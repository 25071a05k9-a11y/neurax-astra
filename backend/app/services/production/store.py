from __future__ import annotations

import math
import re
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from fastapi import HTTPException, UploadFile
from scipy.io import loadmat

from ...config import BACKEND_DIR, RAW_DATA_DIR, UPLOAD_DIR, MENDELEY_DOI

MODEL_METADATA = {
    1: {
        "name": "Linear workshop",
        "layout": "sequential process",
        "published_feature_count": 9,
        "published_processes": ["Drilling", "Milling", "Assembly", "Inspection"],
    },
    2: {
        "name": "Sub-assembly plant",
        "layout": "converging sub-assembly process",
        "published_feature_count": 16,
        "published_processes": ["Drilling", "Milling", "Assembly", "Inspection"],
    },
    3: {
        "name": "OEM mega-plant",
        "layout": "flexible manufacturing system",
        "published_feature_count": 77,
        "published_processes": ["Blanking", "Press line", "Assembly cells", "Paint", "Inspection", "Material handling"],
    },
}

MODEL_FILENAMES = {
    1: ("Model_1.csv", "model_1.csv"),
    2: ("Model_2.csv", "model_2.csv"),
    3: ("Model_3_sample.csv", "Model_3.csv", "model_3_sample.csv", "model_3.csv"),
}


@dataclass
class LoadedDataset:
    dataset_id: str
    model: int
    frame: pd.DataFrame
    source_path: Path
    source_kind: str

    @property
    def numeric_columns(self) -> list[str]:
        return [str(c) for c in self.frame.select_dtypes(include=[np.number]).columns]


