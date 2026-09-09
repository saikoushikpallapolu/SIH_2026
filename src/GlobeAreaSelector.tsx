/**
 * GlobeAreaSelector — Interactive Geographic Bounding Box Selector on the 3D Sphere.
 *
 * Implements a precision two-click workflow:
 * 1. Click 1 sets anchor corner A (Lat1, Lon1) with glowing reticle.
 * 2. Mouse movement dynamically expands the 3D geodesic rectangular boundary.
 * 3. Click 2 locks corner B (Lat2, Lon2), computes true dimensions (km), and creates a SpatialBoundary.
 */
import { Line } from '@react-three/drei'
import { useMemo } from 'react'
import * as THREE from 'three'
import type { SpatialBoundary } from './types'
import { latLngToVector3, GLOBE_RADIUS, haversineDistanceKm } from './oceanDataEngine'

interface GlobeAreaSelectorProps {
  activeBoundary: SpatialBoundary | null
  anchorCorner: { latitude: number; longitude: number } | null
  hoverCorner: { latitude: number; longitude: number } | null
  isSelecting: boolean
}

const RADIUS = GLOBE_RADIUS

export default function GlobeAreaSelector({
  activeBoundary,
  anchorCorner,
  hoverCorner,
  isSelecting,
}: GlobeAreaSelectorProps) {
  // Determine current active box bounds: prioritize in-progress drawing over existing activeBoundary
  const currentBounds = useMemo<{
    minLat: number
    maxLat: number
    minLon: number
    maxLon: number
    widthKm: number
    heightKm: number
  } | null>(() => {
    if (anchorCorner && hoverCorner) {
      const minLat = Math.min(anchorCorner.latitude, hoverCorner.latitude)
      const maxLat = Math.max(anchorCorner.latitude, hoverCorner.latitude)
      const minLon = Math.min(anchorCorner.longitude, hoverCorner.longitude)
      const maxLon = Math.max(anchorCorner.longitude, hoverCorner.longitude)
      const centerLat = (minLat + maxLat) / 2
      const centerLon = (minLon + maxLon) / 2
      const widthKm = haversineDistanceKm(centerLat, minLon, centerLat, maxLon)
      const heightKm = haversineDistanceKm(minLat, centerLon, maxLat, centerLon)
      return { minLat, maxLat, minLon, maxLon, widthKm, heightKm }
    }
    if (activeBoundary && !anchorCorner) {
      const [minLat, maxLat, minLon, maxLon] = activeBoundary.bbox
      return {
        minLat,
        maxLat,
        minLon,
        maxLon,
        widthKm: activeBoundary.width_km,
        heightKm: activeBoundary.height_km,
      }
    }
    return null
  }, [activeBoundary, anchorCorner, hoverCorner])

  // Generate 3D geodesic line vertices along the 4 borders of the spherical rectangle
  const boundaryLines = useMemo(() => {
    if (!currentBounds) return null
    const { minLat, maxLat, minLon, maxLon } = currentBounds

    const numSegs = 28
    const northPts: THREE.Vector3[] = []
    const southPts: THREE.Vector3[] = []
    const eastPts: THREE.Vector3[] = []
    const westPts: THREE.Vector3[] = []

    // North edge (maxLat)
    for (let i = 0; i <= numSegs; i++) {
      const lon = minLon + (i / numSegs) * (maxLon - minLon)
      northPts.push(latLngToVector3(maxLat, lon, RADIUS + 0.016))
    }
    // South edge (minLat)
    for (let i = 0; i <= numSegs; i++) {
      const lon = minLon + (i / numSegs) * (maxLon - minLon)
      southPts.push(latLngToVector3(minLat, lon, RADIUS + 0.016))
    }
    // West edge (minLon)
    for (let i = 0; i <= numSegs; i++) {
      const lat = minLat + (i / numSegs) * (maxLat - minLat)
      westPts.push(latLngToVector3(lat, minLon, RADIUS + 0.016))
    }
    // East edge (maxLon)
    for (let i = 0; i <= numSegs; i++) {
      const lat = minLat + (i / numSegs) * (maxLat - minLat)
      eastPts.push(latLngToVector3(lat, maxLon, RADIUS + 0.016))
    }

    return { northPts, southPts, eastPts, westPts }
  }, [currentBounds])

  // Corner anchor positions in 3D
  const cornerPositions = useMemo(() => {
    if (!currentBounds) return null
    const { minLat, maxLat, minLon, maxLon } = currentBounds
    return [
      { id: 'NW', pos: latLngToVector3(maxLat, minLon, RADIUS + 0.02) },
      { id: 'NE', pos: latLngToVector3(maxLat, maxLon, RADIUS + 0.02) },
      { id: 'SE', pos: latLngToVector3(minLat, maxLon, RADIUS + 0.02) },
      { id: 'SW', pos: latLngToVector3(minLat, minLon, RADIUS + 0.02) },
    ]
  }, [currentBounds])

  // Anchor reticle if only first corner is placed
  const singleAnchorPos = useMemo(() => {
    if (anchorCorner && !hoverCorner) {
      return latLngToVector3(anchorCorner.latitude, anchorCorner.longitude, RADIUS + 0.02)
    }
    return null
  }, [anchorCorner, hoverCorner])

  return (
    <group>
      {/* 1. Glowing Anchor Reticle when first corner is placed */}
      {singleAnchorPos && (
        <group position={singleAnchorPos}>
          <mesh>
            <sphereGeometry args={[0.025, 16, 16]} />
            <meshBasicMaterial color="#00e5ff" />
          </mesh>
          <mesh scale={2.2}>
            <sphereGeometry args={[0.025, 16, 16]} />
            <meshBasicMaterial color="#00e5ff" transparent opacity={0.35} />
          </mesh>
        </group>
      )}

      {/* 2. Geodesic Bounding Box Outline (Cyan Luminous Ribbon) */}
      {boundaryLines && (
        <>
          <Line points={boundaryLines.northPts} color="#00ffff" lineWidth={2.0} transparent opacity={0.95} />
          <Line points={boundaryLines.southPts} color="#00ffff" lineWidth={2.0} transparent opacity={0.95} />
          <Line points={boundaryLines.westPts} color="#00ffff" lineWidth={2.0} transparent opacity={0.95} />
          <Line points={boundaryLines.eastPts} color="#00ffff" lineWidth={2.0} transparent opacity={0.95} />
        </>
      )}

      {/* 3. Four Corner Glowing Anchor Reticle Pins */}
      {cornerPositions &&
        cornerPositions.map((c) => (
          <group key={c.id} position={c.pos}>
            <mesh>
              <sphereGeometry args={[0.0055, 12, 12]} />
              <meshBasicMaterial color="#00f0ff" />
            </mesh>
            <mesh scale={1.2}>
              <ringGeometry args={[0.007, 0.010, 16]} />
              <meshBasicMaterial color="#00e5ff" transparent opacity={0.65} side={THREE.DoubleSide} />
            </mesh>
          </group>
        ))}
    </group>
  )
}
