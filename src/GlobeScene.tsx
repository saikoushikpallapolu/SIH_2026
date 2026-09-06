import { Html, Line, OrbitControls, Stars } from '@react-three/drei'
import { Canvas, useFrame, useLoader, useThree, type ThreeEvent } from '@react-three/fiber'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import {
  GLOBE_RADIUS,
  getOceanVelocity,
  latLngToVector3,
  vector3ToLatLng,
  computeSphericalTangent,
  CURRENT_SYSTEMS,
  TSUNAMI_HISTORIC_DATA,
} from './oceanDataEngine'
import type {
  CoastalStation,
  CurrentSystem,
  Instrument,
  OceanVariable,
  Selection,
  TsunamiScenario,
  ViewMode,
} from './types'

const RADIUS = GLOBE_RADIUS
const EARTH_DAY_MAP = 'https://threejs.org/examples/textures/planets/earth_atmos_2048.jpg'
const EARTH_WATER_MASK = 'https://threejs.org/examples/textures/planets/earth_specular_2048.jpg'

// Fast bounding check for dry land across the Indian Ocean basin and surrounding continents
export function isDryLand(lat: number, lon: number): boolean {
  // Mainland Indian Subcontinent
  if (lat > 8.0 && lat < 34.0 && lon > 68.0 && lon < 89.0) {
    if (lat > 22.0) return true
    if (lon > 73.0 && lon < 84.0 && lat > 9.0) return true
  }
  // Southeast Asia / Indochina / Myanmar / Malay Peninsula
  if (lat > 1.0 && lon > 98.5) return true
  // Arabia & Middle East
  if (lat > 12.0 && lon < 57.0) {
    if (lat > 20.0 && lon < 60.0) return true
    if (lon < 50.0) return true
  }
  // Iran / Pakistan inland
  if (lat > 26.0 && lon > 56.0 && lon < 74.0) return true
  // East Africa
  if (lon < 41.0 && lat > -25.0 && lat < 14.0) return true
  // Madagascar
  if (lat > -26.0 && lat < -11.0 && lon > 43.0 && lon < 51.0) return true
  // Australia
  if (lat < -15.0 && lat > -38.0 && lon > 114.0) return true
  return false
}

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
  }, [active, timeIndex, gridPoints, dummy])

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

interface FlowParticle {
  lat: number
  lon: number
  prevLat: number
  prevLon: number
  age: number
  maxAge: number
  speedMult: number
}

function spawnParticle(initial: boolean): FlowParticle {
  const region = Math.random()
  let lat = 0
  let lon = 75

  if (region < 0.24) {
    // Somali Jet & Western Arabian Sea
    lat = -2 + Math.random() * 16
    lon = 45 + Math.random() * 13
  } else if (region < 0.44) {
    // South Equatorial Current (SEC)
    lat = -20 + Math.random() * 10
    lon = 50 + Math.random() * 60
  } else if (region < 0.60) {
    // Agulhas Current (Mozambique/South Africa)
    lat = -34 + Math.random() * 14
    lon = 30 + Math.random() * 14
  } else if (region < 0.74) {
    // Equatorial Wyrtki Jet
    lat = -3 + Math.random() * 6
    lon = 60 + Math.random() * 34
  } else if (region < 0.88) {
    // Bay of Bengal Gyre
    lat = 8 + Math.random() * 13
    lon = 82 + Math.random() * 10
  } else {
    // Antarctic Circumpolar Current
    lat = -43 + Math.random() * 4
    lon = 35 + Math.random() * 75
  }

  return {
    lat,
    lon,
    prevLat: lat,
    prevLon: lon,
    age: initial ? Math.floor(Math.random() * 100) : 0,
    maxAge: 70 + Math.floor(Math.random() * 80),
    speedMult: 0.8 + Math.random() * 0.5,
  }
}

/**
 * Animated Directional Streamlines with Particle Trails.
 * Renders both trailing velocity motion streaks and bright leading heads.
 */
