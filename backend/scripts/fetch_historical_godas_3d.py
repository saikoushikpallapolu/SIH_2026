"""OceanScope India — 3D GODAS Historical Reanalysis Acquisition Engine (2000-2023).

Acquires missing historical monthly 3D fields from NOAA PSL THREDDS OPeNDAP:
- Potential Temperature (pottmp -> thetao in degC)
- Practical Salinity (salt -> so in PSU)
- Zonal Current (ucur -> uo in m/s)
- Meridional Current (vcur -> vo in m/s)

Target domain: Indian Ocean (lat: -45.0 to 32.0, lon: 20.0 to 125.0).
Depth: Standard 16 depth levels [5, 10, 25, 50, 75, 100, 150, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 4000]m.
Chunked year-by-year, fully resumable with local cache verification.
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
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))
RAW_REAL_DIR = PROJECT_ROOT / "data" / "raw" / "real"
PROC_REAL_DIR = PROJECT_ROOT / "data" / "processed" / "real"

LAT_MIN, LAT_MAX = -45.0, 32.0
LON_MIN, LON_MAX = 20.0, 125.0
STANDARD_16_DEPTHS = [5, 10, 25, 50, 75, 100, 150, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 4000]

def sha256sum(filepath: Path) -> str:
    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()

def acquire_variable_year(var_key: str, year: int) -> bool:
    """Acquires a single year for a specific 3D variable from NOAA GODAS."""
    config = {
        "temperature": {
            "noaa_file": f"pottmp.{year}.nc",
            "noaa_var": "pottmp",
            "std_var": "thetao",
            "raw_dir": RAW_REAL_DIR / "temperature",
            "proc_dir": PROC_REAL_DIR / "temperature" / "yearly",
            "raw_name": f"godas_pottmp_{year}_io.nc",
            "proc_name": f"temperature_godas_{year}_standard.nc",
            "units": "degC",
            "long_name": "Potential Temperature",
            "convert": lambda da: da - 273.15,
        },
        "salinity": {
            "noaa_file": f"salt.{year}.nc",
            "noaa_var": "salt",
            "std_var": "so",
            "raw_dir": RAW_REAL_DIR / "salinity",
            "proc_dir": PROC_REAL_DIR / "salinity" / "yearly",
            "raw_name": f"godas_salt_{year}_io.nc",
            "proc_name": f"salinity_godas_{year}_standard.nc",
            "units": "PSU",
            "long_name": "Practical Salinity",
            "convert": lambda da: da * 1000.0,
        },
        "currents_u": {
            "noaa_file": f"ucur.{year}.nc",
            "noaa_var": "ucur",
            "std_var": "uo",
            "raw_dir": RAW_REAL_DIR / "currents",
            "proc_dir": PROC_REAL_DIR / "currents" / "yearly",
            "raw_name": f"godas_ucur_{year}_io.nc",
            "proc_name": f"ucur_godas_{year}_standard.nc",
            "units": "m/s",
            "long_name": "Eastward Zonal Current Velocity",
            "convert": lambda da: da,
        },
        "currents_v": {
            "noaa_file": f"vcur.{year}.nc",
            "noaa_var": "vcur",
            "std_var": "vo",
            "raw_dir": RAW_REAL_DIR / "currents",
            "proc_dir": PROC_REAL_DIR / "currents" / "yearly",
            "raw_name": f"godas_vcur_{year}_io.nc",
            "proc_name": f"vcur_godas_{year}_standard.nc",
            "units": "m/s",
            "long_name": "Northward Meridional Current Velocity",
            "convert": lambda da: da,
        },
    }[var_key]

    raw_dir = config["raw_dir"]
    proc_dir = config["proc_dir"]
    raw_dir.mkdir(parents=True, exist_ok=True)
    proc_dir.mkdir(parents=True, exist_ok=True)

    raw_path = raw_dir / config["raw_name"]
    proc_path = proc_dir / config["proc_name"]

    # Check local cache
    if proc_path.exists() and proc_path.stat().st_size > 10_000_000:
        try:
            ds_check = xr.open_dataset(proc_path)
            if len(ds_check.time) == 12 and len(ds_check.level) == 16:
                print(f"[{var_key} {year}] Already complete and verified locally ({proc_path.stat().st_size / (1024*1024):.1f} MB). Skipping.", flush=True)
                ds_check.close()
                return True
            ds_check.close()
        except Exception:
            pass

    url = f"https://psl.noaa.gov/thredds/dodsC/Datasets/godas/{config['noaa_file']}"
    print(f"[{var_key} {year}] Fetching from {url}...", flush=True)
    t0 = time.time()

    max_retries = 3
    for attempt in range(1, max_retries + 1):
        try:
            ds = xr.open_dataset(url)
            months_data = []
            for m in range(12):
                da_m = ds[config["noaa_var"]][m].sel(lat=slice(LAT_MIN, LAT_MAX), lon=slice(LON_MIN, LON_MAX)).load()
                months_data.append(da_m)
            ds.close()

            # Verify each month slice
            for m_idx, da_m in enumerate(months_data):
                m_valid = da_m.values[~np.isnan(da_m.values)]
                if len(m_valid) == 0 or (float(m_valid.min()) == 0.0 and float(m_valid.max()) == 0.0):
                    raise ValueError(f"Month {m_idx+1} in {year} returned all zeros/empty data!")

            da_raw = xr.concat(months_data, dim="time")
            da_raw.attrs = months_data[0].attrs

            # Save raw NetCDF
            if raw_path.exists():
                raw_path.unlink()
            da_raw.to_dataset(name=config["noaa_var"]).to_netcdf(raw_path)
            raw_sha = sha256sum(raw_path)

            # Standardized processing: convert units & interpolate to 16 standard depths
            da_conv = config["convert"](da_raw)
            da_conv.attrs = da_raw.attrs
            da_conv.attrs["units"] = config["units"]
            da_conv.attrs["long_name"] = config["long_name"]

            levels_orig = da_raw["level"].values
            target_depths = [d for d in STANDARD_16_DEPTHS if d <= float(levels_orig.max())]
            da_std = da_conv.interp(level=target_depths, method="linear", kwargs={"fill_value": "extrapolate"})

            if proc_path.exists():
                proc_path.unlink()
            da_std.to_dataset(name=config["std_var"]).to_netcdf(proc_path)
            proc_sha = sha256sum(proc_path)

            # Verification
            val_min = float(da_std.min(skipna=True))
            val_max = float(da_std.max(skipna=True))
            if np.isnan(val_min) or (val_min == 0.0 and val_max == 0.0):
                raise ValueError(f"Processed grid has invalid values: min={val_min}, max={val_max}")

            elapsed = time.time() - t0
            size_mb = proc_path.stat().st_size / (1024 * 1024)
            print(f"[{var_key} {year}] SUCCESS: {len(da_std.time)} mos, 16 levels, range [{val_min:.2f}, {val_max:.2f}] {config['units']}, {size_mb:.1f} MB in {elapsed:.1f}s | SHA: {proc_sha}", flush=True)
            return True
        except Exception as e:
            print(f"[{var_key} {year}] Attempt {attempt} failed: {e}. Retrying...", flush=True)
            time.sleep(5)

    print(f"[{var_key} {year}] ERROR: Failed after {max_retries} attempts!", flush=True)
    return False

def combine_and_finalize_variable(var_key: str, start_year: int = 2000, end_year: int = 2024):
    """Combines all yearly files (2000-2024) into the master multi-decadal standardized file."""
    yearly_dir = PROC_REAL_DIR / ("temperature" if var_key == "temperature" else "salinity" if var_key == "salinity" else "currents") / "yearly"
    
    if var_key in ["currents_u", "currents_v"]:
        # Handle currents together
        return

    std_var_name = "thetao" if var_key == "temperature" else "so"
    final_dir = PROC_REAL_DIR / ("temperature" if var_key == "temperature" else "salinity")
    final_file = final_dir / f"{var_key}_godas_monthly_standard.nc"

    datasets = []
    for yr in range(start_year, end_year + 1):
        if yr == 2024:
            f = final_dir / f"{var_key}_godas_2024_standard.nc"
        else:
            f = yearly_dir / f"{var_key}_godas_{yr}_standard.nc"
        
        if f.exists():
            ds = xr.open_dataset(f)
            datasets.append(ds)
        else:
            print(f"Warning: Missing year {yr} for {var_key} when building master file.")

    if not datasets:
        print(f"No datasets found to combine for {var_key}")
        return

    print(f"\nCombining {len(datasets)} years for {var_key} into {final_file}...")
    combined = xr.concat(datasets, dim="time")
    # Sort by time
    _, index = np.unique(combined["time"], return_index=True)
    combined = combined.isel(time=index)

    if final_file.exists():
        final_file.unlink()
    combined.to_netcdf(final_file)
    print(f"Master {var_key} file created: {len(combined.time)} months, size: {final_file.stat().st_size / (1024*1024):.1f} MB, SHA: {sha256sum(final_file)}")

def combine_currents(start_year: int = 2000, end_year: int = 2024):
    """Combines U and V currents into single master currents file."""
    u_dir = PROC_REAL_DIR / "currents" / "yearly"
    v_dir = PROC_REAL_DIR / "currents" / "yearly"
    final_dir = PROC_REAL_DIR / "currents"
    final_file = final_dir / "currents_godas_monthly_standard.nc"

    u_ds_list, v_ds_list = [], []
    for yr in range(start_year, end_year + 1):
        if yr == 2024:
            # existing 2024 currents file has uo and vo
            f2024 = final_dir / "currents_godas_2024_standard.nc"
            if f2024.exists():
                ds24 = xr.open_dataset(f2024)
                u_ds_list.append(ds24[["uo"]])
                v_ds_list.append(ds24[["vo"]])
            continue

        fu = u_dir / f"ucur_godas_{yr}_standard.nc"
        fv = v_dir / f"vcur_godas_{yr}_standard.nc"
        if fu.exists() and fv.exists():
            u_ds_list.append(xr.open_dataset(fu))
            v_ds_list.append(xr.open_dataset(fv))

    if not u_ds_list or not v_ds_list:
        print("No currents datasets found to combine.")
        return

    combined_u = xr.concat(u_ds_list, dim="time")
    combined_v = xr.concat(v_ds_list, dim="time")
    
    _, idx_u = np.unique(combined_u["time"], return_index=True)
    combined_u = combined_u.isel(time=idx_u)
    _, idx_v = np.unique(combined_v["time"], return_index=True)
    combined_v = combined_v.isel(time=idx_v)

    combined_curr = xr.Dataset({"uo": combined_u["uo"], "vo": combined_v["vo"]})
    if final_file.exists():
        final_file.unlink()
    combined_curr.to_netcdf(final_file)
    print(f"Master currents file created: {len(combined_curr.time)} months, size: {final_file.stat().st_size / (1024*1024):.1f} MB, SHA: {sha256sum(final_file)}")

def derive_density_eos80(start_year: int = 2000, end_year: int = 2024):
    """Derives Seawater Density (UNESCO EOS-80) for all acquired months from real T and S."""
    from backend.scripts.acquire_real_data import compute_eos80_density
    print("\n--- Deriving Seawater Density (UNESCO EOS-80) from Real T & S ---", flush=True)

    temp_file = PROC_REAL_DIR / "temperature" / "temperature_godas_monthly_standard.nc"
    sal_file = PROC_REAL_DIR / "salinity" / "salinity_godas_monthly_standard.nc"
    density_file = PROC_REAL_DIR / "density" / "density_eos80_monthly_standard.nc"

    if not temp_file.exists() or not sal_file.exists():
        print("Cannot derive density: master temperature or salinity file missing.")
        return

    ds_t = xr.open_dataset(temp_file)
    ds_s = xr.open_dataset(sal_file)

    depths = ds_t["level"].values
    t_vals = ds_t["thetao"].values
    s_vals = ds_s["so"].values

    rho_grid = np.zeros_like(t_vals, dtype=np.float32)
    for d_idx, depth_m in enumerate(depths):
        rho_grid[:, d_idx] = compute_eos80_density(t_vals[:, d_idx], s_vals[:, d_idx], float(depth_m))

    density_ds = xr.Dataset(
        {"rho": (["time", "level", "lat", "lon"], rho_grid)},
        coords={"time": ds_t.time, "level": depths, "lat": ds_t.lat, "lon": ds_t.lon},
        attrs={
            "units": "kg/m^3",
            "long_name": "Seawater in-situ density computed via UNESCO 1983 EOS-80",
            "formulation": "UNESCO 1983 International Equation of State of Seawater (EOS-80)",
            "provenance_notice": "DERIVED DATA computed directly from real NOAA NCEP GODAS Temperature and Salinity",
            "temperature_source": "NOAA NCEP GODAS Potential Temperature",
            "salinity_source": "NOAA NCEP GODAS Practical Salinity",
            "pressure_treatment": "Hydrostatic pressure approximated by depth (p = 0.1 * depth_m)",
            "density_type": "Potential density referenced to surface pressure (sigma-theta / sigma-0)"
        }
    )

    if density_file.exists():
        density_file.unlink()
    density_ds.to_netcdf(density_file)

    val_min = float(np.nanmin(rho_grid))
    val_max = float(np.nanmax(rho_grid))
    print(f"Master Density file created: {len(density_ds.time)} months, range [{val_min:.2f}, {val_max:.2f}] kg/m^3")
    print(f"Size: {density_file.stat().st_size / (1024*1024):.1f} MB, SHA: {sha256sum(density_file)}")

def run_3d_acquisition(start_year: int = 2000, end_year: int = 2023, vars_to_run=None):
    if vars_to_run is None:
        vars_to_run = ["temperature", "salinity", "currents_u", "currents_v"]

    print("=" * 70, flush=True)
    print(f"OCEANSCOPE INDIA — 3D GODAS HISTORICAL ACQUISITION ({start_year} - {end_year})", flush=True)
    print(f"Variables: {', '.join(vars_to_run)}", flush=True)
    print("=" * 70, flush=True)

    for yr in range(end_year, start_year - 1, -1): # newest to oldest
        for var_key in vars_to_run:
            acquire_variable_year(var_key, yr)

        # After each completed year, combine immediately
        for v in ["temperature", "salinity"]:
            if v in vars_to_run:
                combine_and_finalize_variable(v, start_year, 2024)

        if "currents_u" in vars_to_run and "currents_v" in vars_to_run:
            combine_currents(start_year, 2024)

        if "temperature" in vars_to_run and "salinity" in vars_to_run:
            derive_density_eos80(start_year, 2024)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--start-year", type=int, default=2000)
    parser.add_argument("--end-year", type=int, default=2023)
    parser.add_argument("--vars", nargs="+", default=["temperature", "salinity", "currents_u", "currents_v"])
    args = parser.parse_args()
    run_3d_acquisition(args.start_year, args.end_year, args.vars)
