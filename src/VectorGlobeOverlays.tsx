import React, { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import { GLOBE_RADIUS, latLngToVector3 } from './oceanDataEngine'
import { Html } from '@react-three/drei'

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

/**
 * Builds a complete spherical Lat/Lon Graticule coordinate grid (10° intervals) as LineSegments.
 */
function buildGraticuleGeometry(altitudeOffset = 0.002): { standard: THREE.BufferGeometry; major: THREE.BufferGeometry } {
  const standardPositions: number[] = []
  const majorPositions: number[] = []

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

  // 2. Meridians (every 10° from -180° to 180°)
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

  const standardGeom = new THREE.BufferGeometry()
  standardGeom.setAttribute('position', new THREE.Float32BufferAttribute(standardPositions, 3))

  const majorGeom = new THREE.BufferGeometry()
  majorGeom.setAttribute('position', new THREE.Float32BufferAttribute(majorPositions, 3))

  return { standard: standardGeom, major: majorGeom }
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
}: {
  showCoastlines?: boolean
  showBorders?: boolean
  showIslands?: boolean
  showGraticule?: boolean
  showIslandLabels?: boolean
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

  // Lat/Lon Graticule geometry
  const graticule = useMemo(() => buildGraticuleGeometry(0.0018), [])

  return (
    <group>
      {/* 1. Global Lat/Lon Graticule Grid Lines (10° intervals) */}
      {showGraticule && (
        <>
          {/* Standard 10° grid lines */}
          <lineSegments geometry={graticule.standard}>
            <lineBasicMaterial
              color="#64748b"
              transparent
              opacity={0.16}
              depthWrite={false}
            />
          </lineSegments>
          {/* Major Equator & Prime Meridian lines */}
          <lineSegments geometry={graticule.major}>
            <lineBasicMaterial
              color="#94a3b8"
              transparent
              opacity={0.34}
              depthWrite={false}
            />
          </lineSegments>
        </>
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
