import { Html, Line, OrbitControls, Stars } from '@react-three/drei'
import { Canvas, useFrame, useLoader, useThree, type ThreeEvent } from '@react-three/fiber'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import {
  GLOBE_RADIUS,
  getOceanVelocity,
  isDryLand,
  isPointInIndianOcean,
  latLngToVector3,
  vector3ToLatLng,
  computeSphericalTangent,
  CURRENT_SYSTEMS,
  TSUNAMI_HISTORIC_DATA,
  OCEAN_HOTSPOTS,
  type OceanHotspot,
  fetchOceanDataSlice,
  onCurrentsGridUpdate,
} from './oceanDataEngine'
import type {
  CoastalStation,
  CurrentSystem,
  Instrument,
  OceanVariable,
  Selection,
  TsunamiScenario,
  ViewMode,
  SpatialBoundary,
} from './types'
import OceanCurrentFlow from './OceanCurrentFlow'
import GlobeAreaSelector from './GlobeAreaSelector'

const RADIUS = GLOBE_RADIUS
const EARTH_DAY_MAP = '/data/earth_day_4096.jpg'
const EARTH_WATER_MASK = '/data/earth_specular_2048.jpg'

/**
 * Creates a merged cylinder shaft + cone arrowhead BufferGeometry for 3D vector arrows.
 */
function createArrowGeometry(): THREE.BufferGeometry {
  const geom = new THREE.BufferGeometry()
  const shaftLength = 0.038
  const shaftRadius = 0.002
  const headLength = 0.02
  const headRadius = 0.0065
  const segs = 6

  const positions: number[] = []
  const normals: number[] = []

  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2
    const a1 = ((i + 1) / segs) * Math.PI * 2
    const c0 = Math.cos(a0), s0 = Math.sin(a0)
    const c1 = Math.cos(a1), s1 = Math.sin(a1)

    // Shaft cylinder quad: (b0, b1, t0) and (b1, t1, t0)
    const b0 = [c0 * shaftRadius, 0, s0 * shaftRadius]
    const b1 = [c1 * shaftRadius, 0, s1 * shaftRadius]
    const t0 = [c0 * shaftRadius, shaftLength, s0 * shaftRadius]
    const t1 = [c1 * shaftRadius, shaftLength, s1 * shaftRadius]

    positions.push(...b0, ...b1, ...t0)
    positions.push(...b1, ...t1, ...t0)
    normals.push(c0, 0, s0, c1, 0, s1, c0, 0, s0)
    normals.push(c1, 0, s1, c1, 0, s1, c0, 0, s0)

    // Cone arrowhead segment: base ring to tip
    const tip = [0, shaftLength + headLength, 0]
    const hb0 = [c0 * headRadius, shaftLength, s0 * headRadius]
    const hb1 = [c1 * headRadius, shaftLength, s1 * headRadius]

    positions.push(...hb0, ...hb1, ...tip)
    normals.push(c0, 0.4, s0, c1, 0.4, s1, 0, 1, 0)

    // Cone base cap
    positions.push(0, shaftLength, 0, ...hb1, ...hb0)
    normals.push(0, -1, 0, 0, -1, 0, 0, -1, 0)
  }

  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  return geom
}

/**
 * 3D Instanced Directional Vector Arrow Field.
 * Renders physical 3D arrows across the ocean surface pointing along spherical velocity tangents.
 */
function CurrentsVectorField({
  active,
  timeIndex,
  density = 4.2,
}: {
  active: boolean
  timeIndex: number
  density?: number
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const arrowGeom = useMemo(() => createArrowGeometry(), [])
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const [gridVersion, setGridVersion] = useState(0)

  useEffect(() => {
    return onCurrentsGridUpdate(() => setGridVersion((v) => v + 1))
  }, [])

  // Sample grid over Indian Ocean: lat -44 to 26, lon 24 to 118
  const gridPoints = useMemo(() => {
    const pts: { lat: number; lon: number }[] = []
    for (let lat = -44; lat <= 26; lat += density) {
      for (let lon = 26; lon <= 118; lon += density) {
        if (!isDryLand(lat, lon)) {
          pts.push({ lat, lon })
        }
      }
    }
    return pts
  }, [density])

  useEffect(() => {
    if (!meshRef.current || !active) return
    const mesh = meshRef.current

    const color = new THREE.Color()
    gridPoints.forEach((pt, i) => {
      const vel = getOceanVelocity(pt.lat, pt.lon, timeIndex)
      const tangent = computeSphericalTangent(pt.lat, pt.lon, vel.u, vel.v, RADIUS + 0.016)

      dummy.position.copy(tangent.position)
      dummy.quaternion.copy(tangent.quaternion)

      // Scale arrow length based on speed
      const speed = Math.max(0.06, vel.speed)
      const scaleLen = THREE.MathUtils.clamp(speed * 1.6, 0.5, 2.3)
      const scaleThick = THREE.MathUtils.clamp(0.7 + speed * 0.45, 0.6, 1.4)
      dummy.scale.set(scaleThick, scaleLen, scaleThick)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)

      // Scientific colormap (cmocean speed style)
      if (speed > 1.2) {
        color.set('#ff3d00') // Fast boundary jets: intense coral/vermilion
      } else if (speed > 0.7) {
        color.set('#ffd600') // Moderate-fast: bright gold
      } else if (speed > 0.35) {
        color.set('#00e676') // Moderate: vibrant emerald
      } else {
        color.set('#00b0ff') // Slow circulation: cyan
      }
      mesh.setColorAt(i, color)
    })

    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }, [active, timeIndex, gridPoints, dummy, gridVersion])

  if (!active) return null

  return (
    <instancedMesh
      ref={meshRef}
      args={[arrowGeom, undefined, gridPoints.length]}
    >
      <meshStandardMaterial
        roughness={0.35}
        metalness={0.15}
        transparent
        opacity={0.94}
      />
    </instancedMesh>
  )
}

/**
 * Dynamic Multi-Scenario Tsunami Propagation Layer.
 * Renders the extended fault rupture arc (1,300 km Sunda Trench),
 * authentic irregular bathymetric isochrone contours,
 * epicenter seismic beacons, and coastal tide gauge impacts.
 */
interface BathymetricContour {
  hour: number
  id: string
  coordinates: [number, number][]
}

let isochroneDataCache: Record<string, BathymetricContour[]> | null = null

