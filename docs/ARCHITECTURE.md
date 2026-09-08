# System Architecture & Shader Pipeline

**OceanScope India** combines client-side WebGL 2.0 rendering via **Three.js** and **React Three Fiber (R3F)** with a high-throughput **FastAPI** analytical streaming engine. This document details the technical implementation of the graphics pipeline, custom GLSL shaders, camera director systems, and backend memory mapping.

---

## 1. High-Level Component Topology

```
+-------------------------------------------------------------------------------------------------+
|                                         React 19 Application                                    |
|                                                                                                 |
|   +-----------------------+   +-----------------------+   +---------------------------------+   |
|   |        App.tsx        |---|    TopBar / Dock      |---|     SelectedRegionCard (HUD)    |   |
|   +-----------------------+   +-----------------------+   +---------------------------------+   |
|               |                                                           |                     |
|               v                                                           v                     |
|   +-----------------------+                               +---------------------------------+   |
|   |    GlobeScene.tsx     |                               |       DeepDiveBlock.tsx         |   |
|   |   (4D Global Twin)    |                               |       (Regional 3D Twin)        |   |
|   +-----------------------+                               +---------------------------------+   |
|               |                                                           |                     |
|     +--------------------+                                      +--------------------+          |
|     |  OceanShader.frag  |                                      |   Terrain Mesh     |          |
|     |  Bathymetry Relief |                                      |   Caustics Shader  |          |
|     |  Current Streamline|                                      |   Baitball Boids   |          |
|     +--------------------+                                      +--------------------+          |
+-------------------------------------------------------------------------------------------------+
                                                |
                                      HTTP / Typed Arrays
                                                |
                                                v
+-------------------------------------------------------------------------------------------------+
|                                     FastAPI Backend Engine                                      |
|                                                                                                 |
|         +-----------------------------------------------------------------------------+         |
|         |                            /api/slice (Binary Endpoint)                     |         |
|         +-----------------------------------------------------------------------------+         |
|                                                |                                                |
|                                  NumPy Memory Mapping (np.memmap)                               |
|                                                |                                                |
|                                                v                                                |
|         +-----------------------------------------------------------------------------+         |
|         |                     25-Year Multimodal Binary Data Cubes                    |         |
|         |                  [300 Months x 16 Depths x 309 Lats x 421 Lons]             |         |
|         +-----------------------------------------------------------------------------+         |
+-------------------------------------------------------------------------------------------------+
```

---

## 2. WebGL Custom Shader Architecture (`OceanShader`)

The planet surface in `GlobeScene.tsx` is rendered via a custom Three.js `ShaderMaterial` executed on a high-subdivision sphere geometry (`SphereGeometry args={[2.0, 128, 128]}`).

### A. Sub-Pixel Coastline Antialiasing
Coastlines are rendered without raster aliasing or land color bleed by sampling a dedicated 4K single-channel water mask texture (`uWaterMask`) and evaluating screen-space derivatives:

```glsl
float rawMask = texture2D(uWaterMask, vUv).r;
float fw = max(0.0008, fwidth(rawMask) * 1.2);
float water = smoothstep(0.33 - fw, 0.33 + fw, rawMask);
```

* `water = 0.0`: Pure land surface (samples 4K satellite earth with adaptive sharpening).
* `water = 1.0`: Pure oceanic water column (receives data layers, bathymetry, and currents).
* `0.0 < water < 1.0`: Subpixel antialiased transition zone along complex coastlines, island chains, and fjords.

---

### B. NASA MODIS Logarithmic Ocean Color Pipeline (`paletteAlga`)
Chlorophyll-a is distributed log-normally across ocean basins: ultra-oligotrophic tropical gyres drop to $0.025\text{ mg/m}^3$, while hyper-productive coastal upwellings and river estuaries exceed $2.5\text{ mg/m}^3$.

Linear normalization masks 90% of dynamic variations into the lower dark sapphire band. OceanScope India employs a logarithmic transfer function based on NASA MODIS and SeaWiFS algorithms:

$$\text{normC} = \text{clamp}\left(\frac{\ln(\max(\text{val}, 0.025)) - \ln(0.025)}{\ln(2.5) - \ln(0.025)}, 0.0, 1.0\right) = \text{clamp}\left(\frac{\ln(\max(\text{val}, 0.025)) + 3.68888}{4.60517}, 0.0, 1.0\right)$$

