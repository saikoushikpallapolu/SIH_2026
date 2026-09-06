from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np
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

LAT_MIN, LAT_MAX = -45.0, 32.0
LON_MIN, LON_MAX = 20.0, 125.0
N_LAT, N_LON = 309, 421
DEPTH_LEVELS = [0, 10, 25, 50, 75, 100, 150, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000]

app = FastAPI(title="OceanScope India 25-Year Data Engine API", version="0.3.0")
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

# Global memmap handles
_bath_memmap: np.ndarray | None = None
_temp_memmap: np.ndarray | None = None
_sal_memmap: np.ndarray | None = None
_u_memmap: np.ndarray | None = None
_v_memmap: np.ndarray | None = None
_chl_memmap: np.ndarray | None = None


def get_bath_memmap() -> np.ndarray | None:
    global _bath_memmap
    p = TERRAIN_DIR / "bathymetry_io.bin"
    if _bath_memmap is None and p.exists():
        _bath_memmap = np.memmap(p, dtype=np.float32, mode="r", shape=(N_LAT, N_LON))
    return _bath_memmap


def get_temp_memmap() -> np.ndarray | None:
    global _temp_memmap
    p = CUBES_DIR / "temperature_25yr.bin"
    if _temp_memmap is None and p.exists():
        _temp_memmap = np.memmap(p, dtype=np.float16, mode="r", shape=(300, 16, N_LAT, N_LON))
    return _temp_memmap


def get_sal_memmap() -> np.ndarray | None:
    global _sal_memmap
    p = CUBES_DIR / "salinity_25yr.bin"
    if _sal_memmap is None and p.exists():
        _sal_memmap = np.memmap(p, dtype=np.float16, mode="r", shape=(300, 16, N_LAT, N_LON))
    return _sal_memmap


def get_u_memmap() -> np.ndarray | None:
    global _u_memmap
    p = CUBES_DIR / "currents_u_25yr.bin"
    if _u_memmap is None and p.exists():
        _u_memmap = np.memmap(p, dtype=np.float16, mode="r", shape=(300, N_LAT, N_LON))
    return _u_memmap


def get_v_memmap() -> np.ndarray | None:
    global _v_memmap
    p = CUBES_DIR / "currents_v_25yr.bin"
    if _v_memmap is None and p.exists():
        _v_memmap = np.memmap(p, dtype=np.float16, mode="r", shape=(300, N_LAT, N_LON))
    return _v_memmap


def get_chl_memmap() -> np.ndarray | None:
    global _chl_memmap
    p = CUBES_DIR / "chlorophyll_25yr.bin"
    if _chl_memmap is None and p.exists():
        _chl_memmap = np.memmap(p, dtype=np.float16, mode="r", shape=(300, N_LAT, N_LON))
    return _chl_memmap


def get_db_connection() -> sqlite3.Connection | None:
    if DB_PATH.exists():
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        return conn
    return None


def identify_basin(lat: float, lon: float) -> str:
    """Identify the Indian Ocean marine basin or feature from coordinates."""
    if lat > 10 and lon < 43.5:
        return "Red Sea / Bab-el-Mandeb"
    if lat > 23 and 45 <= lon <= 56.5:
        return "Persian Gulf / Strait of Hormuz"
    if lat >= 10 and 43.5 <= lon <= 51:
        return "Gulf of Aden"
    if lat >= 0 and 51 <= lon <= 77.5:
        return "Arabian Sea Basin"
    if lat >= 0 and 77.5 < lon <= 92:
        return "Bay of Bengal"
    if 0 <= lat <= 16 and 92 < lon <= 100:
        return "Andaman Sea Basin"
    if -26 <= lat <= -10 and 35 <= lon <= 48:
        return "Mozambique Channel"
    if lat < -30 and lon < 40:
        return "Agulhas Retroflection Region"
    if -5 <= lat <= 12 and 42 <= lon <= 55:
        return "Somali Current Marine Upwelling"
    if -14 <= lat <= -4 and 100 <= lon <= 118:
        return "Java / Sunda Trench"
    if -34 <= lat <= 10 and 87 <= lon <= 93:
        return "Ninety East Ridge Basin"
    if -22 <= lat <= 2 and 65 <= lon <= 90:
        return "Central Indian Basin"
    if -35 <= lat <= -15 and 55 <= lon <= 75:
        return "Southwest Indian Ridge"
    if lat < -25:
        return "Southern Indian Ocean"
    if -5 <= lat <= 5:
        return "Equatorial Indian Ocean"
    return "Indian Ocean Pelagic Waters"


