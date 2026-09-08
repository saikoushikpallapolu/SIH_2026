# OceanScope India — Features & Operations Manual

This guide provides an exhaustive operational walkthrough of all modules in **OceanScope India**.

---

## 1. Global 4D Digital Twin (`Globe` Mode)

The primary visualization engine renders the planet Earth with physical atmospheric limb scattering, 4K day satellite imagery, subpixel coastlines, and continuous depth/timeline navigation.

```
+-------------------------------------------------------------------------------------------------+
| [Thermal]  [Salinity]  [Chlorophyll]  [Ocean Currents]  [Instruments]    Depth: [ 35 m =========] |
| THEME: Chlorophyll (NASA alga) · Upwelling Blooms vs Oligotrophic Ocean Desert                  |
| [>] Play   [Jan 2000 ------------------------------------------------ Dec 2024]  [0.03 = 2.50]  |
+-------------------------------------------------------------------------------------------------+
```

### Physical Parameter Overlays
1. **Thermal (`cmocean thermal`)**:
   * Sea Surface Temperature (SST) and thermocline decay from $+33^\circ\text{C}$ in the equatorial Indian warm pool down to $+2^\circ\text{C}$ in the subantarctic zone.
   * Visualizes pre-monsoon heating in the northern Arabian Sea and cold upwelling along the Somali coast.
2. **Salinity (`cmocean haline`)**:
   * Highlights the contrast between the high-salinity Arabian Sea ($> 36.5\text{ PSU}$, driven by strong evaporation) and the low-salinity Bay of Bengal ($< 32.5\text{ PSU}$, driven by massive monsoon precipitation and runoff from the Ganges, Brahmaputra, and Irrawaddy rivers).
3. **Chlorophyll (`NASA MODIS alga`)**:
   * Logarithmically calibrated to NASA ocean color standards ($0.025 - 2.50\text{ mg/m}^3$).
   * Illuminates seasonal phytoplankton blooms, coastal upwellings (Somali current, Malabar shelf, Sri Lanka dome), and oligotrophic subtropical desert waters.
4. **Ocean Currents (`cmocean speed`)**:
   * Dynamic geodesic particle streamlines tracing the Great Whirl, Somali Jet, South Equatorial Current, and Agulhas Retroflection.
   * Real-time flow speed and intensity adjustments.

### Timeline & Depth Scrubber
* **25-Year Timeline Slider**: Scrub across 300 continuous months (Jan 2000 to Dec 2024). Click the **Play / Pause** button to animate interannual climate variations, El Niño / IOD cycles, and monsoon transitions.
* **Depth Slider**: Slice the ocean vertically from surface waters ($0\text{ m}$) down to $5,000\text{ m}$. In chlorophyll mode, depth adjustments simulate the Deep Chlorophyll Maximum (DCM) at $40-60\text{ m}$ before light extinction attenuates primary production below $120\text{ m}$.

---

## 2. Geodesic Area Selection & Marine Validation

OceanScope India allows users to select any ocean or coastal area on Earth with a two-point geodesic bounding box tool:

```
                  Click Point 1 (Top-Left Anchor)
                              +----------------------------+
                              |                            |
                              |   Bounding Region Canvas   |
                              |                            |
                              +----------------------------+
                                                 Click Point 2 (Bottom-Right Corner)
```

### How to Select an Area:
1. Ensure you are in **Globe** or **Ocean Currents** mode.
2. Click once on the globe to establish the first anchor corner. A pulsing cyan marker will designate the anchor.
3. Move your cursor across the globe; a real-time boundary polygon will track your pointer.
4. Click a second point to finalize the bounding box.
5. The **Selected Marine Region Card** appears in the upper left, displaying:
   * **Span**: Width $\times$ Height in kilometers (e.g., $495 \times 611\text{ km}$).
   * **Surface Area**: Total square kilometers (e.g., $302,445\text{ km}^2$).
   * **Geographic Bounds**: Latitude and Longitude bounding coordinates.
6. If the bounding box contains ocean waters, the **`3D Deep Dive`** button activates immediately.

### Fast Benchmark Presets:
Use the quick-select chips at the top of the globe to inspect predefined oceanographic sites:
* **Mumbai Shelf**: Continental shelf break and Western Ghats coastal waters.
* **Sunda Subduction Trench**: Abyssal trench off Sumatra and Java.
* **Gulf of Aden**: High-salinity bottleneck connecting the Red Sea.
* **Lakshadweep**: Coral plateau and atoll lagoons in the eastern Arabian Sea.

