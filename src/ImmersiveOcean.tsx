import { PointerLockControls, Stars } from '@react-three/drei'
import { Canvas, useFrame, useThree, useLoader } from '@react-three/fiber'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import {
  computeMarineBiomass,
  extractClientIsolineSegments,
  fetchTerrainSlice,
  getChlorophyllAt,
  getRegionalDiveProfile,
  getSubgridLocalEstimate,
  querySubgridTelemetry,
  type MarineBiomassInfo,
  type RegionalDiveProfile,
} from './oceanDataEngine'
import type { OceanVariable, Selection, SpatialBoundary, TerrainSliceData } from './types'

export interface DiveTelemetry {
  depth: number
  temperature: number
  salinity: number
  chlorophyll: number
  currentSpeed: number
  currentU: number
  currentV: number
  temperatureProfile: number[]
  biomass: MarineBiomassInfo
  regionalProfile: RegionalDiveProfile
}
interface Props {
  variable: OceanVariable
  selection: Selection
  boundary?: SpatialBoundary
  timeIndex: number
  onTelemetry: (telemetry: DiveTelemetry) => void
  onExit?: () => void
}

const worldLimit = 120

/**
 * Authentic NOAA ETOPO 2022 Bedrock Topography & Bathymetry Terrain.
 * Seamlessly populates the ocean dive floor with real continental shelf,
 * abyssal bathymetry, and genuine subaerial coastal/Ghats land relief with vector contours.
 */
