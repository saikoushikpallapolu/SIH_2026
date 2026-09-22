import React, { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import { GLOBE_RADIUS, latLngToVector3 } from './oceanDataEngine'
import { Html } from '@react-three/drei'
import type { Selection } from './types'

const RADIUS = GLOBE_RADIUS

interface VectorBoundariesData {
  coastlines: [number, number][][]
  islands: [number, number][][]
  borders: [number, number][][]
}

/**
 * Builds a single THREE.BufferGeometry for LineSegments from a list of coordinate polylines.
 */
function buildLineSegmentsGeometry(lines: [number, number][][], altitudeOffset = 0.003): THREE.BufferGeometry {
  const positions: number[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line || line.length < 2) continue

    for (let j = 0; j < line.length - 1; j++) {
      const [lat1, lon1] = line[j]
      const [lat2, lon2] = line[j + 1]

      // Guard against longitudinal wrap-around glitches across the antimeridian
      if (Math.abs(lon2 - lon1) > 180) continue

      const p1 = latLngToVector3(lat1, lon1, RADIUS + altitudeOffset)
      const p2 = latLngToVector3(lat2, lon2, RADIUS + altitudeOffset)

      positions.push(p1.x, p1.y, p1.z)
      positions.push(p2.x, p2.y, p2.z)
    }
  }

  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  return geom
}

export const GRATICULE_LABELS = [
  // Equator Longitudes
  { lat: 0, lon: 20, text: '20°E [IO West]' },
  { lat: 0, lon: 40, text: '40°E' },
  { lat: 0, lon: 60, text: '60°E' },
  { lat: 0, lon: 80, text: '80°E [Center]' },
  { lat: 0, lon: 100, text: '100°E' },
  { lat: 0, lon: 120, text: '120°E' },
  { lat: 0, lon: 125, text: '125°E [IO East]' },
  // 80°E Central Meridian Latitudes
  { lat: 32, lon: 80, text: '32°N [IO North]' },
  { lat: 20, lon: 80, text: '20°N' },
  { lat: 10, lon: 80, text: '10°N' },
  { lat: -10, lon: 80, text: '10°S' },
  { lat: -20, lon: 80, text: '20°S' },
  { lat: -30, lon: 80, text: '30°S' },
  { lat: -40, lon: 80, text: '40°S' },
  { lat: -45, lon: 80, text: '45°S [IO South]' },
]

/**
 * Builds a complete spherical Lat/Lon Graticule coordinate grid (10° intervals),
 * Indian Ocean 309x421 canonical data domain boundary box, and 5° regional subgrid.
 */
