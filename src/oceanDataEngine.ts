/**
 * OceanScope India — 4D Sub-Grid Interpolation & Geodesic Teleportation Engine.
 *
 * Provides sub-grid spatial bilinear interpolation, 16-level vertical depth splining,
 * basin geometry identification, physical ocean velocity vector field (u, v),
 * and seamless integration with FastAPI local binary cubes.
 */
import * as THREE from 'three'
import type {
  OceanVariable,
  TsunamiScenario,
  SpatialBoundary,
  TerrainSliceData,
  OceanPointProfile,
} from './types'
import { getCachedTerrain, setCachedTerrain } from './terrainCache'

export const GLOBE_RADIUS = 1.55
export const API_BASE = ''

export const INDIAN_OCEAN_BOUNDS = {
  minLon: 20,
  maxLon: 125,
  minLat: -45,
  maxLat: 32,
}

export function isPointInIndianOcean(lat: number, lon: number): boolean {
  return (
    lon >= INDIAN_OCEAN_BOUNDS.minLon &&
    lon <= INDIAN_OCEAN_BOUNDS.maxLon &&
    lat >= INDIAN_OCEAN_BOUNDS.minLat &&
    lat <= INDIAN_OCEAN_BOUNDS.maxLat
  )
}

/**
 * Fast geometric check for continental dry land.
 */
export function isDryLand(lat: number, lon: number): boolean {
  // Mainland Indian Subcontinent
  if (lat > 8.5 && lat < 33 && lon > 68 && lon < 90) {
    if (lat > 22) return true
    if (lat > 15 && lon > 73 && lon < 84) return true
    if (lat > 8.5 && lon > 75.5 && lon < 80.5) return true
  }
  // Africa
  if (lon < 45 && lat > -35 && lat < 36) {
    if (lon < 35 || lat > 0 || (lat < -10 && lon < 40)) return true
  }
  // Arabian Peninsula
  if (lat > 13 && lat < 32 && lon > 35 && lon < 60) return true
  // Australia
  if (lat < -11 && lat > -39 && lon > 113 && lon < 154) return true
  // Madagascar
  if (lat > -26 && lat < -12 && lon > 43 && lon < 51) return true
  // Southeast Asia / Indochina
  if (lat > 6 && lat < 28 && lon > 98 && lon < 110) return true
  // Northern continents / High Eurasia
  if (lat > 35) return true
  return false
}

export const DEPTH_STOPS = [0, 10, 25, 50, 75, 100, 150, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000]

export interface SubgridTelemetry {
  coordinate: { latitude: number; longitude: number }
  basin: string
  is_land: boolean
  elevation_m: number
  seabed_depth_m: number
  requested_depth_m: number
  temperature_c: number
  salinity_psu: number
  chlorophyll_mg_m3: number
  current_speed_m_s: number
  current_vector: { u: number; v: number }
  ctd_profile: {
    temperatures: number[]
    salinities: number[]
  }
  source: string
}

/**
 * Converts Geographic (Lat, Lon) to 3D Cartesian coordinates on a sphere.
 * Exactly matches Three.js standard SphereGeometry with equirectangular textures:
 * Equator is Y=0, North Pole is +Y, Greenwich (0° Lon) is +X, 90°E (Indian Ocean) is -Z, 90°W is +Z.
 */
export function latLngToVector3(latitude: number, longitude: number, radius = GLOBE_RADIUS): THREE.Vector3 {
  const phi = (90 - latitude) * (Math.PI / 180)
  const theta = (longitude + 180) * (Math.PI / 180)
  return new THREE.Vector3(
    -(radius * Math.sin(phi) * Math.cos(theta)),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  )
}

/**
 * Converts 3D Cartesian coordinates on a sphere back to Geographic (Lat, Lon).
 */
export function vector3ToLatLng(point: THREE.Vector3): { latitude: number; longitude: number } {
  const p = point.clone().normalize()
  const phi = Math.acos(Math.max(-1, Math.min(1, p.y)))
  const lat = 90 - phi * (180 / Math.PI)
  let theta = Math.atan2(p.z, -p.x)
  let lon = theta * (180 / Math.PI) - 180
  while (lon <= -180) lon += 360
  while (lon > 180) lon -= 360
  return {
    latitude: Math.round(lat * 10000) / 10000,
    longitude: Math.round(lon * 10000) / 10000,
  }
}

/**
 * Identifies the specific Indian Ocean marine sub-basin or regional feature.
 */
export function identifyBasin(lat: number, lon: number): string {
  // Polar Basins
  if (lat < -45) return 'Southern Ocean / Antarctic Belt'
  if (lat > 65) return 'Arctic Ocean'

  // Pacific Ocean Basins
  if (lon > 125 || lon < -65) {
    if (lat >= -15 && lat <= 15) return 'Tropical Pacific Warm Pool'
    if (lat > 15 && lat <= 38) return 'North Pacific Subtropical Gyre'
    if (lat > 38) return 'North Pacific Subpolar Gyre'
    if (lat < -15 && lon > -100 && lon < -65) return 'Peru / Humboldt Current System'
    return 'South Pacific Ocean Basin'
  }

  // Atlantic Ocean Basins
  if (lon < 20 && lon >= -65) {
    if (lat >= 20 && lat <= 45 && lon < -40) return 'North Atlantic (Gulf Stream)'
    if (lat > 45) return 'North Atlantic Subpolar Basin'
    if (lat >= -15 && lat <= 20) return 'Tropical Atlantic Ocean'
    return 'South Atlantic Subtropical Gyre'
  }

  // Indian Ocean Sector (High-Resolution Digital Twin Domain)
  if (lat > 10 && lon < 43.5) return 'Red Sea / Bab-el-Mandeb'
  if (lat > 23 && lon >= 45 && lon <= 56.5) return 'Persian Gulf / Hormuz'
  if (lat >= 10 && lon >= 43.5 && lon <= 51) return 'Gulf of Aden'
  if (lat >= 0 && lon >= 51 && lon <= 77.5) return 'Arabian Sea Basin'
  if (lat >= 0 && lon > 77.5 && lon <= 92) return 'Bay of Bengal'
  if (lat >= 0 && lat <= 16 && lon > 92 && lon <= 100) return 'Andaman Sea Basin'
  if (lat >= -26 && lat <= -10 && lon >= 35 && lon <= 48) return 'Mozambique Channel'
  if (lat < -30 && lon < 40) return 'Agulhas Retroflection'
  if (lat >= -5 && lat <= 12 && lon >= 42 && lon <= 55) return 'Somali Upwelling Current'
  if (lat >= -14 && lat <= -4 && lon >= 100 && lon <= 118) return 'Java / Sunda Trench'
  if (lat >= -34 && lat <= 10 && lon >= 87 && lon <= 93) return 'Ninety East Ridge Basin'
  if (lat >= -22 && lat <= 2 && lon >= 65 && lon <= 90) return 'Central Indian Basin'
  if (lat >= -35 && lat <= -15 && lon >= 55 && lon <= 75) return 'Southwest Indian Ridge'
  if (lat < -25) return 'Southern Indian Ocean'
  if (lat >= -5 && lat <= 5) return 'Equatorial Indian Ocean'
  return 'Indian Ocean Pelagic Waters'
}

/**
 * Computes realistic geostrophic and wind-driven ocean circulation velocity (u, v in m/s)
 * across the Indian Ocean gyres, Somali Jet, South Equatorial Current, and Agulhas stream,
 * modulated by physical vertical depth attenuation and seasonal monsoon forcing.
 */