function Terrain({ selection, boundary }: { selection: Selection; boundary?: SpatialBoundary }) {
  const [terrainData, setTerrainData] = useState<TerrainSliceData | null>(null)

  useEffect(() => {
    let active = true
    const bbox: [number, number, number, number] = boundary
      ? boundary.bbox
      : [
          Math.max(-44.9, selection.latitude - 1.2),
          Math.min(31.9, selection.latitude + 1.2),
          Math.max(20.1, selection.longitude - 1.2),
          Math.min(124.9, selection.longitude + 1.2),
        ]

    fetchTerrainSlice(bbox, 96)
      .then((data) => {
        if (active) setTerrainData(data)
      })
      .catch((err) => {
        console.warn('Terrain NOAA ETOPO fetch fallback:', err)
      })

    return () => {
      active = false
    }
  }, [boundary, selection.latitude, selection.longitude])

  const { terrainGeometry, skirtGeometry, coastlineGeom, contourGeom } = useMemo(() => {
    const size = 260
    const res = terrainData ? terrainData.grid_res : 64
    const elevGrid = terrainData?.elevation_grid

    const numVerts = res * res
    const positions = new Float32Array(numVerts * 3)
    const colors = new Float32Array(numVerts * 3)
    const indices: number[] = []

    const color = new THREE.Color()

    for (let r = 0; r < res; r++) {
      // r = 0 is North (pz = -size/2), r = res - 1 is South (pz = +size/2)
      const pz = (0.5 - r / (res - 1)) * size
      for (let c = 0; c < res; c++) {
        // c = 0 is West (px = -size/2), c = res - 1 is East (px = +size/2)
        const px = (c / (res - 1) - 0.5) * size
        const idx = r * res + c
        const elev = elevGrid ? elevGrid[idx] : -1200

        let py = -18.0
        if (elev >= 0) {
          // Authentic Land Elevation Relief (Western Ghats peaks, coastal hills)
          const landRatio = Math.min(1.0, elev / 1800.0)
          py = -18.0 + landRatio * 24.0 // rises up towards water surface/peaks
          
          // Hypsometric Land Shading
          if (elev < 80) {
            color.setRGB(0.20, 0.58, 0.28) // Coastal lowlands
          } else if (elev < 400) {
            color.setRGB(0.48, 0.54, 0.26) // Foothills & plains
          } else if (elev < 1200) {
            color.setRGB(0.64, 0.50, 0.26) // Western Ghats / ridges
          } else {
            color.setRGB(0.75, 0.65, 0.52) // Mountain peaks
          }
        } else {
          // Authentic Ocean Bathymetry Relief
          const depth = -elev
          const depthRatio = Math.min(1.0, depth / 4500.0)
          py = -18.0 - depthRatio * 14.0 // drops down to seabed
          
          // Bathymetric cmocean Shading
          if (depth < 200) {
            color.setRGB(0.06, 0.65, 0.72) // Continental shelf
          } else if (depth < 1500) {
            color.setRGB(0.05, 0.40, 0.62) // Continental slope
          } else {
            color.setRGB(0.02, 0.18, 0.38) // Abyssal plain
          }
        }

        positions[idx * 3] = px
        positions[idx * 3 + 1] = py
        positions[idx * 3 + 2] = pz

        colors[idx * 3] = color.r
        colors[idx * 3 + 1] = color.g
        colors[idx * 3 + 2] = color.b
      }
    }

    // Upward-facing winding: (a, b, d) and (b, e, d)
    for (let r = 0; r < res - 1; r++) {
      for (let c = 0; c < res - 1; c++) {
        const a = r * res + c
        const b = a + 1
        const d = (r + 1) * res + c
        const e = d + 1
        indices.push(a, b, d)
        indices.push(b, e, d)
      }
    }

    const tGeom = new THREE.BufferGeometry()
    tGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    tGeom.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    tGeom.setIndex(indices)
    tGeom.computeVertexNormals()

    // Framing Skirt Side Walls
    const baseFloorY = -38.0
    const skirtPos: number[] = []
    const skirtColors: number[] = []

    const addWallSegment = (p1: [number, number, number], p2: [number, number, number], isOcean: boolean) => {
      skirtPos.push(...p1, p1[0], baseFloorY, p1[2], ...p2)
      skirtPos.push(...p2, p1[0], baseFloorY, p1[2], p2[0], baseFloorY, p2[2])
      const wallColor = isOcean ? new THREE.Color('#081f33') : new THREE.Color('#1f2620')
      for (let i = 0; i < 6; i++) skirtColors.push(wallColor.r, wallColor.g, wallColor.b)
    }

    // 4 edges
    for (let c = 0; c < res - 1; c++) {
      const idx1 = c, idx2 = c + 1
      addWallSegment([positions[idx1 * 3], positions[idx1 * 3 + 1], positions[idx1 * 3 + 2]], [positions[idx2 * 3], positions[idx2 * 3 + 1], positions[idx2 * 3 + 2]], (elevGrid?.[idx1] ?? -1) < 0)
    }
    for (let c = 0; c < res - 1; c++) {
      const idx1 = (res - 1) * res + c, idx2 = (res - 1) * res + c + 1
      addWallSegment([positions[idx2 * 3], positions[idx2 * 3 + 1], positions[idx2 * 3 + 2]], [positions[idx1 * 3], positions[idx1 * 3 + 1], positions[idx1 * 3 + 2]], (elevGrid?.[idx1] ?? -1) < 0)
    }
    for (let r = 0; r < res - 1; r++) {
      const idx1 = r * res, idx2 = (r + 1) * res
      addWallSegment([positions[idx2 * 3], positions[idx2 * 3 + 1], positions[idx2 * 3 + 2]], [positions[idx1 * 3], positions[idx1 * 3 + 1], positions[idx1 * 3 + 2]], (elevGrid?.[idx1] ?? -1) < 0)
    }
    for (let r = 0; r < res - 1; r++) {
      const idx1 = r * res + (res - 1), idx2 = (r + 1) * res + (res - 1)
      addWallSegment([positions[idx1 * 3], positions[idx1 * 3 + 1], positions[idx1 * 3 + 2]], [positions[idx2 * 3], positions[idx2 * 3 + 1], positions[idx2 * 3 + 2]], (elevGrid?.[idx1] ?? -1) < 0)
    }

    const sGeom = new THREE.BufferGeometry()
    sGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(skirtPos), 3))
    sGeom.setAttribute('color', new THREE.BufferAttribute(new Float32Array(skirtColors), 3))
    sGeom.computeVertexNormals()

    // Marching Squares Vector Coastline & Topographic Contours
    let cGeom: THREE.BufferGeometry | null = null
    let contGeom: THREE.BufferGeometry | null = null

    if (terrainData) {
      const { min_lat: minLat, max_lat: maxLat, min_lon: minLon, max_lon: maxLon } = terrainData.bounds
      const grid = terrainData.elevation_grid

      const buildSegments = (segs: [number, number][][], isoElev: number) => {
        const pts: number[] = []
        for (const [p1, p2] of segs) {
          const u1 = (p1[1] - minLon) / (maxLon - minLon)
          const v1 = (p1[0] - minLat) / (maxLat - minLat)
          const x1 = (u1 - 0.5) * size
          const z1 = (0.5 - v1) * size
          const y1 = isoElev >= 0 ? -18.0 + Math.min(1.0, isoElev / 1800.0) * 24.0 + 0.12 : -18.0 - Math.min(1.0, -isoElev / 4500.0) * 14.0 + 0.12

          const u2 = (p2[1] - minLon) / (maxLon - minLon)
          const v2 = (p2[0] - minLat) / (maxLat - minLat)
          const x2 = (u2 - 0.5) * size
          const z2 = (0.5 - v2) * size
          const y2 = isoElev >= 0 ? -18.0 + Math.min(1.0, isoElev / 1800.0) * 24.0 + 0.12 : -18.0 - Math.min(1.0, -isoElev / 4500.0) * 14.0 + 0.12

          pts.push(x1, y1, z1, x2, y2, z2)
        }
        const g = new THREE.BufferGeometry()
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3))
        return g
      }

      // Coastline (Z = 0)
      const coastSegs = extractClientIsolineSegments(grid, res, minLat, maxLat, minLon, maxLon, 0)
      if (coastSegs.length > 0) cGeom = buildSegments(coastSegs, 0)

      // Topo & Bathy Contours (e.g. 150m and -200m shelf break)
      const shelfSegs = extractClientIsolineSegments(grid, res, minLat, maxLat, minLon, maxLon, -200)
      const topoSegs = extractClientIsolineSegments(grid, res, minLat, maxLat, minLon, maxLon, 250)
      const combined = [...shelfSegs, ...topoSegs]
      if (combined.length > 0) contGeom = buildSegments(combined, 100)
    }

    return { terrainGeometry: tGeom, skirtGeometry: sGeom, coastlineGeom: cGeom, contourGeom: contGeom }
  }, [terrainData])

  return (
    <group position={[0, 0, 0]}>
      {/* Authentic NOAA ETOPO 2022 Seabed & Land Relief Mesh */}
      <mesh geometry={terrainGeometry}>
        <meshStandardMaterial vertexColors roughness={0.88} metalness={0.08} />
      </mesh>

      {/* Side Pedestal Walls */}
      <mesh geometry={skirtGeometry}>
        <meshStandardMaterial vertexColors roughness={0.95} metalness={0} />
      </mesh>

      {/* Vector Coastline Shoreline (Z = 0 contour) */}
      {coastlineGeom && (
        <lineSegments geometry={coastlineGeom}>
          <lineBasicMaterial color="#ffe600" linewidth={2.5} />
        </lineSegments>
      )}

      {/* Topographic & Bathymetric Contours */}
      {contourGeom && (
        <lineSegments geometry={contourGeom}>
          <lineBasicMaterial color="#00f2fe" transparent opacity={0.65} linewidth={1} />
        </lineSegments>
      )}
    </group>
  )
}