function buildGraticuleGeometry(altitudeOffset = 0.0022): {
  standard: THREE.BufferGeometry
  major: THREE.BufferGeometry
  domainBox: THREE.BufferGeometry
  subgrid: THREE.BufferGeometry
} {
  const standardPositions: number[] = []
  const majorPositions: number[] = []
  const domainPositions: number[] = []
  const subgridPositions: number[] = []

  // 1. Parallels (every 10° from -80° to 80°)
  for (let lat = -80; lat <= 80; lat += 10) {
    const isEquator = lat === 0
    const target = isEquator ? majorPositions : standardPositions
    const step = 2.5 // smooth curved arc

    for (let lon = -180; lon < 180; lon += step) {
      const nextLon = lon + step
      const p1 = latLngToVector3(lat, lon, RADIUS + altitudeOffset)
      const p2 = latLngToVector3(lat, nextLon, RADIUS + altitudeOffset)
      target.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z)
    }
  }

  // 2. Tropics of Cancer & Capricorn (±23.44°)
  for (const lat of [23.436, -23.436]) {
    const step = 2.5
    for (let lon = -180; lon < 180; lon += step) {
      const nextLon = lon + step
      const p1 = latLngToVector3(lat, lon, RADIUS + altitudeOffset)
      const p2 = latLngToVector3(lat, nextLon, RADIUS + altitudeOffset)
      majorPositions.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z)
    }
  }

  // 3. Meridians (every 10° from -180° to 180°)
  for (let lon = -180; lon < 180; lon += 10) {
    const isPrime = lon === 0 || lon === 180 || lon === -180
    const target = isPrime ? majorPositions : standardPositions
    const step = 2.5

    for (let lat = -80; lat < 80; lat += step) {
      const nextLat = lat + step
      const p1 = latLngToVector3(lat, lon, RADIUS + altitudeOffset)
      const p2 = latLngToVector3(nextLat, lon, RADIUS + altitudeOffset)
      target.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z)
    }
  }

  // 4. Indian Ocean 309x421 Canonical Data Domain Box (20°E to 125°E, -45°S to 32°N)
  const lonMin = 20.0, lonMax = 125.0
  const latMin = -45.0, latMax = 32.0
  const stepD = 2.5

  // Top (32°N) & Bottom (-45°S)
  for (let lon = lonMin; lon < lonMax; lon += stepD) {
    const nextLon = Math.min(lonMax, lon + stepD)
    const pn1 = latLngToVector3(latMax, lon, RADIUS + altitudeOffset + 0.001)
    const pn2 = latLngToVector3(latMax, nextLon, RADIUS + altitudeOffset + 0.001)
    domainPositions.push(pn1.x, pn1.y, pn1.z, pn2.x, pn2.y, pn2.z)

    const ps1 = latLngToVector3(latMin, lon, RADIUS + altitudeOffset + 0.001)
    const ps2 = latLngToVector3(latMin, nextLon, RADIUS + altitudeOffset + 0.001)
    domainPositions.push(ps1.x, ps1.y, ps1.z, ps2.x, ps2.y, ps2.z)
  }

  // West (20°E) & East (125°E)
  for (let lat = latMin; lat < latMax; lat += stepD) {
    const nextLat = Math.min(latMax, lat + stepD)
    const pw1 = latLngToVector3(lat, lonMin, RADIUS + altitudeOffset + 0.001)
    const pw2 = latLngToVector3(nextLat, lonMin, RADIUS + altitudeOffset + 0.001)
    domainPositions.push(pw1.x, pw1.y, pw1.z, pw2.x, pw2.y, pw2.z)

    const pe1 = latLngToVector3(lat, lonMax, RADIUS + altitudeOffset + 0.001)
    const pe2 = latLngToVector3(nextLat, lonMax, RADIUS + altitudeOffset + 0.001)
    domainPositions.push(pe1.x, pe1.y, pe1.z, pe2.x, pe2.y, pe2.z)
  }

  // 5. Regional 5° Sub-grid lines inside the Indian Ocean Domain
  for (let lat = -40; lat <= 30; lat += 5) {
    if (lat % 10 === 0) continue
    for (let lon = lonMin; lon < lonMax; lon += stepD) {
      const nextLon = Math.min(lonMax, lon + stepD)
      const p1 = latLngToVector3(lat, lon, RADIUS + altitudeOffset)
      const p2 = latLngToVector3(lat, nextLon, RADIUS + altitudeOffset)
      subgridPositions.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z)
    }
  }
  for (let lon = 25; lon <= 120; lon += 5) {
    if (lon % 10 === 0) continue
    for (let lat = latMin; lat < latMax; lat += stepD) {
      const nextLat = Math.min(latMax, lat + stepD)
      const p1 = latLngToVector3(lat, lon, RADIUS + altitudeOffset)
      const p2 = latLngToVector3(nextLat, lon, RADIUS + altitudeOffset)
      subgridPositions.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z)
    }
  }

  const standardGeom = new THREE.BufferGeometry()
  standardGeom.setAttribute('position', new THREE.Float32BufferAttribute(standardPositions, 3))

  const majorGeom = new THREE.BufferGeometry()
  majorGeom.setAttribute('position', new THREE.Float32BufferAttribute(majorPositions, 3))

  const domainGeom = new THREE.BufferGeometry()
  domainGeom.setAttribute('position', new THREE.Float32BufferAttribute(domainPositions, 3))

  const subgridGeom = new THREE.BufferGeometry()
  subgridGeom.setAttribute('position', new THREE.Float32BufferAttribute(subgridPositions, 3))

  return { standard: standardGeom, major: majorGeom, domainBox: domainGeom, subgrid: subgridGeom }
}

/**
 * Key Indian Ocean Islands with verified coordinates and navigational badges.
 */
/**
 * Key Indian Ocean Islands & Coral Atolls with verified coordinates and navigational badges.
 */