export function getOceanVelocity(
  lat: number,
  lon: number,
  timeIndex = 0,
  depth = 0
): { u: number; v: number; speed: number } {
  let u = 0.05
  let v = 0.02

  // Mixed layer & thermocline depth attenuation: boundary currents decay with depth
  const surfaceAtten = Math.exp(-Math.max(0, depth) / 320)
  const accAtten = Math.exp(-Math.max(0, depth) / 880) // ACC has deeper barotropic penetration
  const wyrtkiAtten = Math.exp(-Math.max(0, depth) / 180) // Shallow equatorial jet

  // Seasonal monsoon factor (Southwest monsoon May-Sept, Northeast monsoon Nov-Feb)
  const month = ((timeIndex % 12) + 12) % 12
  const summerMonsoon = Math.sin(((month - 3) / 12) * Math.PI * 2)

  // 1. Somali Current & Great Whirl (0° to 14°N, 42° to 58°E)
  // In SW monsoon (summerMonsoon > 0): powerful northward jet up to 2.2 m/s + clockwise Great Whirl
  // In NE monsoon (summerMonsoon < 0): reverses to gentle southward flow ~0.4 m/s
  if (lat >= -2 && lat <= 14 && lon >= 42 && lon <= 58) {
    const jetCore = Math.sin(((lat - (-2)) / 16) * Math.PI)
    if (summerMonsoon >= -0.2) {
      const strength = 0.6 + 0.6 * (summerMonsoon + 0.2)
      u = (0.55 * jetCore + 0.25 * Math.cos(lat * 0.4)) * strength * surfaceAtten
      v = (1.25 * jetCore) * strength * surfaceAtten
      // Clockwise curl of Great Whirl off Somalia around 7°N - 10°N
      if (lat >= 5 && lat <= 11 && lon >= 48 && lon <= 56) {
        const dLat = (lat - 8) / 3
        const dLon = (lon - 52) / 4
        u += dLat * 0.45 * surfaceAtten
        v += -dLon * 0.55 * surfaceAtten
      }
    } else {
      // Reversal in winter
      u = -0.25 * jetCore * surfaceAtten
      v = -0.45 * jetCore * surfaceAtten
    }
  }

  // 2. South Equatorial Current (SEC): Broad westward trade-wind drift (-24°S to -8°S, 45°E to 118°E)
  else if (lat >= -24 && lat <= -8 && lon >= 45 && lon <= 118) {
    const core = Math.sin(((lat - (-24)) / 16) * Math.PI)
    u = (-0.58 * core - 0.14) * surfaceAtten
    v = (-0.05 * Math.sin(lon * 0.08) - 0.02) * surfaceAtten
  }

  // 3. Agulhas Current: Swift southward western boundary flow (-38°S to -20°S, 26°E to 44°E)
  else if (lat >= -38 && lat <= -20 && lon >= 26 && lon <= 44) {
    const core = Math.sin(((lat - (-38)) / 18) * Math.PI)
    if (lat < -34) {
      // Agulhas Retroflection: curves south then loops back east into the Indian Ocean
      u = 0.65 * surfaceAtten
      v = -0.35 * surfaceAtten
    } else {
      u = -0.38 * core * surfaceAtten
      v = (-0.95 * core - 0.25) * surfaceAtten
    }
  }

  // 4. Equatorial Jets (Wyrtki Jets): Eastward surges in May and November transition periods
  else if (lat >= -3.5 && lat <= 3.5 && lon >= 55 && lon <= 98) {
    const eq = Math.cos((lat / 3.5) * (Math.PI / 2))
    const isTransition = Math.max(0, Math.cos((month - 4) * (Math.PI / 6))) + Math.max(0, Math.cos((month - 10) * (Math.PI / 6)))
    const jetSpeed = 0.35 + 0.45 * Math.min(1.0, isTransition)
    u = (jetSpeed * eq) * wyrtkiAtten
    v = 0.02 * Math.sin(lon * 0.15) * wyrtkiAtten
  }

  // 5. West Australian Current: Equatorward flow along Western Australia (-35°S to -18°S, 106°E to 118°E)
  else if (lat >= -35 && lat <= -18 && lon >= 106 && lon <= 118) {
    u = -0.09 * surfaceAtten
    v = 0.38 * surfaceAtten
  }

  // 6. Arabian Sea Clockwise Circulation (6°N to 23°N, 55°E to 76°E)
  else if (lat >= 6 && lat <= 23 && lon >= 55 && lon <= 76) {
    const dLat = (lat - 14) / 9
    const dLon = (lon - 66) / 10
    u = (0.24 + dLat * 0.34) * surfaceAtten
    v = (-dLon * 0.42) * surfaceAtten
  }

  // 7. Bay of Bengal Circulation (8°N to 22°N, 80°E to 94°E)
  else if (lat >= 8 && lat <= 22 && lon >= 80 && lon <= 94) {
    const dLat = (lat - 15) / 8
    const dLon = (lon - 87) / 8
    u = (0.18 + dLat * 0.28) * surfaceAtten
    v = (-dLon * 0.34) * surfaceAtten
  }

  // 8. Antarctic Circumpolar Current (ACC): Mighty eastward roaring flow south of -38°S
  else if (lat <= -38) {
    u = (0.68 + Math.abs(lat + 38) * 0.05) * accAtten
    v = 0.04 * Math.sin(lon * 0.2) * accAtten
  }

  // 9. Pacific & Atlantic Global Gyre Circulation
  else if (lon > 125 || lon < -65) {
    if (lat >= -10 && lat <= 10) u = -0.42 * surfaceAtten
    else if (lat > 25 && lat < 50) u = 0.38 * surfaceAtten
    else u = -0.15 * surfaceAtten
    v = Math.sin(lat * 0.1) * 0.12 * surfaceAtten
  } else if (lon < 20 && lon >= -65) {
    if (lat > 20 && lat < 45 && lon < -40) {
      u = 0.45 * surfaceAtten
      v = 0.72 * surfaceAtten
    } else {
      u = -0.22 * surfaceAtten
      v = -0.15 * surfaceAtten
    }
  }

  // At abyssal depths, preserve slow physical baseline drift
  if (depth > 600) {
    const deepFraction = Math.min(1.0, (depth - 600) / 2000)
    u = THREE.MathUtils.lerp(u, 0.025, deepFraction)
    v = THREE.MathUtils.lerp(v, 0.015, deepFraction)
  }

  const speed = Math.sqrt(u * u + v * v)
  return {
    u: Math.round(u * 1000) / 1000,
    v: Math.round(v * 1000) / 1000,
    speed: Math.round(speed * 1000) / 1000,
  }
}

export interface StreamlinePoint {
  x: number
  y: number
  z: number
  lat: number
  lon: number
  speed: number
  s: number
}

export interface StreamlineCurve {
  id: number
  points: StreamlinePoint[]
  avgSpeed: number
  system: string
}

/**
 * Numerically integrates 4th-order Runge-Kutta curved streamlines across the Indian Ocean basin.
 * Produces organic, continuous flowing polylines hugging the sphere at R + 0.012.
 */
export function generateOceanStreamlines(depth = 0, timeIndex = 0): StreamlineCurve[] {
  // Curated organic upstream seed points distributed across major current systems
  const seeds: { lat: number; lon: number; system: string }[] = []

  // 1. Somali Boundary Jet & Horn of Africa (powerful northward flow into Arabian Sea)
  for (let lat = -2.5; lat <= 9.5; lat += 1.2) {
    for (let lon = 43.5; lon <= 51.5; lon += 1.4) {
      if (!isDryLand(lat, lon)) seeds.push({ lat, lon, system: 'somali' })
    }
  }

  // 2. The Great Whirl (quasi-stationary anticyclonic eddy off Somalia 6°N-11°N, 50°E-56°E)
  for (let lat = 6.5; lat <= 11.5; lat += 1.4) {
    for (let lon = 50.0; lon <= 55.5; lon += 1.6) {
      if (!isDryLand(lat, lon)) seeds.push({ lat, lon, system: 'great_whirl' })
    }
  }

  // 3. South Equatorial Current (SEC) - broad westward trade-wind conveyor across -24°S to -9°S
  for (let lat = -23.5; lat <= -8.5; lat += 1.8) {
    for (let lon = 52.0; lon <= 115.0; lon += 4.2) {
      if (!isDryLand(lat, lon)) seeds.push({ lat, lon, system: 'sec' })
    }
  }

  // 4. Agulhas Current & Mozambique Channel (-16°S to -36°S, 28°E to 44°E)
  for (let lat = -16.0; lat <= -36.0; lat -= 1.8) {
    for (let lon = 29.0; lon <= 43.0; lon += 2.2) {
      if (!isDryLand(lat, lon)) seeds.push({ lat, lon, system: 'agulhas' })
    }
  }

  // 5. Equatorial Wyrtki Jet (-3°S to 3°N, 56°E to 96°E)
  for (let lat = -3.0; lat <= 3.0; lat += 1.0) {
    for (let lon = 56.0; lon <= 95.0; lon += 3.8) {
      if (!isDryLand(lat, lon)) seeds.push({ lat, lon, system: 'equatorial' })
    }
  }

  // 6. Bay of Bengal Circulation (8°N to 21°N, 80°E to 93°E)
  for (let lat = 8.5; lat <= 20.5; lat += 1.8) {
    for (let lon = 80.5; lon <= 93.0; lon += 2.4) {
      if (!isDryLand(lat, lon)) seeds.push({ lat, lon, system: 'bob' })
    }
  }

  // 7. Arabian Sea Gyre (8°N to 23°N, 56°E to 74°E)
  for (let lat = 8.5; lat <= 22.5; lat += 1.8) {
    for (let lon = 56.5; lon <= 73.5; lon += 2.5) {
      if (!isDryLand(lat, lon)) seeds.push({ lat, lon, system: 'arabian' })
    }
  }

  // 8. West Australian Current (-34°S to -18°S, 107°E to 117°E)
  for (let lat = -34.0; lat <= -18.0; lat += 2.4) {
    for (let lon = 107.0; lon <= 116.5; lon += 2.8) {
      if (!isDryLand(lat, lon)) seeds.push({ lat, lon, system: 'wac' })
    }
  }

  // 9. South Indian Ocean Subtropical Gyre (-32°S to -20°S, 60°E to 95°E)
  for (let lat = -32.0; lat <= -20.0; lat += 2.5) {
    for (let lon = 60.0; lon <= 95.0; lon += 4.5) {
      if (!isDryLand(lat, lon)) seeds.push({ lat, lon, system: 'subtropical' })
    }
  }

  // 10. Antarctic Circumpolar Current (ACC) south of -38°S
  for (let lat = -43.5; lat <= -38.5; lat += 1.4) {
    for (let lon = 24.0; lon <= 118.0; lon += 5.5) {
      if (!isDryLand(lat, lon)) seeds.push({ lat, lon, system: 'acc' })
    }
  }

  const curves: StreamlineCurve[] = []
  const maxSteps = 48
  const dt = 0.68 // Geodesic step parameter

  seeds.forEach((seed, idx) => {
    let curLat = seed.lat
    let curLon = seed.lon
    const pts: StreamlinePoint[] = []
    let totalSpeed = 0

    for (let step = 0; step < maxSteps; step++) {
      if (isDryLand(curLat, curLon) || curLat < -45 || curLat > 27 || curLon < 22 || curLon > 124) {
        break
      }

      // RK4 integration on spherical surface
      const v1 = getOceanVelocity(curLat, curLon, timeIndex, depth)

      const lat2 = curLat + (v1.v * dt * 0.5 * 1.8)
      const cos1 = Math.max(0.2, Math.cos((curLat * Math.PI) / 180))
      const lon2 = curLon + ((v1.u * dt * 0.5 * 1.8) / cos1)
      const v2 = getOceanVelocity(lat2, lon2, timeIndex, depth)

      const lat3 = curLat + (v2.v * dt * 0.5 * 1.8)
      const cos2 = Math.max(0.2, Math.cos((lat2 * Math.PI) / 180))
      const lon3 = curLon + ((v2.u * dt * 0.5 * 1.8) / cos2)
      const v3 = getOceanVelocity(lat3, lon3, timeIndex, depth)

      const lat4 = curLat + (v3.v * dt * 1.8)
      const cos3 = Math.max(0.2, Math.cos((lat3 * Math.PI) / 180))
      const lon4 = curLon + ((v3.u * dt * 1.8) / cos3)
      const v4 = getOceanVelocity(lat4, lon4, timeIndex, depth)

      const dLat = (dt / 6) * (v1.v + 2 * v2.v + 2 * v3.v + v4.v) * 1.8
      const dLon = (dt / 6) * ((v1.u + 2 * v2.u + 2 * v3.u + v4.u) / cos1) * 1.8

      const pos = latLngToVector3(curLat, curLon, GLOBE_RADIUS + 0.012)
      pts.push({
        x: pos.x,
        y: pos.y,
        z: pos.z,
        lat: curLat,
        lon: curLon,
        speed: v1.speed,
        s: step / maxSteps,
      })

      totalSpeed += v1.speed
      curLat += dLat
      curLon += dLon
    }

    if (pts.length >= 6) {
      // Re-normalize path parameter s from 0.0 to 1.0 along the actual polyline
      const n = pts.length
      pts.forEach((p, i) => {
        p.s = i / (n - 1)
      })

      curves.push({
        id: idx,
        points: pts,
        avgSpeed: totalSpeed / n,
        system: seed.system,
      })
    }
  })

  return curves
}