---

## 3. High-Realism 3D Deep Dive (Digital Twin Block)

Clicking **`3D Deep Dive`** enters a localized, high-fidelity digital twin block representing the selected geographic bounding box:

```
+-------------------------------------------------------------------------------------------------+
|                                AERIAL SKY & COASTAL HORIZON                                     |
| ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ WATER SURFACE ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ |
|    *  .    *  .                                                      o  O                       |
|  .   *  .        [ Swirling Baitball Vortices ]                     o     O  [ CTD Telemetry ]  |
|    *  .    *                                                         O   o                      |
|                  =============================================                                  |
|                  \\\\   NOAA ETOPO1 BATHYMETRIC BEDROCK   \\\\                                  |
+-------------------------------------------------------------------------------------------------+
```

### Key Capabilities:
* **True Bedrock Topography**: Built directly from NOAA ETOPO1 elevation data. Continental shelves, submarine canyons, slopes, and trenches appear with natural geological contours.
* **Dual Aerial & Subsea Camera Freedom**:
  * Ascend above $Y = 0$ into the atmosphere to inspect the coastline, river estuaries, and surface currents.
  * Dive beneath $Y = 0$ to inspect the seabed, submarine trenches, and marine water column.
* **Dynamic Caustics & Lighting**: Sunlight refracts through the undulating surface mesh, casting moving caustic networks onto the golden sand shelf.
* **Biomass & Baitball Ecosystem**:
  * Procedural fish boids and baitballs dynamically scale with local chlorophyll concentration.
  * In upwelling zones ($> 1.2\text{ mg/m}^3$), thousands of fish form synchronized rotating vortices.
* **Live Telemetry HUD**: Constant subsea telemetry display reporting depth, water temperature, salinity, currents, and biomass density.

---

## 4. Physical Tsunami Propagation Simulator

Click **`Tsunami Visualisation`** in the top navigation bar to access historical tsunami simulations driven by bathymetric wave speed equations ($c = \sqrt{g \cdot h}$):

### Historic Scenarios:
1. **2004 Sumatra-Andaman Earthquake ($M_w\ 9.1$)**:
   * $1,300\text{ km}$ megathrust rupture along the Sunda Trench.
   * Generates trans-oceanic wavefronts impacting India, Sri Lanka, and Thailand.
2. **1945 Makran Earthquake ($M_w\ 8.1$)**:
   * Northern Arabian Sea subduction event impacting the coasts of Gujarat, Pakistan, and Oman.
3. **2012 Wharton Basin Strike-Slip ($M_w\ 8.6$)**:
   * Massive intraplate strike-slip event illustrating complex shear rupture kinematics without significant vertical seafloor displacement.

### Interactive Controls:
* **Wave Propagation Slider**: Scrub from Hour 0 to Hour 8 post-earthquake.
* **Rupture Arc**: Displays the 3D seismic fault line and epicenter beacon.
* **Tide Gauge Stations**: Click any coastal station marker (e.g., Chennai, Port Blair, Visakhapatnam) to view arrival times, peak wave height telemetry, and distance from epicenter.

---

## 5. Hotspots Drawer & In-Situ Observation Fleet

### Hotspots Drawer
Access 18 curated Indian Ocean biomes, trenches, and biological zones by clicking **`Hotspots`** in the top bar:
* **Upwelling Corridors**: Somali Current, Malabar Coast, Sri Lanka Cetacean Dome, Oman Upwelling.
* **Abyssal Trenches**: Sunda Trench ($7,450\text{ m}$ hadal depth), Diamantina Deep.
* **River Plumes**: Ganges-Brahmaputra Delta, Indus Estuary, Irrawaddy Delta.
* **Coral Superstructures**: Chagos Atolls, Lakshadweep Plateau, Seychelles Bank.
* **Tectonic Ridges**: Central Indian Ridge hydrothermal vents, Ninety East Ridge.

### In-Situ Platforms (`Instruments` toggle)
Toggle real-time positions and historical dive profiles for autonomous marine instruments:
* **Argo Profiling Floats**: Display WMO ID, latest cycle date, temperature/salinity profiles, and drift depth.
* **BioGeoChemical Argo**: Tracks optical backscatter, chlorophyll-a profiles, and dissolved oxygen.
* **INCOIS Gliders**: Displays underwater mission tracks, pitch/roll angles, and depth sawtooth trajectories.
