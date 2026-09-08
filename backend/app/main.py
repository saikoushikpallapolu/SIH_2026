from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np
from fastapi import FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from functools import lru_cache
import struct

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
    if lat < -45:
        return "Southern Ocean / Antarctic Belt"
    if lon < 20:
        return "South Atlantic Ocean (Outside Sector)"
    if lon > 125:
        return "Pacific Ocean Sector (Outside Sector)"
    if lat > 32:
        return "Eurasian Sector"

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


def bilinear_slice_2d(
    grid_data: np.ndarray,
    min_lat: float,
    max_lat: float,
    min_lon: float,
    max_lon: float,
    grid_res: int = 96,
) -> np.ndarray:
    """Vectorized bilinear interpolation of a 2D (N_LAT, N_LON) grid onto (grid_res, grid_res)."""
    lats = np.linspace(min_lat, max_lat, grid_res, dtype=np.float32)
    lons = np.linspace(min_lon, max_lon, grid_res, dtype=np.float32)

    i_float = (lats - LAT_MIN) / (LAT_MAX - LAT_MIN) * (N_LAT - 1)
    i0 = np.clip(np.floor(i_float).astype(np.int32), 0, N_LAT - 2)
    i1 = i0 + 1
    fy = (i_float - i0).astype(np.float32)

    j_float = (lons - LON_MIN) / (LON_MAX - LON_MIN) * (N_LON - 1)
    j0 = np.clip(np.floor(j_float).astype(np.int32), 0, N_LON - 2)
    j1 = j0 + 1
    fx = (j_float - j0).astype(np.float32)

    w00 = (1.0 - fy)[:, None] * (1.0 - fx)[None, :]
    w10 = (1.0 - fy)[:, None] * fx[None, :]
    w01 = fy[:, None] * (1.0 - fx)[None, :]
    w11 = fy[:, None] * fx[None, :]

    sliced = (
        w00 * grid_data[i0[:, None], j0[None, :]]
        + w10 * grid_data[i0[:, None], j1[None, :]]
        + w01 * grid_data[i1[:, None], j0[None, :]]
        + w11 * grid_data[i1[:, None], j1[None, :]]
    )
    return sliced.astype(np.float32)


def extract_isoline_segments(
    grid: np.ndarray,
    min_lat: float,
    max_lat: float,
    min_lon: float,
    max_lon: float,
    iso_val: float = 0.0,
    max_segments: int = 400,
) -> list[list[list[float]]]:
    """Extract 2D line segments where grid values cross iso_val using 2D marching squares."""
    nr, nc = grid.shape
    lats = np.linspace(min_lat, max_lat, nr)
    lons = np.linspace(min_lon, max_lon, nc)
    segments: list[list[list[float]]] = []

    for r in range(nr - 1):
        for c in range(nc - 1):
            z00 = float(grid[r, c]) - iso_val
            z01 = float(grid[r, c + 1]) - iso_val
            z10 = float(grid[r + 1, c]) - iso_val
            z11 = float(grid[r + 1, c + 1]) - iso_val

            if (z00 > 0 and z01 > 0 and z10 > 0 and z11 > 0) or (z00 <= 0 and z01 <= 0 and z10 <= 0 and z11 <= 0):
                continue

            pts: list[list[float]] = []
            if (z00 > 0) != (z01 > 0):
                t = -z00 / (z01 - z00) if z01 != z00 else 0.5
                pts.append([round(float(lats[r]), 4), round(float(lons[c] + t * (lons[c + 1] - lons[c])), 4)])
            if (z01 > 0) != (z11 > 0):
                t = -z01 / (z11 - z01) if z11 != z01 else 0.5
                pts.append([round(float(lats[r] + t * (lats[r + 1] - lats[r])), 4), round(float(lons[c + 1]), 4)])
            if (z10 > 0) != (z11 > 0):
                t = -z10 / (z11 - z10) if z11 != z10 else 0.5
                pts.append([round(float(lats[r + 1]), 4), round(float(lons[c] + t * (lons[c + 1] - lons[c])), 4)])
            if (z00 > 0) != (z10 > 0):
                t = -z00 / (z10 - z00) if z10 != z00 else 0.5
                pts.append([round(float(lats[r] + t * (lats[r + 1] - lats[r])), 4), round(float(lons[c]), 4)])

            if len(pts) == 2:
                segments.append(pts)
                if len(segments) >= max_segments:
                    return segments
            elif len(pts) == 4:
                segments.append([pts[0], pts[1]])
                segments.append([pts[2], pts[3]])
                if len(segments) >= max_segments:
                    return segments

    return segments


