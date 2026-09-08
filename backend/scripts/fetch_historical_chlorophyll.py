"""OceanScope India — Historical Monthly Chlorophyll-a Acquisition Script.

Acquires the longest continuous historical series of ESA Ocean Colour CCI v6.0 monthly composites (1998-2024)
from NOAA OceanWatch ERDDAP for the Indian Ocean domain (20E to 125E, -45S to 32N).
Saves raw and standardized NetCDF files and verifies every chunk locally.
"""
import os
import sys
import time
import json
import hashlib
import urllib.request
from pathlib import Path
import numpy as np
import xarray as xr

PROJECT_ROOT = Path(__file__).resolve().parents[2]
RAW_CHL_DIR = PROJECT_ROOT / "data" / "raw" / "real" / "chlorophyll"
PROC_CHL_DIR = PROJECT_ROOT / "data" / "processed" / "real" / "chlorophyll"
RAW_CHL_DIR.mkdir(parents=True, exist_ok=True)
PROC_CHL_DIR.mkdir(parents=True, exist_ok=True)

LAT_MIN, LAT_MAX = -45.0, 32.0
LON_MIN, LON_MAX = 20.0, 125.0

def sha256sum(filepath: Path) -> str:
    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()

def fetch_chlorophyll_range(start_year: int = 1998, end_year: int = 2024):
    print("=" * 70, flush=True)
    print(f"OCEANSCOPE INDIA — ACQUIRING HISTORICAL CHLOROPHYLL ({start_year} - {end_year})", flush=True)
    print("Source: ESA Ocean Colour CCI v6.0 via NOAA OceanWatch ERDDAP", flush=True)
    print("=" * 70, flush=True)

    yearly_datasets = []

    for yr in range(start_year, end_year + 1):
        raw_yr_file = RAW_CHL_DIR / f"esa_cci_chla_{yr}_monthly_io.nc"
        t0 = time.time()

        if raw_yr_file.exists() and raw_yr_file.stat().st_size > 500_000:
            print(f"[{yr}] Local raw file exists ({raw_yr_file.stat().st_size / (1024*1024):.2f} MB), verifying...", flush=True)
            try:
                ds = xr.open_dataset(raw_yr_file)
                if len(ds.time) >= 12:
                    yearly_datasets.append(ds)
                    print(f"[{yr}] Verified {len(ds.time)} months locally from cache.", flush=True)
                    continue
                else:
                    ds.close()
            except Exception as e:
                print(f"[{yr}] Corrupt file ({e}), re-downloading...", flush=True)

        url = (
            f"https://oceanwatch.pifsc.noaa.gov/erddap/griddap/esa-cci-chla-monthly-v6-0.nc?"
            f"chlor_a[({yr}-01-01T00:00:00Z):1:({yr}-12-31T00:00:00Z)][({LAT_MIN}):6:({LAT_MAX})][({LON_MIN}):6:({LON_MAX})]"
        )
        print(f"[{yr}] Requesting from ERDDAP: {url}", flush=True)

        req = urllib.request.Request(url, headers={"User-Agent": "OceanScopeIndia/1.0"})
        max_retries = 3
        success = False

        for attempt in range(1, max_retries + 1):
            try:
                with urllib.request.urlopen(req, timeout=90) as resp:
                    content = resp.read()
                if len(content) < 100_000:
                    raise ValueError(f"Downloaded content too small: {len(content)} bytes")
                raw_yr_file.write_bytes(content)
                success = True
                break
            except Exception as e:
                print(f"[{yr}] Attempt {attempt} failed: {e}. Retrying...", flush=True)
                time.sleep(3)

        if not success:
            print(f"[{yr}] ERROR: Failed to download year {yr} after {max_retries} attempts. Skipping.", flush=True)
            continue

        # Open and verify downloaded file
        try:
            ds = xr.open_dataset(raw_yr_file)
            n_months = len(ds.time)
            n_valid = int((~ds.chlor_a.isnull()).sum().values)
            elapsed = time.time() - t0
            file_mb = raw_yr_file.stat().st_size / (1024 * 1024)
            print(f"[{yr}] SUCCESS: {n_months} months, {n_valid:,} valid obs, {file_mb:.2f} MB in {elapsed:.1f}s", flush=True)
            yearly_datasets.append(ds)
        except Exception as e:
            print(f"[{yr}] Verification error: {e}", flush=True)

    if not yearly_datasets:
        print("ERROR: No chlorophyll data acquired!", flush=True)
        return

    print("\n--- Combining all verified years into Master Standardized NetCDF ---", flush=True)
    # Combine along time
    combined = xr.concat(yearly_datasets, dim="time")
    # Sort by time and drop duplicates if any
    _, index = np.unique(combined["time"], return_index=True)
    combined = combined.isel(time=index)

    # Standardize variable name to 'chl'
    proc_ds = xr.Dataset(
        {"chl": combined["chlor_a"]},
        attrs={
            "title": "ESA Ocean Colour CCI v6.0 Chlorophyll-a Monthly Composites (Indian Ocean)",
            "source": "ESA Ocean Colour CCI / NOAA OceanWatch ERDDAP",
            "provider": "Plymouth Marine Laboratory / ESA / NOAA",
            "spatial_coverage": f"Lat: {LAT_MIN} to {LAT_MAX}, Lon: {LON_MIN} to {LON_MAX}",
            "units": "mg/m^3",
            "long_name": "Chlorophyll-a concentration in seawater",
            "standard_name": "mass_concentration_of_chlorophyll_a_in_sea_water",
            "frequency": "monthly",
            "total_months": len(combined.time),
            "start_time": str(combined.time.values[0]),
            "end_time": str(combined.time.values[-1]),
        }
    )

    proc_file = PROC_CHL_DIR / "chlorophyll_esa_cci_standard.nc"
    if proc_file.exists():
        proc_file.unlink()
    proc_ds.to_netcdf(proc_file)

    total_months = len(proc_ds.time)
    start_ts = str(proc_ds.time.values[0])[:10]
    end_ts = str(proc_ds.time.values[-1])[:10]
    valid_total = int((~proc_ds.chl.isnull()).sum().values)
    size_mb = proc_file.stat().st_size / (1024 * 1024)
    file_sha = sha256sum(proc_file)

    print("\n" + "=" * 70, flush=True)
    print("CHLOROPHYLL HISTORICAL ACQUISITION COMPLETE & LOCALLY VERIFIED", flush=True)
    print(f"Total Months:      {total_months}", flush=True)
    print(f"Time Range:        {start_ts} to {end_ts}", flush=True)
    print(f"Valid Data Points: {valid_total:,}", flush=True)
    print(f"Output File:       {proc_file}", flush=True)
    print(f"File Size:         {size_mb:.2f} MB", flush=True)
    print(f"SHA-256:           {file_sha}", flush=True)
    print("=" * 70 + "\n", flush=True)

if __name__ == "__main__":
    fetch_chlorophyll_range(1998, 2024)
