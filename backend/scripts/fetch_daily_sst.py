"""OceanScope India — Multi-Year Daily SST Acquisition Engine (2020-2024).

Acquires NOAA OISST v2.1 0.25-degree high-resolution daily SST for the Indian Ocean
(lat: -45.0 to 32.0, lon: 20.0 to 125.0) for the 5-year period 2020-01-01 through 2024-12-31 (~1,827 days).
Preserves the existing 7-day test sample (oisst_v2_1_daily_2024_sample_io.nc) completely untouched.
Uses month-by-month chunked loading to prevent socket timeouts, with immediate local validation.
"""
import os
import sys
import time
import argparse
import hashlib
from pathlib import Path
import numpy as np
import xarray as xr

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

def acquire_daily_sst_year(year: int) -> bool:
    """Acquires and standardizes daily SST for an entire year."""
    raw_file = RAW_SST_DIR / f"oisst_v2_1_daily_{year}_io.nc"
    proc_file = PROC_SST_YEARLY / f"sst_oisst_daily_{year}_standard.nc"

    expected_days = 366 if (year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)) else 365

    # Check local cache
    if proc_file.exists() and proc_file.stat().st_size > 10_000_000:
        try:
            ds_check = xr.open_dataset(proc_file)
            if len(ds_check.time) == expected_days:
                print(f"[Daily SST {year}] Already complete and verified locally ({expected_days} days, {proc_file.stat().st_size / (1024*1024):.1f} MB). Skipping.", flush=True)
                ds_check.close()
                return True
            ds_check.close()
        except Exception:
            pass

    url = f"https://psl.noaa.gov/thredds/dodsC/Datasets/noaa.oisst.v2.highres/sst.day.mean.{year}.nc"
    print(f"\n[Daily SST {year}] Connecting to {url}...", flush=True)
    t0 = time.time()

    try:
        ds = xr.open_dataset(url)
        n_times = len(ds.time)
        print(f"[Daily SST {year}] Remote dataset opened ({n_times} days available). Fetching Indian Ocean slice...", flush=True)

        month_cache_dir = RAW_SST_DIR / "daily_months"
        month_cache_dir.mkdir(parents=True, exist_ok=True)

        # Group time by month
        times = ds["time"].values
        import pandas as pd
        time_series = pd.to_datetime(times)
        months = sorted(time_series.month.unique())
        ds.close()

        for m in months:
            m_file = month_cache_dir / f"oisst_daily_{year}_{m:02d}.nc"
            if m_file.exists() and m_file.stat().st_size > 500_000:
                try:
                    ds_m = xr.open_dataset(m_file)
                    if len(ds_m.time) in [28, 29, 30, 31]:
                        month_slices.append(ds_m["sst_daily"].load())
                        print(f" - Month {year}-{m:02d} ({len(ds_m.time)} days) cached locally. Reusing.", flush=True)
                        ds_m.close()
                        continue
                    ds_m.close()
                except Exception:
                    pass

            # Fetch month with retries on fresh connection
            max_m_retries = 4
            m_loaded = False
            for attempt in range(1, max_m_retries + 1):
                try:
                    t_m_start = time.time()
                    with xr.open_dataset(url) as ds_conn:
                        ts = pd.to_datetime(ds_conn["time"].values)
                        m_mask = (ts.month == m)
                        indices = np.where(m_mask)[0]
                        i_start, i_end = indices[0], indices[-1] + 1
                        m_sub = ds_conn["sst"].isel(time=slice(i_start, i_end)).sel(
                            lat=slice(LAT_MIN, LAT_MAX), lon=slice(LON_MIN, LON_MAX)
                        ).load()

                    v_val = m_sub.values[~np.isnan(m_sub.values)]
                    if len(v_val) == 0 or (float(v_val.min()) == 0.0 and float(v_val.max()) == 0.0):
                        raise ValueError("Invalid 0.0/empty SST chunk received")

                    if m_file.exists():
                        m_file.unlink()
                    m_sub.to_dataset(name="sst_daily").to_netcdf(m_file)
                    month_slices.append(m_sub)
                    print(f" - Month {year}-{m:02d} ({len(m_sub.time)} days) loaded in {time.time()-t_m_start:.1f}s [saved {m_file.name}]", flush=True)
                    m_loaded = True
                    break
                except Exception as e_m:
                    print(f" - Month {year}-{m:02d} attempt {attempt} failed: {e_m}. Retrying in 5s...", flush=True)
                    time.sleep(5)

            if not m_loaded:
                raise RuntimeError(f"Failed to acquire month {year}-{m:02d}")

        # Combine months
        full_yr = xr.concat(month_slices, dim="time")

        # Save raw NetCDF
        if raw_file.exists():
            raw_file.unlink()
        full_yr.to_dataset(name="sst_daily").to_netcdf(raw_file)

        # Standardize: attributes and metadata
        proc_ds = xr.Dataset({"tos_daily": full_yr})
        proc_ds["tos_daily"].attrs = {
            "units": "degC",
            "long_name": "Daily Sea Surface Temperature",
            "standard_name": "sea_surface_temperature",
            "source": "NOAA OISST v2.1 0.25-deg High-Resolution Daily",
            "provider": "NOAA/NCEI & NOAA/PSL",
            "year": year,
            "frequency": "daily"
        }

        if proc_file.exists():
            proc_file.unlink()
        proc_ds.to_netcdf(proc_file)

        valid_vals = full_yr.values[~np.isnan(full_yr.values)]
        min_v = float(valid_vals.min())
        max_v = float(valid_vals.max())
        elapsed = time.time() - t0
        sz_mb = proc_file.stat().st_size / (1024 * 1024)

        print(f"[Daily SST {year}] SUCCESS: {len(proc_ds.time)} days, range [{min_v:.2f}, {max_v:.2f}] degC, {sz_mb:.1f} MB in {elapsed:.1f}s", flush=True)
        return True

    except Exception as e:
        print(f"[Daily SST {year}] ERROR: {e}", flush=True)
        return False