@app.get("/api/terrain/elevation-slice", response_model=None)
def elevation_slice(
    min_lat: float = Query(..., ge=-60.0, le=40.0),
    max_lat: float = Query(..., ge=-60.0, le=40.0),
    min_lon: float = Query(..., ge=15.0, le=135.0),
    max_lon: float = Query(..., ge=15.0, le=135.0),
    grid_res: int = Query(96, ge=16, le=256),
    format: str = Query("json", pattern="^(json|bin)$"),
) -> Response | dict:
    """Return high-resolution elevation & bathymetry slice from NOAA ETOPO 2022 bedrock grid.

    Supports both binary transport (32-byte header + Float32 array) and JSON.
    """
    if min_lat >= max_lat or min_lon >= max_lon:
        raise HTTPException(status_code=400, detail="Invalid coordinates: min must be strictly less than max.")

    bath = get_bath_memmap()
    if bath is None:
        raise HTTPException(status_code=503, detail="Bathymetry dataset unavailable. Run fetch_bathymetry.py.")

    grid = bilinear_slice_2d(bath, min_lat, max_lat, min_lon, max_lon, grid_res)
    min_elev = float(np.min(grid))
    max_elev = float(np.max(grid))

    if format == "bin":
        # 32-byte header:
        # Magic: b"OCEA" (4B), Version: 1 (uint16), GridRes: uint16,
        # min_lat, max_lat, min_lon, max_lon, min_elev, max_elev (6 x float32)
        header = struct.pack(
            "<4sHHffffff",
            b"OCEA",
            1,
            grid_res,
            float(min_lat),
            float(max_lat),
            float(min_lon),
            float(max_lon),
            float(min_elev),
            float(max_elev),
        )
        return Response(
            content=header + grid.tobytes(),
            media_type="application/octet-stream",
            headers={"Cache-Control": "public, max-age=86400, immutable"},
        )

    # JSON fallback with coastline and contour metadata
    coastline_segments = extract_isoline_segments(grid, min_lat, max_lat, min_lon, max_lon, 0.0, 300)
    shelf_break_segments = extract_isoline_segments(grid, min_lat, max_lat, min_lon, max_lon, -200.0, 200)

    return {
        "dataset": "NOAA NCEI ETOPO 2022 (Bedrock & Ice Surface)",
        "native_resolution_deg": 0.25,
        "native_resolution_km_equator": 27.7,
        "grid_res": grid_res,
        "bounds": {
            "min_lat": min_lat,
            "max_lat": max_lat,
            "min_lon": min_lon,
            "max_lon": max_lon,
        },
        "min_elevation_m": round(min_elev, 1),
        "max_elevation_m": round(max_elev, 1),
        "land_fraction": round(float(np.mean(grid >= 0.0)), 4),
        "ocean_fraction": round(float(np.mean(grid < 0.0)), 4),
        "elevation_grid": [[round(float(v), 1) for v in row] for row in grid],
        "coastline_segments": coastline_segments,
        "shelf_break_segments": shelf_break_segments,
        "key_isobaths_m": [-50, -200, -1000, -2000, -4000],
        "disclaimer": "Coastline and bathymetry are derived from NOAA ETOPO 2022 at native 0.25-degree resolution. Grid resampling increases vertex mesh sampling density for rendering without synthesizing unmeasured sub-kilometer features.",
    }