def bilinear_weights(lat: float, lon: float) -> tuple[int, int, int, int, float, float, float, float]:
    i_f = (lat - LAT_MIN) / (LAT_MAX - LAT_MIN) * (N_LAT - 1)
    j_f = (lon - LON_MIN) / (LON_MAX - LON_MIN) * (N_LON - 1)
    i_f = max(0.0, min(float(N_LAT - 1), i_f))
    j_f = max(0.0, min(float(N_LON - 1), j_f))
    i0 = min(int(i_f), N_LAT - 2)
    j0 = min(int(j_f), N_LON - 2)
    i1 = i0 + 1
    j1 = j0 + 1
    u = j_f - j0
    v = i_f - i0
    w00 = (1.0 - u) * (1.0 - v)
    w10 = u * (1.0 - v)
    w01 = (1.0 - u) * v
    w11 = u * v
    return i0, i1, j0, j1, w00, w10, w01, w11


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "service": "oceanscope-25yr-data-engine",
        "time": datetime.now(UTC).isoformat(),
        "database_ready": DB_PATH.exists(),
        "cubes_ready": (CUBES_DIR / "temperature_25yr.bin").exists(),
        "terrain_ready": (TERRAIN_DIR / "bathymetry_io.bin").exists(),
    }


@app.get("/catalog")
def catalog() -> dict:
    """Return the 25-year dataset inventory, dimensions, epochs, and coordinate bounds."""
    meta_path = CUBES_DIR / "ocean_fields_25yr_meta.json"
    if meta_path.exists():
        return json.loads(meta_path.read_text(encoding="utf-8"))
    return {
        "dataset_name": "OceanScope India 25-Year Ocean Atlas",
        "temporal_range": {"start": "2000-01-15T00:00:00Z", "end": "2024-12-15T00:00:00Z", "total_months": 300},
        "depth_levels_m": DEPTH_LEVELS,
        "grid": {"n_lat": N_LAT, "n_lon": N_LON, "lat_range": [LAT_MIN, LAT_MAX], "lon_range": [LON_MIN, LON_MAX]}
    }