export const NOTABLE_ISLANDS = [
  // Lakshadweep Archipelago (India)
  {
    id: 'lakshadweep-kavaratti',
    name: 'Kavaratti (Lakshadweep)',
    desc: 'Capital Atoll · 10.57°N, 72.64°E',
    latitude: 10.57,
    longitude: 72.64,
    color: '#00f2fe',
    ringRadius: 0.016,
  },
  {
    id: 'lakshadweep-agatti',
    name: 'Agatti & Bangaram',
    desc: 'Reef Airstrip & Coral Lagoon',
    latitude: 10.85,
    longitude: 72.18,
    color: '#00f2fe',
    ringRadius: 0.014,
  },
  {
    id: 'lakshadweep-minicoy',
    name: 'Minicoy Atoll (Maliku)',
    desc: 'Southernmost Lakshadweep Atoll',
    latitude: 8.28,
    longitude: 73.05,
    color: '#00f2fe',
    ringRadius: 0.015,
  },
  {
    id: 'lakshadweep-kadmat',
    name: 'Kadmat & Amini Atolls',
    desc: 'Central Amindivi Subgroup',
    latitude: 11.23,
    longitude: 72.78,
    color: '#00f2fe',
    ringRadius: 0.014,
  },
  {
    id: 'lakshadweep-andrott',
    name: 'Andrott Island',
    desc: 'Easternmost Lakshadweep Cay',
    latitude: 10.81,
    longitude: 73.68,
    color: '#00f2fe',
    ringRadius: 0.013,
  },

  // Andaman Islands (India)
  {
    id: 'andaman-portblair',
    name: 'Port Blair (South Andaman)',
    desc: 'Capital & Deepwater Port',
    latitude: 11.62,
    longitude: 92.73,
    color: '#38bdf8',
    ringRadius: 0.018,
  },
  {
    id: 'andaman-havelock',
    name: 'Swaraj Dweep (Havelock)',
    desc: "Ritchie's Archipelago Reefs",
    latitude: 11.98,
    longitude: 92.98,
    color: '#38bdf8',
    ringRadius: 0.014,
  },
  {
    id: 'andaman-north',
    name: 'North Andaman (Diglipur)',
    desc: 'Saddle Peak & Smith Island',
    latitude: 13.25,
    longitude: 92.98,
    color: '#38bdf8',
    ringRadius: 0.016,
  },
  {
    id: 'andaman-little',
    name: 'Little Andaman',
    desc: 'Ten Degree Channel Border',
    latitude: 10.75,
    longitude: 92.55,
    color: '#38bdf8',
    ringRadius: 0.016,
  },

  // Nicobar Islands (India)
  {
    id: 'nicobar-car',
    name: 'Car Nicobar',
    desc: 'Northernmost Nicobar Group',
    latitude: 9.16,
    longitude: 92.78,
    color: '#0ea5e9',
    ringRadius: 0.015,
  },
  {
    id: 'nicobar-great',
    name: 'Great Nicobar (Indira Point)',
    desc: 'Southernmost Indian Landmass · 6.75°N',
    latitude: 6.75,
    longitude: 93.85,
    color: '#0ea5e9',
    ringRadius: 0.020,
  },
  {
    id: 'nicobar-nancowry',
    name: 'Nancowry & Kamorta',
    desc: 'Protected Natural Harbor',
    latitude: 8.05,
    longitude: 93.53,
    color: '#0ea5e9',
    ringRadius: 0.014,
  },

  // Maldives Atolls
  {
    id: 'maldives-male',
    name: 'Malé Atoll (Kaafu)',
    desc: 'Capital Coral Atoll',
    latitude: 4.17,
    longitude: 73.51,
    color: '#2dd4bf',
    ringRadius: 0.016,
  },
  {
    id: 'maldives-addu',
    name: 'Addu Atoll (Gan)',
    desc: 'Southern Hemisphere Coral Atoll',
    latitude: -0.63,
    longitude: 73.16,
    color: '#2dd4bf',
    ringRadius: 0.016,
  },
  {
    id: 'maldives-ari',
    name: 'Ari Atoll (Alif Alif)',
    desc: 'Western Barrier Reef Rim',
    latitude: 3.80,
    longitude: 72.85,
    color: '#2dd4bf',
    ringRadius: 0.018,
  },

  // Sri Lanka
  {
    id: 'sri-lanka-jaffna',
    name: 'Jaffna & Palk Strait',
    desc: "Adam's Bridge Continental Shelf",
    latitude: 9.66,
    longitude: 80.01,
    color: '#67e8f9',
    ringRadius: 0.016,
  },

  // Chagos Archipelago
  {
    id: 'chagos-diego',
    name: 'Diego Garcia (Chagos)',
    desc: 'Submerged Chagos-Laccadive Plateau',
    latitude: -7.32,
    longitude: 72.42,
    color: '#38bdf8',
    ringRadius: 0.018,
  },

  // Seychelles
  {
    id: 'seychelles-mahe',
    name: 'Mahé (Seychelles)',
    desc: 'Granitic Mid-Ocean Bank',
    latitude: -4.67,
    longitude: 55.45,
    color: '#2dd4bf',
    ringRadius: 0.018,
  },

  // Mascarene Islands
  {
    id: 'mauritius',
    name: 'Mauritius',
    desc: 'Mascarene Subsea Plateau',
    latitude: -20.16,
    longitude: 57.50,
    color: '#38bdf8',
    ringRadius: 0.018,
  },

  // Cocos & Christmas
  {
    id: 'cocos-keeling',
    name: 'Cocos (Keeling) Atoll',
    desc: 'Eastern Indian Ocean Ring Atoll',
    latitude: -12.16,
    longitude: 96.87,
    color: '#00f2fe',
    ringRadius: 0.016,
  },
]

