from __future__ import annotations

from io import BytesIO

import cv2
import numpy as np
from fastapi.testclient import TestClient

from app.main import app
from app.services.production.store import store
from app.services.vision.service import VisionService

client = TestClient(app)


def _png_bytes() -> bytes:
    image = np.full((128, 128, 3), 190, dtype=np.uint8)
    cv2.line(image, (18, 24), (108, 93), (50, 50, 50), 2)
    ok, buffer = cv2.imencode(".png", image)
    assert ok
    return buffer.tobytes()


def test_health_and_models() -> None:
    health = client.get("/api/health")
    assert health.status_code == 200
    assert health.json()["status"] == "healthy"
    models = client.get("/api/models")
    assert models.status_code == 200
    assert [item["id"] for item in models.json()["models"]] == [1, 2, 3]


def test_single_image_detector_returns_real_artifacts() -> None:
    response = client.post(
        "/api/inspection/image",
        files={"file": ("surface.png", _png_bytes(), "image/png")},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["sample_id"].startswith("IMG-")
    assert body["defect_type"] in {"crack", "hole", "rust", "scratch", "normal"}
    for key in ("annotated_image", "mask_image", "original_image"):
        assert body[key].startswith("/api/artifacts/ART-")
        artifact = client.get(body[key])
        assert artifact.status_code == 200
        assert artifact.headers["content-type"] == "image/png"
        assert artifact.content.startswith(b"\x89PNG")
    assert isinstance(body["components"], list)
    assert body["processing_ms"] >= 0


def test_batch_aggregation() -> None:
    payload = _png_bytes()
    response = client.post(
        "/api/inspection/batch",
        files=[
            ("files", ("one.png", payload, "image/png")),
            ("files", ("two.png", payload, "image/png")),
        ],
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total_inspected"] == 2
    assert body["normal"] + body["defective"] == 2
    assert len(body["results"]) == 2
    stored = client.get(f"/api/batches/{body['batch_id']}")
    assert stored.status_code == 200
    assert stored.json()["batch_id"] == body["batch_id"]
    history = client.get("/api/batches").json()["batches"]
    assert any(item["batch_id"] == body["batch_id"] for item in history)
    risk = client.get(f"/api/batches/{body['batch_id']}/defect-risk")
    assert risk.status_code == 200
    estimate = risk.json()
    assert estimate["status"] == "estimated"
    assert estimate["sample_count"] == 2
    assert len(estimate["ranked_risks"]) == 4
    assert estimate["likely_defect"]["truth_label"] == "calculated"
    assert sum(item["risk_score"] for item in estimate["ranked_risks"]) > 0


def test_unsupported_images_are_excluded_from_quality_rates() -> None:
    summary = VisionService._summary(
        [
            {
                "sample_id": "IMG-HOLE",
                "filename": "hole.png",
                "defect_type": "hole",
                "has_defect": True,
                "coverage_percent": 8.0,
                "annotated_image": "/api/artifacts/hole",
            },
            {
                "sample_id": "IMG-RGB",
                "filename": "rgb.png",
                "defect_type": "unsupported",
                "has_defect": False,
                "coverage_percent": 0.0,
                "annotated_image": "/api/artifacts/rgb",
            },
        ]
    )
    assert summary["evaluated"] == 1
    assert summary["unsupported"] == 1
    assert summary["defective"] == 1
    assert summary["pass_rate"] == 0.0
    assert summary["defect_rate"] == 100.0


def test_invalid_image_is_structured_error() -> None:
    response = client.post(
        "/api/inspection/image",
        files={"file": ("bad.png", b"not-an-image", "image/png")},
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "invalid_image"


def test_bundled_production_for_all_three_models_uses_real_dataset_rows() -> None:
    for model in (1, 2, 3):
        scenarios = client.get(f"/api/models/{model}/scenarios").json()["scenarios"]
        assert scenarios
        response = client.get(f"/api/production/{model}/{scenarios[0]["id"]}")
        assert response.status_code == 200
        body = response.json()
        assert body["source"]["kind"] in {"bundled_dataset", "user_upload", "mendeley_mat_unmapped"}
        assert body["source"]["file"]
        assert body["source"]["row"] == 1
        assert body["baseline"]["available"] is True
        assert body["baseline"]["population_rows"] >= 1


def test_invalid_scenario() -> None:
    response = client.get("/api/production/1/NOPE")
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "invalid_scenario"


def test_bottleneck_exposes_multifactor_calculation() -> None:
    response = client.get("/api/bottlenecks/1/SC-2048")
    assert response.status_code == 200
    body = response.json()
    assert len(body["bottlenecks"]) >= 1
    assert all(item["station"] != "Inspection" for item in body["bottlenecks"])
    assert "evidence" in body["bottlenecks"][0]
    assert "normalization" in body["bottlenecks"][0]


def test_investigation_is_hypothesis_not_root_cause_claim() -> None:
    response = client.post(
        "/api/investigation",
        json={"model": 2, "scenario_id": "SC-2048", "defect_type": "rust"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["classification"] == "hypothesis"
    assert body["direct_traceability"] == "Not available"


def test_economics_requires_explicit_assumptions() -> None:
    unavailable = client.post("/api/economics", json={})
    assert unavailable.status_code == 200
    assert unavailable.json()["status"] == "Economic data unavailable"
    calculated = client.post(
        "/api/economics",
        json={"scrap_units": 3, "scrap_cost_per_unit": 12.5},
    )
    assert calculated.status_code == 200
    assert calculated.json()["calculated"]["scrap_loss"]["value"] == 37.5


def test_csv_upload_real_scenarios_baseline_and_simulation(tmp_path) -> None:
    original = store.frame_for_model(1)
    csv = (
        "demand,throughput,assembly_utilization,assembly_queue\n"
        "100,88,70,2\n"
        "120,91,82,4\n"
        "150,95,96,8\n"
    ).encode()
    response = client.post(
        "/api/production/upload",
        data={"model": "1"},
        files={"file": ("organizer.csv", csv, "text/csv")},
    )
    assert response.status_code == 200, response.text
    production = client.get("/api/production/1/ROW-000001")
    assert production.status_code == 200
    body = production.json()
    assert body["metrics"]["demand"] == 100
    assert body["stations"][0]["station"] == "Assembly"
    assert body["baseline"]["available"] is True
    assert body["baseline"]["population_rows"] == 3

    simulation = client.post(
        "/api/simulation",
        json={"model": 1, "scenario_id": "ROW-000001", "changes": {"demand": 145}},
    )
    assert simulation.status_code == 200, simulation.text
    sim = simulation.json()
    assert sim["label"] == "Simulated / Advisory"
    assert sim["matched_scenario"] == "SC-0003"

    uploaded_path = store.frame_for_model(1).source_path
    # Keep this test from changing the process-global store for later tests.
    if original is None:
        store._datasets.pop(1, None)
    else:
        store._datasets[1] = original
    if uploaded_path.exists() and (original is None or uploaded_path != original.source_path):
        uploaded_path.unlink(missing_ok=True)


def test_invalid_csv() -> None:
    response = client.post(
        "/api/production/upload",
        data={"model": "2"},
        files={"file": ("bad.csv", b'"unterminated', "text/csv")},
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "corrupt_csv"
