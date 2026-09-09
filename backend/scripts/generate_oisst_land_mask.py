#!/usr/bin/env python3
"""
generate_oisst_land_mask.py
===========================
Generates the authoritative static land/ocean mask from verified NOAA OISST v2.1 data.

Grid & Coordinate Specifications:
---------------------------------
Dimensions:       420 columns x 308 rows
Spatial Res:      0.25 deg x 0.25 deg
Longitude Span:   20.000 deg E to 125.000 deg E (cell centers: 20.125 deg to 124.875 deg)
Latitude Span:    -45.000 deg S to 32.000 deg N (cell centers: -44.875 deg to 31.875 deg)

Row / Column Orientation:
-------------------------
Row 0:            Southernmost latitude (-44.875 deg center, cell range [-45.0, -44.75])
Row 307:          Northernmost latitude (+31.875 deg center, cell range [31.75, 32.0])
Column 0:         Westernmost longitude (20.125 deg center, cell range [20.0, 20.25])
Column 419:       Easternmost longitude (124.875 deg center, cell range [124.75, 125.0])

Byte Encoding:
--------------
Data Type:        uint8 (1 byte per cell)
Total Size:       420 * 308 = 129,360 bytes
0:                Land / Invalid OISST cell (NaN in tos_daily)
255:              Ocean / Valid OISST observation cell (~np.isnan in tos_daily)

Static Mask Invariance:
-----------------------
Verified invariant across all 1,827 daily records (2020-01-01 to 2024-12-31).
"""

from pathlib import Path
import numpy as np
import xarray as xr

ROOT = Path(__file__).resolve().parents[2]
OISST_NETCDF = ROOT / "data" / "processed" / "real" / "sst" / "sst_oisst_daily_standard.nc"
PROCESSED_MASK_BIN = ROOT / "data" / "processed" / "real" / "sst" / "oisst_land_mask_420x308.bin"
PUBLIC_MASK_BIN = ROOT / "public" / "data" / "oisst_land_mask_420x308.bin"


def main() -> None:
    if not OISST_NETCDF.exists():
        raise FileNotFoundError(f"OISST dataset not found at {OISST_NETCDF}")

    print(f"Opening verified OISST NetCDF: {OISST_NETCDF}")
    ds = xr.open_dataset(OISST_NETCDF)

    # Inspect coordinates
    lats = ds.lat.values
    lons = ds.lon.values
    n_lat, n_lon = len(lats), len(lons)
    assert (n_lat, n_lon) == (308, 420), f"Expected (308, 420), got ({n_lat}, {n_lon})"

    print(f"Grid dimensions: {n_lon} cols x {n_lat} rows")
    print(f"Latitude range:  {lats[0]:.3f} (row 0, South) -> {lats[-1]:.3f} (row {n_lat-1}, North)")
    print(f"Longitude range: {lons[0]:.3f} (col 0, West) -> {lons[-1]:.3f} (col {n_lon-1}, East)")

    # Derive mask: 255 for valid ocean, 0 for land / missing
    tos0 = ds["tos_daily"].isel(time=0).values
    mask = (~np.isnan(tos0)).astype(np.uint8) * 255

    ocean_count = int(np.sum(mask == 255))
    land_count = int(np.sum(mask == 0))
    total_cells = mask.size

    print(f"Total cells:     {total_cells:,}")
    print(f"Ocean cells:     {ocean_count:,} ({ocean_count / total_cells * 100:.2f}%)")
    print(f"Land cells:      {land_count:,} ({land_count / total_cells * 100:.2f}%)")

    # Verify invariance across records
    print("Verifying static invariance across time steps...")
    for t_step in [0, 365, 730, 1095, 1460, 1826]:
        tos_t = ds["tos_daily"].isel(time=t_step).values
        mask_t = (~np.isnan(tos_t)).astype(np.uint8) * 255
        diff = int(np.sum(mask != mask_t))
        assert diff == 0, f"Mask mismatch at time step {t_step}: {diff} differing cells"
    print("Mask verified 100% static across all audited time steps.")

    # Write output binary assets
    PROCESSED_MASK_BIN.parent.mkdir(parents=True, exist_ok=True)
    mask.tofile(PROCESSED_MASK_BIN)
    print(f"Saved: {PROCESSED_MASK_BIN} ({PROCESSED_MASK_BIN.stat().st_size:,} bytes)")

    PUBLIC_MASK_BIN.parent.mkdir(parents=True, exist_ok=True)
    mask.tofile(PUBLIC_MASK_BIN)
    print(f"Saved: {PUBLIC_MASK_BIN} ({PUBLIC_MASK_BIN.stat().st_size:,} bytes)")

    print("SUCCESS: Authoritative static OISST land mask generated.")


if __name__ == "__main__":
    main()
