/**
 * DeepDiveBlock — Scientifically Authentic 3D Topographic & Bathymetric Digital Twin Block.
 *
 * Visualizes a regional geographic slice with:
 * - Real NOAA ETOPO 2022 elevations & bathymetry (native 0.25° grid resampled to 96×96 vertices).
 * - Correct geographic cartography: North is -Z (forward/up), South is +Z (near/down), West is -X, East is +X.
 * - Upward-facing surface normals (+Y) ensuring proper lighting across topography and seabed.
 * - ETOPO-derived coastline boundary (Z = 0) and continental shelf break (-200m).
 * - Genuine vector contour lines (topographic isohypses and bathymetric isobaths) via marching squares.
 * - Water surface strictly clipped to ocean cells.
 * - Full WSAD underwater swimming and Up/Down Arrow depth navigation with real-time telemetry HUD.
 * - Physical invariance: vertical exaggeration affects visualization geometry only; reported meters remain exact.
 */
import { OrbitControls } from '@react-three/drei'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type { OceanPointProfile, SpatialBoundary, TerrainSliceData } from './types'
import {
  fetchTerrainSlice,
  fetchOceanPointProfile,
  extractClientIsolineSegments,
} from './oceanDataEngine'

interface DeepDiveBlockProps {
  boundary: SpatialBoundary
  monthIndex?: number
  onExit: () => void
}

const BLOCK_SIZE = 80.0
const BASE_ELEVATION_SCALE = 0.0055 // Maps meters to Three.js units (e.g. -4000m -> -22 units)

/**
 * First-Person Underwater Swimming & Depth Navigation Controller
 * WSAD: Swim forward / backward / left / right
 * ArrowUp / ArrowDown: Ascend (surface) / Descend (dive deeper)
 * Shift: Turbo boost
 */
function DiverNavigator({
  terrainData,
  verticalExaggeration,
  keysRef,
  controlsRef,
  onUpdateStats,
}: {
  terrainData: TerrainSliceData | null
  verticalExaggeration: number
  keysRef: React.MutableRefObject<Record<string, boolean>>
  controlsRef: React.MutableRefObject<any>
  onUpdateStats: (stats: { depth_m: number; altitude_m: number; lat: number; lon: number }) => void
}) {
  const { camera } = useThree()
  const lastUpdate = useRef(0)
  const lastStats = useRef({ depth_m: -999, altitude_m: -999, lat: -999, lon: -999 })

  useFrame((state, delta) => {
    const isShift = !!keysRef.current['shift']
    const speed = (isShift ? 34.0 : 16.0) * delta
    const keys = keysRef.current

    const hasMovement =
      keys['w'] || keys['s'] || keys['a'] || keys['d'] || keys['arrowup'] || keys['arrowdown']

    if (hasMovement) {
      const forward = new THREE.Vector3()
      camera.getWorldDirection(forward)
      forward.y = 0
      forward.normalize()

      const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize()
      const move = new THREE.Vector3(0, 0, 0)

      if (keys['w']) move.addScaledVector(forward, speed)
      if (keys['s']) move.addScaledVector(forward, -speed)
      if (keys['a']) move.addScaledVector(right, -speed)
      if (keys['d']) move.addScaledVector(right, speed)
      if (keys['arrowup']) move.y += speed
      if (keys['arrowdown']) move.y -= speed

      camera.position.add(move)
      if (controlsRef.current) {
        controlsRef.current.target.add(move)
      }
    }

    // Boundary limits
    const limit = BLOCK_SIZE * 0.68
    camera.position.x = THREE.MathUtils.clamp(camera.position.x, -limit, limit)
    camera.position.z = THREE.MathUtils.clamp(camera.position.z, -limit, limit)
    camera.position.y = THREE.MathUtils.clamp(camera.position.y, -65, 85)

    // Periodic telemetry update (every 120ms), with deadband to prevent excessive re-renders
    if (state.clock.elapsedTime - lastUpdate.current > 0.12 && terrainData) {
      lastUpdate.current = state.clock.elapsedTime
      const { min_lat: minLat, max_lat: maxLat, min_lon: minLon, max_lon: maxLon } = terrainData.bounds
      const physY = camera.position.y / (BASE_ELEVATION_SCALE * verticalExaggeration)
      const depth_m = physY < 0 ? Math.round(-physY) : 0
      const altitude_m = physY >= 0 ? Math.round(physY) : 0

      const u = THREE.MathUtils.clamp(camera.position.x / BLOCK_SIZE + 0.5, 0, 1)
      const v = THREE.MathUtils.clamp(0.5 - camera.position.z / BLOCK_SIZE, 0, 1)
      const lat = Number((minLat + v * (maxLat - minLat)).toFixed(2))
      const lon = Number((minLon + u * (maxLon - minLon)).toFixed(2))

      if (
        Math.abs(depth_m - lastStats.current.depth_m) > 1 ||
        Math.abs(altitude_m - lastStats.current.altitude_m) > 1 ||
        lat !== lastStats.current.lat ||
        lon !== lastStats.current.lon
      ) {
        lastStats.current = { depth_m, altitude_m, lat, lon }
        onUpdateStats({ depth_m, altitude_m, lat, lon })
      }
    }
  })

  return null
}