@app.get("/api/telemetry/subgrid")
def subgrid_telemetry(
    lat: float = Query(..., ge=-60.0, le=40.0),
    lon: float = Query(..., ge=15.0, le=135.0),
    depth: float = Query(0.0, ge=0.0, le=6000.0),
    month: int = Query(299, ge=0, le=299),
) -> dict[str, Any]:
    """Continuous 4D sub-grid bilinear interpolation across the 25-year data cubes."""
    i0, i1, j0, j1, w00, w10, w01, w11 = bilinear_weights(lat, lon)
    basin = identify_basin(lat, lon)

    # 1. Bathymetry seabed elevation
    elevation_m = -3500.0
    bath = get_bath_memmap()
    if bath is not None:
        elevation_m = float(w00 * bath[i0, j0] + w10 * bath[i0, j1] + w01 * bath[i1, j0] + w11 * bath[i1, j1])

    is_land = elevation_m > 0.0

    # 2. Temperature profile
    temp_mem = get_temp_memmap()
    temp_profile: list[float] = []
    if temp_mem is not None and not is_land:
        for k in range(16):
            val = w00 * temp_mem[month, k, i0, j0] + w10 * temp_mem[month, k, i0, j1] + w01 * temp_mem[month, k, i1, j0] + w11 * temp_mem[month, k, i1, j1]
            temp_profile.append(round(float(val), 2))
    else:
        # Physical fallbacks if cube is missing or on land
        temp_profile = [28.5, 28.3, 27.8, 26.2, 24.1, 21.0, 17.5, 14.2, 10.5, 7.2, 5.1, 4.0, 3.2, 2.7, 2.4, 2.1]

    # 3. Salinity profile
    sal_mem = get_sal_memmap()
    sal_profile: list[float] = []
    if sal_mem is not None and not is_land:
        for k in range(16):
            val = w00 * sal_mem[month, k, i0, j0] + w10 * sal_mem[month, k, i0, j1] + w01 * sal_mem[month, k, i1, j0] + w11 * sal_mem[month, k, i1, j1]
            sal_profile.append(round(float(val), 2))
    else:
        sal_profile = [35.2, 35.2, 35.3, 35.4, 35.5, 35.4, 35.2, 35.0, 34.9, 34.8, 34.7, 34.7, 34.7, 34.7, 34.7, 34.7]

    # 4. Currents & Chlorophyll
    u_mem, v_mem, chl_mem = get_u_memmap(), get_v_memmap(), get_chl_memmap()
    current_u = 0.0
    current_v = 0.0
    chlorophyll = 0.15
    if u_mem is not None and not is_land:
        current_u = round(float(w00 * u_mem[month, i0, j0] + w10 * u_mem[month, i0, j1] + w01 * u_mem[month, i1, j0] + w11 * u_mem[month, i1, j1]), 3)
    if v_mem is not None and not is_land:
        current_v = round(float(w00 * v_mem[month, i0, j0] + w10 * v_mem[month, i0, j1] + w01 * v_mem[month, i1, j0] + w11 * v_mem[month, i1, j1]), 3)
    if chl_mem is not None and not is_land:
        chlorophyll = round(float(w00 * chl_mem[month, i0, j0] + w10 * chl_mem[month, i0, j1] + w01 * chl_mem[month, i1, j0] + w11 * chl_mem[month, i1, j1]), 3)

    current_speed = round(float(np.sqrt(current_u**2 + current_v**2)), 3)

    # 5. Interpolate temperature at the requested depth
    def interpolate_depth(curve: list[float], target_depth: float) -> float:
        if target_depth <= DEPTH_LEVELS[0]:
            return curve[0]
        if target_depth >= DEPTH_LEVELS[-1]:
            return curve[-1]
        for idx in range(len(DEPTH_LEVELS) - 1):
            d0, d1 = DEPTH_LEVELS[idx], DEPTH_LEVELS[idx + 1]
            if d0 <= target_depth <= d1:
                frac = (target_depth - d0) / (d1 - d0)
                return round(curve[idx] * (1.0 - frac) + curve[idx + 1] * frac, 2)
        return curve[0]

    current_depth_temp = interpolate_depth(temp_profile, depth)
    current_depth_sal = interpolate_depth(sal_profile, depth)

    return {
        "coordinate": {"latitude": round(lat, 5), "longitude": round(lon, 5)},
        "basin": basin,
        "is_land": is_land,
        "elevation_m": round(elevation_m, 1),
        "seabed_depth_m": round(abs(min(0.0, elevation_m)), 1),
        "requested_depth_m": depth,
        "temperature_c": current_depth_temp,
        "salinity_psu": current_depth_sal,
        "chlorophyll_mg_m3": chlorophyll,
        "current_speed_m_s": current_speed,
        "current_vector": {"u": current_u, "v": current_v},
        "depth_levels_m": DEPTH_LEVELS,
        "ctd_profile": {
            "temperatures": temp_profile,
            "salinities": sal_profile,
        },
        "month_index": month,
        "source": "OceanScope 4D Dual-Scale Binary Engine"
    }