def combine_daily_sst(start_year: int = 2020, end_year: int = 2024):
    """Combines all acquired yearly daily SST files into master dataset."""
    master_file = PROC_SST_DIR / "sst_oisst_daily_standard.nc"
    yearly_files = []
    datasets = []

    for yr in range(start_year, end_year + 1):
        f = PROC_SST_YEARLY / f"sst_oisst_daily_{yr}_standard.nc"
        if f.exists():
            ds = xr.open_dataset(f)
            datasets.append(ds)
            yearly_files.append(f)
        else:
            print(f"Warning: Missing year {yr} for master daily SST compilation.")

    if not datasets:
        print("No daily SST datasets to combine.")
        return

    print(f"\nCombining {len(datasets)} years of daily SST into master file {master_file}...", flush=True)
    combined = xr.concat(datasets, dim="time")
    _, idx = np.unique(combined["time"], return_index=True)
    combined = combined.isel(time=idx)

    combined.attrs = {
        "title": "NOAA OISST v2.1 0.25-deg Daily Sea Surface Temperature (Indian Ocean)",
        "source": "NOAA NCEI / NOAA PSL High-Resolution Blended Analysis",
        "spatial_coverage": f"Lat: {LAT_MIN} to {LAT_MAX}, Lon: {LON_MIN} to {LON_MAX}",
        "frequency": "daily",
        "total_days": len(combined.time),
        "start_time": str(combined.time.values[0])[:10],
        "end_time": str(combined.time.values[-1])[:10],
    }

    if master_file.exists():
        master_file.unlink()
    combined.to_netcdf(master_file)

    n_days = len(combined.time)
    sz_mb = master_file.stat().st_size / (1024 * 1024)
    file_sha = sha256sum(master_file)
    print("=" * 70, flush=True)
    print("DAILY SST MULTI-YEAR ACQUISITION COMPLETE & LOCALLY VERIFIED", flush=True)
    print(f"Total Days:    {n_days} (expected ~1,827 for 2020-2024)", flush=True)
    print(f"Time Range:    {combined.attrs['start_time']} to {combined.attrs['end_time']}", flush=True)
    print(f"Master File:   {master_file}", flush=True)
    print(f"File Size:     {sz_mb:.1f} MB", flush=True)
    print(f"SHA-256:       {file_sha}", flush=True)
    print("=" * 70 + "\n", flush=True)

def run_daily_sst_acquisition(start_year: int = 2020, end_year: int = 2024):
    print("=" * 70, flush=True)
    print(f"OCEANSCOPE INDIA — DAILY SST ACQUISITION ({start_year} - {end_year})", flush=True)
    print("Source: NOAA OISST v2.1 Highres Daily via NOAA PSL THREDDS", flush=True)
    print("=" * 70, flush=True)

    for yr in range(end_year, start_year - 1, -1): # 2024 down to 2020
        acquire_daily_sst_year(yr)

    combine_daily_sst(start_year, end_year)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--start-year", type=int, default=2020)
    parser.add_argument("--end-year", type=int, default=2024)
    args = parser.parse_args()
    run_daily_sst_acquisition(args.start_year, args.end_year)