@app.get("/api/ocean/slice", response_model=None)
def ocean_slice(
    variable: str = Query(..., pattern="^(temperature|salinity|currents_u|currents_v|chlorophyll)$"),
    min_lat: float = Query(..., ge=-60.0, le=40.0),
    max_lat: float = Query(..., ge=-60.0, le=40.0),
    min_lon: float = Query(..., ge=15.0, le=135.0),
    max_lon: float = Query(..., ge=15.0, le=135.0),
    depth: float = Query(0.0, ge=0.0, le=6000.0),
    month: int = Query(292, ge=0, le=299),
    grid_res: int = Query(48, ge=16, le=128),
    format: str = Query("json", pattern="^(json|bin)$"),
) -> Response | dict:
    """Return a 2D dynamic oceanographic data slice for the selected bounding box."""
    if min_lat >= max_lat or min_lon >= max_lon:
        raise HTTPException(status_code=400, detail="Invalid coordinates.")

    month_idx = max(0, min(month, 299))
    bath = get_bath_memmap()
    bath_slice = bilinear_slice_2d(bath, min_lat, max_lat, min_lon, max_lon, grid_res) if bath is not None else None

    # Determine depth level index
    k_idx = 0
    min_dist = float("inf")
    for idx, d in enumerate(DEPTH_LEVELS):
        if abs(d - depth) < min_dist:
            min_dist = abs(d - depth)
            k_idx = idx

    raw_2d: np.ndarray | None = None
    units = "°C"

    if variable == "temperature":
        temp_mem = get_temp_memmap()
        if temp_mem is not None:
            raw_2d = temp_mem[month_idx, k_idx].astype(np.float32)
            units = "°C"
    elif variable == "salinity":
        sal_mem = get_sal_memmap()
        if sal_mem is not None:
            raw_2d = sal_mem[month_idx, k_idx].astype(np.float32)
            units = "PSU"
    elif variable == "currents_u":
        u_mem = get_u_memmap()
        if u_mem is not None:
            raw_2d = u_mem[month_idx].astype(np.float32)
            units = "m/s"
    elif variable == "currents_v":
        v_mem = get_v_memmap()
        if v_mem is not None:
            raw_2d = v_mem[month_idx].astype(np.float32)
            units = "m/s"
    elif variable == "chlorophyll":
        chl_mem = get_chl_memmap()
        if chl_mem is not None:
            raw_2d = chl_mem[month_idx].astype(np.float32)
            units = "mg/m³"

    if raw_2d is None:
        raise HTTPException(status_code=503, detail=f"Dataset for {variable} unavailable.")

    slice_grid = bilinear_slice_2d(raw_2d, min_lat, max_lat, min_lon, max_lon, grid_res)

    # Bedrock cut-off masking: cells on land or deeper than local seabed are masked
    if bath_slice is not None:
        seabed_depth = -bath_slice
        mask = (bath_slice >= 0.0) | (seabed_depth < (depth - 25.0))
        slice_grid[mask] = np.nan

    valid_vals = slice_grid[~np.isnan(slice_grid)]
    min_val = float(np.min(valid_vals)) if len(valid_vals) > 0 else 0.0
    max_val = float(np.max(valid_vals)) if len(valid_vals) > 0 else 0.0

    if format == "bin":
        # Binary representation: NaN replaced by -9999.0f
        export_grid = np.nan_to_num(slice_grid, nan=-9999.0).astype(np.float32)
        header = struct.pack(
            "<4sHHffffff",
            b"OCEA",
            2,
            grid_res,
            float(min_lat),
            float(max_lat),
            float(min_lon),
            float(max_lon),
            float(min_val),
            float(max_val),
        )
        return Response(content=header + export_grid.tobytes(), media_type="application/octet-stream")

    return {
        "variable": variable,
        "units": units,
        "depth_m": DEPTH_LEVELS[k_idx] if variable in ("temperature", "salinity") else 0,
        "month_index": month_idx,
        "grid_res": grid_res,
        "min_val": round(min_val, 2),
        "max_val": round(max_val, 2),
        "grid": [[None if np.isnan(v) else round(float(v), 2) for v in row] for row in slice_grid],
        "provenance": {
            "source": "INCOIS / Copernicus GLORYS 25-Year Reanalysis",
            "spatial_resolution_deg": 0.25,
            "temporal_resolution": "Monthly mean",
        },
    }