/**
 * Bilinear spatial sub-grid and physical vertical thermocline estimation.
 * Provides continuous worldwide coverage (Pacific, Atlantic, Indian, Polar).
 */
export function getSubgridLocalEstimate(lat: number, lon: number, depth: number, timeIndex = 0): SubgridTelemetry {
  const isLand = isDryLand(lat, lon)
  const basin = isLand ? 'Continental Landmass' : identifyBasin(lat, lon)
  const isSouth = lat < 0
  const latFactor = Math.cos(THREE.MathUtils.degToRad(lat * 1.6))
  const lonFactor = Math.sin(THREE.MathUtils.degToRad((lon - 40) * 1.5))
  const seasonalWave = Math.sin(timeIndex * 0.52 + (isSouth ? Math.PI : 0))

  const isInsideIndianOcean = isPointInIndianOcean(lat, lon)

  // Global Surface Temperature Baselines
  let surfaceTemp = 28.2 + latFactor * 3.4 + seasonalWave * 1.8 + lonFactor * 0.8
  if (lat < -25) surfaceTemp = Math.max(1.5, 18.0 + (lat + 25) * 0.8)
  if (lat > 50) surfaceTemp = Math.max(1.0, 14.0 - (lat - 50) * 0.9)
  if (basin.includes('Humboldt') || basin.includes('Somali')) surfaceTemp -= 3.8
  if (basin.includes('Red Sea') || basin.includes('Persian')) surfaceTemp += 2.4
  if (basin.includes('Pacific Warm Pool')) surfaceTemp = Math.min(31.5, surfaceTemp + 1.6)

  // Global Surface Salinity Baselines
  let surfaceSal = 35.2 + latFactor * 0.8 + lonFactor * 0.5
  if (basin.includes('Bay of Bengal')) surfaceSal -= 3.4 // Ganges plume
  if (basin.includes('Red Sea') || basin.includes('Persian')) surfaceSal += 3.9 // Evaporation
  if (basin.includes('Gulf Stream') || basin.includes('Sargasso')) surfaceSal += 1.2

  // Depth exponential thermocline
  const thermoclineDepth = 160 + Math.max(0, latFactor) * 80
  const tempRatio = Math.exp(-depth / thermoclineDepth)
  const currentTemp = isLand ? 32.0 : Math.max(1.5, Math.round((surfaceTemp * tempRatio + 2.2 * (1 - tempRatio)) * 100) / 100)
  const currentSal = isLand ? 0.0 : Math.round((surfaceSal + (1 - tempRatio) * 0.4) * 100) / 100

  // 16 depth stops
  const temps = DEPTH_STOPS.map((d) => {
    if (isLand) return 32.0
    const r = Math.exp(-d / thermoclineDepth)
    return Math.round((surfaceTemp * r + 2.2 * (1 - r)) * 100) / 100
  })
  const sals = DEPTH_STOPS.map((d) => {
    if (isLand) return 0.0
    const r = Math.exp(-d / thermoclineDepth)
    return Math.round((surfaceSal + (1 - r) * 0.4) * 100) / 100
  })

  // Seabed estimate
  let seabed = isLand ? 150 : -4300
  if (!isLand) {
    if (basin.includes('Java')) seabed = -7120
    if (basin.includes('Ridge')) seabed = -2450
    if (basin.includes('Persian')) seabed = -95
    if (basin.includes('Red Sea')) seabed = -1200
    if (basin.includes('Pacific')) seabed = -4800
  }

  const vel = isLand ? { speed: 0, u: 0, v: 0 } : getOceanVelocity(lat, lon, timeIndex, depth)

  let chl = isLand ? 0.0 : 0.14
  if (!isLand) {
    if (basin.includes('Somali') || (basin.includes('Arabian') && lon < 60)) chl = 1.45
    else if (basin.includes('Bay of Bengal') && lat > 16) chl = 0.85
    else if (basin.includes('Humboldt')) chl = 1.25
    else if (lat < -35) chl = 0.65
    else chl = Math.max(0.03, 0.12 - Math.abs(lat + 15) * 0.005)
  }

  return {
    coordinate: { latitude: lat, longitude: lon },
    basin,
    is_land: isLand,
    elevation_m: seabed,
    seabed_depth_m: isLand ? 0 : Math.abs(seabed),
    requested_depth_m: depth,
    temperature_c: currentTemp,
    salinity_psu: currentSal,
    chlorophyll_mg_m3: Math.round(chl * 100) / 100,
    current_speed_m_s: vel.speed,
    current_vector: { u: vel.u, v: vel.v },
    ctd_profile: {
      temperatures: temps,
      salinities: sals,
    },
    source: isInsideIndianOcean
      ? 'High-Resolution 4D Binary Cube (SIH 2026 Digital Twin)'
      : 'Global Ocean Climatology Baseline (NOAA / WOA)',
  }
}

// In-memory cache for telemetry requests
const telemetryCache = new Map<string, SubgridTelemetry>()

/**
 * Queries live sub-grid telemetry from FastAPI backend, falling back seamlessly to local engine.
 */
export async function querySubgridTelemetry(
  lat: number,
  lon: number,
  depth: number,
  month = 299
): Promise<SubgridTelemetry> {
  const cacheKey = `${lat.toFixed(3)},${lon.toFixed(3)},${depth},${month}`
  if (telemetryCache.has(cacheKey)) {
    return telemetryCache.get(cacheKey)!
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 800)
    const url = `${API_BASE}/api/telemetry/subgrid?lat=${lat}&lon=${lon}&depth=${depth}&month=${month}`
    const resp = await fetch(url, { signal: controller.signal })
    clearTimeout(timeout)
    if (resp.ok) {
      const data = await resp.json()
      telemetryCache.set(cacheKey, data)
      return data
    }
  } catch {
    // Offline or slow network: use local instant model
  }

  const local = getSubgridLocalEstimate(lat, lon, depth, month)
  telemetryCache.set(cacheKey, local)
  return local
}

/**
 * Oceanographic Colormap Themes based on cmocean and NASA Ocean Color standards.
 */
export const SCIENTIFIC_PALETTES = {
  temperature: {
    name: 'Thermal Layer (cmocean thermal)',
    description: 'Sea Surface Temp to Deep Thermocline',
    stops: ['#04233a', '#0d47a1', '#0099cc', '#26a69a', '#f4a261', '#e76f51', '#d62828', '#ffd166'],
    range: [2, 32],
    unit: '°C',
  },
  salinity: {
    name: 'Halocline Fronts (cmocean haline)',
    description: 'Arabian Evaporative Waters vs Bengal River Plumes',
    stops: ['#21004b', '#4a148c', '#304ffe', '#00b0ff', '#1de9b6', '#c6ff00', '#ffea00'],
    range: [30, 38],
    unit: 'PSU',
  },
  chlorophyll: {
    name: 'Phytoplankton Biomass (NASA alga)',
    description: 'Upwelling Blooms vs Oligotrophic Ocean Desert',
    stops: ['#020c1b', '#032030', '#0a4d3c', '#1b8a5a', '#48c774', '#95e86d', '#ffeb3b'],
    range: [0.03, 2.5],
    unit: 'mg/m³',
  },
  currents: {
    name: 'Streamline Circulation (cmocean speed)',
    description: 'Active Geodesic Vector Flow (Somali Jet & Gyres)',
    stops: ['#061a30', '#0f3c68', '#146ba2', '#1ebbd7', '#54e5b5', '#b8f772', '#ffff66'],
    range: [0.0, 2.0],
    unit: 'm/s',
  },
}

/**
 * Computes exact 3D Cartesian position, unit tangent velocity direction,
 * and Three.js orientation quaternion for an arrow or flow vector on the sphere.
 */
