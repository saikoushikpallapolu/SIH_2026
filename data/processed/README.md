---
license: cc-by-4.0
task_categories:
  - time-series-forecasting
tags:
  - oceanography
  - climate
  - earth-science
  - indian-ocean
  - incois
  - bathymetry
  - argo
  - tsunami
size_categories:
  - 1GB<n<10GB
---

# OceanScope India: 25-Year Multimodal Oceanographic Atlas (2000–2024)

This dataset powers the **OceanScope India** interactive 4D digital twin of the Indian Ocean. It combines physical hydrography, biogeochemical fields, surface circulation, bathymetry, historical extreme event simulations, and in-situ observational networks into unified tensors.

---

## Dataset Structure

```
data/processed/
├── cubes/
│   ├── ocean_fields_25yr_meta.json       # Coordinate bounds, depth levels, and tensor offsets
│   ├── temperature_25yr.bin              # 3D Potential Temperature [300 months x 16 depths x 309 lats x 421 lons]
│   ├── salinity_25yr.bin                 # 3D Practical Salinity [300 months x 16 depths x 309 lats x 421 lons]
│   ├── currents_u_25yr.bin               # Zonal surface velocity u [300 months x 309 lats x 421 lons]
│   ├── currents_v_25yr.bin               # Meridional surface velocity v [300 months x 309 lats x 421 lons]
│   ├── chlorophyll_25yr.bin              # Surface photic chlorophyll-a [300 months x 309 lats x 421 lons]
│   └── tsunami_2004_hourly.json          # Dec 26, 2004 Tsunami hourly wave height & propagation
├── extreme_events/
│   └── tsunami_2004_metadata.json        # Epicenter coordinates, seismic moment, and Jason-1 calibration
├── observations/
│   └── instruments_catalog.json          # Active & historic Argo, BGC-Argo, Gliders, RAMA & Tide Gauges
├── terrain/
│   ├── bathymetry_io.bin                 # GEBCO Indian Ocean seafloor depth grid (float32)
│   ├── bathymetry_meta.json              # Grid metadata & bounding box
│   ├── bathymetry_mask.png               # Land-sea binary mask
│   └── bathymetry_relief.png             # Shaded bathymetric relief texture
├── textures/
│   ├── chl_*.png                         # WebGL ocean surface textures (Heatwaves, Monsoons, Tsunami)
│   ├── sal_*.png
│   └── temp_*.png
└── oceanscope.db                         # SQLite catalog with indexed instrument profiles and metadata
```

---

## Grid & Dimensions

- **Spatial Extent**:
  - Latitude: `-45.0°S` to `+32.0°N` ($N_{lat} = 309$)
  - Longitude: `20.0°E` to `125.0°E` ($N_{lon} = 421$)
- **Vertical Depths (16 standard levels)**:
  `[0, 10, 25, 50, 75, 100, 150, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000]` meters.
- **Temporal Horizon**:
  - 25 Years (300 months): `2000-01` to `2024-12`
  - Historic Event: `2004-12-26` Tsunami hourly wave shockwave simulation (0.25h to 10h post-earthquake).

---

## How to Synchronize

### 1. Using OceanScope India sync script:
```bash
python backend/scripts/sync_data.py --pull
```

### 2. Using `huggingface_hub` in Python:
```python
from huggingface_hub import snapshot_download

snapshot_download(
    repo_id="Maybe-Heisenberg-07/koushik_captain_incois",
    repo_type="dataset",
    local_dir="data/processed"
)
```

---

## Attribution & Data Sources
- **Physical & Biogeochemical Climatologies**: INCOIS, NOAA World Ocean Atlas (WOA), OISST, OSCAR Surface Currents.
- **Bathymetry**: GEBCO (General Bathymetric Chart of the Oceans).
- **Instruments**: INCOIS Ocean Data & Argo GDAC (Global Data Assembly Centre).
- **Historic Simulation**: Calibrated against the Jason-1 radar altimeter satellite overflight (Cycle 109, Pass 129).