@app.get("/api/currents/vectors")
def currents_vectors(
    month: int = Query(292, ge=0, le=299),
    stride: int = Query(6, ge=2, le=20),
    min_speed: float = Query(0.04, ge=0.0),
) -> dict:
    """Return sampled velocity vector field (lat, lon, u, v, speed, heading_deg) across the Indian Ocean."""
    u_mem = get_u_memmap()
    v_mem = get_v_memmap()
    bath = get_bath_memmap()

    vectors = []
    lats = np.linspace(LAT_MIN, LAT_MAX, N_LAT)
    lons = np.linspace(LON_MIN, LON_MAX, N_LON)

    if u_mem is not None and v_mem is not None:
        u_slice = u_mem[month]
        v_slice = v_mem[month]
        for i in range(0, N_LAT, stride):
            lat = float(lats[i])
            for j in range(0, N_LON, stride):
                if bath is not None and bath[i, j] >= 0.0:
                    continue
                u_val = float(u_slice[i, j])
                v_val = float(v_slice[i, j])
                speed = float(np.sqrt(u_val * u_val + v_val * v_val))
                if speed < min_speed:
                    continue
                # Heading in degrees clockwise from North (0=N, 90=E, 180=S, 270=W)
                heading = float((np.degrees(np.arctan2(u_val, v_val)) + 360.0) % 360.0)
                vectors.append({
                    "lat": round(lat, 3),
                    "lon": round(float(lons[j]), 3),
                    "u": round(u_val, 3),
                    "v": round(v_val, 3),
                    "speed": round(speed, 3),
                    "knots": round(speed * 1.94384, 2),
                    "heading": round(heading, 1),
                })

    return {
        "month": month,
        "stride": stride,
        "count": len(vectors),
        "vectors": vectors,
    }



@app.get("/api/telemetry/transect")
def transect_telemetry(
    lat1: float = Query(..., ge=-60.0, le=40.0),
    lon1: float = Query(..., ge=15.0, le=135.0),
    lat2: float = Query(..., ge=-60.0, le=40.0),
    lon2: float = Query(..., ge=15.0, le=135.0),
    samples: int = Query(30, ge=5, le=100),
    month: int = Query(299, ge=0, le=299),
) -> dict:
    """Return 2D vertical cross-section transect between points A and B."""
    bath = get_bath_memmap()
    temp_mem = get_temp_memmap()

    points = []
    # Earth radius in km ~ 6371
    # Haversine distance
    dlat = np.radians(lat2 - lat1)
    dlon = np.radians(lon2 - lon1)
    a_hav = np.sin(dlat / 2.0)**2 + np.cos(np.radians(lat1)) * np.cos(np.radians(lat2)) * np.sin(dlon / 2.0)**2
    total_dist_km = 6371.0 * 2.0 * np.arcsin(np.sqrt(a_hav))

    for s in range(samples):
        t = s / max(1, samples - 1)
        lat = lat1 + t * (lat2 - lat1)
        lon = lon1 + t * (lon2 - lon1)
        i0, i1, j0, j1, w00, w10, w01, w11 = bilinear_weights(lat, lon)

        elevation = -3500.0
        if bath is not None:
            elevation = float(w00 * bath[i0, j0] + w10 * bath[i0, j1] + w01 * bath[i1, j0] + w11 * bath[i1, j1])

        temps = []
        if temp_mem is not None:
            for k in range(16):
                val = w00 * temp_mem[month, k, i0, j0] + w10 * temp_mem[month, k, i0, j1] + w01 * temp_mem[month, k, i1, j0] + w11 * temp_mem[month, k, i1, j1]
                temps.append(round(float(val), 2))
        else:
            temps = [27.0 - k * 1.5 for k in range(16)]

        points.append({
            "step": s,
            "dist_km": round(t * total_dist_km, 1),
            "latitude": round(lat, 4),
            "longitude": round(lon, 4),
            "elevation_m": round(elevation, 1),
            "depth_profile": temps,
        })

    return {
        "start": {"latitude": lat1, "longitude": lon1},
        "end": {"latitude": lat2, "longitude": lon2},
        "total_distance_km": round(total_dist_km, 1),
        "samples_count": samples,
        "depth_levels_m": DEPTH_LEVELS,
        "transect_nodes": points,
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
