# OceanScope India — Future Data Acquisition Checklist

> **Purpose:** Operational checklist for any human engineer or AI agent resuming real data acquisition for OceanScope India.  
> **Reference Document:** Read [`docs/DATA_REPRODUCIBILITY.md`](file:///c:/Users/Shiva/Neural-Debris-Removal-in-Streak-Detection-Models/oceanscope-india/docs/DATA_REPRODUCIBILITY.md) before starting.  
> **Current Data State:** `OCEANSCOPE_DATA_STATE_2026-09-08`

---

## Phase 1: Pre-Download Inspection & Verification

Before issuing any download commands or making network requests:

- [ ] **1. Review Canonical Documentation**
  - Read [`docs/DATA_REPRODUCIBILITY.md`](file:///c:/Users/Shiva/Neural-Debris-Removal-in-Streak-Detection-Models/oceanscope-india/docs/DATA_REPRODUCIBILITY.md).
  - Inspect [`data/manifest/manifest.json`](file:///c:/Users/Shiva/Neural-Debris-Removal-in-Streak-Detection-Models/oceanscope-india/data/manifest/manifest.json).

- [ ] **2. Inspect Physical Filesystem State**
  - Verify existing local files in `data/processed/real/`.
  - Confirm the current verified years for 3D GODAS (currently 2022–2024: 36 months).
  - Verify that no partial or temporary download files are corrupt.

- [ ] **3. Determine the Exact Resume Point**
  - Confirm the first missing month to acquire:
    - For 3D GODAS Temperature: `2000-01` through `2021-12` (264 months remaining).
    - For 3D GODAS Salinity: `2000-01` through `2021-12` (264 months remaining).
    - For 3D GODAS Currents ($U, V$): `2000-01` through `2021-12` (264 months remaining).
  - Determine your acquisition block size (recommended: 5-year blocks, e.g. `2017–2021`).

- [ ] **4. Verify Remote Endpoint Availability**
  - Test connectivity to NOAA PSL THREDDS:
    ```powershell
    python -c "import xarray as xr; ds = xr.open_dataset('https://psl.noaa.gov/thredds/dodsC/Datasets/godas/pottmp.2021.nc'); print('Remote 2021 accessible:', len(ds.time))"
    ```

- [ ] **5. Confirm Domain & Depth Parameters**
  - Latitude: `[-45.0, 32.0]`
  - Longitude: `[20.0, 125.0]`
  - 16 Standard Depths: `[5, 10, 25, 50, 75, 100, 150, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 4000] meters`

---

## Phase 2: Ingestion & Download Execution

During active downloading:

- [ ] **1. Execute Resumable Chunked Downloader**
  - Run the established pipeline script:
    ```powershell
    python -u backend/scripts/fetch_historical_godas_3d.py --start-year 2017 --end-year 2021
    ```
  - *Optionally for T & S only (50% faster):*
    ```powershell
    python -u backend/scripts/fetch_historical_godas_3d.py --start-year 2017 --end-year 2021 --vars temperature salinity
    ```

- [ ] **2. Enforce Month-by-Month Slicing**
  - Ensure the script downloads sequentially month-by-month (`.load()` on month slices) to prevent NOAA PSL socket resets or truncation to all zeros.

- [ ] **3. Avoid Concurrent PSL Queries**
  - Do NOT open parallel connections to NOAA PSL THREDDS from the same IP address; avoid triggering `HTTP 429 Too Many Requests`.

- [ ] **4. Verify Yearly NetCDFs Immediately**
  - Ensure each year is written and validated to `data/processed/real/{var}/yearly/{var}_godas_{YYYY}_standard.nc` before the script moves to the next year.

- [ ] **5. Preserve Raw and Standardized Files**
  - Verify that existing verified years (2022, 2023, 2024) are not overwritten or deleted.

---

## Phase 3: Post-Download Integrity Validation

After each batch finishes:

- [ ] **1. Open All Newly Created NetCDFs with `xarray`**
  - Verify that the NetCDF opens cleanly without parsing errors:
    ```python
    import xarray as xr
    ds = xr.open_dataset("path/to/file.nc")
    ```

- [ ] **2. Verify Timestamps & Continuous Sequence**
  - Confirm all 12 months are present per year.
  - Check for duplicate or out-of-order timestamps:
    ```python
    assert len(ds.time) == len(set(ds.time.values)), "Duplicate timestamps detected!"
    ```

- [ ] **3. Verify Depth Coordinate & Dimensions**
  - Confirm exactly 16 levels: `[5, 10, 25, 50, 75, 100, 150, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 4000]`.
  - Confirm dimensions: `(time, level, lat, lon)`.

- [ ] **4. Check for All-Zero or All-NaN Corruption**
  - Verify that valid marine values exist and fall within physical oceanographic limits:
    - Temperature: `0.0°C` to `35.0°C`
    - Salinity: `30.0 PSU` to `46.0 PSU`
    - Velocity ($U, V$): `-2.5 m/s` to `+2.5 m/s`
    - Density ($\rho$): `1018.0 kg/m³` to `1033.0 kg/m³`

- [ ] **5. Re-derive Seawater Density (UNESCO EOS-80)**
  - When new years of Temperature and Salinity are acquired, recompute the derived density field:
    ```powershell
    python -c "from backend.scripts.fetch_historical_godas_3d import derive_density_eos80; derive_density_eos80(2017, 2024)"
    ```

---

## Phase 4: Manifest & Documentation Synchronization

- [ ] **1. Recalculate Cryptographic Checksums**
  - Compute fresh SHA-256 hashes from the actual disk bytes of updated master NetCDFs:
    ```powershell
    python -c "import hashlib; print(hashlib.sha256(open('data/processed/real/temperature/temperature_godas_monthly_standard.nc', 'rb').read()).hexdigest())"
    ```

- [ ] **2. Update Canonical Manifest Files**
  - Update `data/manifest/manifest.json`.
  - Update `data/processed/real/catalog/manifest.json`.
  - Update `timesteps`, `time_start`, `time_end`, `size_bytes`, and `sha256`.

- [ ] **3. Update Coverage Matrix in `docs/DATA_REPRODUCIBILITY.md`**
  - Update the "Verified Coverage", "Remaining Coverage", and "Resume Point" columns.

- [ ] **4. Commit Code and Manifest Updates**
  - Commit updated scripts and documentation using the required author identity:
    ```powershell
    git config user.name "schrodingerscat07"
    git config user.email "24071a3240@vnrvjiet.in"
    git add docs/ data/manifest/ backend/scripts/
    git commit -m "data: update 3D GODAS verified coverage to 2017-2024"
    ```
  - **NEVER track or commit the large `.nc` or `.bin` binary files to Git!**
