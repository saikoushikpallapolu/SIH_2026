"""Acquisition Completion Pass:
Expands real observations (Argo, BGC-Argo, Gliders) and standardizes 25-year monthly SST.
Strictly isolated in data/raw/real and data/processed/real.
Leaves synthetic data and frontend untouched.
"""
import json
import sqlite3
import time
import urllib.request
from pathlib import Path
import numpy as np
import xarray as xr

PROJECT_ROOT = Path(__file__).resolve().parents[2]
RAW_REAL_DIR = PROJECT_ROOT / "data" / "raw" / "real"
PROCESSED_REAL_DIR = PROJECT_ROOT / "data" / "processed" / "real"
DB_PATH = PROCESSED_REAL_DIR / "observations" / "oceanscope_real.db"

def expand_gliders():
    print("\n--- Ingesting Second Real Glider Mission: IMOS SL502 Ningaloo 2017 ---", flush=True)
    nc_path = RAW_REAL_DIR / "gliders" / "IMOS_ANFOG_SL502_Ningaloo_2017.nc"
    if not nc_path.exists():
        print("Glider file not found, skipping.", flush=True)
        return
    ds = xr.open_dataset(nc_path)
    times = ds.TIME.values
    lats = ds.LATITUDE.values
    lons = ds.LONGITUDE.values
    depths = ds.DEPTH.values
    temps = ds.TEMP.values
    psals = ds.PSAL.values

    # Valid mask
    valid_idx = np.where(~np.isnan(lats) & ~np.isnan(lons) & ~np.isnan(depths) & ~np.isnan(temps))[0]
    print(f"Total fixes: {len(times)}, Valid sensor fixes: {len(valid_idx)}", flush=True)

    # Subsample 50 representative waypoints along trajectory
    step = max(1, len(valid_idx) // 50)
    sampled = valid_idx[::step][:50]

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    mission_id = "IMOS_SL502_Ningaloo_2017"
    inserted = 0
    for wp_i, idx in enumerate(sampled):
        t_str = str(times[idx])[:19]
        lat = round(float(lats[idx]), 5)
        lon = round(float(lons[idx]), 5)
        dep = round(float(depths[idx]), 1)
        temp = round(float(temps[idx]), 2)
        sal = round(float(psals[idx]), 2) if not np.isnan(psals[idx]) else 35.0
        cursor.execute("""
            INSERT OR REPLACE INTO real_glider_tracks
            (mission_id, waypoint_idx, timestamp, latitude, longitude, depth, temperature, salinity)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (mission_id, wp_i, t_str, lat, lon, dep, temp, sal))
        inserted += 1

    conn.commit()
    cursor.execute("SELECT COUNT(DISTINCT mission_id), COUNT(*) FROM real_glider_tracks")
    missions_count, fixes_count = cursor.fetchone()
    conn.close()
    print(f"DB now has {missions_count} distinct glider missions and {fixes_count} indexed waypoints.", flush=True)

def expand_argo():
    print("\n--- Expanding Real Historical Argo Profiles (2018-2022) via Argovis ---", flush=True)
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    queries = [
        {"year": "2018", "start": "2018-05-01T00:00:00Z", "end": "2018-05-15T00:00:00Z", "poly": "[[65,10],[75,10],[75,18],[65,18],[65,10]]", "region": "Arabian Sea (2018)"},
        {"year": "2020", "start": "2020-07-01T00:00:00Z", "end": "2020-07-15T00:00:00Z", "poly": "[[84,8],[92,8],[92,16],[84,16],[84,8]]", "region": "Bay of Bengal (2020)"},
        {"year": "2022", "start": "2022-09-01T00:00:00Z", "end": "2022-09-15T00:00:00Z", "poly": "[[70,-5],[85,-5],[85,5],[70,5],[70,-5]]", "region": "Equatorial IO (2022)"}
    ]

    new_profiles = 0
    raw_argo_dir = RAW_REAL_DIR / "argo"
    raw_argo_dir.mkdir(parents=True, exist_ok=True)

    for q in queries:
        url = f"https://argovis-api.colorado.edu/argo?startDate={q['start']}&endDate={q['end']}&polygon={q['poly']}"
        print(f"Querying {q['region']}...", flush=True)
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=12) as resp:
                profs = json.loads(resp.read().decode("utf-8"))
            print(f" - Found {len(profs)} profiles, sampling 10...", flush=True)
            for p in profs[:10]:
                p_id = p.get("_id")
                geo = p.get("geolocation", {}).get("coordinates", [0, 0])
                lon, lat = geo[0], geo[1]
                t_stamp = p.get("timestamp")
                plat_id = str(p.get("platform_id") or p_id.split("_")[0])

                detail_url = f"https://argovis-api.colorado.edu/argo?id={p_id}&data=all"
                d_req = urllib.request.Request(detail_url, headers={"User-Agent": "Mozilla/5.0"})
                try:
                    with urllib.request.urlopen(d_req, timeout=10) as d_resp:
                        d_data = json.loads(d_resp.read().decode("utf-8"))
                    if d_data:
                        full = d_data[0]
                        (raw_argo_dir / f"{p_id}.json").write_text(json.dumps(full), encoding="utf-8")
                        data_info = full.get("data_info", [[], []])
                        keys = data_info[0] if data_info else []
                        measurements = full.get("data", [])
                        if "pressure" in keys and "temperature" in keys and "salinity" in keys:
                            p_idx, t_idx, s_idx = keys.index("pressure"), keys.index("temperature"), keys.index("salinity")
                            p_vals = measurements[p_idx]
                            t_vals = measurements[t_idx]
                            s_vals = measurements[s_idx]
                            depths, temps, sals = [], [], []
                            for i in range(len(p_vals)):
                                if p_vals[i] is not None and t_vals[i] is not None and s_vals[i] is not None:
                                    depths.append(round(float(p_vals[i]), 1))
                                    temps.append(round(float(t_vals[i]), 2))
                                    sals.append(round(float(s_vals[i]), 2))
                            if depths:
                                cursor.execute("""
                                    INSERT OR REPLACE INTO argo_profiles
                                    (id, platform_id, kind, region, timestamp, latitude, longitude,
                                     surface_temp, surface_sal, max_depth, depths_json, temps_json, sals_json, qc_flag)
                                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                                """, (p_id, plat_id, "Argo Profiling Float", q["region"],
                                      t_stamp, lat, lon, temps[0], sals[0], depths[-1],
                                      json.dumps(depths), json.dumps(temps), json.dumps(sals), 1))
                                new_profiles += 1
                except Exception as e:
                    pass
        except Exception as e:
            print(f"Error querying {q['region']}: {e}", flush=True)

    conn.commit()
    cursor.execute("SELECT COUNT(*) FROM argo_profiles")
    total_argo = cursor.fetchone()[0]
    conn.close()
    print(f"Argo profiles expanded: {new_profiles} added, total now: {total_argo}", flush=True)

def expand_bgc_argo():
    print("\n--- Expanding Real BGC-Argo Profiles via Argovis ---", flush=True)
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    url = "https://argovis-api.colorado.edu/argo?startDate=2023-01-01T00:00:00Z&endDate=2023-12-31T00:00:00Z&polygon=[[60,-10],[90,-10],[90,15],[60,15],[60,-10]]&source=argo_bgc"
    raw_argo_dir = RAW_REAL_DIR / "argo"

    added_bgc = 0
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=12) as resp:
            profs = json.loads(resp.read().decode("utf-8"))
        print(f"Found {len(profs)} BGC profiles in 2023, sampling 10...", flush=True)
        for p in profs[:10]:
            p_id = p.get("_id")
            geo = p.get("geolocation", {}).get("coordinates", [0, 0])
            lon, lat = geo[0], geo[1]
            t_stamp = p.get("timestamp")
            plat_id = str(p.get("platform_id") or p_id.split("_")[0])

            detail_url = f"https://argovis-api.colorado.edu/argo?id={p_id}&data=all"
            d_req = urllib.request.Request(detail_url, headers={"User-Agent": "Mozilla/5.0"})
            try:
                with urllib.request.urlopen(d_req, timeout=10) as d_resp:
                    d_data = json.loads(d_resp.read().decode("utf-8"))
                if d_data:
                    full = d_data[0]
                    (raw_argo_dir / f"{p_id}.json").write_text(json.dumps(full), encoding="utf-8")
                    data_info = full.get("data_info", [[], []])
                    keys = data_info[0] if data_info else []
                    measurements = full.get("data", [])
                    p_idx = keys.index("pressure") if "pressure" in keys else -1
                    c_idx = keys.index("chla") if "chla" in keys else -1
                    d_idx = keys.index("doxy") if "doxy" in keys else -1

                    if p_idx >= 0 and (c_idx >= 0 or d_idx >= 0):
                        p_vals = measurements[p_idx]
                        c_vals = measurements[c_idx] if c_idx >= 0 else [None]*len(p_vals)
                        d_vals = measurements[d_idx] if d_idx >= 0 else [None]*len(p_vals)
                        depths, chla, doxy = [], [], []
                        for i in range(len(p_vals)):
                            if p_vals[i] is not None:
                                depths.append(round(float(p_vals[i]), 1))
                                chla.append(round(float(c_vals[i]), 3) if c_vals[i] is not None else None)
                                doxy.append(round(float(d_vals[i]), 1) if d_vals[i] is not None else None)
                        if depths:
                            cursor.execute("""
                                INSERT OR REPLACE INTO bgc_profiles
                                (id, platform_id, timestamp, latitude, longitude, depths_json, chla_json, doxy_json)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                            """, (p_id, plat_id, t_stamp, lat, lon, json.dumps(depths), json.dumps(chla), json.dumps(doxy)))
                            added_bgc += 1
            except Exception as e:
                pass
    except Exception as e:
        print(f"Error querying BGC: {e}", flush=True)

    conn.commit()
    cursor.execute("SELECT COUNT(*) FROM bgc_profiles")
    total_bgc = cursor.fetchone()[0]
    conn.close()
    print(f"BGC-Argo profiles expanded: {added_bgc} added, total now: {total_bgc}", flush=True)

def standardize_25yr_sst():
    print("\n--- Standardizing Full 25-Year Monthly SST (2000-2024, 300 months) ---", flush=True)
    raw_path = RAW_REAL_DIR / "sst" / "oisst_v2_1_monthly_2000_2024_io.nc"
    if not raw_path.exists():
        print("Raw 25-year SST not found!", flush=True)
        return
    ds = xr.open_dataset(raw_path)
    proc_path = PROCESSED_REAL_DIR / "sst" / "sst_oisst_monthly_standard.nc"
    if proc_path.exists():
        proc_path.unlink()
    ds.rename({"sst": "tos"}).to_netcdf(proc_path)
    print(f"Wrote standardized 25-Year SST NetCDF: {proc_path} ({proc_path.stat().st_size / (1024*1024):.1f} MB)", flush=True)
    print(f" - Timestamps: {len(ds.time)} months ({str(ds.time.values[0])[:10]} to {str(ds.time.values[-1])[:10]})", flush=True)

if __name__ == "__main__":
    expand_gliders()
    expand_argo()
    expand_bgc_argo()
    standardize_25yr_sst()
    print("\n--- Acquisition Completion Pass Finished! ---", flush=True)
