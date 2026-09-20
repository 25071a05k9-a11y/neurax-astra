from __future__ import annotations

from typing import Any


DEFECT_CLASSES = ("crack", "hole", "rust", "scratch")
PROBABILITY_WEIGHT = 0.7
OBSERVED_CLASS_WEIGHT = 0.3


def estimate_defect_risk(batch: dict[str, Any]) -> dict[str, Any]:
    """Rank defect risk using only persisted detector evidence.

    This is an empirical evidence score, not a time-series forecast. It blends
    the mean classifier probability with the observed class frequency so the
    answer remains useful while preserving the distinction from causal or
    future-production prediction.
    """

    samples = [sample for sample in batch.get("results", []) if isinstance(sample, dict)]
    if not samples:
        return {
            "batch_id": batch.get("batch_id"),
            "status": "insufficient_evidence",
            "sample_count": 0,
            "ranked_risks": [],
            "method": "No persisted detector samples were available.",
        }

    probability_totals = {name: 0.0 for name in DEFECT_CLASSES}
    probability_samples = 0
    observed_counts = {name: 0 for name in DEFECT_CLASSES}
    source_samples = []

    for sample in samples:
        defect_type = str(sample.get("defect_type") or "").lower()
        if defect_type in observed_counts:
            observed_counts[defect_type] += 1
        probabilities = sample.get("classifier", {}).get("probabilities", {})
        if isinstance(probabilities, dict) and any(
            isinstance(probabilities.get(name), (int, float)) for name in DEFECT_CLASSES
        ):
            probability_samples += 1
            for name in DEFECT_CLASSES:
                value = probabilities.get(name, 0)
                probability_totals[name] += float(value) if isinstance(value, (int, float)) else 0.0
        source_samples.append(
            {
                "sample_id": sample.get("sample_id"),
                "filename": sample.get("filename"),
                "predicted_class": defect_type or None,
                "confidence": sample.get("classifier", {}).get("confidence"),
            }
        )

    rows = []
    for name in DEFECT_CLASSES:
        mean_probability = (
            probability_totals[name] / probability_samples if probability_samples else 0.0
        )
        observed_share = observed_counts[name] / len(samples) * 100.0
        score = (
            PROBABILITY_WEIGHT * mean_probability
            + OBSERVED_CLASS_WEIGHT * observed_share
        )
        rows.append(
            {
                "defect": name,
                "risk_score": round(score, 2),
                "mean_classifier_probability": round(mean_probability, 2),
                "observed_count": observed_counts[name],
                "observed_share": round(observed_share, 2),
                "truth_label": "calculated",
            }
        )

    rows.sort(key=lambda row: (-row["risk_score"], row["defect"]))
    return {
        "batch_id": batch.get("batch_id"),
        "status": "estimated",
        "sample_count": len(samples),
        "likely_defect": rows[0],
        "ranked_risks": rows,
        "method": (
            "Evidence-weighted score = 70% mean classifier probability + "
            "30% observed class frequency in this persisted batch."
        ),
        "weights": {
            "mean_classifier_probability": PROBABILITY_WEIGHT,
            "observed_class_frequency": OBSERVED_CLASS_WEIGHT,
        },
        "source_samples": source_samples,
        "limitations": (
            "This ranks current stored detector evidence; it is not a trained "
            "time-series forecast and does not establish which machine caused a defect."
        ),
    }
