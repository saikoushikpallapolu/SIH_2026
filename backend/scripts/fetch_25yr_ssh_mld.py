import time
from pathlib import Path
import xarray as xr
import numpy as np

PROJECT_ROOT = Path(__file__).resolve().parents[2]
RAW_REAL_DIR = PROJECT_ROOT / "data" / "raw" / "real"
PROCESSED_REAL_DIR = PROJECT_ROOT / "data" / "processed" / "real"

LAT_MIN, LAT_MAX = -45.0, 32.0
LON_MIN, LON_MAX = 20.0, 125.0

def fetch_25yr_ssh():
    print("\n--- Fetching Full 25-Year SSH (2000-2024) from NOAA GODAS ---", flush=True)
    yearly_slices = []
    t_start = time.time()
    for yr in range(2000, 2025):
        t0 = time.time()
        url = f"https://psl.noaa.gov/thredds/dodsC/Datasets/godas/sshg.{yr}.nc"
        ds = xr.open_dataset(url)
        da_yr = ds['sshg'].sel(lat=slice(LAT_MIN, LAT_MAX), lon=slice(LON_MIN, LON_MAX)).load()
        yearly_slices.append(da_yr)
        print(f" - SSH Year {yr} (12 mos) loaded in {time.time()-t0:.2f}s", flush=True)

    full_ssh = xr.concat(yearly_slices, dim="time")
    raw_path = RAW_REAL_DIR / "ssh" / "godas_sshg_2000_2024_io.nc"
    proc_path = PROCESSED_REAL_DIR / "ssh" / "ssh_godas_monthly_standard.nc"

    if raw_path.exists(): raw_path.unlink()
    if proc_path.exists(): proc_path.unlink()

    full_ssh.to_dataset(name="sshg").to_netcdf(raw_path)
    full_ssh.to_dataset(name="zos").to_netcdf(proc_path)
    print(f"SSH 25-Year Full Download Complete: {len(full_ssh.time)} months in {time.time()-t_start:.1f}s!", flush=True)
    print(f"File size: {proc_path.stat().st_size / (1024*1024):.1f} MB", flush=True)

def fetch_25yr_mld():
    print("\n--- Fetching Full 25-Year MLD (2000-2024) from NOAA GODAS ---", flush=True)
    yearly_slices = []
    t_start = time.time()
    for yr in range(2000, 2025):
        t0 = time.time()
        url = f"https://psl.noaa.gov/thredds/dodsC/Datasets/godas/dbss_obml.{yr}.nc"
        ds = xr.open_dataset(url)
        da_yr = ds['dbss_obml'].sel(lat=slice(LAT_MIN, LAT_MAX), lon=slice(LON_MIN, LON_MAX)).load()
        yearly_slices.append(da_yr)
        print(f" - MLD Year {yr} (12 mos) loaded in {time.time()-t0:.2f}s", flush=True)

    full_mld = xr.concat(yearly_slices, dim="time")
    raw_path = RAW_REAL_DIR / "mld" / "godas_dbss_obml_2000_2024_io.nc"
    proc_path = PROCESSED_REAL_DIR / "mld" / "mld_godas_monthly_standard.nc"

    if raw_path.exists(): raw_path.unlink()
    if proc_path.exists(): proc_path.unlink()

    full_mld.to_dataset(name="dbss_obml").to_netcdf(raw_path)
    full_mld.to_dataset(name="mlotst").to_netcdf(proc_path)
    print(f"MLD 25-Year Full Download Complete: {len(full_mld.time)} months in {time.time()-t_start:.1f}s!", flush=True)
    print(f"File size: {proc_path.stat().st_size / (1024*1024):.1f} MB", flush=True)

if __name__ == "__main__":
    fetch_25yr_ssh()
    fetch_25yr_mld()