function TsunamiPropagationLayer({
  active,
  scenario = TSUNAMI_HISTORIC_DATA,
  tsunamiHour = 2.0,
  showIsochrones = true,
  onSelectStation,
}: {
  active: boolean
  scenario?: TsunamiScenario
  tsunamiHour?: number
  showIsochrones?: boolean
  onSelectStation?: (station: CoastalStation) => void
}) {
  const epic = scenario.epicenter
  const epicPos = useMemo(
    () => latLngToVector3(epic.latitude, epic.longitude, RADIUS + 0.015),
    [epic.latitude, epic.longitude]
  )

  // Epicenter pulsing beacon animation
  const pulseRing1 = useRef<THREE.Mesh>(null)
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime() * 2.0
    if (pulseRing1.current) {
      const p = t % 1
      pulseRing1.current.scale.setScalar(0.6 + p * 1.4)
      ;(pulseRing1.current.material as THREE.MeshBasicMaterial).opacity = Math.max(0, (1 - p) * 0.75)
    }
  })

  // 1. Extended Fault Rupture Arc / Zone (1,300 km Subduction Trench)
  const rupturePoints = useMemo(() => {
    return scenario.rupture_arc.map((pt) =>
      latLngToVector3(pt.lat, pt.lon, RADIUS + 0.02)
    )
  }, [scenario.rupture_arc])

  // Subduction zone fault segment markers along the plate boundary
  const ruptureMarkers = useMemo(() => {
    return scenario.rupture_arc.map((pt) => ({
      name: pt.name,
      pos: latLngToVector3(pt.lat, pt.lon, RADIUS + 0.022),
    }))
  }, [scenario.rupture_arc])

  // 2. Authentic Irregular Travel-Time Contours (Isochrones) Derived from Bathymetry
  const [contours, setContours] = useState<Record<string, BathymetricContour[]>>(
    isochroneDataCache || {}
  )

  useEffect(() => {
    if (isochroneDataCache) return
    fetch('/data/tsunami_bathymetric_isochrones.json')
      .then((res) => res.json())
      .then((data) => {
        isochroneDataCache = data
        setContours(data)
      })
      .catch((err) => console.warn('Could not load bathymetric isochrones:', err))
  }, [])

  const scenarioContours = useMemo(() => {
    const list: BathymetricContour[] = contours[scenario.id] || []
    return list.map((seg: BathymetricContour) => ({
      id: seg.id,
      hour: seg.hour,
      points: seg.coordinates.map(([lat, lon]: [number, number]) =>
        latLngToVector3(lat, lon, RADIUS + 0.016)
      ),
    }))
  }, [contours, scenario.id])

  // 3. Satellite Altimeter Track (e.g. Jason-1 for Sumatra 2004)
  const satTrackPoints = useMemo(() => {
    if (!scenario.satellite_pass) return null
    const pts: THREE.Vector3[] = []
    const sp = scenario.satellite_pass
    for (let lat = sp.lat_start; lat <= sp.lat_end; lat += 0.5) {
      pts.push(latLngToVector3(lat, sp.lon, RADIUS + 0.024))
    }
    return pts
  }, [scenario.satellite_pass])

  if (!active) return null

  return (
    <group>
      {/* 1. Epicenter Seismic Pinpoint Beacon */}
      <group position={epicPos}>
        <mesh>
          <sphereGeometry args={[0.022, 20, 20]} />
          <meshBasicMaterial color="#00e5ff" />
        </mesh>
        <mesh ref={pulseRing1}>
          <ringGeometry args={[0.014, 0.028, 32]} />
          <meshBasicMaterial color="#00e5ff" transparent opacity={0.7} side={THREE.DoubleSide} />
        </mesh>
      </group>

      {/* Upright Beacon Needle */}
      <Line
        points={[epicPos, epicPos.clone().multiplyScalar(1.05)]}
        color="#00e5ff"
        lineWidth={2.2}
      />

      {/* 2. Extended Fault Rupture Arc (1,300 km Subduction Trench) */}
      {rupturePoints.length >= 2 && (
        <Line
          points={rupturePoints}
          color="#00f5ff"
          lineWidth={3.2}
          transparent
          opacity={0.92}
        />
      )}

      {/* Subduction Zone Rupture Node Markers */}
      {ruptureMarkers.map((rm, idx) => (
        <mesh key={idx} position={rm.pos}>
          <sphereGeometry args={[0.01, 12, 12]} />
          <meshBasicMaterial color="#00f5ff" />
        </mesh>
      ))}

      {/* 3. Authentic Irregular Bathymetric Isochrone Contours (Optional Scientific Layer) */}
      {showIsochrones &&
        scenarioContours.map((iso) => (
          <Line
            key={iso.id}
            points={iso.points}
            color="#00e5ff"
            lineWidth={1.0}
            transparent
            opacity={0.28}
          />
        ))}

      {/* 4. Scenario-Specific Coastal Tide Gauge Stations */}
      {scenario.coastal_stations.map((st) => {
        const isImpacted = tsunamiHour >= st.arrival_hours
        const pos = latLngToVector3(st.lat, st.lon, RADIUS + 0.018)
        const color = isImpacted ? '#ff1744' : '#00e5ff'

        return (
          <group
            key={st.id}
            position={pos}
            onClick={(e) => {
              e.stopPropagation()
              onSelectStation?.(st)
            }}
          >
            <mesh>
              <sphereGeometry args={[isImpacted ? 0.022 : 0.015, 16, 16]} />
              <meshBasicMaterial color={color} />
            </mesh>
            {isImpacted && (
              <mesh scale={2.2}>
                <sphereGeometry args={[0.022, 16, 16]} />
                <meshBasicMaterial color="#ff1744" transparent opacity={0.28} />
              </mesh>
            )}
          </group>
        )
      })}

      {/* 5. Satellite Altimeter Pass (if present) */}
      {satTrackPoints && satTrackPoints.length >= 2 && scenario.satellite_pass && (
        <>
          <Line
            points={satTrackPoints}
            color="#cddc39"
            lineWidth={1.2}
            dashed
            dashScale={28}
            dashSize={0.04}
            gapSize={0.02}
            transparent
            opacity={0.65}
          />
          <group position={latLngToVector3(4.5, scenario.satellite_pass.lon, RADIUS + 0.028)}>
            <mesh>
              <octahedronGeometry args={[0.018, 0]} />
              <meshBasicMaterial color="#cddc39" />
            </mesh>
          </group>
        </>
      )}
    </group>
  )
}

/**
 * Oceanographic Multi-Theme Shader.
 * Integrates cmocean thermal, haline, alga, and speed.
 */