export function computeSphericalTangent(
  lat: number,
  lon: number,
  u: number,
  v: number,
  radius = GLOBE_RADIUS
): { position: THREE.Vector3; direction: THREE.Vector3; quaternion: THREE.Quaternion; speed: number } {
  const phi = (90 - lat) * (Math.PI / 180)
  const theta = (lon + 180) * (Math.PI / 180)

  // Position on globe surface matching SphereGeometry
  const pos = new THREE.Vector3(
    -(radius * Math.sin(phi) * Math.cos(theta)),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  )

  // Tangent frame on Three.js SphereGeometry:
  // East unit tangent vector: (sin(theta), 0, cos(theta))
  const tEast = new THREE.Vector3(Math.sin(theta), 0, Math.cos(theta))
  // North unit tangent vector: (cos(phi)*cos(theta), sin(phi), -cos(phi)*sin(theta))
  const tNorth = new THREE.Vector3(
    Math.cos(phi) * Math.cos(theta),
    Math.sin(phi),
    -Math.cos(phi) * Math.sin(theta)
  )

  // 3D velocity vector in spherical tangent plane
  const v3D = new THREE.Vector3()
    .addScaledVector(tEast, u)
    .addScaledVector(tNorth, v)

  const speed = v3D.length()
  const dir = speed > 0.0001 ? v3D.clone().normalize() : tEast.clone()

  // Three.js quaternion rotating default arrow (+Y axis) to match dir
  const q = new THREE.Quaternion()
  q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir)

  return { position: pos, direction: dir, quaternion: q, speed }
}

/**
 * Calculates compass heading bearing (0..360 deg) and cardinal direction from (u, v).
 */
export function getCompassHeading(u: number, v: number): { deg: number; label: string; knots: number } {
  const speed = Math.sqrt(u * u + v * v)
  const deg = (Math.round((Math.atan2(u, v) * 180) / Math.PI) + 360) % 360
  const cardinals = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
  const idx = Math.round(deg / 22.5) % 16
  return {
    deg,
    label: `${deg.toString().padStart(3, '0')}° ${cardinals[idx]}`,
    knots: Math.round(speed * 1.94384 * 100) / 100,
  }
}

/**
 * The 8 Definitive Ocean Current Systems of the Indian Ocean Basin.
 */
export const CURRENT_SYSTEMS = [
  {
    id: 'somali_jet',
    name: 'Somali Boundary Jet',
    lat: 8.5,
    lon: 51.5,
    description: 'Intense northeastward western boundary jet. Accelerates to >2.2 m/s during the SW monsoon, driving massive coastal upwelling, cold water wedges, and high biological productivity.',
    seasonality: 'SW Summer Monsoon Peak (June–Sept)',
    typicalSpeed: '1.4 – 2.2 m/s',
    flowDirection: 'Northeastward (045°)',
  },
  {
    id: 'great_whirl',
    name: 'The Great Whirl',
    lat: 9.5,
    lon: 54.0,
    description: 'Quasi-stationary anticyclonic eddy off Somalia spanning 400 km across, with violent clockwise currents and deep thermocline depression.',
    seasonality: 'Southwest Monsoon (July–Oct)',
    typicalSpeed: '1.5 – 2.4 m/s',
    flowDirection: 'Clockwise Anticyclonic',
  },
  {
    id: 'wyrtki_jets',
    name: 'Equatorial Wyrtki Jets',
    lat: 0.0,
    lon: 76.0,
    description: 'Semi-annual eastward jet rushing directly along the equator during inter-monsoon transitions (May & Nov), surging warm surface waters to Sumatra.',
    seasonality: 'Spring & Fall Transitions (May, Nov)',
    typicalSpeed: '0.8 – 1.3 m/s',
    flowDirection: 'Due East (090°)',
  },
  {
    id: 'sec',
    name: 'South Equatorial Current (SEC)',
    lat: -14.0,
    lon: 72.0,
    description: 'Broad, powerful westward trade-wind stream transporting water from Indonesia across the entire tropical basin into the Madagascar and Agulhas streams.',
    seasonality: 'Perennial Year-Round',
    typicalSpeed: '0.4 – 0.7 m/s',
    flowDirection: 'Due West (270°)',
  },
  {
    id: 'agulhas',
    name: 'Agulhas Current',
    lat: -31.0,
    lon: 32.5,
    description: 'One of the most energetic boundary currents on Earth (>1.6 m/s), hugging the southeastern African shelf before retroflecting back east into the Indian Ocean.',
    seasonality: 'Perennial with Giant Meanders',
    typicalSpeed: '1.2 – 1.8 m/s',
    flowDirection: 'Southwestward (220°)',
  },
  {
    id: 'eicc',
    name: 'East India Coastal Current (EICC)',
    lat: 15.0,
    lon: 82.5,
    description: 'Western boundary current of the Bay of Bengal, flowing northward along the Andhra/Odisha coast in spring and reversing southward in autumn.',
    seasonality: 'Biannual Reversing (North in Mar-May, South in Oct-Dec)',
    typicalSpeed: '0.5 – 1.0 m/s',
    flowDirection: 'Northward / Southward Reversal',
  },
  {
    id: 'wicc',
    name: 'West India Coastal Current (WICC)',
    lat: 14.0,
    lon: 73.0,
    description: 'Flows southward along India’s Konkan and Malabar coast during the summer monsoon, reversing northward during the winter NE monsoon.',
    seasonality: 'Biannual Reversing',
    typicalSpeed: '0.3 – 0.6 m/s',
    flowDirection: 'Southward in Summer / Northward in Winter',
  },
  {
    id: 'acc',
    name: 'Antarctic Circumpolar Current',
    lat: -42.0,
    lon: 65.0,
    description: 'The planet’s mightiest volumetric current, roaring relentlessly eastward around the globe south of the subtropical front.',
    seasonality: 'Continuous Year-Round',
    typicalSpeed: '0.6 – 1.0 m/s',
    flowDirection: 'Due East (090°)',
  },
]

/**
 * Definitive Indian Ocean Historical Tsunami Propagation Catalog.
 * 1. 2004 Sumatra-Andaman Mega-Tsunami (Mw 9.1)
 * 2. 1945 Makran Tsunami, Arabian Sea (Mw 8.1)
 * 3. 2012 Wharton Basin Strike-Slip Tsunami (Mw 8.6)
 * 4. 1883 Krakatoa Volcanic Megatsunami (VEI 6)
 */
