from __future__ import annotations

import json
import sqlite3
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from ...config import ARTIFACT_DIR, DATABASE_PATH, INSPECTION_DIR


class BatchRepository:
    """The single persistent source of truth for batches, artifacts and conversations."""

    def __init__(self, database_path: Path = DATABASE_PATH) -> None:
        self.database_path = database_path
        self._lock = threading.RLock()
        self._initialize()
        self._migrate_legacy_json()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path, timeout=30)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA journal_mode = WAL")
        return connection

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS batches (
                    batch_id TEXT PRIMARY KEY,
                    created_at REAL NOT NULL,
                    completed_at REAL,
                    model INTEGER,
                    scenario_id TEXT,
                    dataset_reference TEXT,
                    agent_session_id TEXT NOT NULL,
                    record_json TEXT NOT NULL,
                    updated_at REAL NOT NULL
                );
                CREATE INDEX IF NOT EXISTS batches_completed_idx
                    ON batches(completed_at DESC, created_at DESC);
                CREATE TABLE IF NOT EXISTS artifacts (
                    artifact_id TEXT PRIMARY KEY,
                    batch_id TEXT,
                    sample_id TEXT,
                    kind TEXT NOT NULL,
                    mime_type TEXT NOT NULL,
                    path TEXT NOT NULL UNIQUE,
                    created_at REAL NOT NULL,
                    FOREIGN KEY(batch_id) REFERENCES batches(batch_id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS artifacts_batch_idx ON artifacts(batch_id, sample_id);
                CREATE TABLE IF NOT EXISTS conversations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    batch_id TEXT NOT NULL,
                    role TEXT NOT NULL,
                    content TEXT NOT NULL,
                    render_blocks_json TEXT NOT NULL DEFAULT '[]',
                    created_at REAL NOT NULL,
                    FOREIGN KEY(batch_id) REFERENCES batches(batch_id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS conversations_batch_idx ON conversations(batch_id, id);
                """
            )

    @staticmethod
    def _safe_batch_id(batch_id: str) -> str:
        value = str(batch_id or "").strip().upper()
        if not value.startswith("BAT-") or not value[4:].isalnum() or len(value) > 64:
            raise HTTPException(status_code=400, detail={"code": "invalid_batch_id", "message": "Batch ID is invalid."})
        return value

    @staticmethod
    def _session_id(batch_id: str) -> str:
        return f"astra-{batch_id.lower()}"

    def save_batch(self, record: dict[str, Any]) -> dict[str, Any]:
        batch_id = self._safe_batch_id(record.get("batch_id", ""))
        now = time.time()
        normalized = dict(record)
        normalized["batch_id"] = batch_id
        normalized.setdefault("created_at", now)
        normalized.setdefault("completed_at", now)
        normalized.setdefault("agent_session_id", self._session_id(batch_id))
        dataset_reference = normalized.get("dataset_reference")
        if not dataset_reference:
            dataset_reference = normalized.get("production_context", {}).get("source", {}).get("file")
        payload = json.dumps(normalized, separators=(",", ":"), ensure_ascii=False)
        with self._lock, self._connect() as connection:
            connection.execute(
                """
                INSERT INTO batches(batch_id, created_at, completed_at, model, scenario_id,
                                    dataset_reference, agent_session_id, record_json, updated_at)
                VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(batch_id) DO UPDATE SET
                    completed_at=excluded.completed_at,
                    model=excluded.model,
                    scenario_id=excluded.scenario_id,
                    dataset_reference=excluded.dataset_reference,
                    agent_session_id=excluded.agent_session_id,
                    record_json=excluded.record_json,
                    updated_at=excluded.updated_at
                """,
                (
                    batch_id, normalized["created_at"], normalized.get("completed_at"),
                    normalized.get("model"), normalized.get("scenario_id"), dataset_reference,
                    normalized["agent_session_id"], payload, now,
                ),
            )
        return normalized

    def update_batch(self, batch_id: str, **fields: Any) -> dict[str, Any]:
        record = self.get_batch(batch_id)
        record.update(fields)
        return self.save_batch(record)

    def get_batch(self, batch_id: str) -> dict[str, Any]:
        normalized = self._safe_batch_id(batch_id)
        with self._connect() as connection:
            row = connection.execute("SELECT record_json FROM batches WHERE batch_id = ?", (normalized,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail={"code": "inspection_batch_not_found", "message": f"Inspection batch {normalized} was not found."})
        try:
            return json.loads(row["record_json"])
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=500, detail={"code": "inspection_batch_corrupt", "message": "Stored inspection batch could not be read."}) from exc

    def latest_batch(self) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT record_json FROM batches ORDER BY COALESCE(completed_at, created_at) DESC LIMIT 1"
            ).fetchone()
        return json.loads(row["record_json"]) if row else None

    def list_batches(self, limit: int = 100) -> list[dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT record_json FROM batches ORDER BY COALESCE(completed_at, created_at) DESC LIMIT ?",
                (max(1, min(int(limit), 500)),),
            ).fetchall()
        summaries = []
        for row in rows:
            record = json.loads(row["record_json"])
            summaries.append({
                key: record.get(key)
                for key in (
                    "batch_id", "created_at", "completed_at", "model", "scenario_id",
                    "dataset_reference", "agent_session_id", "total_inspected", "normal",
                    "defective", "unsupported", "evaluated", "defect_rate", "primary_defect", "secondary_defect",
                    "average_coverage", "max_coverage",
                )
            } | {"analysis_status": "ready" if record.get("automatic_analysis") else "evidence_ready"})
        return summaries

    def save_artifact(
        self,
        data: bytes,
        *,
        kind: str,
        mime_type: str = "image/png",
        batch_id: str | None = None,
        sample_id: str | None = None,
    ) -> str:
        normalized_batch = self._safe_batch_id(batch_id) if batch_id else None
        artifact_id = "ART-" + uuid.uuid4().hex.upper()
        suffix = ".png" if mime_type == "image/png" else ".bin"
        folder = ARTIFACT_DIR / (normalized_batch or "standalone")
        folder.mkdir(parents=True, exist_ok=True)
        artifact_path = folder / f"{artifact_id}{suffix}"
        artifact_path.write_bytes(data)
        with self._lock, self._connect() as connection:
            connection.execute(
                "INSERT INTO artifacts(artifact_id, batch_id, sample_id, kind, mime_type, path, created_at) VALUES(?, ?, ?, ?, ?, ?, ?)",
                (artifact_id, normalized_batch, sample_id, kind, mime_type, str(artifact_path), time.time()),
            )
        return artifact_id

    def artifact(self, artifact_id: str) -> tuple[Path, str]:
        value = str(artifact_id or "").strip().upper()
        if not value.startswith("ART-") or not value[4:].isalnum():
            raise HTTPException(status_code=400, detail={"code": "invalid_artifact_id", "message": "Artifact ID is invalid."})
        with self._connect() as connection:
            row = connection.execute("SELECT path, mime_type FROM artifacts WHERE artifact_id = ?", (value,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail={"code": "artifact_not_found", "message": "Artifact was not found."})
        artifact_path = Path(row["path"]).resolve()
        root = ARTIFACT_DIR.resolve()
        if root not in artifact_path.parents or not artifact_path.is_file():
            raise HTTPException(status_code=404, detail={"code": "artifact_not_found", "message": "Artifact was not found."})
        return artifact_path, row["mime_type"]

    def add_message(self, batch_id: str, role: str, content: str, render_blocks: list[dict] | None = None) -> None:
        normalized = self._safe_batch_id(batch_id)
        if role not in {"user", "assistant", "system"}:
            raise HTTPException(status_code=400, detail={"code": "invalid_conversation_role", "message": "Conversation role is invalid."})
        with self._lock, self._connect() as connection:
            exists = connection.execute("SELECT 1 FROM batches WHERE batch_id = ?", (normalized,)).fetchone()
            if not exists:
                raise HTTPException(status_code=404, detail={"code": "inspection_batch_not_found", "message": f"Inspection batch {normalized} was not found."})
            connection.execute(
                "INSERT INTO conversations(batch_id, role, content, render_blocks_json, created_at) VALUES(?, ?, ?, ?, ?)",
                (normalized, role, str(content or "")[:50000], json.dumps(render_blocks or []), time.time()),
            )
            # Bound batch memory to the most recent 24 messages.
            connection.execute(
                "DELETE FROM conversations WHERE batch_id = ? AND id NOT IN (SELECT id FROM conversations WHERE batch_id = ? ORDER BY id DESC LIMIT 24)",
                (normalized, normalized),
            )

    def conversation(self, batch_id: str, limit: int = 24) -> list[dict[str, Any]]:
        normalized = self._safe_batch_id(batch_id)
        self.get_batch(normalized)
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT role, content, render_blocks_json, created_at FROM conversations WHERE batch_id = ? ORDER BY id DESC LIMIT ?",
                (normalized, max(1, min(int(limit), 50))),
            ).fetchall()
        return [
            {
                "role": row["role"], "text": row["content"],
                "render_blocks": json.loads(row["render_blocks_json"] or "[]"),
                "created_at": row["created_at"],
            }
            for row in reversed(rows)
        ]

    def _migrate_legacy_json(self) -> None:
        for legacy_path in INSPECTION_DIR.glob("BAT-*.json"):
            batch_id = legacy_path.stem.upper()
            with self._connect() as connection:
                if connection.execute("SELECT 1 FROM batches WHERE batch_id = ?", (batch_id,)).fetchone():
                    continue
            try:
                record = json.loads(legacy_path.read_text(encoding="utf-8"))
                record["batch_id"] = batch_id
                self.save_batch(record)
                changed = False
                for sample in record.get("results", []):
                    for key, kind in (("original_image", "original"), ("annotated_image", "annotated"), ("mask_image", "mask")):
                        value = sample.get(key)
                        if not isinstance(value, str) or ";base64," not in value:
                            continue
                        import base64
                        raw = base64.b64decode(value.split(",", 1)[1])
                        artifact_id = self.save_artifact(raw, kind=kind, batch_id=batch_id, sample_id=sample.get("sample_id"))
                        sample[key] = f"/api/artifacts/{artifact_id}"
                        sample[f"{kind}_artifact_id"] = artifact_id
                        changed = True
                if changed:
                    self.save_batch(record)
            except Exception:
                # A corrupt legacy cache is deliberately not promoted into the source of truth.
                continue


batch_repository = BatchRepository()