def _normalise(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", name.strip().lower()).strip("_")


def _finite(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (np.integer, int)):
        return int(value)
    if isinstance(value, (np.floating, float)):
        return float(value) if math.isfinite(float(value)) else None
    return value


def _number(row: pd.Series, column: str) -> float | None:
    if column not in row.index:
        return None
    value = _finite(row[column])
    return float(value) if isinstance(value, (int, float)) else None


def _pct(value: float | None) -> float | None:
    if value is None:
        return None
    # Organizer utilization exports are fractions; preserve already-percent values.
    return round(value * 100.0 if abs(value) <= 1.5 else value, 4)


def _sum_present(values: list[float | None]) -> float | None:
    finite = [float(v) for v in values if v is not None and math.isfinite(float(v))]
    return sum(finite) if finite else None


def _mean_present(values: list[float | None]) -> float | None:
    finite = [float(v) for v in values if v is not None and math.isfinite(float(v))]
    return sum(finite) / len(finite) if finite else None


class ProductionStore:
    def __init__(self) -> None:
        self._datasets: dict[int, LoadedDataset] = {}
        self._known_paths: dict[str, Path] = {}
        self._scan_local_data()

    def _candidate_roots(self) -> list[Path]:
        roots = [RAW_DATA_DIR, BACKEND_DIR, BACKEND_DIR.parent / "sample_data", UPLOAD_DIR]
        return [root for root in roots if root.exists()]

    def _scan_local_data(self) -> None:
        for root in self._candidate_roots():
            for path in root.glob("*.csv"):
                self._known_paths[path.name.lower()] = path

        for model in (1, 2, 3):
            path = None
            for name in MODEL_FILENAMES[model]:
                candidate = self._known_paths.get(name.lower())
                if candidate:
                    path = candidate
                    break
            if path:
                try:
                    self._datasets[model] = self._read_csv(path, model, "bundled_dataset")
                except HTTPException:
                    pass

        mat_candidates = [root / "3000Samplesv3.mat" for root in self._candidate_roots()]
        mat_path = next((p for p in mat_candidates if p.exists()), None)
        if 3 not in self._datasets and mat_path:
            try:
                dataset = self._read_mat(mat_path, 3)
                if dataset:
                    self._datasets[3] = dataset
            except Exception:
                pass

    def _read_csv(self, path: Path, model: int, source_kind: str) -> LoadedDataset:
        try:
            frame = pd.read_csv(path)
        except Exception as exc:
            raise HTTPException(status_code=400, detail={"code": "corrupt_csv", "message": "CSV could not be parsed."}) from exc
        if frame.empty:
            raise HTTPException(status_code=400, detail={"code": "empty_dataset", "message": "Dataset contains no rows."})
        # Drop fully empty organizer-export columns such as Unnamed: 10..21 in Model 1.
        frame = frame.dropna(axis=1, how="all")
        if len(frame.columns) == 0:
            raise HTTPException(status_code=400, detail={"code": "missing_columns", "message": "Dataset contains no usable columns."})
        frame.columns = [str(column).strip() or f"column_{index+1}" for index, column in enumerate(frame.columns)]
        return LoadedDataset(path.stem, model, frame, path, source_kind)

    def _read_mat(self, path: Path, model: int) -> LoadedDataset | None:
        content = loadmat(path, squeeze_me=True)
        arrays = [
            (key, value)
            for key, value in content.items()
            if not key.startswith("__") and isinstance(value, np.ndarray) and value.ndim == 2 and np.issubdtype(value.dtype, np.number)
        ]
        if not arrays:
            return None
        expected = MODEL_METADATA[model]["published_feature_count"]
        arrays.sort(key=lambda item: (item[1].shape[1] != expected, -item[1].shape[0]))
        key, array = arrays[0]
        columns = [f"raw_column_{index+1:03d}" for index in range(array.shape[1])]
        frame = pd.DataFrame(array, columns=columns)
        return LoadedDataset(f"{path.stem}:{key}", model, frame, path, "mendeley_mat_unmapped")

    async def upload_csv(self, model: int, upload: UploadFile) -> dict:
        if model not in MODEL_METADATA:
            raise HTTPException(status_code=404, detail={"code": "invalid_model", "message": "Model must be 1, 2, or 3."})
        filename = upload.filename or "dataset.csv"
        if not filename.lower().endswith(".csv"):
            raise HTTPException(status_code=415, detail={"code": "unsupported_dataset", "message": "Production upload currently accepts CSV files."})
        data = await upload.read(100 * 1024 * 1024 + 1)
        if not data:
            raise HTTPException(status_code=400, detail={"code": "empty_dataset", "message": "Uploaded dataset is empty."})
        if len(data) > 100 * 1024 * 1024:
            raise HTTPException(status_code=413, detail={"code": "dataset_too_large", "message": "CSV uploads must be 100 MB or smaller."})
        safe = re.sub(r"[^A-Za-z0-9._-]+", "_", Path(filename).name)
        path = UPLOAD_DIR / f"model{model}_{uuid.uuid4().hex[:8]}_{safe}"
        path.write_bytes(data)
        try:
            dataset = self._read_csv(path, model, "user_upload")
        except Exception:
            path.unlink(missing_ok=True)
            raise
        self._datasets[model] = dataset
        self._known_paths[path.name.lower()] = path
        return self.dataset_metadata(model)

    def models(self) -> list[dict]:
        result = []
        for model, meta in MODEL_METADATA.items():
            loaded = self._datasets.get(model)
            result.append({
                "id": model,
                "name": meta["name"],
                "published_layout": meta["layout"],
                "published_feature_count": meta["published_feature_count"],
                "published_processes": meta["published_processes"],
                "stations": self.station_names(model),
                "dataset_loaded": loaded is not None,
                "dataset": self.dataset_metadata(model) if loaded else None,
            })
        return result

    def station_names(self, model: int) -> list[str]:
        if model == 1:
            return ["Drilling", "Milling", "Assembly", "Inspection"]
        if model == 2:
            return ["Drilling", "Milling", "Assembly", "Inspection"]
        if model == 3:
            return ["Blanking", "Press line", "Assembly cells", "Paint", "Inspection", "Material handling"]
        return []

    def dataset_metadata(self, model: int) -> dict:
        dataset = self._datasets.get(model)
        if not dataset:
            return {
                "loaded": False,
                "doi": MENDELEY_DOI,
                "message": "No organizer/user dataset is loaded for this model.",
            }
        return {
            "loaded": True,
            "dataset_id": dataset.dataset_id,
            "model": model,
            "rows": int(len(dataset.frame)),
            "columns": [str(c) for c in dataset.frame.columns],
            "numeric_columns": dataset.numeric_columns,
            "source_kind": dataset.source_kind,
            "source_path": dataset.source_path.name,
            "doi": MENDELEY_DOI,
        }

    def scenarios(self, model: int) -> list[dict]:
        if model not in MODEL_METADATA:
            raise HTTPException(status_code=404, detail={"code": "invalid_model", "message": "Unknown model."})
        dataset = self._datasets.get(model)
        if not dataset:
            return []
        return [
            {"id": f"SC-{index+1:04d}", "label": f"Dataset scenario {index+1}", "source": dataset.source_kind}
            for index in range(len(dataset.frame))
        ]

    @staticmethod
    def _scenario_index(scenario_id: str, row_count: int) -> int:
        match = re.fullmatch(r"(?:SC-|ROW-)?(\d+)", str(scenario_id).strip(), flags=re.I)
        if not match:
            raise HTTPException(status_code=404, detail={"code": "invalid_scenario", "message": "Scenario id must be SC-#### or a row number."})
        index = int(match.group(1)) - 1
        if index < 0 or index >= row_count:
            raise HTTPException(status_code=404, detail={"code": "invalid_scenario", "message": "Scenario does not exist in the active dataset."})
        return index

    def _model1(self, row: pd.Series) -> tuple[dict, list[dict], list[str]]:
        required = {
            "Demand", "Total parts", "Parts per hour", "VA Time",
            "Drilling Waiting Time", "Milling Waiting Time", "Assembly Waiting Time",
            "Drilling Util", "Milling Util", "Assembly Util",
        }
        if not required.issubset(row.index):
            return self._generic(row)
        waits = [_number(row, "Drilling Waiting Time"), _number(row, "Milling Waiting Time"), _number(row, "Assembly Waiting Time")]
        metrics = {
            "demand": _number(row, "Demand"),
            "total_parts": _number(row, "Total parts"),
            "throughput": _number(row, "Parts per hour"),
            "cycle_time": _number(row, "VA Time"),
            "waiting_time": _sum_present(waits),
        }
        stations = [
            {"station": "Drilling", "utilization": _pct(_number(row, "Drilling Util")), "waiting": waits[0], "queue": None, "wip": None},
            {"station": "Milling", "utilization": _pct(_number(row, "Milling Util")), "waiting": waits[1], "queue": None, "wip": None},
            {"station": "Assembly", "utilization": _pct(_number(row, "Assembly Util")), "waiting": waits[2], "queue": None, "wip": None},
            {"station": "Inspection", "utilization": None, "waiting": None, "queue": None, "wip": None, "availability": "unavailable"},
        ]
        return metrics, stations, ["wip", "queue", "storage_dwell", "downtime", "changeover"]

    def _model2(self, row: pd.Series) -> tuple[dict, list[dict], list[str]]:
        required = {
            "Demand", "Entities Out", "Drilling Queue Time", "Milling Queue Time", "Assembly Queue Time",
            "Part 1 Storage Time", "Part 2 Storage Time", "Part 1 Stored", "Part 2 Stored",
            "Drilling Utilization", "Milling Utilization", "Assembly Utilization",
        }
        if not required.issubset(row.index):
            return self._generic(row)
        waits = [_number(row, "Drilling Queue Time"), _number(row, "Milling Queue Time"), _number(row, "Assembly Queue Time")]
        p1 = _number(row, "Part 1 Stored")
        p2 = _number(row, "Part 2 Stored")
        s1 = _number(row, "Part 1 Storage Time")
        s2 = _number(row, "Part 2 Storage Time")
        metrics = {
            "demand": _number(row, "Demand"),
            "output": _number(row, "Entities Out"),
            "wip": _sum_present([p1, p2]),
            "waiting_time": _sum_present(waits),
            "storage_dwell": _sum_present([s1, s2]),
        }
        stations = [
            {"station": "Drilling", "utilization": _pct(_number(row, "Drilling Utilization")), "waiting": waits[0], "queue": p1, "wip": p1, "storage_dwell": s1},
            {"station": "Milling", "utilization": _pct(_number(row, "Milling Utilization")), "waiting": waits[1], "queue": p2, "wip": p2, "storage_dwell": s2},
            {"station": "Assembly", "utilization": _pct(_number(row, "Assembly Utilization")), "waiting": waits[2], "queue": None, "wip": None, "cycle_time": _number(row, "Assembly Time")},
            {"station": "Inspection", "utilization": None, "waiting": None, "queue": None, "wip": None, "availability": "unavailable"},
        ]
        return metrics, stations, ["throughput", "cycle_time", "downtime", "changeover"]

    def _model3(self, row: pd.Series) -> tuple[dict, list[dict], list[str]]:
        if "Blanking_Util" not in row.index or "c_TotalProducts" not in row.index:
            return self._generic(row)
        press_utils = [_number(row, f"Press{i}_Util") for i in range(1, 5)]
        press_queues = [_number(row, f"Press{i}_Queue") for i in range(1, 5)]
        cell_utils = [_number(row, f"Cell{i}_Util") for i in range(1, 5)]
        cell_queues = [_number(row, f"Cell{i}_Queue") for i in range(1, 5)]
        paint_utils = [_number(row, "Paint1_Util"), _number(row, "Paint2_Util")]
        paint_queues = [_number(row, "Paint1_Queue"), _number(row, "Paint2_Queue")]
        forklift_queues = [_number(row, "Forklift_Blanking_Queue"), _number(row, "Forklift_Press_Queue"), _number(row, "Forklift_Assembly_Queue")]
        warehouse = [_number(row, "Warehouse1_Queue"), _number(row, "Warehouse_2_Queue"), _number(row, "Warehouse_3_Queue"), _number(row, "Warehouse_4_Queue")]
        all_queues = [
            _number(row, "Blanking_Queue"), *press_queues, *cell_queues, *paint_queues,
            _number(row, "Quality_Queue"), *forklift_queues, *warehouse,
        ]
        wait_times = [_number(row, f"SKU{i}_Wait_Time") for i in range(1, 5)]
        metrics = {
            "output": _number(row, "c_TotalProducts"),
            "queue": _sum_present(all_queues),
            "waiting_time": _mean_present(wait_times),
            "cycle_time": _mean_present([_number(row, f"c_Cycle{i}") for i in range(1, 5)]),
            "time_now": _number(row, "Time_Now"),
        }
        stations = [
            {"station": "Blanking", "utilization": _pct(_number(row, "Blanking_Util")), "queue": _number(row, "Blanking_Queue"), "waiting": None, "wip": _sum_present(warehouse)},
            {"station": "Press line", "utilization": _pct(_mean_present(press_utils)), "queue": _sum_present(press_queues), "waiting": None, "wip": None},
            {"station": "Assembly cells", "utilization": _pct(_mean_present(cell_utils)), "queue": _sum_present(cell_queues), "waiting": None, "wip": None},
            {"station": "Paint", "utilization": _pct(_mean_present(paint_utils)), "queue": _sum_present(paint_queues), "waiting": None, "wip": None},
            {"station": "Inspection", "utilization": _pct(_number(row, "Quality_Util")), "queue": _number(row, "Quality_Queue"), "waiting": None, "wip": None},
            {"station": "Material handling", "utilization": _pct(_number(row, "Forklift_Util")), "queue": _sum_present(forklift_queues), "waiting": None, "wip": None},
        ]
        return metrics, stations, ["demand", "throughput", "storage_dwell", "downtime", "changeover"]

    def _generic(self, row: pd.Series) -> tuple[dict, list[dict], list[str]]:
        normal = {_normalise(str(c)): str(c) for c in row.index}
        aliases = {
            "demand": ["demand", "total_demand", "daily_demand"],
            "throughput": ["throughput", "parts_per_hour", "average_parts_per_hour", "avg_parts_per_hour", "output_rate"],
            "wip": ["wip", "work_in_progress", "inventory", "average_inventory"],
            "yield": ["yield", "first_pass_yield", "fpy"],
            "waiting_time": ["waiting_time", "wait_time", "average_waiting_time"],
            "cycle_time": ["cycle_time", "average_cycle_time", "value_added_time", "average_value_added_time"],
            "queue": ["queue", "queue_length", "average_queue"],
            "storage_dwell": ["storage_dwell", "warehouse_time", "storage_time", "average_storage_time"],
            "output": ["output", "total_output", "entities_out", "total_parts"],
        }
        metrics: dict[str, Any] = {}
        for semantic, names in aliases.items():
            col = next((normal[name] for name in names if name in normal), None)
            if col:
                metrics[semantic] = _number(row, col)
        stations: dict[str, dict[str, Any]] = {}
        patterns = {
            "utilization": [r"(.+)_utili[sz]ation$", r"utili[sz]ation_(.+)$", r"(.+)_util$"],
            "waiting": [r"(.+)_waiting(?:_time)?$", r"waiting(?:_time)?_(.+)$"],
            "queue": [r"(.+)_queue(?:_length)?$", r"queue(?:_length)?_(.+)$"],
            "wip": [r"(.+)_wip$", r"wip_(.+)$"],
        }
        for column in row.index:
            norm = _normalise(str(column))
            for metric, regexes in patterns.items():
                match = next((m for regex in regexes if (m := re.match(regex, norm))), None)
                if not match:
                    continue
                station = match.group(1).replace("_", " ").title()
                value = _number(row, str(column))
                if metric == "utilization":
                    value = _pct(value)
                stations.setdefault(station, {"station": station})[metric] = value
                break
        unavailable = [name for name in aliases if name not in metrics]
        return metrics, list(stations.values()), unavailable

    def production(self, model: int, scenario_id: str) -> dict:
        if model not in MODEL_METADATA:
            raise HTTPException(status_code=404, detail={"code": "invalid_model", "message": "Unknown model."})
        dataset = self._datasets.get(model)
        if not dataset:
            raise HTTPException(status_code=404, detail={"code": "dataset_missing", "message": "No dataset is loaded for this model."})
        index = self._scenario_index(scenario_id, len(dataset.frame))
        row = dataset.frame.iloc[index]
        if model == 1:
            metrics, stations, unavailable = self._model1(row)
        elif model == 2:
            metrics, stations, unavailable = self._model2(row)
        else:
            metrics, stations, unavailable = self._model3(row)
        raw = {str(column): _finite(row[column]) for column in dataset.frame.columns}
        return {
            "model": model,
            "model_name": MODEL_METADATA[model]["name"],
            "scenario_id": f"SC-{index+1:04d}",
            "source": {"kind": dataset.source_kind, "doi": MENDELEY_DOI, "file": dataset.source_path.name, "row": index + 1},
            "metrics": metrics,
            "stations": stations,
            "raw": raw,
            "unavailable": unavailable,
        }

    def frame_for_model(self, model: int) -> LoadedDataset | None:
        return self._datasets.get(model)

    def list_datasets(self) -> list[dict]:
        results = []
        seen: set[Path] = set()
        for model, dataset in self._datasets.items():
            seen.add(dataset.source_path.resolve())
            results.append({
                "id": dataset.source_path.name,
                "name": dataset.source_path.name,
                "model": model,
                "active": True,
                "source_kind": dataset.source_kind,
                "size_bytes": dataset.source_path.stat().st_size if dataset.source_path.exists() else 0,
                "row_count": int(len(dataset.frame)),
                "columns": [str(c) for c in dataset.frame.columns],
            })
        for path in sorted(UPLOAD_DIR.glob("*.csv")):
            if path.resolve() in seen:
                continue
            try:
                frame = pd.read_csv(path, nrows=5)
                results.append({
                    "id": path.name,
                    "name": path.name,
                    "model": None,
                    "active": False,
                    "source_kind": "user_upload",
                    "size_bytes": path.stat().st_size,
                    "row_count": None,
                    "columns": [str(c) for c in frame.columns],
                })
            except Exception:
                continue
        return results

    def preview_dataset(self, filename: str, start_row: int = 1, num_rows: int = 10) -> dict:
        target = Path(filename).name.lower()
        candidates = {dataset.source_path.name.lower(): dataset.source_path for dataset in self._datasets.values()}
        candidates.update({p.name.lower(): p for p in UPLOAD_DIR.glob("*.csv")})
        path = candidates.get(target)
        if not path:
            raise HTTPException(status_code=404, detail={"code": "dataset_not_found", "message": "Dataset file was not found."})
        try:
            frame = pd.read_csv(path, skiprows=range(1, max(1, start_row)), nrows=max(1, min(100, num_rows)))
        except Exception as exc:
            raise HTTPException(status_code=400, detail={"code": "corrupt_csv", "message": "CSV could not be parsed."}) from exc
        frame = frame.dropna(axis=1, how="all")
        rows = []
        for record in frame.to_dict(orient="records"):
            rows.append({str(k): _finite(v) for k, v in record.items()})
        return {"file": path.name, "columns": [str(c) for c in frame.columns], "rows": rows, "total_returned": len(rows), "start_row": start_row}


store = ProductionStore()
