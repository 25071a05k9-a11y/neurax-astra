"""Compatibility launcher for ASTRA's FastAPI backend.

The application implementation lives in :mod:`app.main`.  Keep this file so
older launch instructions that run ``python app.py`` still start the same
single source of truth instead of the retired demo HTTP server.
"""

from __future__ import annotations

import uvicorn


if __name__ == "__main__":
    uvicorn.run("app.main:app", host="127.0.0.1", port=5000, reload=False)
