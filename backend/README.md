# Astra deterministic backend

FastAPI backend for the existing Astra React manufacturing-intelligence UI. It intentionally contains no LLM, agent framework, or chat reasoning service.

## Setup

From `backend/`:

```bash
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

The supplied `defect_detector.py` and `defect_classifier.joblib` are copied unchanged into `app/services/vision/` and wrapped by `VisionService`.

## Organizer dataset

The configured source is Mendeley Data DOI `10.17632/3rw227zxt7.2` (version 2). The backend never invents organizer columns. If local data is absent, production endpoints report the dataset as unavailable. ASTRA does not substitute frontend fixtures or fabricated scenario values; empirical baselines and nearest-neighbor what-if matching require a real loaded dataset.

Download the organizer files from Mendeley Data, then copy them into the predictable data directory with:

```bash
python scripts/bootstrap_dataset.py path/to/downloaded-file
```

CSV files named `model1*.csv`, `model2*.csv`, or `model3*.csv` in `app/data/raw/` are detected on startup. `3000Samplesv3.mat` is also detected for Model 3, but because the MAT file does not carry semantic column names in the loader, its columns are exposed only as `raw_column_###` until an authoritative schema mapping is supplied. CSV data can also be uploaded through `POST /api/production/upload`.

## API

- `GET /api/health`
- `POST /api/inspection/image`
- `POST /api/inspection/batch`
- `GET /api/models`
- `GET /api/models/{model}/scenarios`
- `GET /api/production/{model}/{scenario_id}`
- `POST /api/production/upload`
- `GET /api/bottlenecks/{model}/{scenario_id}`
- `POST /api/investigation`
- `POST /api/simulation`
- `POST /api/economics`
- `GET /api/metadata`

## Tests

```bash
python -m pytest -q
```