export function VectorGlobeOverlays({
  showCoastlines = true,
  showBorders = true,
  showIslands = true,
  showGraticule = true,
  showIslandLabels = true,
  selection,
}: {
  showCoastlines?: boolean
  showBorders?: boolean
  showIslands?: boolean
  showGraticule?: boolean
  showIslandLabels?: boolean
  selection?: Selection | null
}) {
  const [data, setData] = useState<VectorBoundariesData | null>(null)

  useEffect(() => {
    let active = true
    fetch('/data/world_vector_boundaries.json')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((json: VectorBoundariesData) => {
        if (active) setData(json)
      })
      .catch((err) => {
        console.warn('Could not load vector boundaries:', err)
      })
    return () => {
      active = false
    }
  }, [])

  // Coastlines LineSegments geometry
  const coastlinesGeom = useMemo(() => {
    if (!data?.coastlines) return null
    return buildLineSegmentsGeometry(data.coastlines, 0.003)
  }, [data])

  // Coral Reefs / Atolls LineSegments geometry
  const islandsGeom = useMemo(() => {
    if (!data?.islands) return null
    return buildLineSegmentsGeometry(data.islands, 0.0035)
  }, [data])

  // International land borders LineSegments geometry
  const bordersGeom = useMemo(() => {
    if (!data?.borders) return null
    return buildLineSegmentsGeometry(data.borders, 0.0028)
  }, [data])

  // Lat/Lon Graticule & Indian Ocean Domain geometry (altitude 0.012 so lines sit cleanly above surface)
  const graticule = useMemo(() => buildGraticuleGeometry(0.012), [])

  // Selected Grid Cell & Reticle Inspector
  const selectedCell = useMemo(() => {
    if (!selection) return null
    const LAT_MIN = -44.991667, LAT_MAX = 32.008333, N_LAT = 309
    const LON_MIN = 20.008333, LON_MAX = 125.008333, N_LON = 421
    const dLat = (LAT_MAX - LAT_MIN) / (N_LAT - 1)
    const dLon = (LON_MAX - LON_MIN) / (N_LON - 1)

    const lat = selection.latitude
    const lon = selection.longitude
    const inDomain =
      lat >= LAT_MIN - 0.5 &&
      lat <= LAT_MAX + 0.5 &&
      lon >= LON_MIN - 0.5 &&
      lon <= LON_MAX + 0.5
    if (!inDomain) return null

    const row = Math.max(0, Math.min(N_LAT - 1, Math.round((lat - LAT_MIN) / dLat)))
    const col = Math.max(0, Math.min(N_LON - 1, Math.round((lon - LON_MIN) / dLon)))
    const cellCenterLat = LAT_MIN + row * dLat
    const cellCenterLon = LON_MIN + col * dLon

    const alt = RADIUS + 0.009
    // Center selected 0.25° x 0.25° grid cell (neon magenta)
    const c0 = latLngToVector3(cellCenterLat - dLat / 2, cellCenterLon - dLon / 2, alt)
    const c1 = latLngToVector3(cellCenterLat + dLat / 2, cellCenterLon - dLon / 2, alt)
    const c2 = latLngToVector3(cellCenterLat + dLat / 2, cellCenterLon + dLon / 2, alt)
    const c3 = latLngToVector3(cellCenterLat - dLat / 2, cellCenterLon + dLon / 2, alt)

    const boxPositions = [
      c0.x, c0.y, c0.z, c1.x, c1.y, c1.z,
      c1.x, c1.y, c1.z, c2.x, c2.y, c2.z,
      c2.x, c2.y, c2.z, c3.x, c3.y, c3.z,
      c3.x, c3.y, c3.z, c0.x, c0.y, c0.z,
    ]

    // Local 7x7 Data Cell Squares Patch (49 discrete 0.25° observation cells around selection)
    const patchRadius = 3 // 7x7 grid
    const patchPositions: number[] = []
    const dotPositions: number[] = []

    for (let dr = -patchRadius; dr <= patchRadius; dr++) {
      for (let dc = -patchRadius; dc <= patchRadius; dc++) {
        const r = row + dr
        const c = col + dc
        if (r < 0 || r >= N_LAT || c < 0 || c >= N_LON) continue

        const cLat = LAT_MIN + r * dLat
        const cLon = LON_MIN + c * dLon

        // Center observation sampling node dot
        const pDot = latLngToVector3(cLat, cLon, alt + 0.001)
        dotPositions.push(pDot.x, pDot.y, pDot.z)

        // Surrounding neighbor cell borders (center cell handled separately in neon magenta)
        if (dr !== 0 || dc !== 0) {
          const p0 = latLngToVector3(cLat - dLat / 2, cLon - dLon / 2, alt)
          const p1 = latLngToVector3(cLat + dLat / 2, cLon - dLon / 2, alt)
          const p2 = latLngToVector3(cLat + dLat / 2, cLon + dLon / 2, alt)
          const p3 = latLngToVector3(cLat - dLat / 2, cLon + dLon / 2, alt)

          patchPositions.push(
            p0.x, p0.y, p0.z, p1.x, p1.y, p1.z,
            p1.x, p1.y, p1.z, p2.x, p2.y, p2.z,
            p2.x, p2.y, p2.z, p3.x, p3.y, p3.z,
            p3.x, p3.y, p3.z, p0.x, p0.y, p0.z
          )
        }
      }
    }

    // Precision crosshair lines extending across the 7x7 patch
    const chSpan = dLat * (patchRadius + 0.5)
    const chS = latLngToVector3(lat - chSpan, lon, alt + 0.001)
    const chN = latLngToVector3(lat + chSpan, lon, alt + 0.001)
    const chW = latLngToVector3(lat, lon - chSpan, alt + 0.001)
    const chE = latLngToVector3(lat, lon + chSpan, alt + 0.001)

    const crosshairPositions = [
      chS.x, chS.y, chS.z, chN.x, chN.y, chN.z,
      chW.x, chW.y, chW.z, chE.x, chE.y, chE.z,
    ]

    const boxGeom = new THREE.BufferGeometry()
    boxGeom.setAttribute('position', new THREE.Float32BufferAttribute(boxPositions, 3))

    const patchGeom = new THREE.BufferGeometry()
    patchGeom.setAttribute('position', new THREE.Float32BufferAttribute(patchPositions, 3))

    const dotsGeom = new THREE.BufferGeometry()
    dotsGeom.setAttribute('position', new THREE.Float32BufferAttribute(dotPositions, 3))

    const crossGeom = new THREE.BufferGeometry()
    crossGeom.setAttribute('position', new THREE.Float32BufferAttribute(crosshairPositions, 3))

    const badgePos = latLngToVector3(lat, lon, RADIUS + 0.016)

    return {
      row,
      col,
      lat,
      lon,
      cellCenterLat,
      cellCenterLon,
      dLat,
      dLon,
      boxGeom,
      patchGeom,
      dotsGeom,
      crossGeom,
      badgePos,
    }
  }, [selection])

  return (
    <group>
      {/* 1. Global Lat/Lon Graticule Grid Lines & Indian Ocean Data Domain */}
      {showGraticule && (
        <group>
          {/* Standard 10° global grid lines */}
          <lineSegments geometry={graticule.standard}>
            <lineBasicMaterial
              color="#0284c7"
              transparent
              opacity={0.32}
              depthWrite={false}
            />
          </lineSegments>

          {/* Regional 5° Indian Ocean subgrid lines */}
          <lineSegments geometry={graticule.subgrid}>
            <lineBasicMaterial
              color="#0284c7"
              transparent
              opacity={0.22}
              depthWrite={false}
            />
          </lineSegments>

          {/* Major Equator, Prime Meridian, & Tropics */}
          <lineSegments geometry={graticule.major}>
            <lineBasicMaterial
              color="#00f2fe"
              transparent
              opacity={0.72}
              depthWrite={false}
            />
          </lineSegments>

          {/* Indian Ocean 309x421 Canonical Data Domain Outer Boundary Box */}
          <lineSegments geometry={graticule.domainBox}>
            <lineBasicMaterial
              color="#38bdf8"
              transparent
              opacity={0.92}
              depthWrite={false}
            />
          </lineSegments>

          {/* Axis Labels along Equator & Central Meridian 80°E */}
          {GRATICULE_LABELS.map((lbl, idx) => {
            const pos = latLngToVector3(lbl.lat, lbl.lon, RADIUS + 0.005)
            return (
              <group key={`graticule-lbl-${idx}`} position={pos}>
                <Html position={[0, 0, 0.005]} center pointerEvents="none" zIndexRange={[40, 0]}>
                  <div
                    style={{
                      background: 'rgba(2, 6, 23, 0.85)',
                      border: '1px solid rgba(56, 189, 248, 0.45)',
                      borderRadius: '3px',
                      padding: '1.5px 4.5px',
                      color: '#38bdf8',
                      fontSize: '8.5px',
                      fontWeight: 600,
                      fontFamily: 'monospace, sans-serif',
                      letterSpacing: '0.04em',
                      whiteSpace: 'nowrap',
                      userSelect: 'none',
                      boxShadow: '0 2px 6px rgba(0, 0, 0, 0.5)',
                    }}
                  >
                    {lbl.text}
                  </div>
                </Html>
              </group>
            )
          })}

          {/* Selected Point 7x7 Data Cells Array (0.25° x 0.25°) & Accuracy Inspector */}
          {selectedCell && (
            <group>
              {/* Surrounding 48 neighbor 0.25° Data Cell Squares (cyan wireframe) */}
              <lineSegments geometry={selectedCell.patchGeom}>
                <lineBasicMaterial
                  color="#00f2fe"
                  transparent
                  opacity={0.48}
                  depthWrite={false}
                />
              </lineSegments>

              {/* Observation Node Sampling Dots at Center of Each 0.25° Cell */}
              <points geometry={selectedCell.dotsGeom}>
                <pointsMaterial
                  color="#38bdf8"
                  size={3.0}
                  sizeAttenuation={false}
                  transparent
                  opacity={0.75}
                  depthWrite={false}
                />
              </points>

              {/* Active Selected 0.25° Data Cell Bounding Box in vibrant neon magenta */}
              <lineSegments geometry={selectedCell.boxGeom}>
                <lineBasicMaterial
                  color="#ff007f"
                  transparent
                  opacity={1.0}
                  depthWrite={false}
                />
              </lineSegments>

              {/* Crosshair lines */}
              <lineSegments geometry={selectedCell.crossGeom}>
                <lineBasicMaterial
                  color="#ffffff"
                  transparent
                  opacity={0.65}
                  depthWrite={false}
                />
              </lineSegments>

              {/* Floating 3D Accuracy & Resolution Verification HUD Badge */}
              <Html position={selectedCell.badgePos} center pointerEvents="none" zIndexRange={[60, 0]}>
                <div
                  style={{
                    background: 'rgba(2, 6, 23, 0.95)',
                    border: '1px solid rgba(0, 242, 254, 0.8)',
                    boxShadow: '0 4px 20px rgba(0, 242, 254, 0.35)',
                    borderRadius: '7px',
                    padding: '6px 10px',
                    color: '#ffffff',
                    fontFamily: 'monospace, sans-serif',
                    fontSize: '9.5px',
                    letterSpacing: '0.02em',
                    whiteSpace: 'nowrap',
                    backdropFilter: 'blur(8px)',
                    transform: 'translateY(-28px)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '2px',
                    userSelect: 'none',
                  }}
                >
                  <div style={{ color: '#ff007f', fontWeight: 800, fontSize: '9px', letterSpacing: '0.06em' }}>
                    7×7 DATA CELLS CLUSTER (0.25° ACCURACY)
                  </div>
                  <div style={{ fontSize: '11.5px', fontWeight: 700, color: '#ffffff' }}>
                    Active Cell: Row {selectedCell.row} / 309 · Col {selectedCell.col} / 421
                  </div>
                  <div style={{ color: '#00f2fe', fontSize: '9px', fontWeight: 600 }}>
                    Cell Span: ~27.8 km × 27.8 km (773 km² per square)
                  </div>
                  <div style={{ color: '#94a3b8', fontSize: '8px' }}>
                    Coord: {Math.abs(selectedCell.lat).toFixed(2)}°{selectedCell.lat >= 0 ? 'N' : 'S'},{' '}
                    {Math.abs(selectedCell.lon).toFixed(2)}°{selectedCell.lon >= 0 ? 'E' : 'W'} · 130,089 cells in dataset
                  </div>
                </div>
              </Html>
            </group>
          )}
        </group>
      )}

      {/* 2. Razor-sharp 1:50m / 1:10m Vector Coastlines */}
      {showCoastlines && coastlinesGeom && (
        <lineSegments geometry={coastlinesGeom}>
          <lineBasicMaterial
            color="#bae6fd"
            transparent
            opacity={0.75}
            depthWrite={false}
          />
        </lineSegments>
      )}

      {/* 3. International Sovereign Land Borders */}
      {showBorders && bordersGeom && (
        <lineSegments geometry={bordersGeom}>
          <lineBasicMaterial
            color="#94a3b8"
            transparent
            opacity={0.30}
            depthWrite={false}
          />
        </lineSegments>
      )}

      {/* 4. Verified Coral Atolls & Minor Islands (Lakshadweep, Maldives, etc.) */}
      {showIslands && islandsGeom && (
        <lineSegments geometry={islandsGeom}>
          <lineBasicMaterial
            color="#00f2fe"
            transparent
            opacity={0.95}
            depthWrite={false}
          />
        </lineSegments>
      )}

      {/* 5. Clean Island HUD Labels (Shown only when showIslandLabels toggle is active, with NO obscuring concentric rings) */}
      {showIslandLabels &&
        NOTABLE_ISLANDS.map((island) => {
          const pos = latLngToVector3(island.latitude, island.longitude, RADIUS + 0.006)

          return (
            <group key={island.id} position={pos}>
              <Html position={[0, 0, 0.015]} center pointerEvents="none" zIndexRange={[50, 0]}>
                <div
                  style={{
                    background: 'rgba(2, 6, 23, 0.88)',
                    border: `1px solid ${island.color}88`,
                    boxShadow: `0 2px 10px ${island.color}33`,
                    borderRadius: '4px',
                    padding: '3px 7px',
                    color: '#ffffff',
                    fontSize: '9.5px',
                    fontWeight: 600,
                    letterSpacing: '0.02em',
                    whiteSpace: 'nowrap',
                    transform: 'translateY(-14px)',
                    backdropFilter: 'blur(6px)',
                    fontFamily: 'Inter, system-ui, sans-serif',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '1px',
                    userSelect: 'none',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span
                      style={{
                        width: '5px',
                        height: '5px',
                        borderRadius: '50%',
                        background: island.color,
                      }}
                    />
                    <span>{island.name}</span>
                  </div>
                  {island.desc && (
                    <span style={{ fontSize: '8px', color: '#94a3b8', paddingLeft: '9px' }}>
                      {island.desc}
                    </span>
                  )}
                </div>
              </Html>
            </group>
          )
        })}
    </group>
  )
}
