from __future__ import annotations

from typing import Any

import numpy as np

from ..production.store import ProductionStore, _finite


def empirical_baseline(store: ProductionStore, model: int, scenario_id: str) -> dict[str, Any]:
    dataset = store.frame_for_model(model)
    if not dataset:
        return {
            "available": False,
            "reason": "Empirical baseline requires a loaded dataset scenario.",
        }

    index = store._scenario_index(scenario_id, len(dataset.frame))
    if index < 0 or index >= len(dataset.frame):
        return {"available": False, "reason": "Dataset scenario does not exist."}

    frame = dataset.frame
    row = frame.iloc[index]
    metrics: dict[str, dict[str, Any]] = {}
    for column in dataset.numeric_columns:
        series = frame[column].to_numpy(dtype=float)
        finite = series[np.isfinite(series)]
        current = _finite(row[column])
        if current is None or finite.size < 2:
            continue
        percentile = float(np.mean(finite <= float(current)) * 100.0)
        q1, median, q3 = np.percentile(finite, [25, 50, 75])
        if percentile >= 95 or percentile <= 5:
            status = "Critical outlier"
        elif percentile >= 85 or percentile <= 15:
            status = "Elevated deviation"
        else:
            status = "Within typical range"
        metrics[column] = {
            "current": current,
            "percentile": round(percentile, 2),
            "q1": round(float(q1), 6),
            "median": round(float(median), 6),
            "q3": round(float(q3), 6),
            "status": status,
            "kind": "calculated",
        }

    return {
        "available": bool(metrics),
        "scenario_id": scenario_id,
        "population_rows": int(len(frame)),
        "metrics": metrics,
        "method": "Empirical percentile against finite values in the loaded model dataset.",
    }