function StreamlineParticles({ active, timeIndex }: { active: boolean; timeIndex: number }) {
  const count = 2200
  const pointsRef = useRef<THREE.Points>(null)
  const linesRef = useRef<THREE.LineSegments>(null)
  const geomPointsRef = useRef<THREE.BufferGeometry>(null)
  const geomLinesRef = useRef<THREE.BufferGeometry>(null)

  const particles = useMemo<FlowParticle[]>(() => {
    const list: FlowParticle[] = []
    for (let i = 0; i < count; i++) {
      list.push(spawnParticle(true))
    }
    return list
  }, [count])

  // Positions and colors for leading heads (count * 3)
  const headPositions = useMemo(() => new Float32Array(count * 3), [count])
  const headColors = useMemo(() => new Float32Array(count * 3), [count])

  // Positions and colors for trailing streaks (2 vertices per particle: tail -> head)
  const linePositions = useMemo(() => new Float32Array(count * 6), [count])
  const lineColors = useMemo(() => new Float32Array(count * 6), [count])

  useFrame((_, delta) => {
    if (!active) return
    const dt = Math.min(delta, 0.05)

    for (let i = 0; i < count; i++) {
      const p = particles[i]
      const vel = getOceanVelocity(p.lat, p.lon, timeIndex)

      p.prevLat = p.lat
      p.prevLon = p.lon

      // Advect particle along velocity vector (u: east, v: north)
      p.lat += vel.v * dt * 4.6 * p.speedMult
      const cosLat = Math.max(0.2, Math.cos((p.lat * Math.PI) / 180))
      p.lon += ((vel.u * dt * 4.6) / cosLat) * p.speedMult
      p.age += 1

      // Respawn when life expires or moves outside the ocean basin
      if (
        p.age > p.maxAge ||
        p.lat < -44.5 ||
        p.lat > 25.5 ||
        p.lon < 22 ||
        p.lon > 122 ||
        isDryLand(p.lat, p.lon)
      ) {
        particles[i] = spawnParticle(false)
        continue
      }

      // Project head and tail positions onto sphere
      const headPos = latLngToVector3(p.lat, p.lon, RADIUS + 0.016)
      const tailPos = latLngToVector3(p.prevLat, p.prevLon, RADIUS + 0.015)

      // Update head points
      headPositions[i * 3] = headPos.x
      headPositions[i * 3 + 1] = headPos.y
      headPositions[i * 3 + 2] = headPos.z

      // Update trail line segment: vertex 0 (tail) -> vertex 1 (head)
      const lineIdx = i * 6
      linePositions[lineIdx] = tailPos.x
      linePositions[lineIdx + 1] = tailPos.y
      linePositions[lineIdx + 2] = tailPos.z
      linePositions[lineIdx + 3] = headPos.x
      linePositions[lineIdx + 4] = headPos.y
      linePositions[lineIdx + 5] = headPos.z

      // Velocity-based dynamic luminescence
      const speedNorm = Math.min(1.0, vel.speed / 1.4)
      const lifeFrac = p.age / p.maxAge
      const alpha = Math.sin(lifeFrac * Math.PI)

      let cr = 0.2, cg = 0.8, cb = 1.0
      if (speedNorm > 0.65) {
        // Fast jet: Luminous yellow-gold
        cr = 1.0; cg = 0.95; cb = 0.25
      } else if (speedNorm > 0.35) {
        // Moderate current: Electric cyan
        cr = 0.15; cg = 0.92; cb = 1.0
      }

      headColors[i * 3] = cr * alpha
      headColors[i * 3 + 1] = cg * alpha
      headColors[i * 3 + 2] = cb * alpha

      // Streak line: tail is faded, head is bright
      lineColors[lineIdx] = cr * alpha * 0.15
      lineColors[lineIdx + 1] = cg * alpha * 0.15
      lineColors[lineIdx + 2] = cb * alpha * 0.15
      lineColors[lineIdx + 3] = cr * alpha * 0.95
      lineColors[lineIdx + 4] = cg * alpha * 0.95
      lineColors[lineIdx + 5] = cb * alpha * 0.95
    }

    if (geomPointsRef.current) {
      geomPointsRef.current.attributes.position.needsUpdate = true
      geomPointsRef.current.attributes.color.needsUpdate = true
    }
    if (geomLinesRef.current) {
      geomLinesRef.current.attributes.position.needsUpdate = true
      geomLinesRef.current.attributes.color.needsUpdate = true
    }
  })

  if (!active) return null

  return (
    <group>
      {/* Trailing Directional Streaks */}
      <lineSegments ref={linesRef}>
        <bufferGeometry ref={geomLinesRef}>
          <bufferAttribute attach="attributes-position" args={[linePositions, 3]} />
          <bufferAttribute attach="attributes-color" args={[lineColors, 3]} />
        </bufferGeometry>
        <lineBasicMaterial
          vertexColors
          transparent
          opacity={0.85}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </lineSegments>

      {/* Leading Luminous Heads */}
      <points ref={pointsRef}>
        <bufferGeometry ref={geomPointsRef}>
          <bufferAttribute attach="attributes-position" args={[headPositions, 3]} />
          <bufferAttribute attach="attributes-color" args={[headColors, 3]} />
        </bufferGeometry>
        <pointsMaterial
          vertexColors
          size={0.016}
          sizeAttenuation
          transparent
          opacity={0.95}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </points>
    </group>
  )
}