function OceanSurface() {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
        uniforms: { time: { value: 0 } },
        vertexShader: `
          uniform float time;
          varying vec2 vUv;
          void main() {
            vUv = uv;
            vec3 p = position;
            p.z += sin(p.x * 0.08 + time * 0.8) * 0.35;
            p.y += sin(p.x * 0.06 + p.z * 0.08 + time) * 0.22;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
          }
        `,
        fragmentShader: `
          varying vec2 vUv;
          void main() {
            float lines = sin(vUv.x * 140.0) * 0.5 + 0.5;
            vec3 c = mix(vec3(0.01, 0.15, 0.22), vec3(0.08, 0.54, 0.68), vUv.y) * (0.7 + lines * 0.12);
            gl_FragColor = vec4(c, 0.48);
          }
        `,
      }),
    []
  )

  useFrame(({ clock }) => {
    material.uniforms.time.value = clock.getElapsedTime()
  })

  return (
    <mesh position={[0, 8, 0]} rotation={[-Math.PI / 2, 0, 0]} material={material}>
      <planeGeometry args={[300, 300, 48, 48]} />
    </mesh>
  )
}

function WaterParticles() {
  const ref = useRef<THREE.Points>(null)
  const positions = useMemo(() => {
    const data = new Float32Array(800 * 3)
    for (let i = 0; i < 800; i += 1) {
      data[i * 3] = ((i * 37) % 220) - 110
      data[i * 3 + 1] = ((i * 73) % 45) - 34
      data[i * 3 + 2] = ((i * 97) % 220) - 110
    }
    return data
  }, [])

  useFrame(({ clock }) => {
    if (ref.current) ref.current.position.y = Math.sin(clock.getElapsedTime() * 0.12) * 0.6
  })

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        color="#9beeff"
        size={0.10}
        sizeAttenuation
        transparent
        opacity={0.38}
        depthWrite={false}
      />
    </points>
  )
}


/**
 * Procedural 3D low-poly pelagic fish geometry (sardine / mackerel / tuna shape).
 */
function createFishGeometry(): THREE.BufferGeometry {
  const geom = new THREE.BufferGeometry()
  const vertices = new Float32Array([
    // Head / Snout
    0.0, 0.0, 0.45,
    0.08, 0.06, 0.15,
    -0.08, 0.06, 0.15,
    0.0, -0.06, 0.15,
    // Mid-body / Belly
    0.10, 0.08, -0.15,
    -0.10, 0.08, -0.15,
    0.0, -0.08, -0.15,
    // Tail peduncle
    0.02, 0.03, -0.42,
    -0.02, 0.03, -0.42,
    0.0, -0.03, -0.42,
    // Tail fin (Caudal)
    0.0, 0.18, -0.65,
    0.0, -0.18, -0.65,
    0.0, 0.0, -0.52,
    // Dorsal fin
    0.0, 0.22, -0.08,
  ])

  const indices = [
    0, 1, 2,  0, 2, 3,  0, 3, 1, // Snout
    1, 4, 5,  1, 5, 2,  2, 5, 6,  2, 6, 3,  3, 6, 4,  3, 4, 1, // Torso
    4, 7, 8,  4, 8, 5,  5, 8, 9,  5, 9, 6,  6, 9, 7,  6, 7, 4, // Rear body
    7, 10, 12, 7, 12, 9,  9, 12, 11, 8, 10, 12, 8, 12, 9, 9, 11, 12, // Caudal fin
    4, 13, 1, 5, 13, 2, // Dorsal fin
  ]

  geom.setAttribute('position', new THREE.BufferAttribute(vertices, 3))
  geom.setIndex(indices)
  geom.computeVertexNormals()
  return geom
}

const TOTAL_MAX_FISH = 1500

/**
 * High-Performance Instanced Fish Flocking & Baitball Simulation Engine.
 * Modulates between dense swirling baitball vortices (1,200 to 1,500 fish) in rich chlorophyll upwelling hotspots (>1.4 mg/m3)
 * and sparse solitary fish in oligotrophic ocean deserts (<0.2 mg/m3).
 * Uses direct column-major TypedArray matrix writes for ultra-fluid 60 FPS performance with zero heap allocation.
 */
