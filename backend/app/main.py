from __future__ import annotations

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse

from .config import MENDELEY_DOI, MENDELEY_VERSION
from .schemas import AnalysisContextRequest, BatchAnalysisUpdate, ConversationMessageRequest, EconomicsRequest, InvestigationRequest, SimulationRequest
from .services.baseline.service import empirical_baseline
from .services.bottleneck.service import rank_bottlenecks
from .services.economics.service import calculate as calculate_economics
from .services.investigation.service import investigate
from .services.production.store import store
from .services.simulation.service import nearest_scenario
from .services.vision.service import VisionService
from .services.batches.repository import batch_repository
from .services.batches.risk import estimate_defect_risk

app = FastAPI(
    title="Astra Manufacturing Intelligence API",
    version="2.0.0",
    description="Deterministic visual-inspection and manufacturing-intelligence backend.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/", response_class=HTMLResponse)
def root_index() -> str:
    return """<!DOCTYPE html>
<html>
<head><title>ASTRA Manufacturing Intelligence Engine</title><style>body{font-family:system-ui,-apple-system,sans-serif;margin:40px;background:#0d1117;color:#c9d1d9}a{color:#58a6ff;text-decoration:none}a:hover{text-decoration:underline}h1{color:#f0f6fc}.card{background:#161b22;padding:24px;border-radius:8px;border:1px solid #30363d;max-width:640px}ul{line-height:1.8}</style></head>
<body>
<div class="card">
    <h1>ASTRA Engine v2.0</h1>
    <p>Deterministic Visual Inspection &amp; Manufacturing Intelligence API is running.</p>
    <ul>
        <li><a href="/docs">Interactive API Documentation (Swagger UI)</a></li>
        <li><a href="/api/health">System Health Endpoint (/api/health)</a></li>
        <li><a href="/api/models">Manufacturing Models (/api/models)</a></li>
    </ul>
    <p>ASTRA Frontend Dashboard is running at <a href="http://localhost:5173">http://localhost:5173</a>.</p>
</div>
</body>
</html>"""


vision = VisionService()


@app.get("/api/health")
def health() -> dict:
    loaded = [model["id"] for model in store.models() if model["dataset_loaded"]]
    return {
        "status": "healthy" if loaded else "degraded",
        "inspection": "ready",
        "production": "ready" if loaded else "dataset_missing",
        "agentic_reasoning": "external_agent_server",
        "dataset_models_loaded": loaded,
    }


@app.post("/api/inspection/image")
async def inspection_image(file: UploadFile = File(...)) -> dict:
    return await vision.inspect(file)


@app.post("/api/inspection/batch")
async def inspection_batch(
    files: list[UploadFile] = File(...),
    model: int | None = Form(default=None),
    scenario_id: str | None = Form(default=None),
) -> dict:
    if model is not None and model not in (1, 2, 3):
        raise HTTPException(status_code=400, detail={"code": "invalid_model", "message": "Model must be 1, 2, or 3."})
    record = await vision.inspect_batch(files, model=model, scenario_id=scenario_id)
    if model is not None and scenario_id:
        context = _build_analysis_context(model, scenario_id, record["batch_id"])
        record = batch_repository.update_batch(
            record["batch_id"],
            production_context=context["production"],
            bottleneck_evidence=context["bottlenecks"],
            investigation_results=context["investigations"],
            deterministic_analysis=context,
            dataset_reference=context["production"].get("source", {}).get("file"),
        )
    return record


@app.get("/api/inspection/batches/{batch_id}")
def inspection_batch_by_id(batch_id: str, compact: bool = False) -> dict:
    batch = vision.get_batch(batch_id)
    return vision.compact_batch(batch) if compact else batch


@app.get("/api/inspection/latest")
def inspection_latest(compact: bool = False) -> dict:
    batch = vision.latest_batch()
    if batch is None:
        raise HTTPException(status_code=404, detail={"code": "no_inspection_batch", "message": "No inspection batch has been analyzed yet."})
    return vision.compact_batch(batch) if compact else batch


@app.get("/api/batches")
def batch_history(limit: int = Query(100, ge=1, le=500)) -> dict:
    batches = batch_repository.list_batches(limit)
    return {"batches": batches, "count": len(batches)}


