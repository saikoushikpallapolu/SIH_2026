# OceanScope India — REST API Reference

The backend API is implemented in **FastAPI** and runs on port `8000` by default.

Interactive Swagger / OpenAPI UI: **`http://127.0.0.1:8000/docs`**  
ReDoc Documentation: **`http://127.0.0.1:8000/redoc`**

---

## 1. Health & Memory-Map Status

### `GET /api/health`
Returns the operational health of the API and status of memory-mapped data cubes.

#### Response:
```json
{
  "status": "healthy",
  "cubes_loaded": {
    "temperature": true,
    "salinity": true,
    "currents_u": true,
    "currents_v": true,
    "chlorophyll": true
  },
  "database_connected": true,
  "grid_shape": [309, 421],
  "months": 300,
  "depth_levels": [0, 10, 25, 50, 75, 100, 150, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000]
}
```

---

## 2. 2D Data Slice Streaming (Float32 Binary)

### `GET /api/slice`
Streams a raw $309 \times 421$ 2D Float32 binary matrix for direct WebGL GPU texture upload.

#### Query Parameters:
| Parameter | Type | Required | Default | Allowed Values / Range | Description |
|---|---|---|---|---|---|
| `variable` | `string` | No | `"temperature"` | `"temperature"`, `"salinity"`, `"chlorophyll"`, `"currents"` | Physical variable to slice |
| `month` | `integer` | No | `299` | `0` to `299` | Month index (0 = Jan 2000, 299 = Dec 2024) |
| `depth` | `float` | No | `0.0` | `0.0` to `5000.0` | Target ocean depth in meters |

#### Response:
* **Status**: `200 OK`
* **Content-Type**: `application/octet-stream`
* **Length**: `520,356 bytes` ($309 \times 421 \times 4\text{ bytes}$)

#### Example Request:
```bash
curl -O "http://127.0.0.1:8000/api/slice?variable=chlorophyll&month=7&depth=25"
```

---

## 3. Currents Vector Field Matrix

### `GET /api/currents/grid`
Returns subsampled zonal ($U$) and meridional ($V$) velocity components and speed magnitude across the Indian Ocean basin for streamline and particle advection.

#### Query Parameters:
| Parameter | Type | Required | Default | Range | Description |
|---|---|---|---|---|---|
| `month` | `integer` | No | `299` | `0` to `299` | Month index |
| `depth` | `float` | No | `0.0` | `0.0` to `5000.0` | Ocean depth level |

#### Response:
```json
{
  "month": 7,
  "depth": 0.0,
  "step": 3,
  "vectors": [
    { "lat": 9.5, "lon": 51.5, "u": 1.45, "v": 1.82, "speed": 2.33 },
    { "lat": 9.5, "lon": 52.25, "u": 1.38, "v": 1.74, "speed": 2.22 }
  ]
}
```

---

## 4. Sub-Grid Point Coordinate Inspection

### `GET /api/telemetry/subgrid`
Computes high-precision, bilinear-interpolated oceanographic telemetry at exact coordinates.

#### Query Parameters:
| Parameter | Type | Required | Default | Range | Description |
|---|---|---|---|---|---|
| `lat` | `float` | Yes | — | `-44.875` to `32.0` | Target Latitude |
| `lon` | `float` | Yes | — | `20.125` to `124.875` | Target Longitude |
| `depth` | `float` | No | `0.0` | `0.0` to `5000.0` | Depth in meters |
| `month` | `integer` | No | `299` | `0` to `299` | Month index |

#### Response:
```json
{
  "latitude": 5.8,
  "longitude": 80.5,
  "depth_m": 35.0,
  "month_index": 7,
  "timestamp": "2000-08-15T00:00:00Z",
  "basin": "Sri Lanka Cetacean Biological Dome",
  "temperature_c": 27.84,
  "salinity_psu": 34.62,
  "chlorophyll_mg_m3": 1.85,
  "current_u_ms": 0.42,
  "current_v_ms": 0.65,
  "current_speed_ms": 0.77,
  "marine_biomass": "High Phytoplankton Productivity (Baitball Aggregation)"
}
```

---

## 5. Regional 3D Deep Dive Terrain Matrix

### `GET /api/deepdive/terrain`
Extracts an ETOPO1 bathymetry and topography heightmap matrix for the selected bounding box.

#### Query Parameters:
| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `min_lat` | `float` | Yes | — | Southern boundary latitude |
| `max_lat` | `float` | Yes | — | Northern boundary latitude |
| `min_lon` | `float` | Yes | — | Western boundary longitude |
| `max_lon` | `float` | Yes | — | Eastern boundary longitude |
| `grid_res` | `integer` | No | `64` | Resolution grid ($N \times N$) |

#### Response:
```json
{
  "bbox": [15.0, 20.5, 70.0, 74.5],
  "grid_res": 64,
  "elevations_m": [
    [-1850.0, -1720.0, -1200.0, -45.0, 12.0],
    [-2100.0, -1950.0, -1450.0, -50.0, 45.0]
  ],
  "water_mask": [
    [1.0, 1.0, 1.0, 1.0, 0.0],
    [1.0, 1.0, 1.0, 1.0, 0.0]
  ]
}
```

---

## 6. Coastal Tsunami Tide Gauge Network

### `GET /api/tsunami/stations`
Retrieves the catalogue of operational tide gauge stations across India and the Indian Ocean rim.

#### Response:
```json
[
  {
    "id": "chennai",
    "name": "Chennai Port Gauge",
    "country": "India",
    "latitude": 13.08,
    "longitude": 80.29,
    "scenarios": {
      "2004_sumatra": { "arrival_hours": 2.45, "max_amplitude_m": 4.8 },
      "1945_makran": { "arrival_hours": 6.80, "max_amplitude_m": 0.4 }
    }
  },
  {
    "id": "port_blair",
    "name": "Port Blair Sea Level Station",
    "country": "India",
    "latitude": 11.67,
    "longitude": 92.74,
    "scenarios": {
      "2004_sumatra": { "arrival_hours": 0.55, "max_amplitude_m": 7.2 },
      "1945_makran": { "arrival_hours": 7.50, "max_amplitude_m": 0.2 }
    }
  }
]
```

---

## 7. In-Situ Oceanographic Observation Fleet

### `GET /api/instruments`
Returns the active catalogue of in-situ autonomous observational platforms.

#### Response:
```json
[
  {
    "id": "argo_2902198",
    "type": "BGC-Argo",
    "name": "BGC Float 2902198",
    "latitude": 5.8,
    "longitude": 80.5,
    "status": "Active",
    "last_profile": "2024-11-20T12:00:00Z",
    "max_depth_m": 2000,
    "sensors": ["CTD", "Fluorescence", "Backscatter", "Oxygen"]
  },
  {
    "id": "glider_incois_04",
    "type": "Glider",
    "name": "INCOIS Autonomous Glider SG-04",
    "latitude": 16.5,
    "longitude": 84.2,
    "status": "On Mission",
    "heading_deg": 142.0,
    "depth_m": 450
  }
]
```
