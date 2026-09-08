# Oceanographic Data Engine & Synthesis Protocols

This document details the spatial, temporal, physical, and bio-optical foundations of the **OceanScope India** 4D Data Engine.

---

## 1. Spatial & Coordinate Grid Specifications

The Indian Ocean regional domain encompasses the entirety of the primary operational responsibility zone for INCOIS:

| Parameter | Value | Details |
|---|---|---|
| **Longitude Range** | $20.125^\circ\text{E} \rightarrow 124.875^\circ\text{E}$ | Extends from the Agulhas Retroflection across to the Indonesian Archipelago |
| **Latitude Range** | $-44.875^\circ\text{S} \rightarrow 32.0^\circ\text{N}$ | Extends from the Subantarctic convergence zone to the Persian Gulf / Himalayas |
| **Spatial Resolution** | $0.25^\circ \times 0.25^\circ$ | High-resolution oceanographic mesoscale grid |
| **Grid Dimensions** | $309\text{ (Latitude)} \times 421\text{ (Longitude)}$ | $130,089$ horizontal cells per layer |
| **Total Horizontal Points** | $130,089\text{ cells}$ | Continuous spatial matrix |

---

## 2. Vertical Depth Levels (16 Oceanographic Standards)

The water column is discretized into 16 internationally standardized oceanographic depth levels:

$$\text{DEPTH\_LEVELS} = [0, 10, 25, 50, 75, 100, 150, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000]\text{ meters}$$

* **Epipelagic (Euphotic Zone, $0 - 100\text{ m}$)**: Sunlight penetration, intense biological photosynthesis, strong wind-driven seasonal thermocline.
* **Mesopelagic (Twilight Zone, $100 - 1,000\text{ m}$)**: Rapid temperature decline, permanent main thermocline, intermediate water mass boundaries (Red Sea Outflow, Antarctic Intermediate Water).
* **Bathypelagic (Midnight Abyss, $1,000 - 5,000\text{ m}$)**: Near-uniform cold temperatures ($+1.5^\circ\text{C} - +2.5^\circ\text{C}$), stable salinity ($34.72\text{ PSU}$), extreme hydrostatic pressure.

---

## 3. Temporal Domain & Climate Indices

* **Temporal Range**: 25 Years (2000-01-15 through 2024-12-15)
* **Frequency**: Monthly means ($300\text{ consecutive time-slices}$)
* **Total Multimodal Volume**: $\approx 2.55\text{ GB}$ (binary Float16 representation)

### Integrated Climate Teleconnections:
The dataset incorporates historical macro-climatic anomalies:
* **Indian Ocean Dipole (IOD)**: Positive IOD events (notably 2019) featuring western basin warming and eastern basin cooling/suppressed rainfall.
* **El Niño–Southern Oscillation (ENSO)**: Basin-wide warming trends during strong El Niño years (2015–2016, 2023–2024).
* **2004 Tsunami Shock**: Post-seismic mixing signals following the December 2004 megathrust event.

---

## 4. Mathematical Formulations & Physical Laws

### A. Hydrodynamic Velocity Advection (Currents)
The Somali Current is the only major western boundary current on Earth that completely reverses direction seasonally:
* **Southwest Summer Monsoon (June–September)**: Strong south-westerly winds drive the intense northward-flowing Somali Jet ($> 2.0\text{ m/s}$), producing the Great Whirl and coastal cold upwelling wedges.
* **Northeast Winter Monsoon (November–February)**: Reversal to a southward-flowing coastal current ($0.4 - 0.7\text{ m/s}$).

### B. Bio-Optical Logarithmic Chlorophyll Scaling
Chlorophyll-a concentration ranges over three orders of magnitude ($0.025 - 3.5\text{ mg/m}^3$). The system evaluates a logarithmic transfer function for uniform visual discrimination:

$$\text{normC} = \text{clamp}\left(\frac{\ln(\max(\text{val}, 0.025)) - (-3.68888)}{4.60517}, 0.0, 1.0\right)$$

### C. Deep Chlorophyll Maximum (DCM) Vertical Decay
At depth $z > 0\text{ m}$, primary production is governed by sunlight extinction:
* **$z \le 45\text{ m}$**: Chlorophyll concentration rises towards the subsurface Deep Chlorophyll Maximum:
  $$f_{\text{depth}}(z) = 1.0 + \left(\frac{z}{45}\right) \times 0.25$$
* **$45 < z \le 120\text{ m}$**: Rapid attenuation as euphotic illumination diminishes:
  $$f_{\text{depth}}(z) = 1.25 \times \left(1.0 - \frac{z - 45}{75}\right) \times 0.9 + 0.1$$
* **$z > 120\text{ m}$**: Aphotic zone decay to near-zero background:
  $$f_{\text{depth}}(z) = \max\left(0.005, 0.1 \times \exp\left(-\frac{z - 120}{50}\right)\right)$$

---

## 5. Storage Layout & Binary Matrix Specifications

```text
data/processed/cubes/
├── temperature_25yr.bin
│   Dimensions: [300, 16, 309, 421]
│   Datatype:   Float16 (2 bytes)
│   File Size:  1,248.8 MB
│
├── salinity_25yr.bin
│   Dimensions: [300, 16, 309, 421]
│   Datatype:   Float16 (2 bytes)
│   File Size:  1,248.8 MB
│
├── currents_u_25yr.bin / currents_v_25yr.bin
│   Dimensions: [300, 309, 421]
│   Datatype:   Float16 (2 bytes)
│   File Size:  74.4 MB each
│
└── chlorophyll_25yr.bin
    Dimensions: [300, 309, 421]
    Datatype:   Float16 (2 bytes)
    File Size:  74.4 MB
```

---

## 6. Hugging Face Hub Dataset Synchronization

The complete dataset is mirrored on the Hugging Face Hub:
* **Repository**: [`Maybe-Heisenberg-07/koushik_captain_incois`](https://huggingface.co/datasets/Maybe-Heisenberg-07/koushik_captain_incois)

### CLI Operations:
```bash
# Pull remote data cube updates
python backend/scripts/sync_data.py --pull

# Inspect local cube integrity and checksums
python backend/scripts/sync_data.py --status

# Push local synthesized cubes to Hugging Face Hub (Maintainers only)
python backend/scripts/sync_data.py --push
```