```glsl
vec3 paletteAlga(float t) {
  vec3 c0 = vec3(0.018, 0.10, 0.28); // Oligotrophic tropical gyres (deep sapphire blue)
  vec3 c1 = vec3(0.020, 0.32, 0.42); // Low-moderate productivity (0.05 - 0.10 mg/m3)
  vec3 c2 = vec3(0.050, 0.58, 0.36); // Marine emerald shelf (0.15 mg/m3)
  vec3 c3 = vec3(0.180, 0.82, 0.32); // Vibrant phytoplankton green (0.35 mg/m3)
  vec3 c4 = vec3(0.620, 0.94, 0.20); // Luminous chartreuse bloom (0.75 mg/m3)
  vec3 c5 = vec3(0.980, 0.94, 0.16); // Radiant golden biological peak (1.5 mg/m3)
  vec3 c6 = vec3(1.000, 0.58, 0.10); // Hyper-productive upwelling core (> 2.5 mg/m3)

  if (t < 0.15) return mix(c0, c1, t / 0.15);
  if (t < 0.32) return mix(c1, c2, (t - 0.15) / 0.17);
  if (t < 0.50) return mix(c2, c3, (t - 0.32) / 0.18);
  if (t < 0.70) return mix(c3, c4, (t - 0.50) / 0.20);
  if (t < 0.86) return mix(c4, c5, (t - 0.70) / 0.16);
  return mix(c5, c6, (t - 0.86) / 0.14);
}
```

---

### C. Hermite Boundary Feathering
To eliminate rectangular edge artifacts between the regional $0.25^\circ$ Indian Ocean data cube ($20.125^\circ\text{E} \rightarrow 124.875^\circ\text{E}$, $-44.875^\circ\text{S} \rightarrow 32.0^\circ\text{N}$) and the global baseline model, a 4-edge Hermite transition is computed dynamically:

```glsl
float edgeFade = smoothstep(20.125, 23.5, lon) *
                 (1.0 - smoothstep(121.5, 124.875, lon)) *
                 smoothstep(-44.875, -41.5, lat) *
                 (1.0 - smoothstep(28.5, 32.0, lat));

globalBaseColor = mix(globalBaseColor, sliceColor, edgeFade);
```

---

## 3. High-Performance Binary Slice Streaming

Rather than transferring multi-megabyte JSON arrays across HTTP, `/api/slice` returns raw IEEE 754 32-bit floating-point buffers directly from disk:

1. **Backend**: FastAPI queries the requested slice using `np.memmap`. Zero memory copy is required; the OS kernel pages the requested block into cache on demand.
2. **Transfer**: Serialized as `application/octet-stream` with a total payload size of:
   $$\text{Bytes} = 309 \times 421 \times 4\text{ bytes} = 520,356\text{ bytes } (\approx 508\text{ KB})$$
3. **Frontend**: The browser reads the response into a native `ArrayBuffer`:
   ```ts
   const buf = await resp.arrayBuffer()
   const floatArr = new Float32Array(buf)
   const arr = sliceTexture.image.data as Float32Array
   arr.set(floatArr)
   sliceTexture.needsUpdate = true
   ```
4. **GPU Upload**: The `DataTexture` (`THREE.RedFormat`, `THREE.FloatType`) uploads directly to GPU VRAM in less than 2 milliseconds.

---

## 4. Camera Director & Orbit Mechanics

* **Orbital Controls**: Managed via `@react-three/drei`'s `OrbitControls`, bounded with `minDistance={1.606}` (permitting surface zoom) and `maxDistance={5.2}`.
* **Camera Director**: Smooth spherical camera interpolation (`slerp` on quaternions and `lerp` on Cartesian positions) triggered by `teleportNonce` updates:
  ```ts
  const localVec = latLngToVector3(targetPoint.latitude, targetPoint.longitude, RADIUS)
  const worldVec = localVec.clone().applyMatrix4(globeGroupRef.current.matrixWorld)
  const dist = mode === 'tsunami' ? 2.8 : (activeBoundary ? 2.25 : 4.4)
  targetCamPos.current = worldVec.clone().normalize().multiplyScalar(dist)
  ```
* **Auto-Rotation**: Smooth background rotation at `0.18` rad/s, automatically paused during user interaction, area drawing, or active region inspection.
