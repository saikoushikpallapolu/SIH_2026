"""OceanScope India — High-Speed Daily SST Acquisition Engine (NCEI HTTPS Direct).

Acquires NOAA/NCEI 0.25-deg Daily OISST v2.1 directly from official NOAA NCEI HTTPS archive:
https://www.ncei.noaa.gov/data/sea-surface-temperature-optimum-interpolation/v2.1/access/avhrr/

Bypasses PSL THREDDS socket dropouts and 429 rate-limits.
Downloads daily files in parallel, crops immediately to the Indian Ocean domain
(lat: -45.0 to 32.0, lon: 20.0 to 125.0), validates physical SST values,
and compiles into standardized yearly NetCDF files.
"""
import os
import sys
import time
import hashlib
import argparse
import datetime
import tempfile
import urllib.request
from pathlib import Path
import concurrent.futures
import numpy as np
import xarray as xr
import pandas as pd

PROJECT_ROOT = Path(__file__).resolve().parents[2]
RAW_SST_DIR = PROJECT_ROOT / "data" / "raw" / "real" / "sst"
PROC_SST_DIR = PROJECT_ROOT / "data" / "processed" / "real" / "sst"
PROC_SST_YEARLY = PROC_SST_DIR / "yearly"

RAW_SST_DIR.mkdir(parents=True, exist_ok=True)
PROC_SST_DIR.mkdir(parents=True, exist_ok=True)
PROC_SST_YEARLY.mkdir(parents=True, exist_ok=True)

LAT_MIN, LAT_MAX = -45.0, 32.0
LON_MIN, LON_MAX = 20.0, 125.0

def sha256sum(filepath: Path) -> str:
    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()