function OceanShader({
  variable,
  depth,
  timeIndex,
  overlayStrength,
  tsunamiActive = false,
  tsunamiScenario = TSUNAMI_HISTORIC_DATA,
  tsunamiHour = 2.0,
}: {
  variable: OceanVariable
  depth: number
  timeIndex: number
  overlayStrength: number
  tsunamiActive?: boolean
  tsunamiScenario?: TsunamiScenario
  tsunamiHour?: number
}) {
  const [earthMap, waterMask, texSumatra, texMakran, texWharton] = useLoader(
    THREE.TextureLoader,
    [
      EARTH_DAY_MAP,
      EARTH_WATER_MASK,
      '/data/tsunami_travel_time_2004_sumatra.png',
      '/data/tsunami_travel_time_1945_makran.png',
      '/data/tsunami_travel_time_2012_wharton.png',
    ]
  )
  // High-Resolution Anisotropic Texture Filtering for crisp zoom
  useEffect(() => {
    earthMap.colorSpace = THREE.SRGBColorSpace
    earthMap.anisotropy = 16
    earthMap.generateMipmaps = true
    earthMap.minFilter = THREE.LinearMipmapLinearFilter
    earthMap.magFilter = THREE.LinearFilter
    earthMap.needsUpdate = true

    waterMask.anisotropy = 16
    waterMask.generateMipmaps = true
    waterMask.minFilter = THREE.LinearMipmapLinearFilter
    waterMask.magFilter = THREE.LinearFilter
    waterMask.needsUpdate = true
  }, [earthMap, waterMask])

  // Dynamic 2D WebGL DataTexture (421 lon x 309 lat) for the active dataset slice
  const sliceTexture = useMemo(() => {
    const initData = new Float32Array(421 * 309)
    const tex = new THREE.DataTexture(initData, 421, 309, THREE.RedFormat, THREE.FloatType)
    tex.minFilter = THREE.LinearFilter
    tex.magFilter = THREE.LinearFilter
    tex.wrapS = THREE.ClampToEdgeWrapping
    tex.wrapT = THREE.ClampToEdgeWrapping
    tex.generateMipmaps = false
    tex.needsUpdate = true
    return tex
  }, [])

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        uniforms: {
          uTime: { value: 0 },
          uMonthPhase: { value: (timeIndex / 12) * Math.PI * 2 },
          uDepth: { value: depth },
          uVariable: {
            value: ['temperature', 'salinity', 'chlorophyll', 'currents'].indexOf(variable),
          },
          uOverlayStrength: { value: overlayStrength },
          uEarthMap: { value: earthMap },
          uWaterMask: { value: waterMask },
          uTsunamiActive: { value: tsunamiActive ? 1.0 : 0.0 },
          uTsunamiHour: { value: tsunamiHour },
          uTsunamiPropMap: { value: texSumatra },
          uOceanDataSlice: { value: sliceTexture },
          uHasDataSlice: { value: 0.0 },
        },
        vertexShader: `
          varying vec2 vUv;
          varying vec3 vNormal;
          varying vec3 vPosition;
          void main() {
            vUv = uv;
            vNormal = normalize(normalMatrix * normal);
            vPosition = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform float uTime;
          uniform float uMonthPhase;
          uniform float uDepth;
          uniform float uVariable;
          uniform float uOverlayStrength;
          uniform sampler2D uEarthMap;
          uniform sampler2D uWaterMask;
          uniform float uTsunamiActive;
          uniform float uTsunamiHour;
          uniform sampler2D uTsunamiPropMap;
          uniform sampler2D uOceanDataSlice;
          uniform float uHasDataSlice;
          varying vec2 vUv;
          varying vec3 vNormal;
          varying vec3 vPosition;

          // Gaussian patch helper in spherical coordinates
          float patchDist(float lat, float lon, float cLat, float cLon, float rLat, float rLon) {
            float dLat = (lat - cLat) / rLat;
            float dLon = (lon - cLon) / rLon;
            return dLat * dLat + dLon * dLon;
          }

          // 1. Temperature: cmocean thermal
          vec3 paletteThermal(float t) {
            vec3 c0 = vec3(0.015, 0.137, 0.227);
            vec3 c1 = vec3(0.05, 0.28, 0.63);
            vec3 c2 = vec3(0.0, 0.6, 0.8);
            vec3 c3 = vec3(0.15, 0.72, 0.48);
            vec3 c4 = vec3(0.96, 0.64, 0.38);
            vec3 c5 = vec3(0.91, 0.43, 0.32);
            vec3 c6 = vec3(0.85, 0.16, 0.16);
            vec3 c7 = vec3(1.0, 0.82, 0.4);
            if (t < 0.15) return mix(c0, c1, t / 0.15);
            if (t < 0.30) return mix(c1, c2, (t - 0.15) / 0.15);
            if (t < 0.45) return mix(c2, c3, (t - 0.30) / 0.15);
            if (t < 0.60) return mix(c3, c4, (t - 0.45) / 0.15);
            if (t < 0.75) return mix(c4, c5, (t - 0.60) / 0.15);
            if (t < 0.90) return mix(c5, c6, (t - 0.75) / 0.15);
            return mix(c6, c7, (t - 0.90) / 0.10);
          }

          // 2. Salinity: cmocean haline
          vec3 paletteHaline(float t) {
            vec3 c0 = vec3(0.13, 0.0, 0.29);
            vec3 c1 = vec3(0.24, 0.12, 0.6);
            vec3 c2 = vec3(0.12, 0.35, 0.82);
            vec3 c3 = vec3(0.0, 0.68, 0.76);
            vec3 c4 = vec3(0.38, 0.85, 0.58);
            vec3 c5 = vec3(0.88, 0.88, 0.22);
            vec3 c6 = vec3(1.0, 0.72, 0.12);
            if (t < 0.16) return mix(c0, c1, t / 0.16);
            if (t < 0.32) return mix(c1, c2, (t - 0.16) / 0.16);
            if (t < 0.48) return mix(c2, c3, (t - 0.32) / 0.16);
            if (t < 0.65) return mix(c3, c4, (t - 0.48) / 0.17);
            if (t < 0.82) return mix(c4, c5, (t - 0.65) / 0.17);
            return mix(c5, c6, (t - 0.82) / 0.18);
          }

          // 3. Chlorophyll: NASA MODIS Ocean Color / cmocean alga (Ultra-Vivid Global Color Grading)
          vec3 paletteAlga(float t) {
            vec3 c0 = vec3(0.018, 0.10, 0.28); // Oligotrophic tropical gyres (deep sapphire blue)
            vec3 c1 = vec3(0.02, 0.32, 0.42);  // Low-moderate productivity cyan-teal (0.05 - 0.1 mg/m3)
            vec3 c2 = vec3(0.05, 0.58, 0.36);  // Marine emerald shelf (0.15 mg/m3)
            vec3 c3 = vec3(0.18, 0.82, 0.32);  // Rich vibrant phytoplankton green (0.35 mg/m3)
            vec3 c4 = vec3(0.62, 0.94, 0.20);  // Luminous chartreuse bloom (0.75 mg/m3)
            vec3 c5 = vec3(0.98, 0.94, 0.16);  // Radiant golden biological peak (1.5 mg/m3)
            vec3 c6 = vec3(1.0, 0.58, 0.10);   // Hyper-productive upwelling core (> 2.5 mg/m3)
            if (t < 0.15) return mix(c0, c1, t / 0.15);
            if (t < 0.32) return mix(c1, c2, (t - 0.15) / 0.17);
            if (t < 0.50) return mix(c2, c3, (t - 0.32) / 0.18);
            if (t < 0.70) return mix(c3, c4, (t - 0.50) / 0.20);
            if (t < 0.86) return mix(c4, c5, (t - 0.70) / 0.16);
            return mix(c5, c6, (t - 0.86) / 0.14);
          }

          // 4. Currents: cmocean speed
          vec3 paletteSpeed(float t) {
            vec3 c0 = vec3(0.03, 0.08, 0.18);
            vec3 c1 = vec3(0.08, 0.22, 0.45);
            vec3 c2 = vec3(0.1, 0.44, 0.68);
            vec3 c3 = vec3(0.16, 0.72, 0.74);
            vec3 c4 = vec3(0.38, 0.88, 0.58);
            vec3 c5 = vec3(0.76, 0.96, 0.36);
            vec3 c6 = vec3(1.0, 0.95, 0.3);
            if (t < 0.16) return mix(c0, c1, t / 0.16);
            if (t < 0.32) return mix(c1, c2, (t - 0.16) / 0.16);
            if (t < 0.48) return mix(c2, c3, (t - 0.32) / 0.16);
            if (t < 0.66) return mix(c3, c4, (t - 0.48) / 0.18);
            if (t < 0.84) return mix(c4, c5, (t - 0.66) / 0.18);
            return mix(c5, c6, (t - 0.84) / 0.16);
          }

          void main() {
            // High-resolution 4K satellite earth unsharp masking & adaptive sharpening
            vec3 earthRaw = texture2D(uEarthMap, vUv).rgb;
            vec2 texel = vec2(1.0 / 4096.0, 1.0 / 2048.0);
            vec3 blurSample = (
              texture2D(uEarthMap, vUv + vec2(texel.x, 0.0)).rgb +
              texture2D(uEarthMap, vUv - vec2(texel.x, 0.0)).rgb +
              texture2D(uEarthMap, vUv + vec2(0.0, texel.y)).rgb +
              texture2D(uEarthMap, vUv - vec2(0.0, texel.y)).rgb
            ) * 0.25;
            vec3 earth = clamp(earthRaw + (earthRaw - blurSample) * 1.25, 0.0, 1.0);

            // Sub-pixel screen-space antialiased shoreline
            float rawMask = texture2D(uWaterMask, vUv).r;
            float fw = max(0.0008, fwidth(rawMask) * 1.2);
            float water = smoothstep(0.33 - fw, 0.33 + fw, rawMask);

            // ==========================================================
            // PHYSICAL BATHYMETRY-DRIVEN TSUNAMI PROPAGATION (INDIAN OCEAN)
            // Driven by actual ETOPO depth wave speeds c = sqrt(g * H)
            // and 1,300 km extended fault rupture directivity
            // ==========================================================
            if (uTsunamiActive > 0.5) {
              vec3 p = normalize(vPosition);

              // Geographical coordinates of surface fragment
              float latDeg = asin(clamp(p.y, -1.0, 1.0)) * 57.29578;
              float lonDeg = atan(p.z, -p.x) * 57.29578 - 180.0;
              if (lonDeg < -180.0) lonDeg += 360.0;

              // Main sun lighting vector
              vec3 sunDir = normalize(vec3(0.35, 0.82, -1.0));
              float sunLight = max(dot(vNormal, sunDir), 0.0);

              // Bright, warm natural land - never dull or shaded
              vec3 litLand = earth * (1.18 + sunLight * 0.42);

              // Rich, realistic natural ocean base - dark underneath
              vec3 oceanTint = vec3(0.012, 0.09, 0.25);
              vec3 litOcean = mix(earth * 1.15, oceanTint, 0.32) * (1.02 + sunLight * 0.36);

              // Indian Ocean bathymetry grid bounds
              bool inBasin = (latDeg >= -44.99 && latDeg <= 32.00 && lonDeg >= 20.00 && lonDeg <= 125.00);

              if (inBasin && water > 0.12) {
                float u = clamp((lonDeg - 20.008333) / (125.008333 - 20.008333), 0.0, 1.0);
                float v = clamp((latDeg - (-44.991667)) / (32.008333 - (-44.991667)), 0.0, 1.0);

                vec4 propData = texture2D(uTsunamiPropMap, vec2(u, v));
                float tArr = propData.r * 16.0; // Arrival time in hours
                float dirSpread = propData.g;  // Directivity * spreading factor
                float depthNorm = propData.b;  // Normalized ocean depth
                float isOceanWater = propData.a;

                if (isOceanWater > 0.4 && tArr > 0.02 && tArr < 15.5) {
                  float dt = uTsunamiHour - tArr;

                  // Wave packet passes locally from dt = -0.04h to dt = 1.8h
                  if (dt >= -0.04 && dt <= 1.8) {
                    // 1. Steep physical leading wavefront surge (continuous fluid crest)
                    float leadSurge = exp(-pow(max(0.0, dt) / 0.08, 2.0));

                    // 2. Subtle micro-scale sea-surface variation (restrained, never substituting for physics)
                    float subtleVar = sin(p.x * 20.0 + p.y * 18.0 + uTime * 1.6) * 0.2;

                    // 3. Continuous flowing wave train behind the leading front (multiple fluid wave bands)
                    float primaryBands = sin(dt * 20.0 - uTime * 2.2 + subtleVar) * 0.5 + 0.5;
                    float secondaryHarmonic = sin(dt * 40.0 - uTime * 3.6) * 0.22;
                    float waveTrain = clamp(primaryBands + secondaryHarmonic, 0.0, 1.0);
                    float packetDecay = exp(-max(0.0, dt) / 0.62);

                    // 4. Energy attenuation and lifecycle dissipation across the basin
                    float lifeDecay = clamp(1.0 - (uTsunamiHour - 0.4) / 10.8, 0.0, 1.0);
                    float energy = dirSpread * lifeDecay;

                    // Physical wave surface elevation
                    float waveElevation = (leadSurge * 1.15 + waveTrain * packetDecay * 0.72) * energy;
                    waveElevation = clamp(waveElevation, 0.0, 1.0);

                    // Restrained scientific oceanographic palette:
                    vec3 troughColor = vec3(0.012, 0.065, 0.22);
                    vec3 swellColor = vec3(0.00, 0.44, 0.88);
                    vec3 crestColor = vec3(0.05, 0.86, 0.98);
                    vec3 highlightColor = vec3(0.92, 0.98, 1.0);

                    vec3 waveColor;
                    if (waveElevation < 0.38) {
                      waveColor = mix(troughColor, swellColor, waveElevation / 0.38);
                    } else if (waveElevation < 0.76) {
                      waveColor = mix(swellColor, crestColor, (waveElevation - 0.38) / 0.38);
                    } else {
                      waveColor = mix(crestColor, highlightColor, (waveElevation - 0.76) / 0.24);
                    }

                    // Specular sunlight reflection along wave crests
                    vec3 viewDir = normalize(vec3(0.0, 0.0, -1.0));
                    vec3 halfVec = normalize(sunDir + viewDir);
                    float spec = pow(max(dot(vNormal, halfVec), 0.0), 30.0) * waveElevation * energy * 0.42;

                    vec3 litWaveSurface = waveColor * (1.02 + sunLight * 0.38) + vec3(spec);

                    // Smoothly blend onto the dark natural ocean underneath
                    float blendAlpha = smoothstep(0.02, 0.45, waveElevation) * energy;
                    litOcean = mix(litOcean, litWaveSurface, blendAlpha * 0.94);
                  }
                }
              }

              gl_FragColor = vec4(mix(litLand, litOcean, water), 1.0);
              return;
            }

            float lat = (vUv.y - 0.5) * 180.0;
            float lon = (vUv.x - 0.5) * 360.0;
            float latFromEq = abs(vUv.y - 0.5) * 2.0;
            float tropicality = pow(max(0.0, cos(latFromEq * 1.5708)), 1.3);
            float thermocline = 1.0 - exp(-uDepth / (200.0 + tropicality * 140.0));

            // --- 1. GLOBAL BASELINE FIELD (Outside Indian Ocean Basin) ---
            vec3 globalBaseColor = vec3(0.0);
            if (uVariable < 0.5) {
              float wave = sin(vPosition.x * 4.0 + uTime * 0.4) * 0.03;
              float normVal = clamp(0.1 + tropicality * 0.88 - thermocline * 0.76 + wave, 0.0, 1.0);
              globalBaseColor = paletteThermal(normVal);
            }
            else if (uVariable < 1.5) {
              float baseSal = 0.52;
              float atlHigh = exp(-patchDist(lat, lon, 25.0, -45.0, 16.0, 25.0)) * 0.22;
              float medHigh = exp(-patchDist(lat, lon, 35.0, 18.0, 8.0, 20.0)) * 0.32;
              float amazonLow = -exp(-patchDist(lat, lon, 4.0, -48.0, 8.0, 12.0)) * 0.38;
              float polarLow = -smoothstep(45.0, 70.0, abs(lat)) * 0.26;
              float salNorm = clamp(baseSal + atlHigh + medHigh + amazonLow + polarLow + thermocline * 0.08, 0.0, 1.0);
              globalBaseColor = paletteHaline(salNorm);
            }
            else if (uVariable < 2.5) {
              float coastProx = 1.0 - smoothstep(0.20, 0.48, texture2D(uWaterMask, vUv).r);

              // 1. Somali Upwelling (Indian Ocean) - seasonal monsoon surge
              float somali = exp(-patchDist(lat, lon, 9.5, 51.5, 7.0, 7.0)) * (0.85 + 0.5 * max(0.0, sin(uMonthPhase - 1.1)));
              // 2. Malabar Coast / Sri Lanka Dome (Indian Ocean)
              float malabar = exp(-patchDist(lat, lon, 11.5, 74.5, 6.0, 5.0)) * 0.72;
              // 3. Ganges-Brahmaputra Delta (Bay of Bengal)
              float ganges = exp(-patchDist(lat, lon, 19.5, 88.5, 6.5, 7.5)) * 0.82;
              // 4. Mozambique & Agulhas Bank
              float agulhas = exp(-patchDist(lat, lon, -30.0, 34.0, 8.0, 8.0)) * 0.75;
              // 5. Peru / Humboldt Upwelling (Pacific Ocean - World's Largest Fishery Bloom)
              float humboldt = exp(-patchDist(lat, lon, -14.5, -77.5, 14.0, 7.0)) * 0.95;
              // 6. Benguela Upwelling (South Atlantic Ocean)
              float benguela = exp(-patchDist(lat, lon, -23.0, 13.5, 11.0, 5.5)) * 0.88;
              // 7. California Current Upwelling (North Pacific)
              float california = exp(-patchDist(lat, lon, 38.0, -124.0, 12.0, 6.5)) * 0.78;
              // 8. Canary / Mauritania Upwelling (North Atlantic)
              float canary = exp(-patchDist(lat, lon, 22.0, -18.0, 10.0, 6.0)) * 0.80;
              // 9. Amazon River Oceanic Plume (Atlantic)
              float amazon = exp(-patchDist(lat, lon, 3.5, -49.0, 7.0, 10.0)) * 0.88;
              // 10. Mississippi Delta / Gulf of Mexico
              float mississippi = exp(-patchDist(lat, lon, 28.5, -89.5, 4.5, 6.0)) * 0.75;
              // 11. Pacific Equatorial Upwelling Divergence Belt
              float eqPacific = exp(-pow(lat / 3.8, 2.0)) * smoothstep(-175.0, -140.0, lon) * (1.0 - smoothstep(-85.0, -75.0, lon)) * 0.42;
              // 12. Circum-Antarctic Subpolar Nutrient Belt
              float subantarctic = smoothstep(-40.0, -56.0, lat) * (1.0 - smoothstep(-68.0, -78.0, lat)) * 0.52;
              // 13. North Atlantic & North Pacific Subpolar Spring Blooms
              float northSubpolar = smoothstep(45.0, 62.0, lat) * 0.48 * (0.8 + 0.35 * sin(uMonthPhase));

              // Dynamic undulating biological filaments
              float eddyFilament = sin(vPosition.x * 22.0 + sin(vPosition.y * 16.0 + uTime * 0.4) * 3.2) * 0.5 + 0.5;

              // Continuous baseline everywhere across globe (0.14 baseline ensures visible marine cyan/teal, blooming into rich emeralds & golds)
              float chlVal = clamp(
                0.14 + coastProx * 0.46 +
                somali + malabar + ganges + agulhas +
                humboldt + benguela + california + canary + amazon + mississippi + eqPacific + subantarctic + northSubpolar +
                eddyFilament * 0.08 - thermocline * 0.35,
                0.0,
                1.0
              );
              globalBaseColor = paletteAlga(chlVal);
            }
            else {
              float kineticCore = exp(-pow(latFromEq / 0.28, 2.0)) * 0.32;
              float flowGlow = clamp(0.08 + kineticCore, 0.0, 1.0);
              globalBaseColor = paletteSpeed(flowGlow) * 0.55;
            }

            // Dynamic authentic 0.25-deg ocean data slice over Indian Ocean
            if (uHasDataSlice > 0.5 && lat >= -44.875 && lat <= 32.0 && lon >= 20.125 && lon <= 124.875) {
              float su = (lon - 20.125) / (124.875 - 20.125);
              float sv = (lat - (-44.875)) / (32.0 - (-44.875));
              float val = texture2D(uOceanDataSlice, vec2(su, sv)).r;
              if (val > -990.0) {
                vec3 sliceColor = globalBaseColor;
                if (uVariable < 0.5) {
                  float normT = clamp((val - 2.0) / 30.0, 0.0, 1.0);
                  sliceColor = paletteThermal(normT);
                } else if (uVariable < 1.5) {
                  float normS = clamp((val - 31.0) / 6.0, 0.0, 1.0);
                  sliceColor = paletteHaline(normS);
                } else if (uVariable < 2.5) {
                  // NASA MODIS Ocean Color Logarithmic Transfer Function (0.025 to 2.5 mg/m3)
                  if (val > 0.01) {
                    float normC = clamp((log(max(val, 0.025)) - (-3.68888)) / 4.60517, 0.0, 1.0);
                    sliceColor = paletteAlga(normC);
                  }
                }
                // Seamless hermite feathering at Indian Ocean data boundaries
                float edgeFade = smoothstep(20.125, 23.5, lon) *
                                 (1.0 - smoothstep(121.5, 124.875, lon)) *
                                 smoothstep(-44.875, -41.5, lat) *
                                 (1.0 - smoothstep(28.5, 32.0, lat));
                globalBaseColor = mix(globalBaseColor, sliceColor, edgeFade);
              }
            }

            // Lighting and seamless ocean surface synthesis
            float light = max(dot(vNormal, normalize(vec3(0.8, 0.9, 1.0))), 0.0);
            vec3 dataColor;
            if (uVariable > 1.5 && uVariable < 2.5) {
              // Chlorophyll NASA Ocean Color: vibrant bio-pigment contrast
              dataColor = globalBaseColor * (0.88 + light * 0.30);
            } else {
              dataColor = globalBaseColor * (0.65 + light * 0.60);
            }
            vec3 litOcean = mix(earth, dataColor, uOverlayStrength);

            // Clean land masking with zero color bleed
            gl_FragColor = vec4(mix(earth * (0.50 + light * 0.50), litOcean, water), 1.0);
          }
        `,
      }),
    [variable, earthMap, waterMask, overlayStrength, sliceTexture]
  )

  // Fetch real high-resolution 0.25-deg ocean data slice from binary cubes engine
  useEffect(() => {
    let active = true
    const month = Math.max(0, Math.min(299, Math.round(timeIndex)))
    fetchOceanDataSlice(variable, month, depth)
      .then((data) => {
        if (!active || !data) return
        const arr = sliceTexture.image.data as Float32Array
        arr.set(data)
        sliceTexture.needsUpdate = true
        material.uniforms.uHasDataSlice.value = 1.0
      })
      .catch((err) => {
        console.warn('Globe slice fallback:', err)
      })
    return () => {
      active = false
    }
  }, [variable, timeIndex, depth, sliceTexture, material])

  useFrame(({ clock }) => {
    material.uniforms.uTime.value = clock.getElapsedTime()
    const activePropMap =
      tsunamiScenario.id === '1945_makran'
        ? texMakran
        : tsunamiScenario.id === '2012_wharton'
        ? texWharton
        : texSumatra
    material.uniforms.uTsunamiPropMap.value = activePropMap
  })

  material.uniforms.uDepth.value = depth
  material.uniforms.uMonthPhase.value = (timeIndex / 12) * Math.PI * 2
  material.uniforms.uVariable.value = ['temperature', 'salinity', 'chlorophyll', 'currents'].indexOf(variable)
  material.uniforms.uOverlayStrength.value = overlayStrength
  material.uniforms.uTsunamiActive.value = tsunamiActive ? 1.0 : 0.0
  material.uniforms.uTsunamiHour.value = tsunamiHour

  return (
    <mesh material={material}>
      <sphereGeometry args={[RADIUS, 128, 128]} />
    </mesh>
  )
}