@app.get("/api/ocean/profile")
def ocean_profile(
    lat: float = Query(..., ge=-60.0, le=40.0),
    lon: float = Query(..., ge=15.0, le=135.0),
    month: int = Query(292, ge=0, le=299),
) -> dict:
    """Return explicit multi-level CTD depth profile at a user-selected geographic point.

    Performs quantitative vertical gradient analysis (dT/dz, dS/dz). Features are strictly labeled
    as 'Thermocline' or 'Halocline' only when quantitative physical gradient criteria are met.
    """
    i0, i1, j0, j1, w00, w10, w01, w11 = bilinear_weights(lat, lon)
    month_idx = max(0, min(month, 299))

    # 1. Physical seabed depth / land elevation check
    elevation = -3500.0
    bath = get_bath_memmap()
    if bath is not None:
        elevation = float(w00 * bath[i0, j0] + w10 * bath[i0, j1] + w01 * bath[i1, j0] + w11 * bath[i1, j1])

    is_land = elevation >= 0.0
    if is_land:
        return {
            "is_land": True,
            "coordinate": {"lat": round(lat, 4), "lon": round(lon, 4)},
            "elevation_m": round(elevation, 1),
            "status": "continental_landmass",
            "message": "Selected coordinate is on land. No marine water column profile present.",
        }

    seabed_depth_m = round(-elevation, 1)

    # 2. Query 16-level temperature & salinity cubes
    temp_mem = get_temp_memmap()
    sal_mem = get_sal_memmap()

    levels: list[dict[str, Any]] = []
    valid_temps: list[tuple[float, float]] = []  # (depth_m, temp_c)
    valid_sals: list[tuple[float, float]] = []

    for k in range(16):
        d_m = DEPTH_LEVELS[k]
        in_water_column = d_m <= (seabed_depth_m + 35.0)

        temp_c: float | None = None
        sal_psu: float | None = None

        if in_water_column:
            if temp_mem is not None:
                t = float(w00 * temp_mem[month_idx, k, i0, j0] + w10 * temp_mem[month_idx, k, i0, j1] + w01 * temp_mem[month_idx, k, i1, j0] + w11 * temp_mem[month_idx, k, i1, j1])
                temp_c = round(t, 2)
                valid_temps.append((d_m, temp_c))

            if sal_mem is not None:
                s = float(w00 * sal_mem[month_idx, k, i0, j0] + w10 * sal_mem[month_idx, k, i0, j1] + w01 * sal_mem[month_idx, k, i1, j0] + w11 * sal_mem[month_idx, k, i1, j1])
                sal_psu = round(s, 2)
                valid_sals.append((d_m, sal_psu))

        levels.append({
            "depth_m": d_m,
            "in_water_column": in_water_column,
            "temperature_c": temp_c,
            "salinity_psu": sal_psu,
            "bedrock_cutoff": not in_water_column,
        })

    # 3. Quantitative vertical gradient analysis (Thermocline & Halocline)
    max_dT_dz = 0.0
    thermocline_range: list[float] | None = None
    if len(valid_temps) >= 3:
        for i in range(len(valid_temps) - 1):
            z1, t1 = valid_temps[i]
            z2, t2 = valid_temps[i + 1]
            dz = z2 - z1
            if dz > 0:
                grad = abs((t2 - t1) / dz)
                if grad > max_dT_dz:
                    max_dT_dz = grad
                    if grad >= 0.05:  # Standard physical oceanographic threshold: 0.05 °C / meter
                        thermocline_range = [z1, z2]

    thermocline_detected = max_dT_dz >= 0.05 and thermocline_range is not None

    max_dS_dz = 0.0
    halocline_range: list[float] | None = None
    if len(valid_sals) >= 3:
        for i in range(len(valid_sals) - 1):
            z1, s1 = valid_sals[i]
            z2, s2 = valid_sals[i + 1]
            dz = z2 - z1
            if dz > 0:
                grad = abs((s2 - s1) / dz)
                if grad > max_dS_dz:
                    max_dS_dz = grad
                    if grad >= 0.02:  # Threshold: 0.02 PSU / meter
                        halocline_range = [z1, z2]

    halocline_detected = max_dS_dz >= 0.02 and halocline_range is not None

    return {
        "is_land": False,
        "coordinate": {"lat": round(lat, 4), "lon": round(lon, 4)},
        "seabed_depth_m": seabed_depth_m,
        "month_index": month_idx,
        "levels": levels,
        "thermocline": {
            "detected": thermocline_detected,
            "classification": "Thermocline" if thermocline_detected else "Temperature Profile",
            "max_gradient_c_per_m": round(max_dT_dz, 4),
            "depth_range_m": thermocline_range,
        },
        "halocline": {
            "detected": halocline_detected,
            "classification": "Halocline" if halocline_detected else "Salinity Profile",
            "max_gradient_psu_per_m": round(max_dS_dz, 4),
            "depth_range_m": halocline_range,
        },
        "provenance": {
            "source": "INCOIS / Copernicus GLORYS 25-Year Reanalysis",
            "bathymetry_source": "NOAA ETOPO 2022 (0.25° native resolution)",
        },
    }

