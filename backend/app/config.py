from pathlib import Path

APP_DIR = Path(__file__).resolve().parent
BACKEND_DIR = APP_DIR.parent
DATA_DIR = APP_DIR / "data"
RAW_DATA_DIR = DATA_DIR / "raw"
UPLOAD_DIR = DATA_DIR / "uploads"
CACHE_DIR = DATA_DIR / "cache"
INSPECTION_DIR = CACHE_DIR / "inspections"
ARTIFACT_DIR = DATA_DIR / "artifacts"
DATABASE_PATH = DATA_DIR / "astra.sqlite3"

for directory in (RAW_DATA_DIR, UPLOAD_DIR, CACHE_DIR, INSPECTION_DIR, ARTIFACT_DIR):
    directory.mkdir(parents=True, exist_ok=True)

MENDELEY_DOI = "10.17632/3rw227zxt7.2"
MENDELEY_DATASET_ID = "3rw227zxt7"
MENDELEY_VERSION = 2