/**
 * Luminous Bioluminescent Surface Shoals & Plankton Swirls
 * dynamically circling active feeding grounds (Somali Upwelling, Malabar Shelf, Bay of Bengal, Sri Lanka).
 */
function GlobeFishShoals({ timeIndex, active }: { timeIndex: number; active: boolean }) {
  const meshRef = useRef<THREE.InstancedMesh>(null)

  // Hotspot feeding centers with geographic coordinates
  const feedingCenters = useMemo(() => [
    { name: 'Somali Upwelling', lat: 9.5, lon: 51.5, radiusDeg: 2.4, baseSpeed: 0.85 },
    { name: 'Malabar Coastal Shelf', lat: 12.5, lon: 74.5, radiusDeg: 2.1, baseSpeed: 0.75 },
    { name: 'Bay of Bengal Ganges Delta', lat: 18.5, lon: 88.5, radiusDeg: 2.6, baseSpeed: 0.80 },
    { name: 'Sri Lanka Biological Dome', lat: 7.5, lon: 82.5, radiusDeg: 1.8, baseSpeed: 0.70 },
    { name: 'Mozambique Channel / Agulhas', lat: -23.5, lon: 37.5, radiusDeg: 2.3, baseSpeed: 0.72 },
  ], [])

  const TOTAL_SHOAL_FISH = 180
  const fishGeom = useMemo(() => {
    // Sleek, streamlined biological sliver hugging the water surface
    const g = new THREE.CylinderGeometry(0.0012, 0.0032, 0.024, 5)
    g.rotateX(Math.PI / 2)
    return g
  }, [])

  const fishOffsets = useMemo(() => {
    return Array.from({ length: TOTAL_SHOAL_FISH }, (_, i) => {
      const centerIdx = i % feedingCenters.length
      return {
        centerIdx,
        radiusOffset: (Math.random() - 0.5) * 1.2,
        phase: Math.random() * Math.PI * 2,
        speedMul: 0.85 + Math.random() * 0.3,
        radialJitter: Math.random() * 0.35,
        elevation: RADIUS + 0.003 + Math.random() * 0.002, // Hugs surface seamlessly
      }
    })
  }, [feedingCenters.length])

  const tempObj = useMemo(() => new THREE.Object3D(), [])

  useEffect(() => {
    if (!meshRef.current) return
    const mesh = meshRef.current
    const cEmerald = new THREE.Color('#10b981')
    const cCyan = new THREE.Color('#38bdf8')
    const cAmber = new THREE.Color('#fbbf24')

    for (let i = 0; i < TOTAL_SHOAL_FISH; i++) {
      const p = i / TOTAL_SHOAL_FISH
      const col = new THREE.Color()
      if (p < 0.45) {
        col.lerpColors(cEmerald, cCyan, p / 0.45)
      } else {
        col.lerpColors(cCyan, cAmber, (p - 0.45) / 0.55)
      }
      mesh.setColorAt(i, col)
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }, [])

  useFrame(({ clock }) => {
    if (!meshRef.current || !active) return
    const t = clock.getElapsedTime()
    const mesh = meshRef.current

    for (let i = 0; i < TOTAL_SHOAL_FISH; i++) {
      const f = fishOffsets[i]
      const center = feedingCenters[f.centerIdx]
      const angle = t * center.baseSpeed * f.speedMul * 0.28 + f.phase
      const r = center.radiusDeg + f.radiusOffset + Math.sin(t * 1.2 + f.phase) * f.radialJitter

      const lat = center.lat + Math.sin(angle) * r
      const lon = center.lon + (Math.cos(angle) * r) / Math.cos(THREE.MathUtils.degToRad(center.lat))

      // 3D Cartesian spherical position
      const pos = latLngToVector3(lat, lon, f.elevation)
      tempObj.position.copy(pos)

      // Forward direction tangent on sphere
      const dLat = Math.cos(angle) * center.baseSpeed
      const dLon = -Math.sin(angle) * center.baseSpeed
      const nextPos = latLngToVector3(lat + dLat * 0.08, lon + dLon * 0.08, f.elevation)
      tempObj.lookAt(nextPos)

      // Subtle pulse scale
      const pulse = 0.9 + 0.2 * Math.sin(t * 2.0 + f.phase)
      tempObj.scale.set(pulse, pulse, pulse * 1.2)
      tempObj.updateMatrix()
      mesh.setMatrixAt(i, tempObj.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
  })

  if (!active) return null

  return (
    <instancedMesh
      ref={meshRef}
      args={[fishGeom, undefined, TOTAL_SHOAL_FISH]}
      frustumCulled={false}
    >
      <meshBasicMaterial
        transparent
        opacity={0.82}
        blending={THREE.AdditiveBlending}
      />
    </instancedMesh>
  )
}

function Atmosphere() {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        uniforms: {
          uAtmosphereColor: { value: new THREE.Color('#38bdf8') },
        },
        vertexShader: `
          varying vec3 vNormal;
          varying vec3 vPositionWorld;
          void main() {
            vNormal = normalize(normalMatrix * normal);
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vPositionWorld = wp.xyz;
            gl_Position = projectionMatrix * viewMatrix * wp;
          }
        `,
        fragmentShader: `
          uniform vec3 uAtmosphereColor;
          varying vec3 vNormal;
          varying vec3 vPositionWorld;
          void main() {
            vec3 viewDir = normalize(cameraPosition - vPositionWorld);
            // Atmospheric limb scattering: only visible on planetary rim at glancing angles
            // When viewed directly or zoomed in, rim approaches 0.0, keeping surface pixels crystal-clear
            float rim = 1.0 - max(0.0, dot(vNormal, viewDir));
            float alpha = pow(rim, 3.6) * 0.48;
            if (alpha < 0.003) discard;
            gl_FragColor = vec4(uAtmosphereColor, alpha);
          }
        `,
      }),
    []
  )

  return (
    <mesh scale={1.032} material={material}>
      <sphereGeometry args={[RADIUS, 96, 96]} />
    </mesh>
  )
}