@app.get("/api/batches/{batch_id}")
def persisted_batch(batch_id: str, compact: bool = False) -> dict:
    batch = batch_repository.get_batch(batch_id)
    result = vision.compact_batch(batch) if compact else batch
    result["conversation"] = batch_repository.conversation(batch_id)
    return result


@app.get("/api/batches/{batch_id}/analysis")
def persisted_batch_analysis(batch_id: str) -> dict:
    batch = batch_repository.get_batch(batch_id)
    deterministic = batch.get("deterministic_analysis")
    if not deterministic and batch.get("model") and batch.get("scenario_id"):
        deterministic = _build_analysis_context(int(batch["model"]), str(batch["scenario_id"]), batch_id)
        batch = batch_repository.update_batch(batch_id, deterministic_analysis=deterministic)
    return {
        "batch_id": batch_id,
        "deterministic": deterministic,
        "automatic_analysis": batch.get("automatic_analysis"),
        "agent_session_id": batch.get("agent_session_id"),
    }


@app.get("/api/batches/{batch_id}/defect-risk")
def persisted_batch_defect_risk(batch_id: str) -> dict:
    """Return a deterministic defect ranking from stored detector evidence."""
    return estimate_defect_risk(batch_repository.get_batch(batch_id))


@app.put("/api/batches/{batch_id}/analysis")
def update_persisted_batch_analysis(batch_id: str, request: BatchAnalysisUpdate) -> dict:
    analysis = request.model_dump()
    batch_repository.update_batch(batch_id, automatic_analysis=analysis)
    return {"batch_id": batch_id, "automatic_analysis": analysis}


@app.get("/api/batches/{batch_id}/conversation")
def batch_conversation(batch_id: str) -> dict:
    messages = batch_repository.conversation(batch_id)
    return {"batch_id": batch_id, "messages": messages}


@app.post("/api/batches/{batch_id}/conversation")
def append_batch_conversation(batch_id: str, request: ConversationMessageRequest) -> dict:
    batch_repository.add_message(batch_id, request.role, request.content, request.render_blocks)
    return {"batch_id": batch_id, "stored": True}


@app.get("/api/artifacts/{artifact_id}")
def artifact(artifact_id: str) -> FileResponse:
    artifact_path, mime_type = batch_repository.artifact(artifact_id)
    return FileResponse(
        artifact_path,
        media_type=mime_type,
        headers={"Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff"},
    )


@app.get("/api/models")
def models() -> dict:
    return {"models": store.models()}


@app.get("/api/models/{model}/scenarios")
def scenarios(model: int) -> dict:
    return {"model": model, "scenarios": store.scenarios(model)}


@app.get("/api/production/{model}/{scenario_id}")
def production(model: int, scenario_id: str) -> dict:
    result = store.production(model, scenario_id)
    result["baseline"] = empirical_baseline(store, model, scenario_id)
    return result


@app.post("/api/production/upload")
async def production_upload(model: int = Form(...), file: UploadFile = File(...)) -> dict:
    return await store.upload_csv(model, file)


@app.get("/api/csv/files")
def csv_files() -> dict:
    files = store.list_datasets()
    return {"files": files, "count": len(files)}


@app.get("/api/csv/data")
def csv_data(
    file: str = Query(...),
    action: str = Query("head"),
    start_row: int = Query(1, ge=1),
    num_rows: int = Query(10, ge=1, le=100),
) -> dict:
    if action not in {"head", "get_rows"}:
        raise HTTPException(status_code=422, detail={"code": "unsupported_csv_action", "message": "Use head or get_rows for the UI preview endpoint."})
    return store.preview_dataset(file, start_row=start_row, num_rows=num_rows)


@app.get("/api/bottlenecks/{model}/{scenario_id}")
def bottlenecks(model: int, scenario_id: str) -> dict:
    production_data = store.production(model, scenario_id)
    stations = production_data.get("stations", [])
    available = [s for s in stations if any(isinstance(s.get(k), (int, float)) for k in ("utilization", "waiting", "queue", "wip"))]
    if not available:
        return {
            "model": model,
            "scenario_id": scenario_id,
            "bottlenecks": [],
            "status": "unavailable",
            "message": "No station-level numeric signals are available in this dataset scenario.",
        }
    return {
        "model": model,
        "scenario_id": production_data["scenario_id"],
        "bottlenecks": rank_bottlenecks(available),
        "source": production_data.get("source"),
    }