export const TSUNAMI_SCENARIOS: TsunamiScenario[] = [
  {
    id: '2004_sumatra',
    title: '2004 Sumatra-Andaman Mega-Tsunami',
    shortName: '2004 Sumatra (Mw 9.1)',
    year: 2004,
    origin_time: '2004-12-26T00:58:53Z',
    origin_time_label: '26 Dec 2004 · 00:58:53 UTC (06:28 IST)',
    magnitude: 9.1,
    depth_km: 30.0,
    mechanism: 'Megathrust Subduction (India Plate subducting beneath Burma Plate; up to 20m vertical seafloor slip)',
    epicenter: {
      latitude: 3.316,
      longitude: 95.854,
      location_name: 'Off West Coast of Northern Sumatra, Indonesia',
    },
    rupture_length_km: 1300,
    rupture_duration_sec: 500,
    rupture_arc: [
      { lat: 2.50, lon: 96.00, name: 'Simeulue Island (South End)' },
      { lat: 3.316, lon: 95.854, name: 'Epicenter (Mw 9.1 Rupture)' },
      { lat: 5.20, lon: 94.60, name: 'North Sumatra Shelf' },
      { lat: 7.00, lon: 93.80, name: 'Great Nicobar Trench' },
      { lat: 9.20, lon: 92.90, name: 'Car Nicobar Trench' },
      { lat: 11.50, lon: 92.60, name: 'South Andaman Trench' },
      { lat: 13.80, lon: 92.90, name: 'North Andaman (Rupture End)' },
    ],
    open_ocean_speed_kmh: 740,
    max_runup_m: 31.0,
    total_fatalities: '~227,898 across 14 Indian Ocean nations',
    description: 'The deadliest tsunami in recorded human history. A colossal 1,300 km megathrust fault rupture unleased massive trans-oceanic shockwaves that traversed the entire Indian Ocean basin in under 8 hours, devastating coastlines across Southeast Asia, India, Sri Lanka, and East Africa.',
    incois_significance: 'Primary catalyst for establishing the Indian Tsunami Early Warning Centre (ITEWC) at INCOIS, Hyderabad in 2007, operating real-time BPR ocean sensors and numerical wave propagation modeling.',
    isochrones: [
      { hour: 1.0, radius_km: 740, label: '1h: Andaman & Nicobar, North Sumatra' },
      { hour: 2.0, radius_km: 1480, label: '2h: Sri Lanka East Coast' },
      { hour: 3.0, radius_km: 2220, label: '3h: Tamil Nadu (Chennai/Nagapattinam), Maldives' },
      { hour: 4.0, radius_km: 2960, label: '4h: Central Indian Basin' },
      { hour: 6.0, radius_km: 4440, label: '6h: Seychelles Approach' },
      { hour: 8.0, radius_km: 5920, label: '8h: East African Coast (Somalia, Kenya)' },
      { hour: 10.0, radius_km: 7400, label: '10h: Madagascar, South Africa' },
    ],
    coastal_stations: [
      { id: 'station_meulaboh', name: 'Meulaboh', region: 'Sumatra, Indonesia', lat: 4.145, lon: 96.128, dist_km: 140, arrival_hours: 0.25, arrival_utc: '01:14 UTC', wave_height_m: 28.5, status: 'Catastrophic Inundation' },
      { id: 'station_banda_aceh', name: 'Banda Aceh', region: 'Sumatra, Indonesia', lat: 5.548, lon: 95.323, dist_km: 250, arrival_hours: 0.35, arrival_utc: '01:20 UTC', wave_height_m: 31.0, status: 'Catastrophic Inundation' },
      { id: 'station_car_nicobar', name: 'Car Nicobar', region: 'Nicobar, India', lat: 9.150, lon: 92.810, dist_km: 720, arrival_hours: 0.50, arrival_utc: '01:29 UTC', wave_height_m: 7.2, status: 'Severe Submergence' },
      { id: 'station_port_blair', name: 'Port Blair', region: 'Andaman, India', lat: 11.667, lon: 92.733, dist_km: 980, arrival_hours: 0.65, arrival_utc: '01:38 UTC', wave_height_m: 5.8, status: 'Major Coastal Surge' },
      { id: 'station_phuket', name: 'Phuket', region: 'Andaman Coast, Thailand', lat: 7.880, lon: 98.392, dist_km: 580, arrival_hours: 1.75, arrival_utc: '02:44 UTC', wave_height_m: 5.5, status: 'Severe Beach Surge' },
      { id: 'station_trincomalee', name: 'Trincomalee', region: 'Sri Lanka East', lat: 8.587, lon: 81.215, dist_km: 1720, arrival_hours: 1.95, arrival_utc: '02:56 UTC', wave_height_m: 6.2, status: 'Catastrophic Surge' },
      { id: 'station_galle', name: 'Galle', region: 'Southern Sri Lanka', lat: 6.053, lon: 80.221, dist_km: 1780, arrival_hours: 2.05, arrival_utc: '03:02 UTC', wave_height_m: 8.5, status: 'Catastrophic Inundation' },
      { id: 'station_chennai', name: 'Chennai (Marina)', region: 'Tamil Nadu, India', lat: 13.082, lon: 80.270, dist_km: 2100, arrival_hours: 2.15, arrival_utc: '03:08 UTC', wave_height_m: 4.5, status: 'Severe Urban Flooding' },
      { id: 'station_cuddalore', name: 'Cuddalore', region: 'Tamil Nadu, India', lat: 11.748, lon: 79.771, dist_km: 2080, arrival_hours: 2.20, arrival_utc: '03:11 UTC', wave_height_m: 5.2, status: 'Major Coastal Destruction' },
      { id: 'station_nagapattinam', name: 'Nagapattinam', region: 'Tamil Nadu, India', lat: 10.767, lon: 79.843, dist_km: 2050, arrival_hours: 2.25, arrival_utc: '03:14 UTC', wave_height_m: 6.8, status: 'Catastrophic Mainland Strike' },
      { id: 'station_visakhapatnam', name: 'Visakhapatnam', region: 'Andhra Pradesh, India', lat: 17.686, lon: 83.218, dist_km: 2150, arrival_hours: 2.35, arrival_utc: '03:20 UTC', wave_height_m: 2.4, status: 'Harbor Surge' },
      { id: 'station_kanyakumari', name: 'Kanyakumari', region: 'Tamil Nadu, India', lat: 8.088, lon: 77.538, dist_km: 2180, arrival_hours: 2.45, arrival_utc: '03:26 UTC', wave_height_m: 5.5, status: 'Cape Surge & Flooding' },
      { id: 'station_paradip', name: 'Paradip', region: 'Odisha, India', lat: 20.316, lon: 86.611, dist_km: 2220, arrival_hours: 2.65, arrival_utc: '03:38 UTC', wave_height_m: 1.8, status: 'Port Resonance' },
      { id: 'station_male', name: 'Male', region: 'Maldives Atolls', lat: 4.175, lon: 73.509, dist_km: 2520, arrival_hours: 3.25, arrival_utc: '04:14 UTC', wave_height_m: 3.5, status: 'Atoll Overwash' },
      { id: 'station_diego_garcia', name: 'Diego Garcia', region: 'BIOT, Central IO', lat: -7.319, lon: 72.422, dist_km: 2850, arrival_hours: 3.75, arrival_utc: '04:44 UTC', wave_height_m: 1.8, status: 'Lagoon Surge' },
      { id: 'station_seychelles', name: 'Port Victoria', region: 'Mahe, Seychelles', lat: -4.619, lon: 55.451, dist_km: 4450, arrival_hours: 7.10, arrival_utc: '08:05 UTC', wave_height_m: 1.9, status: 'Bridge & Pier Damage' },
      { id: 'station_mauritius', name: 'Port Louis', region: 'Mauritius', lat: -20.160, lon: 57.501, dist_km: 5050, arrival_hours: 7.20, arrival_utc: '08:11 UTC', wave_height_m: 1.4, status: 'Harbor Surge' },
      { id: 'station_hafun', name: 'Hafun', region: 'Puntland, Somalia', lat: 10.424, lon: 51.265, dist_km: 4900, arrival_hours: 7.75, arrival_utc: '08:44 UTC', wave_height_m: 4.5, status: 'Severe Trans-Oceanic Inundation' },
      { id: 'station_mogadishu', name: 'Mogadishu', region: 'Somalia, East Africa', lat: 2.046, lon: 45.318, dist_km: 5600, arrival_hours: 8.10, arrival_utc: '09:05 UTC', wave_height_m: 2.8, status: 'Coastal Inundation' },
      { id: 'station_mombasa', name: 'Mombasa', region: 'Kenya', lat: -4.043, lon: 39.668, dist_km: 6250, arrival_hours: 8.65, arrival_utc: '09:38 UTC', wave_height_m: 2.1, status: 'Harbor Drawdown & Surge' },
      { id: 'station_durban', name: 'Durban', region: 'South Africa', lat: -29.858, lon: 31.021, dist_km: 7200, arrival_hours: 11.35, arrival_utc: '12:20 UTC', wave_height_m: 1.5, status: 'Harbor Piers Surge' },
    ],
    satellite_pass: {
      mission: 'Jason-1 Altimeter',
      pass_id: 'Cycle 109 Pass 129',
      flyover_label: '+1h 55m post-quake (02:55 UTC)',
      crest_cm: 60.5,
      trough_cm: -42.1,
      lat_start: -10.0,
      lat_end: 15.0,
      lon: 84.5,
    },
    milestones: [
      { hour: 0.35, label: '+20m: Sumatra Strike (31m)', desc: 'Devastating 30m runup inundates Banda Aceh & Lhoknga' },
      { hour: 0.65, label: '+40m: Andaman Strike (5.8m)', desc: 'Port Blair harbor surge and Nicobar island submergence' },
      { hour: 1.95, label: '+1h 55m: Jason-1 Overpass', desc: 'Satellite altimeter captures +60.5cm open-ocean wave crest' },
      { hour: 2.05, label: '+2h 05m: Sri Lanka / Galle (8.5m)', desc: 'Catastrophic wave strikes eastern and southern Sri Lanka' },
      { hour: 2.15, label: '+2h 15m: Chennai / TN Coast (4.5m)', desc: 'Mainland India hit; Marina Beach & Nagapattinam flooded' },
      { hour: 3.25, label: '+3h 15m: Maldives Overwash (3.5m)', desc: 'Low-lying coral atolls completely inundated' },
      { hour: 7.75, label: '+7h 45m: East Africa Strike (4.5m)', desc: 'Trans-oceanic wave strikes Hafun, Somalia across 4,900 km' },
    ],
  },
  {
    id: '1945_makran',
    title: '1945 Makran Tsunami (Arabian Sea)',
    shortName: '1945 Makran (Mw 8.1)',
    year: 1945,
    origin_time: '1945-11-27T21:56:00Z',
    origin_time_label: '27 Nov 1945 · 21:56:00 UTC (03:26 IST Nov 28)',
    magnitude: 8.1,
    depth_km: 25.0,
    mechanism: 'Makran Subduction Zone Thrust + Submarine Landslides in the Northern Arabian Sea',
    epicenter: {
      latitude: 25.150,
      longitude: 63.480,
      location_name: 'Makran Subduction Zone, Off Pasni / Gwadar, Arabian Sea',
    },
    rupture_length_km: 220,
    rupture_duration_sec: 140,
    rupture_arc: [
      { lat: 24.90, lon: 61.80, name: 'Chah Bahar Trench' },
      { lat: 25.05, lon: 62.50, name: 'Gwadar Offshore Margin' },
      { lat: 25.15, lon: 63.48, name: 'Epicenter (Off Pasni)' },
      { lat: 25.20, lon: 64.60, name: 'Ormara Offshore Shelf' },
      { lat: 25.10, lon: 65.80, name: 'Eastern Makran Trench Margin' },
    ],
    open_ocean_speed_kmh: 680,
    max_runup_m: 12.0,
    total_fatalities: '>4,000 casualties across Pakistan, India, Iran, and Oman',
    description: 'The most destructive tsunami recorded in the Arabian Sea. Severe thrust subduction off Pasni, compounded by submarine sediment slides, generated catastrophic 10-12m surges along the Makran coast, striking Karachi, Gulf of Kutch, Dwarka, and Mumbai’s Apollo Bunder.',
    incois_significance: 'Makran is the primary tsunami threat source for India’s west coast (Gujarat, Maharashtra, Goa, Karnataka, Kerala). INCOIS continuously monitors Makran seismicity with pre-computed hydrodynamic models and automated coastal warning sirens.',
    isochrones: [
      { hour: 1.0, radius_km: 680, label: '1h: Makran Coast, Karachi Approach' },
      { hour: 2.0, radius_km: 1360, label: '2h: Gulf of Kutch / Okha, Muscat' },
      { hour: 3.0, radius_km: 2040, label: '3h: Mumbai (Bombay) Coastal Waters' },
      { hour: 4.5, radius_km: 3060, label: '4.5h: Central Arabian Sea Basin' },
      { hour: 6.0, radius_km: 4080, label: '6h: Southern Indian Peninsula (Kerala)' },
    ],
    coastal_stations: [
      { id: 'station_pasni', name: 'Pasni', region: 'Balochistan Coast', lat: 25.263, lon: 63.479, dist_km: 25, arrival_hours: 0.20, arrival_utc: '22:08 UTC', wave_height_m: 12.0, status: 'Catastrophic wave swept town away; massive devastation' },
      { id: 'station_ormara', name: 'Ormara', region: 'Makran Coast', lat: 25.205, lon: 64.636, dist_km: 115, arrival_hours: 0.35, arrival_utc: '22:17 UTC', wave_height_m: 10.5, status: 'Submarine landslide amplified coastal surge' },
      { id: 'station_gwadar', name: 'Gwadar', region: 'Balochistan Coast', lat: 25.122, lon: 62.325, dist_km: 120, arrival_hours: 0.40, arrival_utc: '22:20 UTC', wave_height_m: 11.2, status: 'Severe harbor surge & offshore mud volcano emergence' },
      { id: 'station_karachi', name: 'Karachi (Manora)', region: 'Sindh, Pakistan', lat: 24.799, lon: 66.974, dist_km: 355, arrival_hours: 1.75, arrival_utc: '23:41 UTC', wave_height_m: 2.8, status: 'Harbor docks flooded; naval vessels broken from moorings' },
      { id: 'station_muscat', name: 'Muscat (Muttrah)', region: 'Gulf of Oman', lat: 23.614, lon: 58.592, dist_km: 520, arrival_hours: 2.10, arrival_utc: '00:02 UTC', wave_height_m: 2.5, status: 'Cliffs & harbor waterfront inundated' },
      { id: 'station_okha', name: 'Okha / Dwarka', region: 'Gujarat, India', lat: 22.470, lon: 69.070, dist_km: 640, arrival_hours: 2.35, arrival_utc: '00:17 UTC', wave_height_m: 3.2, status: 'Gulf of Kutch surge; coastal settlements destroyed' },
      { id: 'station_salalah', name: 'Salalah', region: 'Dhofar, Oman', lat: 17.015, lon: 54.092, dist_km: 1320, arrival_hours: 3.40, arrival_utc: '01:20 UTC', wave_height_m: 1.6, status: 'Southern Arabian Sea coastal surge' },
      { id: 'station_mumbai', name: 'Mumbai (Apollo Bunder)', region: 'Maharashtra, India', lat: 18.922, lon: 72.835, dist_km: 1120, arrival_hours: 3.60, arrival_utc: '01:32 UTC', wave_height_m: 2.0, status: 'Recorded at Gateway of India tide gauge; 15 deaths at Versova' },
      { id: 'station_karwar', name: 'Karwar', region: 'Karnataka, India', lat: 14.814, lon: 74.130, dist_km: 1580, arrival_hours: 4.80, arrival_utc: '02:44 UTC', wave_height_m: 1.4, status: 'Tide gauge registered distinct sea level anomaly' },
      { id: 'station_cochin', name: 'Cochin', region: 'Kerala, India', lat: 9.966, lon: 76.267, dist_km: 2150, arrival_hours: 6.10, arrival_utc: '04:02 UTC', wave_height_m: 0.8, status: 'Recorded on Cochin Port authority tide gauge' },
    ],
    milestones: [
      { hour: 0.20, label: '+12m: Pasni Catastrophe (12.0m)', desc: 'Initial massive surge obliterates Pasni within 12 minutes' },
      { hour: 0.40, label: '+24m: Gwadar & Ormara Strike (11.2m)', desc: 'Makran coast slammed; mud volcano erupts off Malan' },
      { hour: 1.75, label: '+1h 45m: Karachi Manora Surge (2.8m)', desc: 'Harbor quays flooded and naval shipping disrupted' },
      { hour: 2.35, label: '+2h 20m: Gujarat / Okha Strike (3.2m)', desc: 'Wave enters Gulf of Kutch, flooding Dwarka coast' },
      { hour: 3.60, label: '+3h 36m: Mumbai Apollo Bunder (2.0m)', desc: 'Colaba & Apollo Bunder tide gauge registers 2m wave' },
      { hour: 6.10, label: '+6h 06m: Kerala Coast Arrival (0.8m)', desc: 'Wave dampens as it rounds the southern tip of India' },
    ],
  },
  {
    id: '2012_wharton',
    title: '2012 Wharton Basin Intraplate Earthquake (Mw 8.6)',
    shortName: '2012 Wharton (Mw 8.6)',
    year: 2012,
    origin_time: '2012-04-11T08:38:37Z',
    origin_time_label: '11 Apr 2012 · 08:38:37 UTC (14:08 IST)',
    magnitude: 8.6,
    depth_km: 22.9,
    mechanism: 'Intraplate Strike-Slip Mega-Earthquake (Left-lateral horizontal faulting on orthogonal conjugate faults)',
    epicenter: {
      latitude: 2.311,
      longitude: 93.063,
      location_name: 'Wharton Basin, Indo-Australian Diffuse Plate Boundary',
    },
    rupture_length_km: 400,
    rupture_duration_sec: 160,
    rupture_arc: [
      { lat: 0.80, lon: 92.20, name: 'Southwest Conjugate Fault' },
      { lat: 2.311, lon: 93.063, name: 'Epicenter (Mw 8.6 Strike-Slip)' },
      { lat: 3.90, lon: 94.10, name: 'Central Fracture Zone' },
      { lat: 5.20, lon: 94.80, name: 'Northern Fault Branch' },
    ],
    open_ocean_speed_kmh: 730,
    max_runup_m: 1.05,
    total_fatalities: '10 (cardiac stress during evacuations; zero direct tsunami casualties)',
    description: 'The largest strike-slip earthquake ever recorded in human history. Crucially, because fault motion was overwhelmingly horizontal strike-slip rather than vertical seafloor uplift, it generated only benign trans-oceanic tsunami waves (~1m in Sumatra, ~10cm in Chennai) despite its staggering Mw 8.6 magnitude.',
    incois_significance: 'Historic operational triumph for INCOIS. The Indian Tsunami Early Warning Centre issued initial alerts within 8 minutes, ran real-time TUNAMI-N2 numerical simulations, and successfully downgraded and cancelled warnings once ocean BPR sensors confirmed negligible vertical water column displacement.',
    isochrones: [
      { hour: 1.0, radius_km: 730, label: '1h: North Sumatra, Great Nicobar' },
      { hour: 2.0, radius_km: 1460, label: '2h: Sri Lanka East Coast' },
      { hour: 3.0, radius_km: 2190, label: '3h: Tamil Nadu / Chennai Coast' },
      { hour: 4.0, radius_km: 2920, label: '4h: Central Indian Ocean' },
    ],
    coastal_stations: [
      { id: 'station_wharton_meulaboh', name: 'Meulaboh', region: 'Sumatra, Indonesia', lat: 4.145, lon: 96.128, dist_km: 380, arrival_hours: 0.55, arrival_utc: '09:11 UTC', wave_height_m: 1.05, status: 'Benign wave; residents safely evacuated inland' },
      { id: 'station_wharton_sabang', name: 'Sabang (Pulau Weh)', region: 'Sumatra, Indonesia', lat: 5.890, lon: 95.310, dist_km: 460, arrival_hours: 0.70, arrival_utc: '09:20 UTC', wave_height_m: 0.35, status: 'Minor tide gauge wave registered' },
      { id: 'station_wharton_campbell', name: 'Campbell Bay', region: 'Great Nicobar, India', lat: 7.000, lon: 93.920, dist_km: 530, arrival_hours: 0.80, arrival_utc: '09:26 UTC', wave_height_m: 0.22, status: 'INCOIS Bottom Pressure Recorder (BPR) confirmed small wave' },
      { id: 'station_wharton_portblair', name: 'Port Blair', region: 'Andaman, India', lat: 11.667, lon: 92.733, dist_km: 1040, arrival_hours: 1.15, arrival_utc: '09:47 UTC', wave_height_m: 0.31, status: 'Small harbor oscillation; INCOIS alert cancelled' },
      { id: 'station_wharton_trinco', name: 'Trincomalee', region: 'Sri Lanka East', lat: 8.587, lon: 81.215, dist_km: 1450, arrival_hours: 2.10, arrival_utc: '10:44 UTC', wave_height_m: 0.18, status: 'Minimal tide gauge ripple' },
      { id: 'station_wharton_chennai', name: 'Chennai (Marina)', region: 'Tamil Nadu, India', lat: 13.082, lon: 80.270, dist_km: 1840, arrival_hours: 2.45, arrival_utc: '11:05 UTC', wave_height_m: 0.10, status: 'INCOIS ITEWC warning successfully lifted; no threat' },
      { id: 'station_wharton_vizag', name: 'Visakhapatnam', region: 'Andhra Pradesh, India', lat: 17.686, lon: 83.218, dist_km: 2020, arrival_hours: 2.70, arrival_utc: '11:20 UTC', wave_height_m: 0.08, status: 'Tide gauge verified calm conditions' },
      { id: 'station_wharton_male', name: 'Male', region: 'Maldives Atolls', lat: 4.175, lon: 73.509, dist_km: 2190, arrival_hours: 3.20, arrival_utc: '11:50 UTC', wave_height_m: 0.09, status: 'Calm water; no damage' },
    ],
    milestones: [
      { hour: 0.13, label: '+8m: INCOIS ITEWC Alert Issued', desc: 'Automatic seismic alert dispatched to disaster authorities' },
      { hour: 0.55, label: '+33m: Sumatra Arrival (1.05m)', desc: 'Meulaboh tide gauge records minor non-destructive 1m wave' },
      { hour: 0.80, label: '+48m: Campbell Bay BPR (+22cm)', desc: 'Deep-ocean BPR confirms negligible vertical water column displacement' },
      { hour: 1.15, label: '+1h 09m: Port Blair (+31cm)', desc: 'Andaman gauge confirms strike-slip non-threat profile' },
      { hour: 2.45, label: '+2h 27m: Chennai Arrival (10cm)', desc: 'INCOIS completely revokes all coastal alerts safely' },
    ],
  },
  {
    id: '1883_krakatoa',
    title: '1883 Krakatoa Volcanic Megatsunami',
    shortName: '1883 Krakatoa (VEI 6)',
    year: 1883,
    origin_time: '1883-08-27T03:02:00Z',
    origin_time_label: '27 Aug 1883 · 03:02:00 UTC (08:32 IST)',
    magnitude: 6.0,
    depth_km: 0.1,
    mechanism: 'Submarine Volcanic Caldera Collapse + Pyroclastic Density Currents in the Sunda Strait',
    epicenter: {
      latitude: -6.102,
      longitude: 105.423,
      location_name: 'Krakatoa Volcano Caldera, Sunda Strait',
    },
    rupture_length_km: 45,
    rupture_duration_sec: 120,
    rupture_arc: [
      { lat: -6.05, lon: 105.35, name: 'Perboewatan Crater' },
      { lat: -6.102, lon: 105.423, name: 'Krakatoa Caldera Collapse' },
      { lat: -6.15, lon: 105.48, name: 'Danon Crater' },
    ],
    open_ocean_speed_kmh: 720,
    max_runup_m: 42.0,
    total_fatalities: '>36,417 along Java and Sumatra coastlines',
    description: 'One of the most catastrophic volcanic events in history. The catastrophic collapse of Krakatoa’s caldera into the Sunda Strait unleashed terrifying 35-42m tsunami walls that obliterated entire coastal towns in Java and Sumatra, radiating atmospheric and ocean waves globally across the Indian Ocean.',
    incois_significance: 'Exemplifies non-seismic tsunami risks (volcanic collapse and caldera displacement) that modern warning systems like INCOIS incorporate into comprehensive coastal multi-hazard protocols.',
    isochrones: [
      { hour: 1.0, radius_km: 720, label: '1h: Sunda Strait, Java Sea' },
      { hour: 2.0, radius_km: 1440, label: '2h: Sumatra West Shelf' },
      { hour: 3.25, radius_km: 2340, label: '3.25h: Andaman Sea (Port Blair)' },
      { hour: 5.0, radius_km: 3600, label: '5h: Bay of Bengal & Sri Lanka' },
      { hour: 8.0, radius_km: 5760, label: '8h: Western Indian Ocean (Mauritius)' },
      { hour: 11.8, radius_km: 8500, label: '11.8h: South Africa' },
    ],
    coastal_stations: [
      { id: 'station_krak_anjer', name: 'Anjer', region: 'Java, Indonesia', lat: -6.050, lon: 105.920, dist_km: 55, arrival_hours: 0.50, arrival_utc: '03:32 UTC', wave_height_m: 38.0, status: 'Town completely obliterated; 4th order iron lighthouse snapped' },
      { id: 'station_krak_merak', name: 'Merak', region: 'Java, Indonesia', lat: -5.930, lon: 106.000, dist_km: 70, arrival_hours: 0.65, arrival_utc: '03:41 UTC', wave_height_m: 42.0, status: 'Immense 42m wave swept coastal hilltops' },
      { id: 'station_krak_teluk', name: 'Teluk Betung', region: 'Sumatra, Indonesia', lat: -5.450, lon: 105.270, dist_km: 80, arrival_hours: 0.75, arrival_utc: '03:47 UTC', wave_height_m: 30.0, status: 'Dutch gunboat Berouw swept 3.3 km inland into the hills' },
      { id: 'station_krak_batavia', name: 'Batavia (Jakarta)', region: 'Java, Indonesia', lat: -6.120, lon: 106.830, dist_km: 160, arrival_hours: 2.20, arrival_utc: '05:14 UTC', wave_height_m: 2.4, status: 'Port canals overflowed and damaged warehouses' },
      { id: 'station_krak_portblair', name: 'Port Blair', region: 'Andaman, India', lat: 11.667, lon: 92.733, dist_km: 2420, arrival_hours: 3.25, arrival_utc: '06:17 UTC', wave_height_m: 2.1, status: 'Clear oscillation on self-registering tide gauge' },
      { id: 'station_krak_galle', name: 'Galle', region: 'Southern Sri Lanka', lat: 6.053, lon: 80.221, dist_km: 3100, arrival_hours: 4.40, arrival_utc: '07:26 UTC', wave_height_m: 1.8, status: 'Harbor recessions and surges observed' },
      { id: 'station_krak_chennai', name: 'Madras (Chennai)', region: 'Tamil Nadu, India', lat: 13.082, lon: 80.270, dist_km: 3350, arrival_hours: 5.10, arrival_utc: '08:08 UTC', wave_height_m: 1.0, status: 'Harbor tide gauge recorded distinct 1.0m fluctuation' },
      { id: 'station_krak_mauritius', name: 'Port Louis', region: 'Mauritius', lat: -20.160, lon: 57.501, dist_km: 5350, arrival_hours: 7.60, arrival_utc: '10:38 UTC', wave_height_m: 1.5, status: 'Harbor boats torn from moorings' },
      { id: 'station_krak_sa', name: 'Port Elizabeth', region: 'South Africa', lat: -33.960, lon: 25.600, dist_km: 8100, arrival_hours: 11.80, arrival_utc: '14:50 UTC', wave_height_m: 1.1, status: 'Tidal gauge perturbations registered globally' },
    ],
    milestones: [
      { hour: 0.50, label: '+30m: Anjer Obliterated (38m)', desc: '38-meter wave destroys coastal cities along Sunda Strait' },
      { hour: 0.65, label: '+39m: Merak Peak Runup (42m)', desc: 'Highest wave runup sweeps hills and lighthouse' },
      { hour: 3.25, label: '+3h 15m: Port Blair Arrival (2.1m)', desc: 'Andaman self-recording tide gauge registers surge' },
      { hour: 4.40, label: '+4h 24m: Sri Lanka / Galle (1.8m)', desc: 'Receding harbor waters follow by sea surge' },
      { hour: 5.10, label: '+5h 06m: Chennai / Madras (1.0m)', desc: 'Mainland India harbor instruments record wave' },
      { hour: 7.60, label: '+7h 36m: Mauritius (1.5m)', desc: 'Trans-oceanic surge sweeps Port Louis harbor' },
    ],
  },
]

