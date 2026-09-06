# OceanScope India — data collection and storage plan

## Collect these first

| Priority | Collection | Minimum fields | Prototype recommendation | Storage destination |
|---|---|---|---|---|
| 1 | INCOIS numerical model output | `time`, `depth`, `latitude`, `longitude`, temperature, salinity, `u`, `v` currents | Indian Ocean; 6–12 timestamps; 10–20 depth levels | `data/raw/model/` then `data/processed/zarr/` |
| 2 | Bathymetry and land | elevation/depth, land mask, coastline | GEBCO Indian Ocean subset at 30–60 arc-second render resolution | `data/raw/bathymetry/` then terrain tiles in object storage |
| 3 | Chlorophyll | model `chl` or satellite chlorophyll-a, timestamp, grid coordinates | same dates/grid as the physical model whenever possible | alongside model Zarr |
| 4 | Argo profiles | WMO ID, time, latitude, longitude, pressure/depth, temperature, salinity, QC | 10–30 Indian Ocean floats from the selected time window | `data/raw/argo/` then `data/observations/` |
| 5 | BGC-Argo profiles | all Argo fields plus chlorophyll and QC | 5–10 floats with chlorophyll | `data/raw/bgc_argo/` then `data/observations/` |
| 6 | Glider missions | mission/vehicle ID, time, latitude, longitude, depth, T/S/chlorophyll, heading | 1–3 INCOIS deployment tracks | `data/raw/gliders/` then `data/observations/` |

Do not use screenshots, rendered maps, or spreadsheets as the source for model data. Request original **CF-compliant NetCDF** wherever possible. Preserve original untouched downloads under `data/raw/`; never edit those files in place.

## Exact request to make to INCOIS

Ask for one representative Indian Ocean model run with the following metadata and fields:

```text
Domain: Indian Ocean (or their operational regional domain)
Horizontal grid: latitude / longitude and their units
Vertical grid: depth or pressure values and positive direction
Time: UTC timestamps and calendar
Variables: temperature, salinity, zonal current u, meridional current v,
           vertical current w if available, sea-surface height, chlorophyll-a
Quality: fill value, valid range, units, variable long name, model run/version
Static: model bathymetry / land mask / grid metrics if available
```

For instrument data, require platform ID, instrument type, coordinate/time precision, depth or pressure, parameter units, and each parameter's QC flag. For Argo, prefer adjusted values where present and keep raw values/QC in the archive.

## Data source hierarchy

1. INCOIS model and institutional Glider data — operational truth for the final product.
2. GEBCO bathymetry — static terrain and land/ocean relief.
3. Argo GDAC/BGC-Argo — global, quality-managed float profiles.
4. Copernicus Marine — legal fallback/demo source for physics or chlorophyll where an INCOIS sample is unavailable.

Never silently mix two model sources in one visual layer. The UI must display the source, model run/version, time, and units so a scientist knows what they are seeing.

## Storage layout

```text
data/
  raw/                         # immutable originals; not committed to Git
    model/<source>/<run>/
    argo/<download-date>/
    bgc_argo/<download-date>/
    gliders/<mission-id>/
    bathymetry/
  processed/
    zarr/<dataset-id>.zarr/    # xarray-ready 4D cubes, chunked by time/depth/tile
    terrain/                   # quantized mesh / raster terrain tiles
    tiles/                     # GPU-ready field tiles generated from Zarr
  observations/
    argo_YYYYqN.json           # API-ready summaries/profiles
    glider_<mission>.json
  catalog/catalog.json         # machine-readable dataset inventory
```

For a deployed version: raw data belongs in restricted object storage; processed Zarr and terrain tiles in object storage/CDN; observation summaries, catalogue, users, and audit metadata in PostgreSQL/PostGIS. Keep instrument-level data-access permissions separate from the public demo assets.

## Ingestion commands

Create an isolated Python environment in `oceanscope-india/backend`, install `requirements.txt`, and run:

```powershell
python scripts/ingest_model.py `
  --source ..\data\raw\model\incois\sample.nc `
  --dataset-id incois_indian_ocean_2025q2 `
  --lat-min -40 --lat-max 30 --lon-min 20 --lon-max 125

python scripts/ingest_observations.py `
  --source ..\data\raw\argo\indian_ocean_profiles.nc `
  --kind "Argo float" `
  --collection argo_2025q2
```

The model script accepts local NetCDF or an OPeNDAP URL, maps common variable aliases to `thetao`, `so`, `uo`, `vo`, `wo`, `chl`, and `zos`, validates dimensions, then writes a chunked Zarr cube plus a catalogue entry. The observation script normalizes CSV, text, or NetCDF into the shape the frontend will consume.

## Quarterly update process

1. Download and checksum original files into a new dated `raw/` folder.
2. Run schema/QC validation; reject invalid coordinate units, duplicate time steps, or absent fill-value metadata.
3. Run both ingestion scripts with a new stable dataset ID.
4. Build web tiles and preview the data against a scientist-approved reference map.
5. Mark the new catalogue entry as active only after review; retain the earlier run for reproducibility.

The first production addition is authentication and role-based access—not a rewrite of this data design.
