from __future__ import annotations

import asyncio
import base64
import hashlib
import time
import uuid
from typing import Iterable

import cv2
import numpy as np
from fastapi import HTTPException, UploadFile

from ..batches.repository import batch_repository
from .defect_detector import DefectDetector

_ALLOWED_TYPES = {"image/png", "image/jpeg", "image/webp"}
_MAX_BYTES = 10 * 1024 * 1024


class VisionService:
    def __init__(self) -> None:
        self.detector = DefectDetector()
        if self.detector.classifier is None:
            raise RuntimeError("The supplied defect classifier could not be loaded; refusing to use a fabricated heuristic fallback.")

    @staticmethod
    async def _read_upload(upload: UploadFile) -> tuple[str, bytes]:
        if upload.content_type not in _ALLOWED_TYPES:
            raise HTTPException(status_code=415, detail={"code": "unsupported_image", "message": "Use PNG, JPEG, or WebP images."})
        data = await upload.read(_MAX_BYTES + 1)
        if not data:
            raise HTTPException(status_code=400, detail={"code": "empty_image", "message": "The uploaded image is empty."})
        if len(data) > _MAX_BYTES:
            raise HTTPException(status_code=413, detail={"code": "image_too_large", "message": "Images must be 10 MB or smaller."})
        return upload.filename or "image", data

    def _inspect_bytes(self, filename: str, raw: bytes) -> dict:
        image = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
        if image is None:
            raise HTTPException(status_code=400, detail={"code": "invalid_image", "message": f"{filename} could not be decoded as an image."})
        started = time.perf_counter()
        try:
            result = self.detector.analyze(image, mode="auto")
        except Exception as exc:
            raise HTTPException(status_code=500, detail={"code": "detector_error", "message": f"The supplied detector could not process {filename}."}) from exc
        elapsed = round((time.perf_counter() - started) * 1000, 2)
        image_size = result["image_size"]
        overall = result.get("overall_box")
        coverage = float(overall.get("coverage_pct", 0.0)) if overall else 0.0
        sample_id = "IMG-" + hashlib.sha256(raw).hexdigest()[:12].upper()
        classifier = result.get("ai_prediction") or {}
        return {
            "sample_id": sample_id,
            "filename": filename,
            "defect_type": result["defect_type"],
            "has_defect": bool(result["has_defect"]),
            "image_width": int(image_size["width"]),
            "image_height": int(image_size["height"]),
            "overall_box": overall,
            "components": result.get("components", []),
            "coverage_percent": coverage,
            "original_image": self.detector.encode_base64(image),
            "annotated_image": self.detector.encode_base64(result["annotated_bgr"]),
            "mask_image": self.detector.encode_base64(result["mask_bgr"]),
            "processing_ms": elapsed,
            "classifier": classifier,
            "error": result.get("error"),
            "provenance": {
                "detector": "backend/app/services/vision/defect_detector.py",
                "classifier": "backend/app/services/vision/defect_classifier.joblib",
                "result_kind": "measured/calculated from uploaded image",
            },
        }

    async def inspect(self, upload: UploadFile) -> dict:
        filename, raw = await self._read_upload(upload)
        result = await asyncio.to_thread(self._inspect_bytes, filename, raw)
        return self._materialize_artifacts(result)

    @staticmethod
    def _decode_data_uri(value: str) -> tuple[bytes, str]:
        header, encoded = value.split(",", 1)
        mime_type = header.removeprefix("data:").split(";", 1)[0] or "image/png"
        return base64.b64decode(encoded), mime_type

    def _materialize_artifacts(self, result: dict, batch_id: str | None = None) -> dict:
        stored = dict(result)
        sample_id = stored.get("sample_id")
        for key, kind in (("original_image", "original"), ("annotated_image", "annotated"), ("mask_image", "mask")):
            value = stored.get(key)
            if not isinstance(value, str) or ";base64," not in value:
                continue
            raw, mime_type = self._decode_data_uri(value)
            artifact_id = batch_repository.save_artifact(
                raw, kind=kind, mime_type=mime_type, batch_id=batch_id, sample_id=sample_id
            )
            stored[key] = f"/api/artifacts/{artifact_id}"
            stored[f"{kind}_artifact_id"] = artifact_id
        return stored

    @staticmethod
    def _summary(results: list[dict]) -> dict:
        counts: dict[str, int] = {}
        for result in results:
            key = str(result["defect_type"]).lower()
            counts[key] = counts.get(key, 0) + 1
        total = len(results)
        unsupported = counts.get("unsupported", 0)
        evaluated = max(0, total - unsupported)
        defective = sum(
            1
            for result in results
            if result["has_defect"]
            and str(result["defect_type"]).lower() != "unsupported"
        )
        coverages = [float(result["coverage_percent"]) for result in results]
        representatives: dict[str, list[dict]] = {}
        for defect in sorted(counts):
            candidates = [r for r in results if str(r["defect_type"]).lower() == defect]
            candidates.sort(key=lambda item: float(item["coverage_percent"]), reverse=True)
            representatives[defect] = [
                {
                    "sample_id": r["sample_id"],
                    "filename": r["filename"],
                    "coverage_percent": r["coverage_percent"],
                    "annotated_image": r["annotated_image"],
                }
                for r in candidates[:3]
            ]
        defect_counts = {k: v for k, v in counts.items() if k != "normal" and k != "unsupported"}
        ranked = sorted(defect_counts.items(), key=lambda item: (-item[1], item[0]))
        primary = ranked[0] if ranked else None
        secondary = ranked[1] if len(ranked) > 1 else None
        mean_coverage = sum(coverages) / total if total else 0.0
        variance = sum((value - mean_coverage) ** 2 for value in coverages) / total if total else 0.0
        outlier_threshold = mean_coverage + variance ** 0.5
        unusual = [result for result in results if float(result["coverage_percent"]) > outlier_threshold]
        unusual.sort(key=lambda item: float(item["coverage_percent"]), reverse=True)
        return {
            "total_inspected": total,
            "normal": counts.get("normal", 0),
            "defective": defective,
            "unsupported": unsupported,
            "evaluated": evaluated,
            "pass_rate": round(counts.get("normal", 0) / evaluated * 100, 2) if evaluated else 0.0,
            "defect_rate": round(defective / evaluated * 100, 2) if evaluated else 0.0,
            "counts": counts,
            "class_percentages": {key: round(value / total * 100, 2) for key, value in counts.items()} if total else {},
            "average_coverage": round(mean_coverage, 3),
            "max_coverage": max(coverages, default=0.0),
            "primary_defect": {"type": primary[0], "count": primary[1], "percent": round(primary[1] / total * 100, 2)} if primary else None,
            "secondary_defect": {"type": secondary[0], "count": secondary[1], "percent": round(secondary[1] / total * 100, 2)} if secondary else None,
            "representative_samples": representatives,
            "unusual_samples": [
                {
                    "sample_id": item["sample_id"],
                    "filename": item["filename"],
                    "defect_type": item["defect_type"],
                    "coverage_percent": item["coverage_percent"],
                    "annotated_image": item["annotated_image"],
                    "reason": "coverage above the batch mean plus one standard deviation",
                }
                for item in unusual[:5]
            ],
        }

    async def inspect_batch(
        self,
        uploads: Iterable[UploadFile],
        *,
        model: int | None = None,
        scenario_id: str | None = None,
    ) -> dict:
        files = list(uploads)
        if not files:
            raise HTTPException(status_code=400, detail={"code": "empty_batch", "message": "Upload at least one image."})
        payloads = [await self._read_upload(upload) for upload in files]
        raw_results = await asyncio.gather(*[
            asyncio.to_thread(self._inspect_bytes, filename, raw) for filename, raw in payloads
        ])
        batch_id = "BAT-" + uuid.uuid4().hex[:12].upper()
        created_at = time.time()
        # Insert the parent row before artifact rows so SQLite can enforce ownership.
        batch_repository.save_batch({
            "batch_id": batch_id,
            "created_at": created_at,
            "completed_at": None,
            "model": model,
            "scenario_id": scenario_id,
            "status": "materializing_artifacts",
            "results": [],
        })
        results = [self._materialize_artifacts(result, batch_id) for result in raw_results]
        summary = self._summary(results)
        record = {
            "batch_id": batch_id,
            "created_at": created_at,
            "completed_at": time.time(),
            "model": model,
            "scenario_id": scenario_id,
            "status": "complete",
            **summary,
            "results": results,
        }
        return batch_repository.save_batch(record)

    def get_batch(self, batch_id: str) -> dict:
        return batch_repository.get_batch(batch_id)

    def latest_batch(self) -> dict | None:
        return batch_repository.latest_batch()

    @staticmethod
    def compact_batch(record: dict) -> dict:
        return {
            key: record.get(key)
            for key in (
                "batch_id", "total_inspected", "normal", "defective", "unsupported", "evaluated", "pass_rate", "defect_rate",
                "counts", "class_percentages", "average_coverage", "max_coverage",
                "primary_defect", "secondary_defect",
                "representative_samples", "unusual_samples", "model", "scenario_id",
                "agent_session_id", "automatic_analysis", "production_context",
            )
        } | {
            "samples": [
                {
                    "sample_id": item["sample_id"],
                    "filename": item["filename"],
                    "defect_type": item["defect_type"],
                    "has_defect": item["has_defect"],
                    "coverage_percent": item["coverage_percent"],
                    "overall_box": item["overall_box"],
                    "components": item["components"],
                    "classifier": item.get("classifier"),
                    "original_image": item.get("original_image"),
                    "annotated_image": item.get("annotated_image"),
                    "mask_image": item.get("mask_image"),
                    "original_artifact_id": item.get("original_artifact_id"),
                    "annotated_artifact_id": item.get("annotated_artifact_id"),
                    "mask_artifact_id": item.get("mask_artifact_id"),
                }
                for item in record.get("results", [])
            ]
        }