@app.post("/api/investigation")
def investigation(request: InvestigationRequest) -> dict:
    production_data = request.production
    if production_data is None and request.scenario_id:
        production_data = store.production(request.model, request.scenario_id)
    return investigate(request.defect_type, production_data)


def _build_analysis_context(model: int, scenario_id: str, inspection_batch_id: str | None = None) -> dict:
    production_data = store.production(model, scenario_id)
    production_data["baseline"] = empirical_baseline(store, model, production_data["scenario_id"])
    bottleneck_data = {
        "model": model,
        "scenario_id": production_data["scenario_id"],
        "bottlenecks": rank_bottlenecks([
            s for s in production_data.get("stations", [])
            if any(isinstance(s.get(k), (int, float)) for k in ("utilization", "waiting", "queue", "wip"))
        ]),
    }

    batch = None
    if inspection_batch_id:
        batch = vision.compact_batch(vision.get_batch(inspection_batch_id))
    else:
        latest = vision.latest_batch()
        if latest:
            batch = vision.compact_batch(latest)

    investigations = []
    if batch:
        for slot in ("primary_defect", "secondary_defect"):
            defect = batch.get(slot)
            if defect and defect.get("type"):
                investigations.append({
                    "role": "primary" if slot == "primary_defect" else "secondary",
                    "defect": defect,
                    "evidence": investigate(defect["type"], production_data),
                })

    return {
        "production": production_data,
        "bottlenecks": bottleneck_data,
        "inspection": batch,
        "investigations": investigations,
        "traceability": {
            "direct_unit_to_machine_join": False,
            "statement": "Inspection images and production scenarios are analyzed together as evidence streams; no direct unit-to-machine join is present in the supplied datasets.",
        },
        "truth_labels": ["measured", "calculated", "hypothesis", "simulated", "user_assumption", "unavailable"],
    }


@app.post("/api/analysis/context")
def analysis_context(request: AnalysisContextRequest) -> dict:
    if request.inspection_batch_id:
        batch = batch_repository.get_batch(request.inspection_batch_id)
        cached = batch.get("deterministic_analysis")
        if cached and int(batch.get("model") or request.model) == request.model and str(batch.get("scenario_id") or request.scenario_id) == request.scenario_id:
            return cached
    result = _build_analysis_context(request.model, request.scenario_id, request.inspection_batch_id)
    if request.inspection_batch_id:
        batch_repository.update_batch(
            request.inspection_batch_id,
            model=request.model,
            scenario_id=request.scenario_id,
            production_context=result["production"],
            bottleneck_evidence=result["bottlenecks"],
            investigation_results=result["investigations"],
            deterministic_analysis=result,
            dataset_reference=result["production"].get("source", {}).get("file"),
        )
    return result


@app.post("/api/simulation")
def simulation(request: SimulationRequest) -> dict:
    return nearest_scenario(store, request.model, request.scenario_id, request.changes)


@app.post("/api/economics")
def economics(request: EconomicsRequest) -> dict:
    return calculate_economics(request)


@app.get("/api/metadata")
def metadata() -> dict:
    return {
        "product": "Visual Inspection & Manufacturing Intelligence Platform",
        "mendeley": {
            "doi": MENDELEY_DOI,
            "version": MENDELEY_VERSION,
            "local_data": {str(model): store.dataset_metadata(model) for model in (1, 2, 3)},
        },
        "truth_labels": ["measured", "calculated", "hypothesis", "simulated", "user_assumption", "unavailable"],
        "agentic_features": "provided by the separate AGY orchestration server",
    }


@app.get("/api/classes")
def classes() -> list[str]:
    return ["crack", "hole", "rust", "scratch", "normal"]



@app.exception_handler(ValueError)
async def value_error_handler(_, exc: ValueError):
    from fastapi.responses import JSONResponse

    return JSONResponse(
        status_code=400,
        content={"detail": {"code": "invalid_value", "message": str(exc) or "Invalid value."}},
    )
