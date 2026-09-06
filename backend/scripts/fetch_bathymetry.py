"""Fetch Indian Ocean Bathymetry & Seafloor Relief from NOAA ETOPO 2022.

Downloads the 0.25-degree Indian Ocean bedrock elevation grid and produces:
1. data/processed/terrain/bathymetry_io.bin (Float32 raw elevation array)
2. data/processed/terrain/bathymetry_meta.json (Coordinate bounds & metrics)
3. data/processed/terrain/bathymetry_mask.png (Land/Ocean mask)
4. data/processed/terrain/bathymetry_relief.png (Normalized depth texture for WebGL dual-scale shaders)
"""
from __future__ import annotations

import json
import urllib.request
from pathlib import Path
import numpy as np
from PIL import Image

PROJECT_ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = PROJECT_ROOT / "data" / "processed" / "terrain"
OUT_DIR.mkdir(parents=True, exist_ok=True)

ERDDAP_URL = (
    "https://oceanwatch.pifsc.noaa.gov/erddap/griddap/ETOPO_2022_v1_60s.json?"
    "z[(-45.0):15:(32.0)][(20.0):15:(125.0)]"
)


def fetch_bathymetry():
    print(f"Fetching Indian Ocean Bathymetry from NOAA ETOPO 2022...")
    req = urllib.request.Request(ERDDAP_URL, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=40) as response:
        payload = json.loads(response.read().decode("utf-8"))

    rows = payload.get("table", {}).get("rows", [])
    print(f"Received {len(rows)} coordinate points.")

    # Parse coordinates and elevations
    lats = sorted(list({r[0] for r in rows}))
    lons = sorted(list({r[1] for r in rows}))
    n_lat, n_lon = len(lats), len(lons)
    print(f"Grid dimensions: {n_lat} latitudes x {n_lon} longitudes")

    grid = np.zeros((n_lat, n_lon), dtype=np.float32)
    lat_to_idx = {lat: i for i, lat in enumerate(lats)}
    lon_to_idx = {lon: j for j, lon in enumerate(lons)}

    for lat, lon, elevation in rows:
        i = lat_to_idx[lat]
        j = lon_to_idx[lon]
        grid[i, j] = float(elevation) if elevation is not None else 0.0

    # Save raw float32 binary array
    bin_path = OUT_DIR / "bathymetry_io.bin"
    grid.tofile(bin_path)
    print(f"Wrote Float32 binary grid to: {bin_path} ({bin_path.stat().st_size / 1024:.1f} KB)")

    # Metadata
    meta = {
        "dataset": "NOAA NCEI ETOPO 2022 (Bedrock & Ice Surface)",
        "spatial_resolution_deg": 0.25,
        "n_lat": n_lat,
        "n_lon": n_lon,
        "lat_min": float(lats[0]),
        "lat_max": float(lats[-1]),
        "lon_min": float(lons[0]),
        "lon_max": float(lons[-1]),
        "min_depth_meters": float(np.min(grid)),
        "max_elevation_meters": float(np.max(grid)),
        "ocean_coverage_percent": float(np.mean(grid < 0) * 100),
    }
    meta_path = OUT_DIR / "bathymetry_meta.json"
    meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(f"Wrote metadata: {meta_path}")

    # Generate Land/Water Mask (White = Water, Black = Land)
    mask = (grid < 0).astype(np.uint8) * 255
    # Flip vertically for standard equirectangular texture (North = top)
    mask_img = Image.fromarray(np.flipud(mask))
    mask_path = OUT_DIR / "bathymetry_mask.png"
    mask_img.save(mask_path)
    print(f"Wrote land/water mask to: {mask_path}")

    # Generate Bathymetric Depth Relief Texture for 3D shaders
    # Normalize ocean depths (-7200m to 0m) to 0..255 for displacement mapping
    ocean_depths = np.clip(-grid, 0, 7500)
    norm_depth = (ocean_depths / 7500.0 * 255).astype(np.uint8)
    depth_img = Image.fromarray(np.flipud(norm_depth))
    depth_path = OUT_DIR / "bathymetry_relief.png"
    depth_img.save(depth_path)
    print(f"Wrote bathymetric displacement relief texture to: {depth_path}")

    print("Bathymetry processing COMPLETE!")


if __name__ == "__main__":
    fetch_bathymetry()
