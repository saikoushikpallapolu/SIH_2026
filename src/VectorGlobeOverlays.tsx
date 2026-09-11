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
export const NOTABLE_ISLANDS = [
  {
    id: 'lakshadweep',
    name: 'Lakshadweep Archipelago',
    desc: '36 Coral Atolls & Cays · Kavaratti · Agatti',
    latitude: 10.57,
    longitude: 72.64,
    color: '#00f2fe',
  },
  {
    id: 'andaman',
    name: 'Andaman Islands',
    desc: 'Great Andaman Chain · Port Blair',
    latitude: 11.67,
    longitude: 92.73,
    color: '#38bdf8',
  },
  {
    id: 'nicobar',
    name: 'Nicobar Islands',
    desc: 'Great & Car Nicobar · Indira Point',
    latitude: 7.00,
    longitude: 93.85,
    color: '#38bdf8',
  },
  {
    id: 'maldives',
    name: 'Maldives Atolls',
    desc: 'Coral Atoll Ridge · Malé',
    latitude: 4.17,
    longitude: 73.51,
    color: '#2dd4bf',
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

      {/* 5. Prominent 3D Island Target Rings & HUD Labels */}
      {showIslandLabels &&
        NOTABLE_ISLANDS.map((island) => {
          const pos = latLngToVector3(island.latitude, island.longitude, RADIUS + 0.008)
          const normal = pos.clone().normalize()
          const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal)

          return (
            <group key={island.id} position={pos} quaternion={q}>
              {/* Subtle glowing atoll halo ring */}
              <mesh>
                <ringGeometry args={[0.012, 0.022, 20]} />
                <meshBasicMaterial
                  color={island.color}
                  transparent
                  opacity={0.65}
                  side={THREE.DoubleSide}
                />
              </mesh>
              <mesh position={[0, 0, 0.008]}>
                <sphereGeometry args={[0.004, 12, 12]} />
                <meshBasicMaterial color={island.color} />
              </mesh>

              {/* Floating HTML HUD label */}
              <Html position={[0, 0, 0.025]} center pointerEvents="none" zIndexRange={[50, 0]}>
                <div
                  style={{
                    background: 'rgba(2, 6, 23, 0.85)',
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
                    alignItems: 'center',
                    gap: '4px',
                    userSelect: 'none',
                  }}
                >
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
              </Html>
            </group>
          )
        })}
    </group>
  )
}