function FishSchools({
  chlorophyll,
  diverPositionRef,
}: {
  chlorophyll: number
  diverPositionRef?: React.RefObject<THREE.Vector3>
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const fishGeom = useMemo(() => createFishGeometry(), [])
  
  // Calculate dynamic active fish count and behavior based on local chlorophyll
  const biomass = useMemo(() => computeMarineBiomass(chlorophyll), [chlorophyll])
  const activeCount = Math.min(TOTAL_MAX_FISH, biomass.estimated_fish_count)
  const isBaitball = biomass.school_activity === 'Swarming Baitball' || biomass.school_activity === 'Feeding Frenzy'
  const prevCountRef = useRef(0)

  // 8 dynamic school centroid orbits across multiple depths and radii
  const schoolCentroids = useMemo(() => [
    { pos: new THREE.Vector3(-12, -4, 25), radius: 15, speed: 1.05, phase: 0.0, tilt: 0.25 },
    { pos: new THREE.Vector3(18, -6, 12), radius: 18, speed: 1.15, phase: 1.8, tilt: -0.35 },
    { pos: new THREE.Vector3(-22, -9, -15), radius: 16, speed: 0.85, phase: 3.4, tilt: 0.15 },
    { pos: new THREE.Vector3(8, -2, -28), radius: 20, speed: 1.05, phase: 4.9, tilt: -0.20 },
    { pos: new THREE.Vector3(0, -6, 0), radius: 13, speed: 1.40, phase: 0.8, tilt: 0.45 },
    { pos: new THREE.Vector3(26, -11, -8), radius: 22, speed: 0.80, phase: 2.6, tilt: 0.10 },
    { pos: new THREE.Vector3(-6, -2.5, 10), radius: 11, speed: 1.25, phase: 1.2, tilt: 0.30 },
    { pos: new THREE.Vector3(14, -13, 20), radius: 19, speed: 0.90, phase: 5.2, tilt: -0.15 },
  ], [])

  // Individual fish randomized local parameters
  const fishParams = useMemo(() => {
    return Array.from({ length: TOTAL_MAX_FISH }, (_, i) => {
      const schoolIdx = i % 8
      return {
        schoolIdx,
        relRadius: 0.8 + Math.random() * 9.5,
        orbitSpeed: 0.75 + Math.random() * 0.55,
        phaseOffset: Math.random() * Math.PI * 2.0,
        yOffset: (Math.random() - 0.5) * 6.5,
        yFreq: 0.4 + Math.random() * 0.8,
        scale: 0.65 + Math.random() * 0.55,
        vortexTightness: 0.5 + Math.random() * 0.8,
      }
    })
  }, [])

  // Instanced mesh per-fish color ramp (silver-blue bellies to emerald/amber backs)
  useEffect(() => {
    if (!meshRef.current) return
    const mesh = meshRef.current
    const cEmerald = new THREE.Color('#34d399')
    const cSilver = new THREE.Color('#94a3b8')
    const cAmber = new THREE.Color('#fbbf24')
    const cCyan = new THREE.Color('#38bdf8')

    for (let i = 0; i < TOTAL_MAX_FISH; i++) {
      const color = new THREE.Color()
      const p = i / TOTAL_MAX_FISH
      if (p < 0.4) {
        color.lerpColors(cSilver, cCyan, p / 0.4)
      } else if (p < 0.8) {
        color.lerpColors(cCyan, cEmerald, (p - 0.4) / 0.4)
      } else {
        color.lerpColors(cEmerald, cAmber, (p - 0.8) / 0.2)
      }
      mesh.setColorAt(i, color)
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }, [])

  useFrame(({ clock }) => {
    if (!meshRef.current) return
    const t = clock.getElapsedTime()
    const mesh = meshRef.current
    const array = mesh.instanceMatrix.array as Float32Array

    // If active count decreased, zero out the inactive instances
    if (prevCountRef.current > activeCount) {
      for (let i = activeCount; i < TOTAL_MAX_FISH; i++) {
        const off = i * 16
        array[off + 0] = 0; array[off + 1] = 0; array[off + 2] = 0; array[off + 3] = 0;
        array[off + 4] = 0; array[off + 5] = 0; array[off + 6] = 0; array[off + 7] = 0;
        array[off + 8] = 0; array[off + 9] = 0; array[off + 10] = 0; array[off + 11] = 0;
        array[off + 12] = 0; array[off + 13] = -999; array[off + 14] = 0; array[off + 15] = 1;
      }
    }
    prevCountRef.current = activeCount

    const diverPos = diverPositionRef?.current
    const diverX = diverPos ? diverPos.x : 0
    const diverY = diverPos ? diverPos.y : 0
    const diverZ = diverPos ? diverPos.z : 0

    // Direct JIT-optimized loop over all active fish (up to 1,500)
    for (let i = 0; i < activeCount; i++) {
      const p = fishParams[i]
      const school = schoolCentroids[p.schoolIdx]

      let x = 0, y = 0, z = 0
      let forwardX = 0, forwardZ = 0

      if (isBaitball) {
        // Hyper-dense swirling baitball vortex physics
        const baitballSpeed = (1.2 + chlorophyll * 0.45) * p.orbitSpeed
        const vortexAngle = t * baitballSpeed + p.phaseOffset
        const r = (p.relRadius * 0.55 * p.vortexTightness) + Math.sin(t * 1.2 + p.phaseOffset) * 0.6
        const vortexY = school.pos.y + Math.sin(t * p.yFreq + p.phaseOffset * 2.0) * 3.5 + Math.cos(vortexAngle * 0.5) * 1.8

        x = school.pos.x + Math.cos(vortexAngle) * r
        y = vortexY
        z = school.pos.z + Math.sin(vortexAngle) * r

        forwardX = -Math.sin(vortexAngle)
        forwardZ = Math.cos(vortexAngle)
      } else {
        // Wide-roaming foraging shoals
        const angle = t * school.speed * p.orbitSpeed * 0.45 + p.phaseOffset
        const r = school.radius + p.relRadius
        x = school.pos.x + Math.cos(angle) * r
        y = school.pos.y + p.yOffset + Math.sin(t * p.yFreq + p.phaseOffset) * 1.5
        z = school.pos.z + Math.sin(angle) * r * (1.0 + school.tilt)

        forwardX = -Math.sin(angle)
        forwardZ = Math.cos(angle)
      }

      // Zero-allocation diver repulsion
      if (diverPos) {
        const dx = x - diverX
        const dy = y - diverY
        const dz = z - diverZ
        const distSq = dx * dx + dy * dy + dz * dz
        if (distSq < 100.0 && distSq > 0.001) {
          const dist = Math.sqrt(distSq)
          const force = (10.0 - dist) * 0.85
          const invDist = force / dist
          x += dx * invDist
          y += dy * invDist * 0.5
          z += dz * invDist
          forwardX += dx * 0.4
          forwardZ += dz * 0.4
        }
      }

      // Heading rotation + harmonic tail waggle
      const heading = Math.atan2(forwardX, forwardZ)
      const tailWag = Math.sin(t * 8.5 + p.phaseOffset) * 0.08
      const totalAngle = heading + tailWag
      const s = p.scale * (isBaitball ? 1.05 : 0.95)

      const cosH = Math.cos(totalAngle) * s
      const sinH = Math.sin(totalAngle) * s
      const off = i * 16

      // Write column-major matrix directly to TypedArray
      // Column 0
      array[off + 0] = cosH
      array[off + 1] = 0
      array[off + 2] = -sinH
      array[off + 3] = 0

      // Column 1
      array[off + 4] = 0
      array[off + 5] = s
      array[off + 6] = 0
      array[off + 7] = 0

      // Column 2
      array[off + 8] = sinH
      array[off + 9] = 0
      array[off + 10] = cosH
      array[off + 11] = 0

      // Column 3 (Position)
      array[off + 12] = x
      array[off + 13] = y
      array[off + 14] = z
      array[off + 15] = 1
    }

    mesh.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh
      ref={meshRef}
      args={[fishGeom, undefined, TOTAL_MAX_FISH]}
      frustumCulled={false}
    >
      <meshStandardMaterial
        color="#ffffff"
        roughness={0.25}
        metalness={0.82}
        envMapIntensity={1.4}
      />
    </instancedMesh>
  )
}

const BLOOM_PARTICLE_COUNT = 450

/**
 * High-Performance GPU-Driven Phytoplankton Micro-Algae Bloom Motes.
 * Movement and scattering are 100% computed in GPU vertex shaders with zero CPU buffer transfer.
 */
function PhytoplanktonBloom({ chlorophyll }: { chlorophyll: number }) {
  const pointsRef = useRef<THREE.Points>(null)

  const [positions, scales, phases] = useMemo(() => {
    const pos = new Float32Array(BLOOM_PARTICLE_COUNT * 3)
    const sc = new Float32Array(BLOOM_PARTICLE_COUNT)
    const ph = new Float32Array(BLOOM_PARTICLE_COUNT)
    for (let i = 0; i < BLOOM_PARTICLE_COUNT; i++) {
      pos[i * 3 + 0] = (Math.random() - 0.5) * 110
      pos[i * 3 + 1] = -16.0 + Math.random() * 24.0
      pos[i * 3 + 2] = (Math.random() - 0.5) * 110
      sc[i] = 0.5 + Math.random() * 1.2
      ph[i] = Math.random() * Math.PI * 2.0
    }
    return [pos, sc, ph]
  }, [])

  const bloomColor = useMemo(() => {
    if (chlorophyll > 1.2) return new THREE.Color('#34d399')
    if (chlorophyll > 0.5) return new THREE.Color('#6ee7b7')
    return new THREE.Color('#a7f3d0')
  }, [chlorophyll])

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uTime: { value: 0 },
          uChl: { value: chlorophyll },
          uColor: { value: bloomColor },
          uOpacity: { value: chlorophyll > 1.0 ? 0.85 : 0.45 },
        },
        vertexShader: `
          uniform float uTime;
          uniform float uChl;
          attribute float aPhase;
          attribute float aScale;
          void main() {
            vec3 p = position;
            p.y += sin(uTime * 0.4 + aPhase) * 0.75 - 0.15;
            p.x += cos(uTime * 0.25 + aPhase * 0.6) * 0.5;
            p.z += sin(uTime * 0.3 + aPhase * 1.2) * 0.5;
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            float sizeFactor = (0.7 + clamp(uChl, 0.2, 3.0) * 0.4) * aScale;
            gl_PointSize = sizeFactor * (16.0 / max(1.0, -mv.z));
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: `
          uniform vec3 uColor;
          uniform float uOpacity;
          void main() {
            float d = length(gl_PointCoord - vec2(0.5));
            if (d > 0.5) discard;
            float alpha = smoothstep(0.5, 0.05, d) * uOpacity;
            gl_FragColor = vec4(uColor, alpha);
          }
        `,
      }),
    [bloomColor, chlorophyll]
  )

  useFrame(({ clock }) => {
    material.uniforms.uTime.value = clock.getElapsedTime()
    material.uniforms.uChl.value = chlorophyll
  })

  return (
    <points ref={pointsRef} material={material}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-aScale" args={[scales, 1]} />
        <bufferAttribute attach="attributes-aPhase" args={[phases, 1]} />
      </bufferGeometry>
    </points>
  )
}

function RegionalSeabedFeatures({ profile }: { profile: RegionalDiveProfile; selection: Selection }) {
  return (
    <group>
      {profile.terrainType === 'mid_ocean_ridge' && (
        <group>
          {[-15, 0, 18].map((x, i) => (
            <group key={i} position={[x, -16.5, -20 + i * 14]}>
              <pointLight color="#f97316" intensity={3.5} distance={22} />
              <mesh>
                <coneGeometry args={[1.4, 4.5, 8]} />
                <meshStandardMaterial color="#292524" roughness={0.9} />
              </mesh>
            </group>
          ))}
        </group>
      )}

      {profile.terrainType === 'coral_atoll' && (
        <group>
          {[[-20, -18, -15], [30, -22, 25], [-10, -20, 35]].map((p, i) => (
            <group key={i} position={p as [number, number, number]}>
              <pointLight color="#06b6d4" intensity={2.2} distance={25} />
              <mesh>
                <sphereGeometry args={[0.8, 12, 12]} />
                <meshBasicMaterial color="#38bdf8" />
              </mesh>
            </group>
          ))}
        </group>
      )}
    </group>
  )
}

function Diver({
  selection,
  timeIndex,
  diverPosRef,
  onTelemetry,
}: {
  selection: Selection
  timeIndex: number
  diverPosRef: React.RefObject<THREE.Vector3>
  onTelemetry: (telemetry: DiveTelemetry) => void
}) {
  const { camera } = useThree()
  const keys = useRef<Record<string, boolean>>({})
  const lastTelemetry = useRef(0)

  useEffect(() => {
    const update = (event: KeyboardEvent, state: boolean) => {
      keys.current[event.key.toLowerCase()] = state
    }
    const down = (event: KeyboardEvent) => update(event, true)
    const up = (event: KeyboardEvent) => update(event, false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  useFrame((state, delta) => {
    const speed = keys.current.shift ? 18 : 9
    const forward = new THREE.Vector3()
    camera.getWorldDirection(forward)
    forward.y = 0
    forward.normalize()
    const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize()

    if (keys.current.w) camera.position.addScaledVector(forward, speed * delta)
    if (keys.current.s) camera.position.addScaledVector(forward, -speed * delta)
    if (keys.current.a) camera.position.addScaledVector(right, -speed * delta)
    if (keys.current.d) camera.position.addScaledVector(right, speed * delta)
    if (keys.current.arrowup) camera.position.y += speed * delta
    if (keys.current.arrowdown) camera.position.y -= speed * delta

    camera.position.x = THREE.MathUtils.clamp(camera.position.x, -worldLimit, worldLimit)
    camera.position.z = THREE.MathUtils.clamp(camera.position.z, -worldLimit, worldLimit)
    camera.position.y = THREE.MathUtils.clamp(camera.position.y, -17, 7.5)

    // Direct mutable reference update with ZERO React re-renders!
    if (diverPosRef.current) {
      diverPosRef.current.copy(camera.position)
    }

    // Throttled smooth telemetry updates using fast synchronous subgrid engine
    if (state.clock.elapsedTime - lastTelemetry.current > 0.35) {
      lastTelemetry.current = state.clock.elapsedTime
      const profile = getRegionalDiveProfile(selection.latitude, selection.longitude, timeIndex)
      const depth = Math.round(Math.max(0, 8 - camera.position.y) * (profile.seabedDepth / 22.0))

      const localData = getSubgridLocalEstimate(selection.latitude, selection.longitude, depth, timeIndex * 25)
      onTelemetry({
        depth,
        temperature: localData.temperature_c,
        salinity: localData.salinity_psu,
        chlorophyll: localData.chlorophyll_mg_m3,
        currentSpeed: localData.current_speed_m_s,
        currentU: localData.current_vector.u,
        currentV: localData.current_vector.v,
        temperatureProfile: localData.ctd_profile?.temperatures || [],
        biomass: localData.marine_biomass || computeMarineBiomass(localData.chlorophyll_mg_m3, depth),
        regionalProfile: profile,
      })
    }
  })

  return null
}

function TemperatureField({
  temperature,
  currentDepth,
  temperatureProfile,
}: {
  temperature: number
  currentDepth: number
  temperatureProfile: number[]
}) {
  if (!temperatureProfile.length) {
    return null
  }

  return (
    <ThermalField
      temperature={temperature}
      currentDepth={currentDepth}
      temperatureProfile={temperatureProfile}
    />
  )
}

const PROFILE_DEPTHS = [
  0, 10, 25, 50, 75, 100, 150, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000,
]

function interpolateProfile(
  depths: number[],
  temperatures: number[],
  depth: number
) {
  if (!temperatures.length) return 0
  if (depth <= depths[0]) return temperatures[0]
  const last = temperatures.length - 1
  if (depth >= depths[last]) return temperatures[last]

  for (let i = 0; i < last; i += 1) {
    if (depth >= depths[i] && depth <= depths[i + 1]) {
      const t = (depth - depths[i]) / (depths[i + 1] - depths[i])
      return THREE.MathUtils.lerp(temperatures[i], temperatures[i + 1], t)
    }
  }
  return temperatures[last]
}

function ThermalField({
  temperature,
  currentDepth,
  temperatureProfile,
}: {
  temperature: number
  currentDepth: number
  temperatureProfile: number[]
}) {
  const materialRef = useRef<THREE.ShaderMaterial>(null)
  const fieldRef = useRef<THREE.Mesh>(null)
  const { camera } = useThree()

  const profile = useMemo(() => {
    const values = new Array(32).fill(0)
    if (!temperatureProfile.length) return values

    for (let i = 0; i < values.length; i += 1) {
      const t = i / (values.length - 1)
      const depth = t * 5000
      values[i] = interpolateProfile(PROFILE_DEPTHS, temperatureProfile, depth)
    }
    return values
  }, [temperatureProfile])

  const uniforms = useMemo(() => {
    return {
      time: { value: 0 },
      temperature: { value: temperature },
      currentDepth: { value: currentDepth },
      profile: { value: profile },
    }
  }, [temperature, currentDepth, profile])

  useFrame(({ clock }) => {
    if (!materialRef.current || !fieldRef.current) return
    fieldRef.current.position.copy(camera.position)
    materialRef.current.uniforms.time.value = clock.getElapsedTime()
    materialRef.current.uniforms.temperature.value = temperature
    materialRef.current.uniforms.currentDepth.value = currentDepth
    materialRef.current.uniforms.profile.value = profile
  })

  return (
    <mesh ref={fieldRef} scale={[1, 0.7, 1]}>
      <sphereGeometry args={[45, 24, 16]} />
      <shaderMaterial
        ref={materialRef}
        transparent
        depthWrite={false}
        depthTest={false}
        blending={THREE.AdditiveBlending}
        side={THREE.BackSide}
        uniforms={uniforms}
        vertexShader={`
          varying vec3 vLocalPosition;
          void main() {
            vLocalPosition = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `}
        fragmentShader={`
          uniform float time;
          uniform float temperature;
          uniform float currentDepth;
          uniform float profile[32];
          varying vec3 vLocalPosition;

          float hash(vec3 p) {
            p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
            p *= 17.0;
            return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
          }

          float simpleNoise(vec3 p) {
            vec3 i = floor(p);
            vec3 f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            float a = hash(i);
            float b = hash(i + vec3(1.0, 0.0, 0.0));
            float c = hash(i + vec3(0.0, 1.0, 0.0));
            float d = hash(i + vec3(1.0, 1.0, 0.0));
            float e = hash(i + vec3(0.0, 0.0, 1.0));
            float f1 = hash(i + vec3(1.0, 0.0, 1.0));
            float g = hash(i + vec3(0.0, 1.0, 1.0));
            float h = hash(i + vec3(1.0, 1.0, 1.0));
            return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y), mix(mix(e, f1, f.x), mix(g, h, f.x), f.y), f.z);
          }

          float fastTurbulence(vec3 p) {
            return simpleNoise(p) * 0.7 + simpleNoise(p * 2.2) * 0.3;
          }

          vec3 temperatureColor(float t) {
            vec3 cold   = vec3(0.005, 0.12, 0.55);
            vec3 blue   = vec3(0.01, 0.35, 0.80);
            vec3 cyan   = vec3(0.02, 0.72, 0.88);
            vec3 yellow = vec3(1.00, 0.80, 0.18);
            vec3 orange = vec3(1.00, 0.25, 0.02);

            if (t < 0.25) return mix(cold, blue, smoothstep(0.0, 0.25, t));
            if (t < 0.55) return mix(blue, cyan, smoothstep(0.25, 0.55, t));
            if (t < 0.8) return mix(cyan, yellow, smoothstep(0.55, 0.8, t));
            return mix(yellow, orange, smoothstep(0.8, 1.0, t));
          }

          float profileTemperature(float normalizedDepth) {
            float scaled = clamp(normalizedDepth, 0.0, 0.999) * 31.0;
            float a = floor(scaled);
            float b = min(a + 1.0, 31.0);
            float f = scaled - a;
            return mix(profile[int(a)], profile[int(b)], f);
          }

          void main() {
            vec3 rayEnd = vLocalPosition;
            float rayLength = length(rayEnd);
            if (rayLength < 0.1) discard;
            vec3 rayDirection = normalize(rayEnd);

            const int STEPS = 14;
            vec3 accumulatedColor = vec3(0.0);
            float accumulatedAlpha = 0.0;

            for (int i = 0; i < STEPS; i++) {
              float fi = (float(i) + 0.5) / float(STEPS);
              vec3 p = rayDirection * rayLength * fi;
              float localDepth = max(0.0, currentDepth - p.y * 92.0);
              float normalizedDepth = clamp(localDepth / 5000.0, 0.0, 1.0);

              float temp = profileTemperature(normalizedDepth);
              float normalizedTemperature = clamp((temp - 2.0) / 26.0, 0.0, 1.0);

              vec3 flowPos = vec3(p.x * 0.045 + time * 0.018, p.y * 0.12, p.z * 0.045 - time * 0.012);
              float structure = fastTurbulence(flowPos);

              float tempA = profileTemperature(clamp(normalizedDepth - 0.025, 0.0, 1.0));
              float tempB = profileTemperature(clamp(normalizedDepth + 0.025, 0.0, 1.0));
              float thermocline = smoothstep(0.015, 0.10, abs(tempA - tempB));

              float thermalLayer = structure * (0.10 + thermocline * 0.95) * thermocline;
              float shimmer = 0.85 + 0.15 * sin(time * 1.4 + p.x * 2.0 + p.z * 1.7);

              float radialDist = length(p.xz);
              float spatialFalloff = 1.0 - smoothstep(18.0, 65.0, radialDist);
              float depthFalloff = 1.0 - smoothstep(22.0, 60.0, abs(p.y));

              float density = thermalLayer * (0.45 + thermocline * 1.25) * shimmer * spatialFalloff * depthFalloff;
              vec3 color = temperatureColor(normalizedTemperature);

              float sampleAlpha = clamp(density * 0.06, 0.0, 0.09);
              float remaining = 1.0 - accumulatedAlpha;
              accumulatedColor += color * sampleAlpha * remaining;
              accumulatedAlpha += sampleAlpha * remaining;

              if (accumulatedAlpha > 0.82) break;
            }

            if (accumulatedAlpha < 0.004) discard;
            gl_FragColor = vec4(accumulatedColor, accumulatedAlpha);
          }
        `}
      />
    </mesh>
  )
}

function DiveWorld({
  variable,
  selection,
  boundary,
  timeIndex,
  onTelemetry,
  onExit,
}: Props) {
  // Mutable diver position reference for ZERO-overhead 60 FPS fish interaction
  const diverPosRef = useRef<THREE.Vector3>(new THREE.Vector3(0, 3, 55))

  const profile = useMemo(
    () => getRegionalDiveProfile(selection.latitude, selection.longitude, timeIndex),
    [selection.latitude, selection.longitude, timeIndex]
  )

  const [telemetry, setTelemetry] = useState<DiveTelemetry>(() => ({
    depth: 24,
    temperature: 28.5,
    salinity: 35.2,
    chlorophyll: profile.chlorophyll,
    currentSpeed: 0.45,
    currentU: 0.3,
    currentV: 0.2,
    temperatureProfile: [28.5, 28.2, 27.8, 26.5, 24.0, 20.5, 16.2, 12.0, 8.5, 5.2, 3.8, 2.5, 2.0, 1.8, 1.5, 1.2],
    biomass: profile.biomass,
    regionalProfile: profile,
  }))

  const handleTelemetry = (next: DiveTelemetry) => {
    setTelemetry(next)
    onTelemetry(next)
  }

  return (
    <>
      <color attach="background" args={[profile.fogColor]} />
      <fog attach="fog" args={[profile.fogColor, 14, 155]} />

      <ambientLight
        intensity={1.65}
        color={profile.ambientColor}
      />

      <directionalLight
        position={[0, 17, 20]}
        intensity={4.5}
        color="#b9fbff"
      />

      <pointLight
        position={[0, -4, 2]}
        intensity={2.4}
        color={profile.ambientColor}
        distance={75}
      />

      <OceanSurface />

      <Terrain selection={selection} boundary={boundary} />

      <RegionalSeabedFeatures profile={profile} selection={selection} />

      {/* High-Performance GPU Phytoplankton Motes */}
      <PhytoplanktonBloom chlorophyll={telemetry.chlorophyll || profile.chlorophyll} />

      {/* 360-Instanced High-Speed Fish Flocking Baitball Simulation */}
      <FishSchools
        chlorophyll={telemetry.chlorophyll || profile.chlorophyll}
        diverPositionRef={diverPosRef}
      />

      {/* Optimized Volumetric Thermal Stratification Raymarching */}
      {variable === 'temperature' && (
        <TemperatureField
          temperature={telemetry.temperature}
          currentDepth={telemetry.depth}
          temperatureProfile={telemetry.temperatureProfile}
        />
      )}

      <WaterParticles />

      <Stars
        radius={180}
        depth={80}
        count={600}
        factor={1}
        saturation={0}
        fade
        speed={0.2}
      />

      <Diver
        selection={selection}
        timeIndex={timeIndex}
        diverPosRef={diverPosRef}
        onTelemetry={handleTelemetry}
      />

      <PointerLockControls />
    </>
  )
}

export default function ImmersiveOcean(props: Props) {
  return (
    <Canvas
      camera={{ position: [0, 3, 55], fov: 64, near: 0.1, far: 400 }}
      dpr={[1, 1.5]}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
    >
      <Suspense
        fallback={
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'grid',
              placeItems: 'center',
              color: '#9beeff',
              background: '#06384d',
              fontFamily: 'sans-serif',
            }}
          >
            Loading Ocean Dive…
          </div>
        }
      >
        <DiveWorld {...props} />
      </Suspense>
    </Canvas>
  )
}
