# OceanScope India

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![React 19](https://img.shields.io/badge/React-19.1.1-61dafb.svg)](https://react.dev/)
[![Three.js](https://img.shields.io/badge/Three.js-r179-black.svg)](https://threejs.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688.svg)](https://fastapi.tiangolo.com/)
[![Python 3.10+](https://img.shields.io/badge/Python-3.10%2B-blue.svg)](https://python.org)
[![Hugging Face](https://img.shields.io/badge/%F0%9F%A4%97%20Hugging%20Face-Dataset-yellow.svg)](https://huggingface.co/datasets/Maybe-Heisenberg-07/koushik_captain_incois)

**OceanScope India** is an ultra-high-performance 4D Digital Twin and scientific oceanographic exploration platform for the Indian Ocean basin ($20^\circ\text{E} \rightarrow 125^\circ\text{E}$, $-45^\circ\text{S} \rightarrow 32^\circ\text{N}$). Developed for the **Smart India Hackathon (SIH 2026)** in collaboration with the **Indian National Centre for Ocean Information Services (INCOIS)**, the system synthesizes 25 years (2000–2024) of continuous multimodal hydrographic, biophysical, and atmospheric data into an interactive browser-based visual suite.

---

## Table of Contents

1. [Key Features](#key-features)
2. [System Architecture](#system-architecture)
3. [Technology Stack](#technology-stack)
4. [Quick Start Guide](#quick-start-guide)
5. [User Interface & Interactive Controls](#user-interface--interactive-controls)
6. [Data Pipeline & Storage Architecture](#data-pipeline--storage-architecture)
7. [API Endpoints Overview](#api-endpoints-overview)
8. [Documentation Index](#documentation-index)
9. [Contributing & Developer Guidelines](#contributing--developer-guidelines)
10. [License](#license)

---

## Key Features

### 1. Interactive 4D WebGL Digital Twin Globe
* **Photorealistic 4K Earth & Atmosphere**: Local 4K satellite base map with dynamic limb-scattering atmospheric haze, horizon glow, and subpixel-antialiased shoreline masking (zero land bleed).
* **Non-Linear Bathymetric Relief**: Visualizes submarine continental shelves, ocean ridges (e.g., Ninety East Ridge, Southwest Indian Ridge), and the deep hadal Sunda Trench with real-time isobath contours (1,800 m shelf break).
* **25-Year Multimodal Timeline**: Interactive monthly scrubbing from **January 2000 through December 2024** (300 consecutive epochs).
* **Full-Column Depth Slicing**: Dynamic inspection from surface waters ($0\text{ m}$) down to abyssal depths ($5,000\text{ m}$) across 16 oceanographic standard levels.
* **Scientific Colormaps**:
  * **Thermal**: `cmocean thermal` (Sea Surface Temperature & thermocline decay).
  * **Salinity**: `cmocean haline` (Arabian Sea evaporation basin vs. Bay of Bengal monsoon river plumes).
  * **Chlorophyll**: `NASA MODIS alga` with authentic logarithmic scaling ($\text{normC} = [\ln(\text{chl}) - \ln(0.025)] / 4.605$) capturing oligotrophic gyres, coastal upwellings, and river deltas.
  * **Currents**: `cmocean speed` with active geodesic streamlines, particle velocity advection, and seasonal reversal of the Somali Current.

### 2. 100% Geodesic Area Selection & Marine Validation
* **Interactive Bounding Box Selection**: Click any two points on the 3D globe to establish a localized bounding box with live geodesic span ($km \times km$) and surface area ($km^2$) calculations.
* **Benchmark Presets**: One-click selection for iconic regions:
  * *Mumbai Shelf & Western Ghats* ($15.0^\circ\text{N} - 20.5^\circ\text{N}$, $70.0^\circ\text{E} - 74.5^\circ\text{E}$)
  * *Sunda Subduction Trench* ($-8.5^\circ\text{S} - -3.0^\circ\text{S}$, $99.5^\circ\text{E} - 105.0^\circ\text{E}$)
  * *Gulf of Aden & Bab-el-Mandeb* ($10.5^\circ\text{N} - 14.5^\circ\text{N}$, $43.5^\circ\text{E} - 51.0^\circ\text{E}$)
  * *Lakshadweep Coral Archipelago* ($8.0^\circ\text{N} - 13.0^\circ\text{N}$, $71.0^\circ\text{E} - 74.5^\circ\text{E}$)
* **Marine Boundary Enforcement**: Automatically validates ocean presence inside the selected bounding box, enabling seamless one-click transition into the 3D Deep Dive twin.

### 3. High-Realism 3D Deep Dive (Digital Twin Block)
* **True ETOPO Bathymetric Bedrock**: Loads authentic 1-arc-minute topographic elevation grids, rendering continental shelves, submarine canyons, and trenches with geological golden sand and rocky textures.
* **Dynamic Surface & Aerial Camera**: Full vertical freedom—ascend above sea level for panoramic aerial coast views or dive beneath the surface to inspect the benthos without artificial ceilings.
* **Underwater Physics & Caustics**: Dynamic sunlight refraction caustics, depth-based atmospheric light extinction, and marine snow particles.
* **Ecological Biomass & Baitball Vortices**: Procedural marine life engine that dynamically scales fish shoals and swirling baitball vortices (1,200–1,500 individuals) directly according to local chlorophyll-a and phytoplankton productivity.
* **Real-Time CTD Telemetry HUD**: Constant telemetry readouts for depth, temperature, salinity, current velocity ($u, v$), and chlorophyll.

### 4. Physical Tsunami Propagation Simulator
* **Shallow-Water Wave Dynamics**: Real-time wave front velocity governed by bathymetry ($c = \sqrt{g \cdot h}$).
* **Historic Calamity Scenarios**:
  * **2004 Sumatra Megathrust** ($M_w\ 9.1$, 1,300 km rupture arc).
  * **1945 Makran Subduction Zone** ($M_w\ 8.1$, Arabian Sea).
  * **2012 Wharton Basin Strike-Slip** ($M_w\ 8.6$, Intraplate deformation).
* **Coastal Tide Gauge Network**: Real-time arrival time and peak amplitude telemetry across Chennai, Port Blair, Visakhapatnam, Tuticorin, Colombo, Male, and Phuket.

### 5. In-Situ Oceanographic Observation Fleet
* **Argo Profiling Floats**: Active robotic drift floats measuring temperature and salinity profiles down to 2,000 m.
* **BioGeoChemical (BGC) Argo**: Equipped with bio-optical fluorometers tracking subsurface chlorophyll maxima (DCM).
* **INCOIS Autonomous Underwater Gliders**: Sawtooth propulsion tracks with real-time heading vectors.
* **18 Curated Ecological Hotspots**: Floating HUD beacons for major upwelling corridors, whale feeding domes, and hadal trenches with flicker-free screen-space tooltips.

---

## System Architecture

```
                                  +-------------------------------------------------------+
                                  |                 Client Web Browser                    |
                                  |     React 19 + TypeScript + Three.js + R3F + CSS      |
                                  +-------------------------------------------------------+
                                         |                                  |
               REST / JSON Queries (Telemetry, Bathymetry)         Float32 Binary Slices (GPU Textures)
                                         |                                  |
                                         v                                  v
+-------------------------------------------------------------------------------------------------+
|                                FastAPI Backend Engine (Port 8000)                               |
|                                                                                                 |
|   /api/slice                  /api/currents/grid              /api/telemetry/subgrid            |
|   (2D Float32 Slice Buffer)   (Vector Field Matrices)         (Bilinear Interpolated CTD)       |
|                                                                                                 |
|   /api/deepdive/terrain       /api/tsunami/stations           /api/health                       |
|   (ETOPO Elevation Grids)     (Tide Gauge Gauging telemetry)  (Memory-map healthcheck)          |
+-------------------------------------------------------------------------------------------------+
                                         |
                               Memory-Mapped File Access (NumPy np.memmap, O(1) Overhead)
                                         |
                                         v
+-------------------------------------------------------------------------------------------------+
|                                 Local High-Performance Data Vault                               |
|                                                                                                 |
|   data/processed/cubes/                                       data/processed/terrain/           |
|   ├── temperature_25yr.bin  (16 depths x 300 mo x 309x421)    ├── etopo_bathymetry_bedrock.bin  |
|   ├── salinity_25yr.bin     (16 depths x 300 mo x 309x421)    data/processed/observations/      |
|   ├── currents_u_25yr.bin   (300 mo x 309x421)                ├── argo_profiles.json            |
|   ├── currents_v_25yr.bin   (300 mo x 309x421)                ├── bgc_argo_chlorophyll.json     |
|   └── chlorophyll_25yr.bin  (300 mo x 309x421)                └── glider_missions.json          |
+-------------------------------------------------------------------------------------------------+
```

---

## Technology Stack

| Layer | Technologies | Purpose |
|---|---|---|
| **Frontend Framework** | React 19, TypeScript, Vite 7 | High-performance reactive UI and component state orchestration |
| **3D Graphics & Shaders** | Three.js (r179), `@react-three/fiber`, `@react-three/drei` | WebGL canvas, 4D globe shaders, particle systems, underwater camera director |
| **Styling & HUD** | Vanilla CSS, Lucide React Icons | Sleek dark-mode glassmorphism, responsive control docks, scientific colorbars |
| **Backend Framework** | FastAPI, Uvicorn, Python 3.10+ | Asynchronous REST API, binary data slice serialization, subgrid telemetry |
| **Scientific Data Engine** | NumPy 2.x (`np.memmap`), SQLite 3 | Zero-overhead memory-mapped binary cube slicing, geospatial index querying |
| **Data Repositories** | Hugging Face Hub, NOAA ETOPO1, INCOIS, GEBCO | Remote cloud synchronization and bathymetric bedrock models |

---

## Quick Start Guide

### Prerequisites
* **Node.js**: `v20.x` or higher (`npm v10+`)
* **Python**: `3.10` or higher (`pip` / `venv`)
* **Hardware**: Dedicated or integrated GPU supporting WebGL 2.0 (Google Chrome, Firefox, Safari, or Edge)

---

### Step 1: Clone the Repository
```bash
git clone https://github.com/saikoushikpallapolu/SIH_2026.git
cd SIH_2026
```

---

### Step 2: Backend Setup & Data Initialization

1. Create and activate a Python virtual environment:
   ```bash
   # macOS / Linux
   python3 -m venv venv
   source venv/bin/activate

   # Windows (Command Prompt / PowerShell)
   python -m venv venv
   .\venv\Scripts\activate
   ```

2. Install backend dependencies:
   ```bash
   pip install -r backend/requirements.txt
   ```

3. Generate or sync the local 25-Year 4D data cubes:
   * **Option A — Fast Local Generation** (Recommended, ~25 seconds, zero network required):
     ```bash
     python backend/scripts/fetch_hydrography_and_currents.py
     python backend/scripts/fetch_real_chlorophyll.py
     ```
   * **Option B — Hugging Face Cloud Synchronization** (Direct download from Hub):
     ```bash
     python backend/scripts/sync_data.py --pull
     ```

4. Launch the FastAPI backend server:
   ```bash
   python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --reload
   ```
   * The backend will be available at `http://127.0.0.1:8000`.
   * Interactive OpenAPI docs: `http://127.0.0.1:8000/docs`.

---

### Step 3: Frontend Setup

Open a new terminal window:
```bash
cd SIH_2026
npm install
npm run dev
```

The application will launch on **`http://127.0.0.1:5173`**.

---

## User Interface & Interactive Controls

```
+---------------------------------------------------------------------------------------------+
| [OceanScope INDIA]      [Globe]  [Tsunami Visualisation]  [3D Deep Dive]  [Hotspots]        |
+---------------------------------------------------------------------------------------------+
| [Area Selection Guide: Click 2 points on globe] [Mumbai Shelf] [Sunda Trench] [Gulf of Aden]|
|                                                                                             |
|                                                                                             |
|                                       3D WEBGL GLOBE                                        |
|                                                                                             |
|                                                                                             |
+---------------------------------------------------------------------------------------------+
|  [Thermal] [Salinity] [Chlorophyll] [Currents] [Instruments]  |  Depth Slider: [Surface - 5km]|
|  THEME: Chlorophyll (NASA alga) · Upwelling Blooms vs Oligotrophic Ocean Desert             |
|  [>] Play  [Timeline Scrubber: 2000 ----------------------- 2024]  [0.03 ===== 2.50 mg/m³]  |
+---------------------------------------------------------------------------------------------+
```

### Global Mouse & Camera Controls
* **Orbit / Rotate**: Left-click + drag anywhere on the ocean surface.
* **Zoom In / Out**: Scroll wheel. Smoothly moves camera from orbital view down to surface waters.
* **Area Selection**: Click two points on the globe surface to draw a geodesic bounding box.
* **Clear Area**: Click `Clear` on the selected region card or benchmark banner.
* **Enter 3D Deep Dive**: Click `3D Deep Dive` on the top bar, or click `3D Deep Dive` on any selected marine region card.

### Hotspots Drawer
Click **`Hotspots`** in the top navigation bar to open the curated catalog of 18 ocean biomes:
* Filter by category: *Upwelling Blooms*, *Deep Trenches*, *River Plumes*, *Coral Atolls*, *Volcanic Ridges*.
* Clicking any card automatically teleports the camera to the coordinate and configures the default bathymetric depth.

---

## Data Pipeline & Storage Architecture

```text
data/
├── processed/
│   ├── cubes/                                 # 25-Year 4D Binary Arrays (Float16)
│   │   ├── temperature_25yr.bin               # [300 months x 16 depths x 309 lats x 421 lons]
│   │   ├── salinity_25yr.bin                  # [300 months x 16 depths x 309 lats x 421 lons]
│   │   ├── currents_u_25yr.bin                # [300 months x 309 lats x 421 lons]
│   │   ├── currents_v_25yr.bin                # [300 months x 309 lats x 421 lons]
│   │   └── chlorophyll_25yr.bin               # [300 months x 309 lats x 421 lons]
│   ├── terrain/                               # Geological Bathymetry Models
│   │   └── etopo_bathymetry_bedrock.bin       # NOAA ETOPO1 Indian Ocean Bedrock
│   └── observations/                          # In-Situ Sensor Catalogues
│       ├── argo_profiles.json                 # Core Argo CTD profiles
│       ├── bgc_argo_chlorophyll.json          # BioGeoChemical Argo profiles
│       └── glider_missions.json               # INCOIS mission tracks
└── raw/                                       # Immutable downloads (gitignored)
```

---

## API Endpoints Overview

The FastAPI backend exposes high-performance binary streaming and analytical query routes:

| Method | Route | Parameters | Output Format | Description |
|---|---|---|---|---|
| `GET` | `/api/health` | None | `JSON` | Health status and verification of loaded binary cubes |
| `GET` | `/api/slice` | `variable`, `month`, `depth` | `application/octet-stream` (Float32 Array) | Dynamic 2D raster slice ($309 \times 421$) for GPU texturing |
| `GET` | `/api/currents/grid` | `month`, `depth` | `JSON` | Vector field samples ($U, V, \text{speed}$) for streamline particles |
| `GET` | `/api/telemetry/subgrid` | `lat`, `lon`, `depth`, `month` | `JSON` | Bilinear interpolated CTD telemetry at exact coordinates |
| `GET` | `/api/deepdive/terrain` | `min_lat`, `max_lat`, `min_lon`, `max_lon`, `grid_res` | `JSON` | Subgrid ETOPO elevation matrix and water mask for 3D twin |
| `GET` | `/api/tsunami/stations` | None | `JSON` | Coastal tide gauge catalog with historic travel times and amplitudes |
| `GET` | `/api/instruments` | None | `JSON` | In-situ platform metadata (Argo, BGC-Argo, Gliders) |

For comprehensive documentation with request and response examples, refer to [docs/API_REFERENCE.md](./docs/API_REFERENCE.md).

---

## Documentation Index

Detailed technical specifications and user manuals are available in the [`docs/`](./docs/) directory:

1. 📖 **[System Architecture & Shaders](./docs/ARCHITECTURE.md)**: WebGL shader pipelines, memory-mapped binary array streaming, and React Three Fiber scene hierarchy.
2. 🗺️ **[Features & Operations Manual](./docs/FEATURES_GUIDE.md)**: In-depth usage guide for area selection, 3D deep dive immersion, tsunami simulator, and in-situ platforms.
3. 🔬 **[Oceanographic Data Engine](./docs/DATA_ENGINE.md)**: Mathematical formulations, logarithmic ocean color calibration, depth levels, and Hugging Face synchronization.
4. 🔌 **[REST API Reference](./docs/API_REFERENCE.md)**: Complete endpoint parameters, query structures, and response schemas.

---

## Contributing & Developer Guidelines

When contributing to this repository:
1. **Branching**: Create focused feature branches (`feat/feature-name` or `fix/bug-name`) from `main`.
2. **Type Safety**: Run `npx tsc --noEmit` before submitting changes to verify TypeScript correctness.
3. **Commit Messages**: Follow Conventional Commits (`feat: ...`, `fix: ...`, `docs: ...`, `refactor: ...`).
4. **Data Isolation**: Never commit multi-gigabyte binary files (`data/processed/cubes/*.bin`) to Git. Use the scripts in `backend/scripts/` to generate or sync data locally.

---

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

Developed with pride for the **Smart India Hackathon 2026** and **INCOIS**.