/**
 * 3D Interactive Waypoints for the 8 Major Indian Ocean Current Systems.
 * Rendered as clean, glowing 3D navigational markers without intrusive text overlays.
 */
function CurrentSystemsWaypoints({
  active,
  onSelectSystem,
}: {
  active: boolean
  onSelectSystem?: (sys: CurrentSystem) => void
}) {
  if (!active) return null

  return (
    <group>
      {CURRENT_SYSTEMS.map((sys) => {
        const pos = latLngToVector3(sys.lat, sys.lon, RADIUS + 0.024)
        return (
          <group
            key={sys.id}
            position={pos}
            onClick={(e) => {
              e.stopPropagation()
              onSelectSystem?.(sys)
            }}
          >
            {/* Luminous beacon core */}
            <mesh>
              <sphereGeometry args={[0.02, 16, 16]} />
              <meshBasicMaterial color="#00e5ff" />
            </mesh>
            {/* Outer soft glow ring */}
            <mesh scale={1.9}>
              <sphereGeometry args={[0.02, 16, 16]} />
              <meshBasicMaterial color="#00e5ff" transparent opacity={0.28} />
            </mesh>
          </group>
        )
      })}
    </group>
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
  earthMap.colorSpace = THREE.SRGBColorSpace

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        uniforms: {
          uTime: { value: 0 },
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
          uniform float uDepth;
          uniform float uVariable;
          uniform float uOverlayStrength;
          uniform sampler2D uEarthMap;
          uniform sampler2D uWaterMask;
          uniform float uTsunamiActive;
          uniform float uTsunamiHour;
          uniform sampler2D uTsunamiPropMap;
          varying vec2 vUv;
          varying vec3 vNormal;
          varying vec3 vPosition;

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

          // 3. Chlorophyll: NASA MODIS Ocean Color / cmocean alga
          vec3 paletteAlga(float t) {
            vec3 c0 = vec3(0.01, 0.05, 0.11);
            vec3 c1 = vec3(0.02, 0.18, 0.18);
            vec3 c2 = vec3(0.06, 0.38, 0.22);
            vec3 c3 = vec3(0.15, 0.62, 0.28);
            vec3 c4 = vec3(0.38, 0.85, 0.32);
            vec3 c5 = vec3(0.72, 0.94, 0.36);
            vec3 c6 = vec3(1.0, 0.96, 0.42);
            if (t < 0.16) return mix(c0, c1, t / 0.16);
            if (t < 0.32) return mix(c1, c2, (t - 0.16) / 0.16);
            if (t < 0.48) return mix(c2, c3, (t - 0.32) / 0.16);
            if (t < 0.66) return mix(c3, c4, (t - 0.48) / 0.18);
            if (t < 0.84) return mix(c4, c5, (t - 0.66) / 0.18);
            return mix(c5, c6, (t - 0.84) / 0.16);
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
            vec3 earth = texture2D(uEarthMap, vUv).rgb;
            float water = smoothstep(0.18, 0.46, texture2D(uWaterMask, vUv).r);

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
                    // Deep Oceanic Indigo (Trough)
                    vec3 troughColor = vec3(0.012, 0.065, 0.22);
                    // Rich Marine Azure (Swell flank)
                    vec3 swellColor = vec3(0.00, 0.44, 0.88);
                    // Luminous Electric Cyan (Wave crest)
                    vec3 crestColor = vec3(0.05, 0.86, 0.98);
                    // Restrained Pale Sky-White (Sea-spray crest highlight)
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

            float latFromEq = abs(vUv.y - 0.5) * 2.0;
            float tropicality = pow(max(0.0, cos(latFromEq * 1.5708)), 1.3);
            float thermocline = 1.0 - exp(-uDepth / (200.0 + tropicality * 140.0));

            vec3 fieldColor = vec3(0.0);

            if (uVariable < 0.5) {
              float wave = sin(vPosition.x * 4.0 + uTime * 0.4) * 0.04;
              float normVal = clamp(0.1 + tropicality * 0.88 - thermocline * 0.76 + wave, 0.0, 1.0);
              fieldColor = paletteThermal(normVal);
            }
            else if (uVariable < 1.5) {
              float regionalEvap = (0.5 - vUv.x) * 1.8;
              float gyre = sin(latFromEq * 3.1416);
              float baseSal = clamp(0.32 + gyre * 0.42 + regionalEvap * 0.28 + thermocline * 0.1, 0.0, 1.0);
              float isohaline = abs(fract(baseSal * 10.0) - 0.5);
              float contour = smoothstep(0.44, 0.48, isohaline) * 0.15;
              fieldColor = paletteHaline(baseSal) + vec3(contour * 0.6, contour * 0.8, contour);
            }
            else if (uVariable < 2.5) {
              float coastProximity = smoothstep(0.42, 0.49, texture2D(uWaterMask, vUv).r);
              float bloomFilament = sin(vPosition.x * 18.0 + sin(vPosition.y * 14.0 + uTime * 0.5) * 3.0) * 0.5 + 0.5;
              float southernFront = smoothstep(0.65, 0.95, vUv.y);
              float chlVal = clamp(0.04 + (1.0 - coastProximity) * 0.65 + bloomFilament * 0.28 + southernFront * 0.45 - thermocline * 0.25, 0.0, 1.0);
              fieldColor = paletteAlga(chlVal);
            }
            else {
              // Currents circulation speed field (cmocean speed)
              float latDeg = (vUv.y - 0.5) * 180.0;
              float lonDeg = (vUv.x - 0.5) * 360.0;

              float speed = 0.12;

              // Somali Boundary Jet (0° to 14°N, 42° to 58°E)
              if (latDeg >= -2.0 && latDeg <= 14.0 && lonDeg >= 42.0 && lonDeg <= 58.0) {
                float core = sin((latDeg + 2.0) / 16.0 * 3.14159);
                speed = max(speed, 0.3 + 1.6 * core);
              }
              // South Equatorial Current (-22° to -8°S, 45° to 115°E)
              else if (latDeg >= -22.0 && latDeg <= -8.0 && lonDeg >= 45.0 && lonDeg <= 115.0) {
                float core = sin((latDeg + 22.0) / 14.0 * 3.14159);
                speed = max(speed, 0.25 + 0.55 * core);
              }
              // Agulhas Current (-36° to -20°S, 28° to 44°E)
              else if (latDeg >= -36.0 && latDeg <= -20.0 && lonDeg >= 28.0 && lonDeg <= 44.0) {
                speed = max(speed, 1.45);
              }
              // Equatorial Wyrtki Jet (-3.5° to 3.5°, 58° to 96°E)
              else if (latDeg >= -3.5 && latDeg <= 3.5 && lonDeg >= 58.0 && lonDeg <= 96.0) {
                speed = max(speed, 0.85 * cos(latDeg / 3.5 * 1.5708));
              }
              // Antarctic Circumpolar Current
              else if (latDeg <= -38.0) {
                speed = max(speed, 0.95);
              }

              float speedNorm = clamp(speed / 2.0, 0.0, 1.0);
              fieldColor = paletteSpeed(speedNorm);
            }

            float light = max(dot(vNormal, normalize(vec3(1.0, 0.8, 1.2))), 0.0);
            vec3 litOcean = mix(earth, fieldColor * (0.54 + light * 0.72), uOverlayStrength);
            gl_FragColor = vec4(mix(earth * (0.45 + light * 0.55), litOcean, water), 1.0);
          }
        `,
      }),
    [variable, earthMap, waterMask, overlayStrength]
  )

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


function Atmosphere() {
  return (
    <mesh scale={1.035}>
      <sphereGeometry args={[RADIUS, 96, 96]} />
      <meshBasicMaterial
        color="#58ddff"
        transparent
        opacity={0.12}
        side={THREE.BackSide}
        blending={THREE.AdditiveBlending}
      />
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
  const point = latLngToVector3(instrument.latitude, instrument.longitude, RADIUS + 0.045)
  const color = instrument.kind === 'Glider' ? '#ffcf66' : instrument.kind === 'BGC-Argo' ? '#9b83ff' : '#72e8ff'

  return (
    <group
      position={point}
      onClick={(event) => {
        event.stopPropagation()
        onSelect(instrument)
      }}
    >
      <mesh>
        <sphereGeometry args={[0.035, 16, 16]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <mesh scale={1.8}>
        <sphereGeometry args={[0.035, 16, 16]} />
        <meshBasicMaterial color={color} transparent opacity={0.2} />
      </mesh>
    </group>
  )
}

function HolographicBeacon({ selection }: { selection: Selection }) {
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

  return (
    <group position={localPos} quaternion={quaternion}>
      <mesh>
        <circleGeometry args={[0.024, 32]} />
        <meshBasicMaterial color="#00f2fe" transparent opacity={0.95} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={ring1Ref}>
        <ringGeometry args={[0.035, 0.05, 32]} />
        <meshBasicMaterial color="#4facfe" transparent opacity={0.8} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={ring2Ref}>
        <ringGeometry args={[0.035, 0.05, 32]} />
        <meshBasicMaterial color="#00f2fe" transparent opacity={0.6} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0, 0.07]}>
        <cylinderGeometry args={[0.0018, 0.0018, 0.14, 8]} />
        <meshBasicMaterial color="#70e2ff" transparent opacity={0.75} />
      </mesh>
      <mesh position={[0, 0, 0.14]}>
        <sphereGeometry args={[0.012, 16, 16]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
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
}: {
  targetPoint: Selection
  teleportNonce?: number
  globeGroupRef: React.RefObject<THREE.Group | null>
  mode: ViewMode
  depth: number
  tsunamiScenario?: TsunamiScenario
}) {
  const { camera } = useThree()
  const isTeleporting = useRef(false)
  const targetCamPos = useRef<THREE.Vector3 | null>(null)
  const lastNonce = useRef(teleportNonce)
  const lastScenarioId = useRef(tsunamiScenario?.id)
  const lastMode = useRef(mode)

  // 1. Teleport when targetPoint / teleportNonce is triggered
  useEffect(() => {
    if (teleportNonce !== undefined && teleportNonce !== lastNonce.current && globeGroupRef.current) {
      lastNonce.current = teleportNonce
      const localVec = latLngToVector3(targetPoint.latitude, targetPoint.longitude, RADIUS)
      const worldVec = localVec.clone().applyMatrix4(globeGroupRef.current.matrixWorld)
      // When a specific station or coordinate is clicked, zoom to 2.8; else frame Indian Ocean basin at 4.4
      const isEpicenterTarget =
        tsunamiScenario &&
        Math.abs(targetPoint.latitude - tsunamiScenario.epicenter.latitude) < 0.5 &&
        Math.abs(targetPoint.longitude - tsunamiScenario.epicenter.longitude) < 0.5

      const dist = mode === 'tsunami' && !isEpicenterTarget ? 2.8 : 4.4
      targetCamPos.current = worldVec.clone().normalize().multiplyScalar(dist)
      isTeleporting.current = true
    }
  }, [teleportNonce, targetPoint, globeGroupRef, mode, tsunamiScenario])

  // 2. Smoothly frame Indian Ocean and scenario epicenter upon entering Tsunami mode or changing scenario
  useEffect(() => {
    if (mode === 'tsunami' && (lastMode.current !== 'tsunami' || lastScenarioId.current !== tsunamiScenario?.id)) {
      lastMode.current = mode
      lastScenarioId.current = tsunamiScenario?.id
      if (tsunamiScenario) {
        const epicVec = latLngToVector3(tsunamiScenario.epicenter.latitude, tsunamiScenario.epicenter.longitude, RADIUS)
        targetCamPos.current = epicVec.clone().normalize().multiplyScalar(4.4)
        isTeleporting.current = true
      }
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
  showIsochrones?: boolean
  tsunamiHour?: number
  selectedStation?: CoastalStation | null
  tsunamiScenario?: TsunamiScenario
  onInstrument: (instrument: Instrument) => void
  onSelectPoint: (selection: Selection) => void
  onSelectStation?: (station: CoastalStation) => void
  onSelectCurrentSystem?: (sys: CurrentSystem) => void
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
  showVectorArrows = true,
  showCurrentLabels = true,
  showIsochrones = true,
  tsunamiHour = 2.0,
  tsunamiScenario = TSUNAMI_HISTORIC_DATA,
  onInstrument,
  onSelectPoint,
  onSelectStation,
  onSelectCurrentSystem,
}: GlobeSceneProps) {
  const groupRef = useRef<THREE.Group>(null)

  const handleGlobeClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation()
    if (!groupRef.current) return
    const localPoint = groupRef.current.worldToLocal(event.point.clone())
    const coord = vector3ToLatLng(localPoint)
    onSelectPoint(coord)
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
          variable={isTsunamiActive ? 'temperature' : variable}
          depth={depth}
          timeIndex={timeIndex}
          overlayStrength={isTsunamiActive ? 0.35 : overlayStrength}
          tsunamiActive={isTsunamiActive}
          tsunamiScenario={tsunamiScenario}
          tsunamiHour={tsunamiHour}
        />

        {/* Invisible raycast sphere */}
        <mesh onClick={handleGlobeClick}>
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

        {/* 1. Real Directional Streamline Flow Streaks */}
        <StreamlineParticles
          active={isCurrentsActive || mode === 'dive'}
          timeIndex={timeIndex}
        />

        {/* 2. 3D Instanced Directional Vector Arrow Field */}
        <CurrentsVectorField
          active={isCurrentsActive && showVectorArrows}
          timeIndex={timeIndex}
        />

        {/* 3. Major Current Systems Interactive Markers */}
        <CurrentSystemsWaypoints
          active={isCurrentsActive && showCurrentLabels}
          onSelectSystem={onSelectCurrentSystem}
        />

        {/* 4. Complete Multi-Scenario Indian Ocean Tsunami Propagation Scene */}
        <TsunamiPropagationLayer
          active={isTsunamiActive}
          scenario={tsunamiScenario}
          tsunamiHour={tsunamiHour}
          showIsochrones={showIsochrones}
          onSelectStation={onSelectStation}
        />

        {/* In-situ Observation Markers (Argo, BGC, Gliders) */}
        {!isTsunamiActive &&
          instruments.map((instrument) => (
            <Marker key={instrument.id} instrument={instrument} onSelect={onInstrument} />
          ))}

        {/* Holographic Sonar Beacon at clicked coordinate */}
        <HolographicBeacon selection={selection} />
      </group>

      <Atmosphere />

      <CameraDirector
        targetPoint={selection}
        teleportNonce={teleportNonce}
        globeGroupRef={groupRef}
        mode={mode}
        depth={depth}
        tsunamiScenario={tsunamiScenario}
      />

      <OrbitControls
        enablePan={false}
        minDistance={1.8}
        maxDistance={5.2}
        enableDamping
        dampingFactor={0.06}
        autoRotate={mode === 'explore' && !teleportNonce}
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