export default function DeepDiveBlock({
  boundary,
  monthIndex = 292,
  onExit,
}: DeepDiveBlockProps) {
  const [terrainData, setTerrainData] = useState<TerrainSliceData | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [verticalExaggeration, setVerticalExaggeration] = useState<number>(2.2)
  const [showContours, setShowContours] = useState<boolean>(true)
  const [showWater, setShowWater] = useState<boolean>(true)
  const [selectedProbe, setSelectedProbe] = useState<{
    lat: number
    lon: number
    elevation_m: number
  } | null>(null)
  const [pointProfile, setPointProfile] = useState<OceanPointProfile | null>(null)
  const [profileLoading, setProfileLoading] = useState<boolean>(false)

  // Diver swimming keyboard state & telemetry
  const keysRef = useRef<Record<string, boolean>>({})
  const [activeKeys, setActiveKeys] = useState<Record<string, boolean>>({})
  const controlsRef = useRef<any>(null)
  const [diverStats, setDiverStats] = useState<{
    depth_m: number
    altitude_m: number
    lat: number
    lon: number
  }>({
    depth_m: 0,
    altitude_m: 0,
    lat: boundary.center[0],
    lon: boundary.center[1],
  })

  // Keyboard listeners for WSAD & Arrow Keys
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase()
      if (['w', 's', 'a', 'd', 'arrowup', 'arrowdown', 'shift'].includes(key)) {
        if (key === 'arrowup' || key === 'arrowdown') {
          e.preventDefault()
        }
        keysRef.current[key] = true
        setActiveKeys((prev) => (prev[key] ? prev : { ...prev, [key]: true }))
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase()
      if (['w', 's', 'a', 'd', 'arrowup', 'arrowdown', 'shift'].includes(key)) {
        keysRef.current[key] = false
        setActiveKeys((prev) => {
          const next = { ...prev }
          delete next[key]
          return next
        })
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [])

  // 1. Fetch authentic elevation slice from NOAA ETOPO 2022
  // Stable key prevents unnecessary fetch cancel loops
  const bboxKey = boundary.bbox.join(',')
  useEffect(() => {
    let cancelled = false
    setLoading(true)

    fetchTerrainSlice(boundary.bbox, 96)
      .then((data) => {
        if (!cancelled) {
          setTerrainData(data)
          setLoading(false)
          // Default initial probe at region center
          const { min_lat: minLat, max_lat: maxLat, min_lon: minLon, max_lon: maxLon } = data.bounds
          const midLat = (minLat + maxLat) / 2
          const midLon = (minLon + maxLon) / 2
          handleProbePoint(midLat, midLon, (data.min_elevation_m + data.max_elevation_m) / 2)
        }
      })
      .catch((err) => {
        console.error('Error fetching terrain slice:', err)
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [bboxKey])

  // Explicit coordinate probing for CTD ocean profiles
  const handleProbePoint = (lat: number, lon: number, elev: number) => {
    setSelectedProbe({ lat, lon, elevation_m: elev })
    setProfileLoading(true)

    fetchOceanPointProfile(lat, lon, monthIndex)
      .then((prof) => {
        setPointProfile(prof)
        setProfileLoading(false)
      })
      .catch(() => setProfileLoading(false))
  }

  // 2. Build 3D Terrain & Bathymetry Mesh with correct geographic cartography:
  // North is -Z (forward/top of screen), South is +Z (near/bottom of screen)
  // West is -X (left of screen), East is +X (right of screen)
  // Normal winding: (a, b, d) and (b, e, d) ensures normals point UP (+Y)
  const { terrainGeometry, waterGeometry, skirtGeometry } = useMemo(() => {
    if (!terrainData) return { terrainGeometry: null, waterGeometry: null, skirtGeometry: null }

    const res = terrainData.grid_res
    const elevGrid = terrainData.elevation_grid
    const numVerts = res * res
    const positions = new Float32Array(numVerts * 3)
    const colors = new Float32Array(numVerts * 3)
    const indices: number[] = []

    const color = new THREE.Color()

    for (let r = 0; r < res; r++) {
      // r = 0 is minLat (South) -> pz = +BLOCK_SIZE/2
      // r = res - 1 is maxLat (North) -> pz = -BLOCK_SIZE/2
      const pz = (0.5 - r / (res - 1)) * BLOCK_SIZE

      for (let c = 0; c < res; c++) {
        // c = 0 is minLon (West) -> px = -BLOCK_SIZE/2
        // c = res - 1 is maxLon (East) -> px = +BLOCK_SIZE/2
        const px = (c / (res - 1) - 0.5) * BLOCK_SIZE
        const idx = r * res + c
        const elev = elevGrid[idx] // True invariant elevation in meters

        // WebGL display Y scaled by vertical exaggeration
        const py = elev * BASE_ELEVATION_SCALE * verticalExaggeration

        positions[idx * 3] = px
        positions[idx * 3 + 1] = py
        positions[idx * 3 + 2] = pz

        if (elev >= 0) {
          // Authentic Land Hypsometric Shading
          if (elev < 80) {
            color.setRGB(0.22, 0.62, 0.32) // Coastal lowlands
          } else if (elev < 400) {
            color.setRGB(0.52, 0.58, 0.28) // Foothills & plains
          } else if (elev < 1200) {
            color.setRGB(0.68, 0.52, 0.28) // Western Ghats / plateaus / ridges
          } else if (elev < 2500) {
            color.setRGB(0.76, 0.65, 0.50) // Highland peaks / rocky terrain
          } else {
            color.setRGB(0.86, 0.86, 0.88) // High peaks / granite
          }
        } else {
          // Authentic Ocean Bathymetric cmocean Shading
          const depth = -elev
          if (depth < 200) {
            // Continental shelf (sunlit turquoise / emerald-cyan)
            const t = depth / 200
            color.setRGB(0.05 + t * 0.03, 0.68 - t * 0.22, 0.76 - t * 0.12)
          } else if (depth < 1500) {
            // Continental slope (cerulean / cobalt blue)
            const t = (depth - 200) / 1300
            color.setRGB(0.08 - t * 0.04, 0.46 - t * 0.26, 0.68 - t * 0.26)
          } else if (depth < 4000) {
            // Abyssal plain (deep oceanic navy)
            const t = (depth - 1500) / 2500
            color.setRGB(0.04 - t * 0.02, 0.20 - t * 0.12, 0.42 - t * 0.18)
          } else {
            // Subduction trench (deep abyssal violet)
            color.setRGB(0.015, 0.06, 0.22)
          }
        }

        colors[idx * 3] = color.r
        colors[idx * 3 + 1] = color.g
        colors[idx * 3 + 2] = color.b
      }
    }

    // Upward-facing normal winding: (a, b, d) and (b, e, d)
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

    // 3. Water Surface (Flat plane at Sea Level Y = 0, clipped to only submerged ocean cells)
    const waterIndices: number[] = []
    for (let r = 0; r < res - 1; r++) {
      for (let c = 0; c < res - 1; c++) {
        const a = r * res + c
        const b = a + 1
        const d = (r + 1) * res + c
        const e = d + 1
        if (elevGrid[a] < 0 || elevGrid[b] < 0 || elevGrid[d] < 0 || elevGrid[e] < 0) {
          waterIndices.push(a, b, d)
          waterIndices.push(b, e, d)
        }
      }
    }

    const wPos = new Float32Array(numVerts * 3)
    for (let r = 0; r < res; r++) {
      const pz = (0.5 - r / (res - 1)) * BLOCK_SIZE
      for (let c = 0; c < res; c++) {
        const px = (c / (res - 1) - 0.5) * BLOCK_SIZE
        const idx = r * res + c
        wPos[idx * 3] = px
        wPos[idx * 3 + 1] = 0.0 // Exactly at Sea Level (Z = 0)
        wPos[idx * 3 + 2] = pz
      }
    }

    const wGeom = new THREE.BufferGeometry()
    wGeom.setAttribute('position', new THREE.BufferAttribute(wPos, 3))
    wGeom.setIndex(waterIndices)
    wGeom.computeVertexNormals()

    // 4. Geometric Framing Pedestal (Side walls dropping to base floor)
    const minZ = Math.min(-3000, terrainData.min_elevation_m)
    const baseFloorY = minZ * BASE_ELEVATION_SCALE * verticalExaggeration - 4.0

    const skirtPos: number[] = []
    const skirtColors: number[] = []

    const addWallSegment = (
      p1: [number, number, number],
      p2: [number, number, number],
      isOcean: boolean
    ) => {
      const top1 = p1
      const bot1 = [p1[0], baseFloorY, p1[2]]
      const top2 = p2
      const bot2 = [p2[0], baseFloorY, p2[2]]

      skirtPos.push(...top1, ...bot1, ...top2)
      skirtPos.push(...top2, ...bot1, ...bot2)

      const wallColor = isOcean ? new THREE.Color('#0c2e4e') : new THREE.Color('#252e3b')
      for (let i = 0; i < 6; i++) {
        skirtColors.push(wallColor.r, wallColor.g, wallColor.b)
      }
    }

    // South Wall: r = 0 (pz = +BLOCK_SIZE / 2)
    for (let c = 0; c < res - 1; c++) {
      const idx1 = c
      const idx2 = c + 1
      addWallSegment(
        [positions[idx1 * 3], positions[idx1 * 3 + 1], positions[idx1 * 3 + 2]],
        [positions[idx2 * 3], positions[idx2 * 3 + 1], positions[idx2 * 3 + 2]],
        elevGrid[idx1] < 0
      )
    }
    // North Wall: r = res - 1 (pz = -BLOCK_SIZE / 2)
    for (let c = 0; c < res - 1; c++) {
      const idx1 = (res - 1) * res + c
      const idx2 = (res - 1) * res + c + 1
      addWallSegment(
        [positions[idx2 * 3], positions[idx2 * 3 + 1], positions[idx2 * 3 + 2]],
        [positions[idx1 * 3], positions[idx1 * 3 + 1], positions[idx1 * 3 + 2]],
        elevGrid[idx1] < 0
      )
    }
    // West Wall: c = 0 (px = -BLOCK_SIZE / 2)
    for (let r = 0; r < res - 1; r++) {
      const idx1 = r * res
      const idx2 = (r + 1) * res
      addWallSegment(
        [positions[idx2 * 3], positions[idx2 * 3 + 1], positions[idx2 * 3 + 2]],
        [positions[idx1 * 3], positions[idx1 * 3 + 1], positions[idx1 * 3 + 2]],
        elevGrid[idx1] < 0
      )
    }
    // East Wall: c = res - 1 (px = +BLOCK_SIZE / 2)
    for (let r = 0; r < res - 1; r++) {
      const idx1 = r * res + (res - 1)
      const idx2 = (r + 1) * res + (res - 1)
      addWallSegment(
        [positions[idx1 * 3], positions[idx1 * 3 + 1], positions[idx1 * 3 + 2]],
        [positions[idx2 * 3], positions[idx2 * 3 + 1], positions[idx2 * 3 + 2]],
        elevGrid[idx1] < 0
      )
    }

    const sGeom = new THREE.BufferGeometry()
    sGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(skirtPos), 3))
    sGeom.setAttribute('color', new THREE.BufferAttribute(new Float32Array(skirtColors), 3))
    sGeom.computeVertexNormals()

    return { terrainGeometry: tGeom, waterGeometry: wGeom, skirtGeometry: sGeom }
  }, [terrainData, verticalExaggeration])

  // 3. Genuine Vector Contour Lines (Marching Squares Isolines)
  const {
    coastlineLineGeom,
    shelfBreakLineGeom,
    landContoursLineGeom,
    bathymetryContoursLineGeom,
  } = useMemo(() => {
    if (!terrainData || !showContours) {
      return {
        coastlineLineGeom: null,
        shelfBreakLineGeom: null,
        landContoursLineGeom: null,
        bathymetryContoursLineGeom: null,
      }
    }

    const { min_lat: minLat, max_lat: maxLat, min_lon: minLon, max_lon: maxLon } = terrainData.bounds
    const grid = terrainData.elevation_grid
    const res = terrainData.grid_res

    const buildSegmentGeometry = (segments: [number, number][][], isoElevationM: number) => {
      const linePoints: THREE.Vector3[] = []
      const py = isoElevationM * BASE_ELEVATION_SCALE * verticalExaggeration + 0.08

      segments.forEach((seg) => {
        if (seg.length >= 2) {
          const [lat1, lon1] = seg[0]
          const [lat2, lon2] = seg[1]

          const u1 = (lon1 - minLon) / (maxLon - minLon)
          const v1 = (lat1 - minLat) / (maxLat - minLat)
          const px1 = (u1 - 0.5) * BLOCK_SIZE
          const pz1 = (0.5 - v1) * BLOCK_SIZE

          const u2 = (lon2 - minLon) / (maxLon - minLon)
          const v2 = (lat2 - minLat) / (maxLat - minLat)
          const px2 = (u2 - 0.5) * BLOCK_SIZE
          const pz2 = (0.5 - v2) * BLOCK_SIZE

          linePoints.push(new THREE.Vector3(px1, py, pz1))
          linePoints.push(new THREE.Vector3(px2, py, pz2))
        }
      })

      if (linePoints.length === 0) return null
      return new THREE.BufferGeometry().setFromPoints(linePoints)
    }

    // A. Coastline Boundary (Z = 0m)
    const coastSegs =
      terrainData.coastline_segments && terrainData.coastline_segments.length > 0
        ? terrainData.coastline_segments
        : extractClientIsolineSegments(grid, res, minLat, maxLat, minLon, maxLon, 0.0)
    const cGeom = buildSegmentGeometry(coastSegs, 0.0)

    // B. Continental Shelf Break (Z = -200m)
    const shelfSegs =
      terrainData.shelf_break_segments && terrainData.shelf_break_segments.length > 0
        ? terrainData.shelf_break_segments
        : extractClientIsolineSegments(grid, res, minLat, maxLat, minLon, maxLon, -200.0)
    const sbGeom = buildSegmentGeometry(shelfSegs, -200.0)

    // C. Topographic Land Isohypses (+100m, +250m, +500m, +1000m, +1500m)
    const landLevels = [100, 250, 500, 1000, 1500].filter(
      (lvl) => lvl <= terrainData.max_elevation_m && lvl >= terrainData.min_elevation_m
    )
    const landPoints: THREE.Vector3[] = []
    landLevels.forEach((lvl) => {
      const segs = extractClientIsolineSegments(grid, res, minLat, maxLat, minLon, maxLon, lvl)
      const py = lvl * BASE_ELEVATION_SCALE * verticalExaggeration + 0.06
      segs.forEach((seg) => {
        if (seg.length >= 2) {
          const u1 = (seg[0][1] - minLon) / (maxLon - minLon)
          const v1 = (seg[0][0] - minLat) / (maxLat - minLat)
          const u2 = (seg[1][1] - minLon) / (maxLon - minLon)
          const v2 = (seg[1][0] - minLat) / (maxLat - minLat)
          landPoints.push(new THREE.Vector3((u1 - 0.5) * BLOCK_SIZE, py, (0.5 - v1) * BLOCK_SIZE))
          landPoints.push(new THREE.Vector3((u2 - 0.5) * BLOCK_SIZE, py, (0.5 - v2) * BLOCK_SIZE))
        }
      })
    })
    const lGeom = landPoints.length > 0 ? new THREE.BufferGeometry().setFromPoints(landPoints) : null

    // D. Bathymetric Isobaths (-500m, -1000m, -2000m, -3000m, -4000m)
    const oceanLevels = [-500, -1000, -2000, -3000, -4000].filter(
      (lvl) => lvl >= terrainData.min_elevation_m && lvl <= terrainData.max_elevation_m
    )
    const oceanPoints: THREE.Vector3[] = []
    oceanLevels.forEach((lvl) => {
      const segs = extractClientIsolineSegments(grid, res, minLat, maxLat, minLon, maxLon, lvl)
      const py = lvl * BASE_ELEVATION_SCALE * verticalExaggeration + 0.06
      segs.forEach((seg) => {
        if (seg.length >= 2) {
          const u1 = (seg[0][1] - minLon) / (maxLon - minLon)
          const v1 = (seg[0][0] - minLat) / (maxLat - minLat)
          const u2 = (seg[1][1] - minLon) / (maxLon - minLon)
          const v2 = (seg[1][0] - minLat) / (maxLat - minLat)
          oceanPoints.push(new THREE.Vector3((u1 - 0.5) * BLOCK_SIZE, py, (0.5 - v1) * BLOCK_SIZE))
          oceanPoints.push(new THREE.Vector3((u2 - 0.5) * BLOCK_SIZE, py, (0.5 - v2) * BLOCK_SIZE))
        }
      })
    })
    const oGeom = oceanPoints.length > 0 ? new THREE.BufferGeometry().setFromPoints(oceanPoints) : null

    return {
      coastlineLineGeom: cGeom,
      shelfBreakLineGeom: sbGeom,
      landContoursLineGeom: lGeom,
      bathymetryContoursLineGeom: oGeom,
    }
  }, [terrainData, verticalExaggeration, showContours])

  // Raycast click on terrain to probe exact geographic coordinate
  const handleTerrainClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation()
    if (!terrainData || !event.point) return

    const { min_lat, max_lat, min_lon, max_lon } = terrainData.bounds
    const p = event.point
    const u = THREE.MathUtils.clamp(p.x / BLOCK_SIZE + 0.5, 0, 1)
    const v = THREE.MathUtils.clamp(0.5 - p.z / BLOCK_SIZE, 0, 1)

    const lat = min_lat + v * (max_lat - min_lat)
    const lon = min_lon + u * (max_lon - min_lon)

    // Unscale Y to true physical meters (invariant)
    const trueElevation = Math.round(p.y / (BASE_ELEVATION_SCALE * verticalExaggeration))

    handleProbePoint(lat, lon, trueElevation)
  }

  // Calculate live water temperature for swimmer based on active CTD profile
  const currentSwimmerTemp = useMemo(() => {
    if (diverStats.depth_m <= 0) return 28.5 // Surface
    if (pointProfile && pointProfile.levels) {
      for (let i = 0; i < pointProfile.levels.length - 1; i++) {
        const l1 = pointProfile.levels[i]
        const l2 = pointProfile.levels[i + 1]
        if (diverStats.depth_m >= l1.depth_m && diverStats.depth_m <= l2.depth_m) {
          if (l1.temperature_c !== null && l2.temperature_c !== null) {
            const frac = (diverStats.depth_m - l1.depth_m) / (l2.depth_m - l1.depth_m)
            return (l1.temperature_c + frac * (l2.temperature_c - l1.temperature_c)).toFixed(1)
          }
        }
      }
    }
    // Oceanographic empirical thermal gradient fallback
    if (diverStats.depth_m < 50) return '28.2'
    if (diverStats.depth_m < 150) return '24.5'
    if (diverStats.depth_m < 300) return '16.8'
    if (diverStats.depth_m < 750) return '9.2'
    if (diverStats.depth_m < 1500) return '5.4'
    return '2.8'
  }, [diverStats.depth_m, pointProfile])

  return (
    <div className="deep-dive-container">
      {/* 3D WebGL Canvas */}
      <Canvas
        camera={{ position: [0, 42, 68], fov: 48, near: 0.5, far: 800 }}
        gl={{ antialias: true, alpha: false }}
      >
        <color attach="background" args={['#020b17']} />
        <fog attach="fog" args={['#020b17', 90, 450]} />

        <ambientLight intensity={1.8} color="#e0f7fa" />
        <directionalLight position={[40, 70, 40]} intensity={3.2} color="#ffffff" />
        <directionalLight position={[-40, 50, -40]} intensity={1.8} color="#4fc3f7" />
        <directionalLight position={[0, -40, 0]} intensity={0.6} color="#0288d1" />

        <OrbitControls
          ref={controlsRef}
          makeDefault
          enableDamping
          dampingFactor={0.06}
          maxPolarAngle={Math.PI / 2 + 0.05} // Prevent flipping underneath
          minDistance={8}
          maxDistance={240}
        />

        {/* First-Person Swimming & Depth Navigator */}
        <DiverNavigator
          terrainData={terrainData}
          verticalExaggeration={verticalExaggeration}
          keysRef={keysRef}
          controlsRef={controlsRef}
          onUpdateStats={setDiverStats}
        />

        {/* 1. Main 3D Terrain & Bathymetry Mesh */}
        {terrainGeometry && (
          <mesh geometry={terrainGeometry} onClick={handleTerrainClick}>
            <meshStandardMaterial
              vertexColors
              roughness={0.75}
              metalness={0.05}
              side={THREE.DoubleSide}
              flatShading={false}
            />
          </mesh>
        )}

        {/* 2. ETOPO Coastline Boundary Line (Z = 0m, Illuminated Cyan) */}
        {coastlineLineGeom && (
          <lineSegments geometry={coastlineLineGeom}>
            <lineBasicMaterial color="#00ffff" linewidth={2.5} transparent opacity={0.98} />
          </lineSegments>
        )}

        {/* 3. Continental Shelf Break Line (Z = -200m, Golden Amber) */}
        {shelfBreakLineGeom && (
          <lineSegments geometry={shelfBreakLineGeom}>
            <lineBasicMaterial color="#ffd166" linewidth={2.0} transparent opacity={0.92} />
          </lineSegments>
        )}

        {/* 4. Topographic Land Isohypses (Warm Earth Tones) */}
        {landContoursLineGeom && (
          <lineSegments geometry={landContoursLineGeom}>
            <lineBasicMaterial color="#dda15e" linewidth={1.2} transparent opacity={0.8} />
          </lineSegments>
        )}

        {/* 5. Deep Ocean Bathymetric Isobaths (Cobalt Blue / Aqua) */}
        {bathymetryContoursLineGeom && (
          <lineSegments geometry={bathymetryContoursLineGeom}>
            <lineBasicMaterial color="#38bdf8" linewidth={1.2} transparent opacity={0.7} />
          </lineSegments>
        )}

        {/* 6. Ocean Water Surface (Clipped to Ocean Cells at Z = 0) */}
        {showWater && waterGeometry && (
          <mesh geometry={waterGeometry}>
            <meshStandardMaterial
              color="#0077b6"
              transparent
              opacity={0.52}
              roughness={0.12}
              metalness={0.08}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
        )}

        {/* 7. Geometric Depth Framing Pedestal */}
        {skirtGeometry && (
          <mesh geometry={skirtGeometry}>
            <meshStandardMaterial
              vertexColors
              roughness={0.88}
              metalness={0.02}
              side={THREE.DoubleSide}
            />
          </mesh>
        )}

        {/* 8. Clicked Probe Reticle Marker */}
        {selectedProbe && terrainData && (
          <group
            position={[
              ((selectedProbe.lon - terrainData.bounds.min_lon) /
                (terrainData.bounds.max_lon - terrainData.bounds.min_lon) -
                0.5) *
                BLOCK_SIZE,
              selectedProbe.elevation_m * BASE_ELEVATION_SCALE * verticalExaggeration + 0.4,
              (0.5 -
                (selectedProbe.lat - terrainData.bounds.min_lat) /
                  (terrainData.bounds.max_lat - terrainData.bounds.min_lat)) *
                BLOCK_SIZE,
            ]}
          >
            <mesh>
              <sphereGeometry args={[0.7, 16, 16]} />
              <meshBasicMaterial color="#ffff00" />
            </mesh>
            <mesh scale={2.4}>
              <ringGeometry args={[0.5, 0.7, 24]} />
              <meshBasicMaterial color="#ffff00" transparent opacity={0.6} side={THREE.DoubleSide} />
            </mesh>
          </group>
        )}
      </Canvas>

      {/* Loading Overlay */}
      {loading && !terrainData && (
        <div className="deep-dive-loader">
          <div className="loader-spinner" />
          <span>Loading NOAA ETOPO 2022 Bathymetry & Relief...</span>
        </div>
      )}

      {/* Floating HUD Header */}
      <div className="deep-dive-hud-header">
        <div className="hud-title-block">
          <button className="back-globe-btn" onClick={onExit}>
            ← Back to Globe
          </button>
          <div className="hud-region-info">
            <h2>{boundary.label || 'Deep Dive: Regional Digital Twin'}</h2>
            <p className="provenance-tag">
              NOAA ETOPO 2022 (Bedrock) · Real Bathymetry & Coastline
            </p>
          </div>
        </div>

        <div className="hud-quick-stats">
          <div className="stat-pill">
            <label>Dimensions</label>
            <span>
              {boundary.width_km} km × {boundary.height_km} km
            </span>
          </div>
          {terrainData && (
            <>
              <div className="stat-pill">
                <label>Max Peak</label>
                <span className="elev-pos">
                  +{Math.round(terrainData.max_elevation_m).toLocaleString()} m
                </span>
              </div>
              <div className="stat-pill">
                <label>Max Depth</label>
                <span className="elev-neg">
                  {Math.round(terrainData.min_elevation_m).toLocaleString()} m
                </span>
              </div>
              <div className="stat-pill">
                <label>Ocean Coverage</label>
                <span>{(terrainData.ocean_fraction * 100).toFixed(1)}%</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Floating Real-Time Swimmer / Diver Telemetry Card (Top Right) */}
      <div className="deep-dive-swimmer-card">
        <div className="swimmer-status-tag">
          <span className={`status-dot ${diverStats.depth_m > 0 ? 'submerged' : 'surface'}`} />
          <span>{diverStats.depth_m > 0 ? 'DIVER SUBMERGED' : 'SURFACE / AERIAL'}</span>
        </div>
        <div className="swimmer-metrics-grid">
          <div className="swimmer-metric-item">
            <label>{diverStats.depth_m > 0 ? 'DIVE DEPTH' : 'ALTITUDE'}</label>
            <strong className={diverStats.depth_m > 0 ? 'depth-val' : 'alt-val'}>
              {diverStats.depth_m > 0 ? `-${diverStats.depth_m} m` : `+${diverStats.altitude_m} m`}
            </strong>
          </div>
          <div className="swimmer-metric-item">
            <label>WATER TEMP</label>
            <strong className="temp-val">{currentSwimmerTemp} °C</strong>
          </div>
        </div>
        <div className="swimmer-coords">
          <span>{diverStats.lat.toFixed(2)}°N, {diverStats.lon.toFixed(2)}°E</span>
        </div>
      </div>

      {/* Keybinding Helper Guide (Bottom Center) */}
      <div className="deep-dive-keys-guide">
        <div className="keys-cluster">
          <span className={`key-cap ${activeKeys['w'] ? 'active' : ''}`}>W</span>
          <span className={`key-cap ${activeKeys['a'] ? 'active' : ''}`}>A</span>
          <span className={`key-cap ${activeKeys['s'] ? 'active' : ''}`}>S</span>
          <span className={`key-cap ${activeKeys['d'] ? 'active' : ''}`}>D</span>
          <span className="key-action">Swim</span>
        </div>
        <div className="key-divider" />
        <div className="keys-cluster">
          <span className={`key-cap ${activeKeys['arrowup'] ? 'active' : ''}`}>↑</span>
          <span className={`key-cap ${activeKeys['arrowdown'] ? 'active' : ''}`}>↓</span>
          <span className="key-action">Depth</span>
        </div>
        <div className="key-divider" />
        <div className="keys-cluster">
          <span className={`key-cap ${activeKeys['shift'] ? 'active' : ''}`}>Shift</span>
          <span className="key-action">Boost</span>
        </div>
        <div className="key-divider" />
        <span className="key-hint">Drag water to look</span>
      </div>

      {/* Interactive Display Controls (Bottom Left) */}
      <div className="deep-dive-controls-card">
        <div className="control-row">
          <label>
            Vertical Exaggeration: <strong>{verticalExaggeration.toFixed(1)}×</strong>
          </label>
          <input
            type="range"
            min="1.0"
            max="5.0"
            step="0.2"
            value={verticalExaggeration}
            onChange={(e) => setVerticalExaggeration(parseFloat(e.target.value))}
          />
          <small>Displays topography/seabed relief. All reported depths remain true invariant meters.</small>
        </div>

        <div className="toggles-row">
          <button
            className={`hud-toggle ${showContours ? 'active' : ''}`}
            onClick={() => setShowContours(!showContours)}
          >
            Contours & Isobaths: {showContours ? 'ON' : 'OFF'}
          </button>
          <button
            className={`hud-toggle ${showWater ? 'active' : ''}`}
            onClick={() => setShowWater(!showWater)}
          >
            Water Surface: {showWater ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>

      {/* Explicit Coordinate Probe Card (Bottom Right) */}
      {selectedProbe && (
        <div className="deep-dive-probe-card">
          <div className="probe-header">
            <h4>Physical Point Telemetry</h4>
            <span className="probe-coords">
              {selectedProbe.lat.toFixed(3)}°N, {selectedProbe.lon.toFixed(3)}°E
            </span>
          </div>

          <div className="probe-elev-box">
            <span className="probe-type">
              {selectedProbe.elevation_m >= 0 ? 'Topographic Land' : 'Marine Seabed'}
            </span>
            <span className={`probe-meters ${selectedProbe.elevation_m >= 0 ? 'pos' : 'neg'}`}>
              {selectedProbe.elevation_m >= 0
                ? `+${Math.round(selectedProbe.elevation_m)} m`
                : `${Math.round(selectedProbe.elevation_m)} m`}
            </span>
          </div>

          {profileLoading ? (
            <div className="probe-loading">Loading CTD ocean profile...</div>
          ) : pointProfile ? (
            <div className="probe-ctd-details">
              {pointProfile.is_land ? (
                <div className="land-note">Continental Landmass (No marine water column)</div>
              ) : (
                <>
                  <div className="gradient-badge">
                    <span className="label">Thermal Structure:</span>
                    <strong className={pointProfile.thermocline?.detected ? 'highlight' : ''}>
                      {pointProfile.thermocline?.classification}
                    </strong>
                    {pointProfile.thermocline?.detected && (
                      <span className="grad-metric">
                        (Max: {pointProfile.thermocline.max_gradient_c_per_m} °C/m,{' '}
                        {pointProfile.thermocline.depth_range_m?.[0]}–{pointProfile.thermocline.depth_range_m?.[1]}
                        m)
                      </span>
                    )}
                  </div>

                  <div className="gradient-badge">
                    <span className="label">Salinity Structure:</span>
                    <strong className={pointProfile.halocline?.detected ? 'highlight' : ''}>
                      {pointProfile.halocline?.classification}
                    </strong>
                  </div>

                  {/* CTD Level Depth Profile */}
                  <div className="ctd-mini-table">
                    <div className="table-head">
                      <span>Depth</span>
                      <span>Temp</span>
                      <span>Salinity</span>
                    </div>
                    {pointProfile.levels
                      ?.filter((l) => l.in_water_column)
                      .slice(0, 5)
                      .map((lvl) => (
                        <div key={lvl.depth_m} className="table-row">
                          <span>{lvl.depth_m} m</span>
                          <span>{lvl.temperature_c ?? '--'} °C</span>
                          <span>{lvl.salinity_psu ?? '--'} PSU</span>
                        </div>
                      ))}
                  </div>
                </>
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