def fetch_single_day(date_str: str) -> tuple:
    """Downloads a single daily file from NCEI, extracts Indian Ocean slice, and returns (date, DataArray)."""
    # date_str format: YYYYMMDD
    ym = date_str[:6]
    url = f"https://www.ncei.noaa.gov/data/sea-surface-temperature-optimum-interpolation/v2.1/access/avhrr/{ym}/oisst-avhrr-v02r01.{date_str}.nc"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (OceanScope India)"})

    max_retries = 3
    for attempt in range(1, max_retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                data = resp.read()

            with tempfile.NamedTemporaryFile(suffix=".nc", delete=False) as tmp:
                tmp.write(data)
                tmp_path = tmp.name

            ds = xr.open_dataset(tmp_path)
            # Squeeze zlev if present
            da_sst = ds["sst"]
            if "zlev" in da_sst.dims:
                da_sst = da_sst.squeeze("zlev", drop=True)

            # Crop to Indian Ocean
            io_sst = da_sst.sel(lat=slice(LAT_MIN, LAT_MAX), lon=slice(LON_MIN, LON_MAX)).load()
            ds.close()
            os.remove(tmp_path)

            v = io_sst.values[~np.isnan(io_sst.values)]
            if len(v) == 0 or (float(v.min()) == 0.0 and float(v.max()) == 0.0):
                raise ValueError("All zero / empty SST values")

            return (date_str, io_sst, None)
        except Exception as e:
            if attempt == max_retries:
                return (date_str, None, str(e))
            time.sleep(2)

def acquire_year_ncei(year: int, max_workers: int = 8) -> bool:
    """Acquires all daily SST files for a given year using parallel NCEI HTTPS transfers."""
    proc_file = PROC_SST_YEARLY / f"sst_oisst_daily_{year}_standard.nc"
    expected_days = 366 if (year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)) else 365

    # Check local cache
    if proc_file.exists() and proc_file.stat().st_size > 10_000_000:
        try:
            ds_chk = xr.open_dataset(proc_file)
            if len(ds_chk.time) == expected_days:
                print(f"[Daily SST {year}] Already complete and verified ({expected_days} days, {proc_file.stat().st_size/(1024*1024):.1f} MB). Skipping.", flush=True)
                ds_chk.close()
                return True
            ds_chk.close()
        except Exception:
            pass

    print("=" * 70, flush=True)
    print(f"ACQUIRING DAILY SST FOR {year} FROM NOAA/NCEI HTTPS ({expected_days} DAYS)", flush=True)
    print("=" * 70, flush=True)

    start_date = datetime.date(year, 1, 1)
    end_date = datetime.date(year, 12, 31)
    day_count = (end_date - start_date).days + 1

    date_strings = [(start_date + datetime.timedelta(days=i)).strftime("%Y%m%d") for i in range(day_count)]

    t0 = time.time()
    daily_slices = {}
    errors = []

    print(f"Dispatching {len(date_strings)} daily downloads with {max_workers} concurrent workers...", flush=True)

    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(fetch_single_day, d): d for d in date_strings}
        completed = 0
        for future in concurrent.futures.as_completed(futures):
            d_str, da, err = future.result()
            completed += 1
            if err:
                errors.append((d_str, err))
                print(f" [{completed}/{day_count}] {d_str} FAILED: {err}", flush=True)
            else:
                daily_slices[d_str] = da
                if completed % 30 == 0 or completed == day_count:
                    pct = (completed / day_count) * 100
                    elapsed = time.time() - t0
                    print(f" Progress: {completed}/{day_count} days ({pct:.1f}%) in {elapsed:.1f}s ({completed/elapsed:.1f} days/s)", flush=True)

    if errors:
        print(f"ERROR: {len(errors)} days failed to download for year {year}!", flush=True)
        return False

    print(f"\nAll {len(daily_slices)} days downloaded in {time.time()-t0:.1f}s. Concatenating into yearly dataset...", flush=True)

    # Sort chronologically
    sorted_dates = sorted(daily_slices.keys())
    ordered_slices = [daily_slices[d] for d in sorted_dates]

    full_year_da = xr.concat(ordered_slices, dim="time")

    # Standardize Dataset
    std_ds = xr.Dataset({"tos_daily": full_year_da})
    std_ds["tos_daily"].attrs = {
        "units": "degC",
        "long_name": "Daily Sea Surface Temperature",
        "standard_name": "sea_surface_temperature",
        "source": "NOAA/NCEI 0.25-deg Daily Optimum Interpolation Sea Surface Temperature (OISST) v2.1",
        "provider": "NOAA National Centers for Environmental Information (NCEI)",
        "spatial_coverage": "Lat: -45.0 to 32.0, Lon: 20.0 to 125.0",
        "year": year,
        "total_days": len(ordered_slices),
    }

    if proc_file.exists():
        proc_file.unlink()

    std_ds.to_netcdf(proc_file)
    sz_mb = proc_file.stat().st_size / (1024 * 1024)
    sha = sha256sum(proc_file)

    vals = full_year_da.values[~np.isnan(full_year_da.values)]
    min_v = float(vals.min())
    max_v = float(vals.max())

    print(f"[Daily SST {year}] SUCCESS: {len(std_ds.time)} days, range [{min_v:.2f}, {max_v:.2f}] degC, {sz_mb:.1f} MB | SHA: {sha}", flush=True)
    return True

def combine_all_daily_sst(start_year: int = 2020, end_year: int = 2024):
    """Combines all yearly daily SST datasets into the master 5-year dataset."""
    master_file = PROC_SST_DIR / "sst_oisst_daily_standard.nc"
    datasets = []
    total_days = 0

    for y in range(start_year, end_year + 1):
        f = PROC_SST_YEARLY / f"sst_oisst_daily_{y}_standard.nc"
        if f.exists():
            ds = xr.open_dataset(f)
            datasets.append(ds)
            total_days += len(ds.time)
        else:
            print(f"Warning: Year {y} missing when compiling master daily SST.")

    if not datasets:
        print("No daily datasets found to combine.")
        return

    print(f"\nCombining {len(datasets)} years ({total_days} total days) into {master_file}...", flush=True)
    combined = xr.concat(datasets, dim="time")

    if master_file.exists():
        master_file.unlink()

    combined.to_netcdf(master_file)
    sz_mb = master_file.stat().st_size / (1024 * 1024)
    sha = sha256sum(master_file)
    print(f"Master Daily SST dataset finalized: {len(combined.time)} days, {sz_mb:.1f} MB | SHA: {sha}", flush=True)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--start-year", type=int, default=2024)
    parser.add_argument("--end-year", type=int, default=2024)
    parser.add_argument("--workers", type=int, default=10)
    args = parser.parse_args()

    for yr in range(args.start_year, args.end_year + 1):
        acquire_year_ncei(yr, max_workers=args.workers)

    combine_all_daily_sst(args.start_year, args.end_year)