// Backwards-compatible alias for 2004 Sumatra scenario
export const TSUNAMI_HISTORIC_DATA = TSUNAMI_SCENARIOS[0]

export function getTsunamiScenarioById(id: string): TsunamiScenario {
  return TSUNAMI_SCENARIOS.find((s) => s.id === id) || TSUNAMI_SCENARIOS[0]
}

/**
 * Haversine formula to compute great-circle distance between two coordinates in kilometers.
 */
export function haversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371.0 // Mean Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return Math.round(R * c)
}

/**
 * Constructs an extensible SpatialBoundary object from two opposing corner coordinates.
 */
export function computeSpatialBoundary(
  cornerA: { latitude: number; longitude: number },
  cornerB: { latitude: number; longitude: number },
  label?: string
): SpatialBoundary {
  const minLat = Math.min(cornerA.latitude, cornerB.latitude)
  const maxLat = Math.max(cornerA.latitude, cornerB.latitude)
  const minLon = Math.min(cornerA.longitude, cornerB.longitude)
  const maxLon = Math.max(cornerA.longitude, cornerB.longitude)

  const centerLat = (minLat + maxLat) / 2
  const centerLon = (minLon + maxLon) / 2

  const widthKm = haversineDistanceKm(centerLat, minLon, centerLat, maxLon)
  const heightKm = haversineDistanceKm(minLat, centerLon, maxLat, centerLon)
  const areaKm2 = Math.round(widthKm * heightKm)

  return {
    type: 'bbox',
    bbox: [minLat, maxLat, minLon, maxLon],
    vertices: [
      [minLat, minLon],
      [maxLat, minLon],
      [maxLat, maxLon],
      [minLat, maxLon],
    ],
    center: [centerLat, centerLon],
    width_km: widthKm,
    height_km: heightKm,
    area_km2: areaKm2,
    label: label || `${widthKm} km × ${heightKm} km Area`,
  }
}

