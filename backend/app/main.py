from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parents[2]
PROCESSED_DIR = ROOT / "data" / "processed"
CUBES_DIR = PROCESSED_DIR / "cubes"
TERRAIN_DIR = PROCESSED_DIR / "terrain"
TEXTURES_DIR = PROCESSED_DIR / "textures"
OBS_FILE = PROCESSED_DIR / "observations" / "instruments_catalog.json"
DB_PATH = PROCESSED_DIR / "oceanscope.db"

app = FastAPI(title="OceanScope India 25-Year Data Engine API", version="0.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["GET"],
    allow_headers=["*"],
)

# Mount static asset folders if present
if TEXTURES_DIR.exists():
    app.mount("/static/textures", StaticFiles(directory=str(TEXTURES_DIR)), name="textures")
if TERRAIN_DIR.exists():
    app.mount("/static/terrain", StaticFiles(directory=str(TERRAIN_DIR)), name="terrain")


def get_db_connection() -> sqlite3.Connection | None:
    if DB_PATH.exists():
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        return conn
    return None


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "service": "oceanscope-25yr-data-engine",
        "time": datetime.now(UTC).isoformat(),
        "database_ready": DB_PATH.exists(),
        "cubes_ready": (CUBES_DIR / "temperature_25yr.bin").exists()
    }


@app.get("/catalog")
def catalog() -> dict:
    """Return the 25-year dataset inventory, dimensions, epochs, and coordinate bounds."""
    meta_path = CUBES_DIR / "ocean_fields_25yr_meta.json"
    if meta_path.exists():
        return json.loads(meta_path.read_text(encoding="utf-8"))
    return {
        "dataset_name": "OceanScope India 25-Year Ocean Atlas (Pending Ingestion)",
        "temporal_range": {"start": "2000-01-15T00:00:00Z", "end": "2024-12-15T00:00:00Z", "total_months": 300},
        "depth_levels_m": [0, 10, 25, 50, 75, 100, 150, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000]
    }


@app.get("/observations")
def observations(kind: str | None = None) -> list[dict]:
    """Return normalized in-situ instrument summaries (Argo, BGC-Argo, Gliders)."""
    if OBS_FILE.exists():
        records = json.loads(OBS_FILE.read_text(encoding="utf-8"))
        if kind:
            return [r for r in records if r.get("kind", "").lower() == kind.lower()]
        return records

    conn = get_db_connection()
    if conn:
        cursor = conn.cursor()
        query = "SELECT id, kind, name, region, latitude, longitude, surface_temp as temperature, surface_sal as salinity, max_depth as depth, timestamp FROM argo_profiles"
        rows = cursor.execute(query).fetchall()
        conn.close()
        return [dict(r) for r in rows]
    return []


@app.get("/observations/{instrument_id}/profile")
def profile(instrument_id: str) -> dict:
    """Return full measured CTD depth profile (Temperature, Salinity, Depth)."""
    conn = get_db_connection()
    if conn:
        cursor = conn.cursor()
        row = cursor.execute(
            "SELECT * FROM argo_profiles WHERE id = ? OR platform_id = ?",
            (instrument_id, instrument_id)
        ).fetchone()
        if row:
            item = dict(row)
            item["depths"] = json.loads(item.get("depths_json", "[]"))
            item["temperatures"] = json.loads(item.get("temps_json", "[]"))
            item["salinities"] = json.loads(item.get("sals_json", "[]"))
            conn.close()
            return item
        conn.close()

    # Check fallback observations
    if OBS_FILE.exists():
        for r in json.loads(OBS_FILE.read_text(encoding="utf-8")):
            if str(r.get("id")).lower() == instrument_id.lower():
                return r

    raise HTTPException(status_code=404, detail=f"No instrument profile found for {instrument_id}")


@app.get("/api/events/tsunami2004")
def tsunami_event() -> dict:
    """Return the December 26, 2004 Indian Ocean Tsunami propagation simulation."""
    tsunami_file = CUBES_DIR / "tsunami_2004_hourly.json"
    if tsunami_file.exists():
        return json.loads(tsunami_file.read_text(encoding="utf-8"))
    raise HTTPException(status_code=404, detail="Tsunami 2004 dataset not found. Run fetch_tsunami_2004.py.")


@app.get("/api/terrain/bathymetry")
def bathymetry_info() -> dict:
    """Return Indian Ocean bathymetry coordinate bounds and metrics."""
    meta_path = TERRAIN_DIR / "bathymetry_meta.json"
    if meta_path.exists():
        return json.loads(meta_path.read_text(encoding="utf-8"))
    raise HTTPException(status_code=404, detail="Bathymetry not found. Run fetch_bathymetry.py.")