function Marker({
  instrument,
  onSelect,
}: {
  instrument: Instrument
  onSelect: (instrument: Instrument) => void
}) {
  const [hovered, setHovered] = useState(false)
  const groupRef = useRef<THREE.Group>(null)
  const { camera } = useThree()

  const point = useMemo(
    () => latLngToVector3(instrument.latitude, instrument.longitude, RADIUS + 0.042),
    [instrument.latitude, instrument.longitude]
  )

  // Color scheme per instrument type
  const color =
    instrument.kind === 'Glider'
      ? '#ffcf66'
      : instrument.kind === 'BGC-Argo'
        ? '#c084fc'
        : '#38bdf8'

  // Glider: build a long sinusoidal back-trace path using heading
  // 20° arc ≈ 2200 km, with lateral meander simulating ocean-current drift
  const trailPoints = useMemo(() => {
    if (instrument.kind !== 'Glider' || instrument.heading === undefined) return null

    const backHeadingRad = THREE.MathUtils.degToRad(instrument.heading + 180)
    // Forward direction components (lat/lon axes)
    const dLat = Math.cos(backHeadingRad)
    const dLon = Math.sin(backHeadingRad)
    // Perpendicular (90° left of travel direction) for lateral meander
    const pLat = -dLon
    const pLon = dLat
    const cosLat = Math.max(0.15, Math.cos(THREE.MathUtils.degToRad(instrument.latitude)))

    const steps = 80        // high step count for smooth curve
    const totalDistDeg = 20 // ~2200 km path length
    const meanderAmp = 2.8  // arc amplitude in degrees (wider single bow)
    const meanderFreq = 0.5 // half sine cycle = one smooth circular arc
    const pts: THREE.Vector3[] = []

    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const dist = t * totalDistDeg
      // Sinusoidal lateral offset — grows from 0, peaks mid-track, fades near tail
      const envelope = Math.sin(t * Math.PI) // fade in & out at ends
      const lateral = meanderAmp * envelope * Math.sin(t * meanderFreq * 2 * Math.PI)

      const lat = instrument.latitude + dLat * dist + pLat * lateral
      const lon = instrument.longitude + (dLon * dist + pLon * lateral) / cosLat

      // Stop trail the moment it crosses onto land — gliders can't traverse land
      if (i > 0 && isDryLand(lat, lon)) break

      pts.push(latLngToVector3(lat, lon, RADIUS + 0.028))
    }
    return pts
  }, [instrument])

  // Scale marker dot with camera distance so it stays legible at any zoom
  useFrame(() => {
    if (!groupRef.current) return
    const dist = camera.position.length()
    const s = THREE.MathUtils.clamp(dist * 0.15, 0.32, 1.2) * (hovered ? 1.35 : 1.0)
    groupRef.current.scale.setScalar(s)
  })

  return (
    <group
      onClick={(event) => {
        event.stopPropagation()
        onSelect(instrument)
      }}
      onPointerOver={(event) => {
        event.stopPropagation()
        setHovered(true)
      }}
      onPointerOut={(event) => {
        event.stopPropagation()
        setHovered(false)
      }}
    >
      {/* Glider: wide sinusoidal mission track with multi-layer glow */}
      {trailPoints && (
        <>
          {/* Wide soft outer glow */}
          <Line
            points={trailPoints}
            color="#ffcf66"
            lineWidth={hovered ? 12 : 9}
            transparent
            opacity={hovered ? 0.20 : 0.10}
          />
          {/* Mid glow band */}
          <Line
            points={trailPoints}
            color="#ffde80"
            lineWidth={hovered ? 7 : 5}
            transparent
            opacity={hovered ? 0.38 : 0.22}
          />
          {/* Core bright line */}
          <Line
            points={trailPoints}
            color="#ffe599"
            lineWidth={hovered ? 3.0 : 2.2}
            transparent
            opacity={1.0}
          />
        </>
      )}

      {/* Invisible larger hit target for smooth hover detection */}
      <mesh position={point} visible={false}>
        <sphereGeometry args={[0.07, 8, 8]} />
        <meshBasicMaterial />
      </mesh>

      {/* Dot marker — smaller, 3-layer halo */}
      <group ref={groupRef} position={point}>
        {/* Outer soft halo */}
        <mesh>
          <sphereGeometry args={[hovered ? 0.065 : 0.045, 16, 16]} />
          <meshBasicMaterial color={color} transparent opacity={hovered ? 0.28 : 0.10} />
        </mesh>
        {/* Mid glow */}
        <mesh>
          <sphereGeometry args={[hovered ? 0.042 : 0.030, 16, 16]} />
          <meshBasicMaterial color={color} transparent opacity={hovered ? 0.55 : 0.32} />
        </mesh>
        {/* Solid core */}
        <mesh>
          <sphereGeometry args={[0.016, 16, 16]} />
          <meshBasicMaterial color={hovered ? '#ffffff' : color} />
        </mesh>
      </group>

      {/* Floating Hover Tooltip / Badge for Gliders and Argo Floats */}
      {hovered && (
        <Html
          position={[point.x, point.y, point.z]}
          center
          pointerEvents="none"
          zIndexRange={[100, 0]}
        >
          <div
            style={{
              background: 'rgba(3, 15, 29, 0.94)',
              border: `1px solid ${color}`,
              boxShadow: `0 4px 20px ${color}44, 0 0 12px ${color}22`,
              color: '#ffffff',
              padding: '6px 10px',
              borderRadius: '8px',
              fontSize: '11px',
              fontWeight: 600,
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
              userSelect: 'none',
              transform: 'translateY(-20px)',
              backdropFilter: 'blur(10px)',
              fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
              display: 'flex',
              flexDirection: 'column',
              gap: '3px',
              maxWidth: '260px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span
                style={{
                  width: '7px',
                  height: '7px',
                  borderRadius: '50%',
                  background: color,
                  boxShadow: `0 0 6px ${color}`,
                  flexShrink: 0,
                }}
              />
              <span style={{ color: '#fff', fontSize: '11.5px', fontWeight: 700, letterSpacing: '0.02em' }}>
                {instrument.name}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '9.5px', fontWeight: 500, color: 'rgba(255, 255, 255, 0.75)' }}>
              <span style={{ color: color, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {instrument.kind}
              </span>
              <span>•</span>
              <span>
                {Math.abs(instrument.latitude).toFixed(2)}°{instrument.latitude >= 0 ? 'N' : 'S'}, {Math.abs(instrument.longitude).toFixed(2)}°{instrument.longitude >= 0 ? 'E' : 'W'}
              </span>
              <span>•</span>
              <span style={{ color: '#38bdf8' }}>{instrument.depth}m</span>
            </div>
          </div>
        </Html>
      )}
    </group>
  )
}

function HolographicBeacon({ selection }: { selection: Selection }) {
  const isSector = isPointInIndianOcean(selection.latitude, selection.longitude)
  const localPos = useMemo(
    () => latLngToVector3(selection.latitude, selection.longitude, RADIUS + 0.005),
    [selection.latitude, selection.longitude]
  )
  const ring1Ref = useRef<THREE.Mesh>(null)
  const ring2Ref = useRef<THREE.Mesh>(null)

  const normal = useMemo(() => localPos.clone().normalize(), [localPos])
  const quaternion = useMemo(() => {
    const q = new THREE.Quaternion()
    q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal)
    return q
  }, [normal])

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime() * 1.6
    if (ring1Ref.current) {
      const p1 = t % 1
      ring1Ref.current.scale.setScalar(0.2 + p1 * 1.4)
      const mat = ring1Ref.current.material as THREE.MeshBasicMaterial
      mat.opacity = Math.max(0, (1 - p1) * 0.85)
    }
    if (ring2Ref.current) {
      const p2 = (t + 0.5) % 1
      ring2Ref.current.scale.setScalar(0.2 + p2 * 1.4)
      const mat = ring2Ref.current.material as THREE.MeshBasicMaterial
      mat.opacity = Math.max(0, (1 - p2) * 0.85)
    }
  })

  const primaryColor = isSector ? '#00f2fe' : '#f59e0b'
  const secondaryColor = isSector ? '#4facfe' : '#fbbf24'
  const beamColor = isSector ? '#70e2ff' : '#fde68a'

  return (
    <group position={localPos} quaternion={quaternion}>
      <mesh>
        <circleGeometry args={[0.024, 32]} />
        <meshBasicMaterial color={primaryColor} transparent opacity={0.95} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={ring1Ref}>
        <ringGeometry args={[0.035, 0.05, 32]} />
        <meshBasicMaterial color={secondaryColor} transparent opacity={0.8} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={ring2Ref}>
        <ringGeometry args={[0.035, 0.05, 32]} />
        <meshBasicMaterial color={primaryColor} transparent opacity={0.6} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0, 0.07]}>
        <cylinderGeometry args={[0.0018, 0.0018, 0.14, 8]} />
        <meshBasicMaterial color={beamColor} transparent opacity={0.75} />
      </mesh>
      <mesh position={[0, 0, 0.14]}>
        <sphereGeometry args={[0.012, 16, 16]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
    </group>
  )
}