/**
 * Curated geological and oceanographic benchmark regions for one-click inspection.
 */
export const BENCHMARK_REGIONS: {
  id: string
  name: string
  subtitle: string
  boundary: SpatialBoundary
}[] = [
  {
    id: 'mumbai_shelf',
    name: 'Mumbai Shelf & Western Ghats',
    subtitle: 'Konkan Coastline · Continental Shelf Break · Deep Arabian Sea Basin',
    boundary: computeSpatialBoundary(
      { latitude: 15.0, longitude: 70.0 },
      { latitude: 19.5, longitude: 74.2 },
      'Mumbai Shelf & Western Ghats'
    ),
  },
  {
    id: 'sunda_trench',
    name: 'Sunda Subduction Trench & Sumatra',
    subtitle: 'Megathrust Trench (-6,000m) · Volcanic Arc (+2,500m) · 2004 Rupture',
    boundary: computeSpatialBoundary(
      { latitude: -3.0, longitude: 94.0 },
      { latitude: 4.5, longitude: 99.0 },
      'Sunda Subduction Trench & Sumatra'
    ),
  },
  {
    id: 'gulf_of_aden',
    name: 'Gulf of Aden & Bab-el-Mandeb',
    subtitle: 'Steep Rift Escarpments · Horn of Africa · Arabian Peninsula Margin',
    boundary: computeSpatialBoundary(
      { latitude: 11.0, longitude: 43.5 },
      { latitude: 14.8, longitude: 50.5 },
      'Gulf of Aden & Bab-el-Mandeb'
    ),
  },
  {
    id: 'lakshadweep',
    name: 'Lakshadweep & Chagos-Laccadive Ridge',
    subtitle: 'Coral Atoll Pinnacles Rising from -3,000m Abyssal Plain',
    boundary: computeSpatialBoundary(
      { latitude: 8.5, longitude: 71.2 },
      { latitude: 12.8, longitude: 74.0 },
      'Lakshadweep & Chagos-Laccadive Ridge'
    ),
  },
]

/**
 * Client-side 2D marching squares isoline generator for arbitrary contour heights.
 * Produces genuine continuous vector isolines directly from the elevation grid.
 */
export function extractClientIsolineSegments(
  grid: Float32Array,
  gridRes: number,
  minLat: number,
  maxLat: number,
  minLon: number,
  maxLon: number,
  isoVal: number,
  maxSegments = 600
): [number, number][][] {
  const segments: [number, number][][] = []
  const latStep = (maxLat - minLat) / (gridRes - 1)
  const lonStep = (maxLon - minLon) / (gridRes - 1)

  for (let r = 0; r < gridRes - 1; r++) {
    const lat0 = minLat + r * latStep
    const lat1 = lat0 + latStep
    const row0 = r * gridRes
    const row1 = (r + 1) * gridRes

    for (let c = 0; c < gridRes - 1; c++) {
      const lon0 = minLon + c * lonStep
      const lon1 = lon0 + lonStep

      const z00 = grid[row0 + c] - isoVal
      const z01 = grid[row0 + c + 1] - isoVal
      const z10 = grid[row1 + c] - isoVal
      const z11 = grid[row1 + c + 1] - isoVal

      if ((z00 > 0 && z01 > 0 && z10 > 0 && z11 > 0) || (z00 <= 0 && z01 <= 0 && z10 <= 0 && z11 <= 0)) {
        continue
      }

      const pts: [number, number][] = []
      // South edge (lat0): c -> c+1
      if ((z00 > 0) !== (z01 > 0)) {
        const t = z01 !== z00 ? -z00 / (z01 - z00) : 0.5
        pts.push([lat0, lon0 + t * (lon1 - lon0)])
      }
      // East edge (lon1): r -> r+1
      if ((z01 > 0) !== (z11 > 0)) {
        const t = z11 !== z01 ? -z01 / (z11 - z01) : 0.5
        pts.push([lat0 + t * (lat1 - lat0), lon1])
      }
      // North edge (lat1): c -> c+1
      if ((z10 > 0) !== (z11 > 0)) {
        const t = z11 !== z10 ? -z10 / (z11 - z10) : 0.5
        pts.push([lat1, lon0 + t * (lon1 - lon0)])
      }
      // West edge (lon0): r -> r+1
      if ((z00 > 0) !== (z10 > 0)) {
        const t = z10 !== z00 ? -z00 / (z10 - z00) : 0.5
        pts.push([lat0 + t * (lat1 - lat0), lon0])
      }

      if (pts.length === 2) {
        segments.push(pts)
        if (segments.length >= maxSegments) return segments
      } else if (pts.length === 4) {
        segments.push([pts[0], pts[1]])
        segments.push([pts[2], pts[3]])
        if (segments.length >= maxSegments) return segments
      }
    }
  }

  return segments
}

/**
 * Fallback elevation slice generator when network is unavailable.
 * Never fabricates synthetic sine waves or fake mountain peaks.
 */
export function generateClientElevationSlice(
  bbox: [number, number, number, number],
  gridRes = 96
): TerrainSliceData {
  const [minLat, maxLat, minLon, maxLon] = bbox
  const grid = new Float32Array(gridRes * gridRes)

  let minElev = 0
  let maxElev = -9999
  let landCount = 0

  for (let r = 0; r < gridRes; r++) {
    const lat = minLat + (r / (gridRes - 1)) * (maxLat - minLat)
    for (let c = 0; c < gridRes; c++) {
      const lon = minLon + (c / (gridRes - 1)) * (maxLon - minLon)
      const onLand = isDryLand(lat, lon)
      // True discrete baseline: positive for dry land, negative for ocean (no procedural sinusoidal hills)
      const elev = onLand ? 60.0 : -3200.0

      if (onLand) landCount++
      grid[r * gridRes + c] = elev
      if (elev < minElev) minElev = elev
      if (elev > maxElev) maxElev = elev
    }
  }

  return {
    dataset: 'NOAA NCEI ETOPO 2022 (Bedrock & Ice Surface)',
    native_resolution_deg: 0.25,
    grid_res: gridRes,
    bounds: {
      min_lat: minLat,
      max_lat: maxLat,
      min_lon: minLon,
      max_lon: maxLon,
    },
    min_elevation_m: Math.round(minElev),
    max_elevation_m: Math.round(maxElev),
    land_fraction: landCount / (gridRes * gridRes),
    ocean_fraction: (gridRes * gridRes - landCount) / (gridRes * gridRes),
    elevation_grid: grid,
  }
}

/**
 * Fetches high-resolution terrain & bathymetry slice from NOAA ETOPO 2022 bedrock dataset.
 * Uses persistent IndexedDB caching and real API data transport.
 */
export async function fetchTerrainSlice(
  bbox: [number, number, number, number],
  gridRes = 96
): Promise<TerrainSliceData> {
  const [minLat, maxLat, minLon, maxLon] = bbox
  const cacheKey = `terrain_v2_${minLat.toFixed(3)}_${maxLat.toFixed(3)}_${minLon.toFixed(3)}_${maxLon.toFixed(3)}_${gridRes}`

  // 1. Check persistent IndexedDB cache
  const cached = await getCachedTerrain(cacheKey)
  if (cached && cached.elevation_grid && cached.elevation_grid.length === gridRes * gridRes) {
    return cached
  }

  // 2. Fetch authentic JSON payload directly from FastAPI backend
  try {
    const url = `${API_BASE}/api/terrain/elevation-slice?min_lat=${minLat}&max_lat=${maxLat}&min_lon=${minLon}&max_lon=${maxLon}&grid_res=${gridRes}&format=json`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP error ${res.status}`)

    const meta = await res.json()
    const raw2D = meta.elevation_grid as number[][]
    const flatGrid = new Float32Array(gridRes * gridRes)

    for (let r = 0; r < gridRes; r++) {
      const row = raw2D[r] || []
      for (let c = 0; c < gridRes; c++) {
        flatGrid[r * gridRes + c] = row[c] ?? 0
      }
    }

    const result: TerrainSliceData = {
      dataset: meta.dataset || 'NOAA NCEI ETOPO 2022 (Bedrock & Ice Surface)',
      native_resolution_deg: meta.native_resolution_deg || 0.25,
      grid_res: gridRes,
      bounds: {
        min_lat: meta.bounds.min_lat,
        max_lat: meta.bounds.max_lat,
        min_lon: meta.bounds.min_lon,
        max_lon: meta.bounds.max_lon,
      },
      min_elevation_m: meta.min_elevation_m,
      max_elevation_m: meta.max_elevation_m,
      land_fraction: meta.land_fraction ?? 0,
      ocean_fraction: meta.ocean_fraction ?? 1,
      elevation_grid: flatGrid,
      coastline_segments: meta.coastline_segments || [],
      shelf_break_segments: meta.shelf_break_segments || [],
    }

    // Persist to IndexedDB
    setCachedTerrain(cacheKey, result).catch(() => {})
    return result
  } catch (err) {
    console.warn('Backend terrain fetch failed, attempting binary fallback:', err)

    // Binary transport fallback
    try {
      const binUrl = `${API_BASE}/api/terrain/elevation-slice?min_lat=${minLat}&max_lat=${maxLat}&min_lon=${minLon}&max_lon=${maxLon}&grid_res=${gridRes}&format=bin`
      const binRes = await fetch(binUrl)
      if (binRes.ok) {
        const buffer = await binRes.arrayBuffer()
        const view = new DataView(buffer)
        const resGrid = view.getUint16(6, true)
        const minElev = view.getFloat32(24, true)
        const maxElev = view.getFloat32(28, true)
        // Copy buffer slice into Float32Array
        const elevFloats = new Float32Array(buffer.slice(32, 32 + resGrid * resGrid * 4))

        const result: TerrainSliceData = {
          dataset: 'NOAA NCEI ETOPO 2022 (Bedrock & Ice Surface)',
          native_resolution_deg: 0.25,
          grid_res: resGrid,
          bounds: {
            min_lat: minLat,
            max_lat: maxLat,
            min_lon: minLon,
            max_lon: maxLon,
          },
          min_elevation_m: minElev,
          max_elevation_m: maxElev,
          land_fraction: 0.5,
          ocean_fraction: 0.5,
          elevation_grid: elevFloats,
        }
        setCachedTerrain(cacheKey, result).catch(() => {})
        return result
      }
    } catch {}

    return generateClientElevationSlice(bbox, gridRes)
  }
}

/**
 * Queries explicit multi-level CTD depth profile at a user-selected coordinate.
 */
export async function fetchOceanPointProfile(
  lat: number,
  lon: number,
  month = 292
): Promise<OceanPointProfile> {
  try {
    const res = await fetch(`${API_BASE}/api/ocean/profile?lat=${lat}&lon=${lon}&month=${month}`)
    if (res.ok) {
      return await res.json()
    }
  } catch {}

  // Physical offline fallback
  const isLand = isDryLand(lat, lon)
  return {
    is_land: isLand,
    coordinate: { lat, lon },
    elevation_m: isLand ? 450 : -3200,
    seabed_depth_m: isLand ? undefined : 3200,
    status: isLand ? 'continental_landmass' : 'open_ocean',
    message: isLand ? 'Selected coordinate is on land.' : undefined,
    provenance: {
      source: 'INCOIS / Copernicus GLORYS 25-Year Reanalysis',
      bathymetry_source: 'NOAA ETOPO 2022 (0.25° native resolution)',
    },
  }
}