function GlobeHotspotMarker({
  spot,
  isSelected,
  onSelect,
}: {
  spot: OceanHotspot
  isSelected: boolean
  onSelect: (spot: OceanHotspot) => void
}) {
  const [hovered, setHovered] = useState(false)
  const pos = useMemo(
    () => latLngToVector3(spot.latitude, spot.longitude, RADIUS + 0.012),
    [spot.latitude, spot.longitude]
  )
  const normal = useMemo(() => pos.clone().normalize(), [pos])
  const quaternion = useMemo(() => {
    const q = new THREE.Quaternion()
    q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal)
    return q
  }, [normal])

  const color = spot.badgeColor || '#10b981'

  return (
    <group position={pos} quaternion={quaternion}>
      {/* Interactive clickable hitbox */}
      <mesh
        onClick={(e) => {
          e.stopPropagation()
          onSelect(spot)
        }}
        onPointerOver={(e) => {
          e.stopPropagation()
          setHovered(true)
        }}
        onPointerOut={(e) => {
          e.stopPropagation()
          setHovered(false)
        }}
        position={[0, 0, 0.04]}
      >
        <cylinderGeometry args={[0.025, 0.025, 0.08, 12]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>

      {/* Surface target ring */}
      <mesh>
        <ringGeometry args={[0.016, 0.028, 24]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={isSelected ? 0.95 : hovered ? 0.8 : 0.45}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Vertical Holographic Light Pillar */}
      <mesh position={[0, 0, 0.035]}>
        <cylinderGeometry args={[0.002, 0.002, 0.07, 8]} />
        <meshBasicMaterial color={color} transparent opacity={isSelected || hovered ? 0.95 : 0.65} />
      </mesh>

      {/* Glowing tip beacon */}
      <mesh position={[0, 0, 0.07]}>
        <sphereGeometry args={[isSelected || hovered ? 0.014 : 0.009, 16, 16]} />
        <meshBasicMaterial color={color} />
      </mesh>

      {/* Hover or Selected floating HTML HUD badge */}
      {(hovered || isSelected) && (
        <Html
          position={[0, 0, 0.11]}
          center
          pointerEvents="none"
          zIndexRange={[100, 0]}
        >
          <div
            style={{
              background: 'rgba(5, 23, 38, 0.92)',
              border: `1px solid ${color}`,
              boxShadow: `0 4px 16px ${color}33`,
              color: '#ffffff',
              padding: '6px 10px',
              borderRadius: '6px',
              fontSize: '11px',
              fontWeight: 600,
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
              userSelect: 'none',
              transform: 'translateY(-12px)',
              backdropFilter: 'blur(8px)',
              fontFamily: 'Inter, system-ui, sans-serif',
              display: 'flex',
              flexDirection: 'column',
              gap: '2px',
              maxWidth: '240px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: color, flexShrink: 0 }} />
              <span style={{ color: '#fff', fontSize: '11px', fontWeight: 600 }}>{spot.name}</span>
            </div>
            <span style={{ color: color, fontSize: '9px', fontWeight: 500 }}>
              {spot.categoryLabel} · {spot.defaultDepth}m
            </span>
          </div>
        </Html>
      )}
    </group>
  )
}

function CameraDirector({
  targetPoint,
  teleportNonce,
  globeGroupRef,
  mode,
  depth,
  tsunamiScenario,
  activeBoundary,
}: {
  targetPoint: Selection
  teleportNonce?: number
  globeGroupRef: React.RefObject<THREE.Group | null>
  mode: ViewMode
  depth: number
  tsunamiScenario?: TsunamiScenario
  activeBoundary?: SpatialBoundary | null
}) {
  const { camera } = useThree()
  const isTeleporting = useRef(false)
  const targetCamPos = useRef<THREE.Vector3 | null>(null)
  const lastNonce = useRef(teleportNonce)
  const lastScenarioId = useRef(tsunamiScenario?.id)
  const lastMode = useRef(mode)

  // Cancel automatic camera lerp immediately on manual wheel zoom
  useEffect(() => {
    const onWheel = () => {
      isTeleporting.current = false
    }
    window.addEventListener('wheel', onWheel, { passive: true })
    return () => window.removeEventListener('wheel', onWheel)
  }, [])

  // 1. Teleport when targetPoint / teleportNonce is triggered
  useEffect(() => {
    if (teleportNonce !== undefined && teleportNonce !== lastNonce.current && globeGroupRef.current) {
      lastNonce.current = teleportNonce
      const localVec = latLngToVector3(targetPoint.latitude, targetPoint.longitude, RADIUS)
      const worldVec = localVec.clone().applyMatrix4(globeGroupRef.current.matrixWorld)
      // When a specific station or coordinate is clicked, zoom to 2.8; when an area is selected, zoom to 2.25
      const isEpicenterTarget =
        tsunamiScenario &&
        Math.abs(targetPoint.latitude - tsunamiScenario.epicenter.latitude) < 0.5 &&
        Math.abs(targetPoint.longitude - tsunamiScenario.epicenter.longitude) < 0.5

      const dist = mode === 'tsunami' && !isEpicenterTarget ? 2.8 : (activeBoundary ? 2.25 : 4.4)
      targetCamPos.current = worldVec.clone().normalize().multiplyScalar(dist)
      isTeleporting.current = true
    }
  }, [teleportNonce, targetPoint, globeGroupRef, mode, tsunamiScenario, activeBoundary])

  // 2. Smoothly frame Indian Ocean upon entering Tsunami or Currents mode
  useEffect(() => {
    if (mode === 'tsunami' && (lastMode.current !== 'tsunami' || lastScenarioId.current !== tsunamiScenario?.id)) {
      lastMode.current = mode
      lastScenarioId.current = tsunamiScenario?.id
      if (tsunamiScenario) {
        const epicVec = latLngToVector3(tsunamiScenario.epicenter.latitude, tsunamiScenario.epicenter.longitude, RADIUS)
        targetCamPos.current = epicVec.clone().normalize().multiplyScalar(4.4)
        isTeleporting.current = true
      }
    } else if (mode === 'currents' && lastMode.current !== 'currents') {
      lastMode.current = mode
      const centerVec = latLngToVector3(3.0, 66.0, RADIUS)
      targetCamPos.current = centerVec.clone().normalize().multiplyScalar(4.4)
      isTeleporting.current = true
    } else {
      lastMode.current = mode
    }
  }, [mode, tsunamiScenario])

  useFrame((_, delta) => {
    if (mode === 'dive') {
      const target = new THREE.Vector3(2.02 - Math.min(depth, 1800) / 3100, 0.45, 2.42 - Math.min(depth, 1800) / 4000)
      camera.position.lerp(target, 0.03)
      camera.lookAt(new THREE.Vector3(0.15, 0.08, 0.2))
      return
    }

    if (isTeleporting.current && targetCamPos.current) {
      const factor = Math.min(1, delta * 3.6)
      camera.position.lerp(targetCamPos.current, factor)
      camera.lookAt(0, 0, 0)
      if (camera.position.distanceTo(targetCamPos.current) < 0.02) {
        isTeleporting.current = false
      }
    }
  })

  return null
}

export interface GlobeSceneProps {
  variable: OceanVariable
  depth: number
  timeIndex: number
  mode: ViewMode
  overlayStrength: number
  instruments: Instrument[]
  selection: Selection
  teleportNonce?: number
  showVectorArrows?: boolean
  showCurrentLabels?: boolean
  showStreamlines?: boolean
  showParticles?: boolean
  flowIntensity?: number
  flowSpeed?: number
  showIsochrones?: boolean
  tsunamiHour?: number
  selectedStation?: CoastalStation | null
  tsunamiScenario?: TsunamiScenario
  isSelectingArea?: boolean
  activeBoundary?: SpatialBoundary | null
  anchorCorner?: { latitude: number; longitude: number } | null
  hoverCorner?: { latitude: number; longitude: number } | null
  onInstrument: (instrument: Instrument) => void
  onSelectPoint?: (selection: Selection) => void
  onSelectStation?: (station: CoastalStation) => void
  onSelectCurrentSystem?: (sys: CurrentSystem) => void
  onAreaCornerSelect?: (coord: { latitude: number; longitude: number }) => void
  onAreaHover?: (coord: { latitude: number; longitude: number }) => void
}

function IndianOceanSectorBoundary() {
  const points = useMemo(() => {
    const pts: THREE.Vector3[] = []
    const lonMin = 20, lonMax = 125
    const latMin = -45, latMax = 32

    // North border: lonMin -> lonMax at latMax (32°N)
    for (let lon = lonMin; lon <= lonMax; lon += 2.5) {
      pts.push(latLngToVector3(latMax, lon, RADIUS + 0.012))
    }
    // East border: latMax -> latMin at lonMax (125°E)
    for (let lat = latMax; lat >= latMin; lat -= 2.5) {
      pts.push(latLngToVector3(lat, lonMax, RADIUS + 0.012))
    }
    // South border: lonMax -> lonMin at latMin (-45°S)
    for (let lon = lonMax; lon >= lonMin; lon -= 2.5) {
      pts.push(latLngToVector3(latMin, lon, RADIUS + 0.012))
    }
    // West border: latMin -> latMax at lonMin (20°E)
    for (let lat = latMin; lat <= latMax; lat += 2.5) {
      pts.push(latLngToVector3(lat, lonMin, RADIUS + 0.012))
    }
    pts.push(latLngToVector3(latMax, lonMin, RADIUS + 0.012))
    return pts
  }, [])

  return (
    <Line
      points={points}
      color="#00f2fe"
      lineWidth={1.0}
      transparent
      opacity={0.38}
    />
  )
}

function Scene({
  variable,
  depth,
  timeIndex,
  mode,
  overlayStrength,
  instruments,
  selection,
  teleportNonce,
  showVectorArrows = false,
  showCurrentLabels = true,
  showStreamlines = true,
  showParticles = true,
  flowIntensity = 1.0,
  flowSpeed = 1.0,
  showIsochrones = true,
  tsunamiHour = 2.0,
  tsunamiScenario = TSUNAMI_HISTORIC_DATA,
  isSelectingArea = false,
  activeBoundary = null,
  anchorCorner = null,
  hoverCorner = null,
  onInstrument,
  onSelectPoint,
  onSelectStation,
  onSelectCurrentSystem,
  onAreaCornerSelect,
  onAreaHover,
}: GlobeSceneProps) {
  const groupRef = useRef<THREE.Group>(null)

  const handleGlobeClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation()
    if (!groupRef.current || !onAreaCornerSelect) return
    const localPoint = groupRef.current.worldToLocal(event.point.clone())
    const coord = vector3ToLatLng(localPoint)
    onAreaCornerSelect(coord)
  }

  const handleGlobePointerMove = (event: ThreeEvent<PointerEvent>) => {
    if (!onAreaHover || !groupRef.current) return
    const localPoint = groupRef.current.worldToLocal(event.point.clone())
    const coord = vector3ToLatLng(localPoint)
    onAreaHover(coord)
  }

  // Strict mode isolation: when in Tsunami mode, NEVER render currents layers
  const isTsunamiActive = mode === 'tsunami'
  const isCurrentsActive = !isTsunamiActive && (mode === 'currents' || variable === 'currents')

  return (
    <>
      <color attach="background" args={['#020712']} />
      <fog attach="fog" args={['#020712', 8, 18]} />
      <ambientLight intensity={1.3} />
      <directionalLight position={[1.8, 3.8, -4.6]} intensity={2.8} color="#ffffff" />
      <directionalLight position={[-3.8, 1.8, -3.6]} intensity={1.4} color="#b3e5fc" />
      <pointLight position={[0, -4, -3]} intensity={0.9} color="#00e5ff" />
      <Stars radius={90} depth={45} count={3200} factor={3} saturation={0} fade speed={0.25} />

      <group
        ref={groupRef}
        rotation={[0, 0, 0]}
      >
        <OceanShader
          variable={isTsunamiActive ? 'temperature' : (mode === 'currents' ? 'currents' : variable)}
          depth={depth}
          timeIndex={timeIndex}
          overlayStrength={isTsunamiActive ? 0.35 : overlayStrength}
          tsunamiActive={isTsunamiActive}
          tsunamiScenario={tsunamiScenario}
          tsunamiHour={tsunamiHour}
        />

        {/* Interactive Bounding Box / Area Selector */}
        <GlobeAreaSelector
          activeBoundary={activeBoundary}
          anchorCorner={anchorCorner}
          hoverCorner={hoverCorner}
          isSelecting={isSelectingArea}
        />

        {/* Invisible raycast sphere for clicks and precision hover */}
        <mesh
          onClick={handleGlobeClick}
          onPointerMove={handleGlobePointerMove}
        >
          <sphereGeometry args={[RADIUS + 0.008, 96, 96]} />
          <meshBasicMaterial transparent opacity={0} />
        </mesh>

        {/* Latitude circles */}
        {[-30, 0, 30].map((lat) => (
          <Line
            key={lat}
            points={Array.from({ length: 73 }, (_, i) => latLngToVector3(lat, -180 + i * 5, RADIUS + 0.012))}
            color="#c1eaff"
            lineWidth={0.28}
            transparent
            opacity={0.14}
          />
        ))}

        {/* Indian Ocean Digital Twin Observation Boundary [20°E-125°E, 45°S-32°N] */}
        <IndianOceanSectorBoundary />

        {/* Continuous Fluid Ocean Flow: Smooth Curved Streamlines & Luminous Advected Particles */}
        <OceanCurrentFlow
          active={isCurrentsActive || mode === 'dive'}
          depth={depth}
          timeIndex={timeIndex}
          showStreamlines={showStreamlines}
          showParticles={showParticles}
          flowIntensity={flowIntensity}
          flowSpeed={flowSpeed}
        />

        {/* Optional 3D Vector Arrow Field (off by default) */}
        {showVectorArrows && (
          <CurrentsVectorField
            active={isCurrentsActive && showVectorArrows}
            timeIndex={timeIndex}
          />
        )}

        {/* 4. Complete Multi-Scenario Indian Ocean Tsunami Propagation Scene */}
        <TsunamiPropagationLayer
          active={isTsunamiActive}
          scenario={tsunamiScenario}
          tsunamiHour={tsunamiHour}
          showIsochrones={showIsochrones}
          onSelectStation={onSelectStation}
        />

        {/* In-situ Observation Markers (Argo, BGC, Gliders) - Explore Mode Only */}
        {!isTsunamiActive && mode === 'explore' &&
          instruments.map((instrument) => (
            <Marker key={instrument.id} instrument={instrument} onSelect={onInstrument} />
          ))}
        {/* 18 Curated Biological Upwelling & Trench Hotspots Beacons */}
        {!isTsunamiActive && (mode === 'explore' || mode === 'currents') &&
          OCEAN_HOTSPOTS.map((spot) => (
            <GlobeHotspotMarker
              key={spot.id}
              spot={spot}
              isSelected={
                Math.abs(selection.latitude - spot.latitude) < 0.25 &&
                Math.abs(selection.longitude - spot.longitude) < 0.25
              }
              onSelect={(s) => {
                onSelectPoint?.({ latitude: s.latitude, longitude: s.longitude })
              }}
            />
          ))}

        {/* Surface Fish Shoals over high-chlorophyll upwelling blooms */}
        <GlobeFishShoals
          active={mode === 'explore' && variable === 'chlorophyll'}
          timeIndex={timeIndex}
        />

        {/* Holographic Sonar Beacon at clicked coordinate (hidden when boundary box is framing area) */}
        {!activeBoundary && <HolographicBeacon selection={selection} />}
      </group>

      <Atmosphere />

      <CameraDirector
        targetPoint={selection}
        teleportNonce={teleportNonce}
        globeGroupRef={groupRef}
        mode={mode}
        depth={depth}
        tsunamiScenario={tsunamiScenario}
        activeBoundary={activeBoundary}
      />

      <OrbitControls
        enablePan={false}
        minDistance={1.606}
        maxDistance={5.2}
        enableDamping
        dampingFactor={0.06}
        autoRotate={mode === 'explore' && !teleportNonce && !isSelectingArea && !activeBoundary && !anchorCorner}
        autoRotateSpeed={0.18}
      />
    </>
  )
}

export default function GlobeScene(props: GlobeSceneProps) {
  return (
    <Canvas camera={{ position: [0.65, 0.75, -4.4], fov: 38 }} dpr={[1, 2]} gl={{ antialias: true }}>
      <Suspense fallback={null}>
        <Scene {...props} />
      </Suspense>
    </Canvas>
  )
}
