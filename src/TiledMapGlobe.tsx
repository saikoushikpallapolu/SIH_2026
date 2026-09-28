import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import {
  Globe,
  Layers,
  Compass,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Anchor,
  Activity,
  Navigation,
  Eye,
  Waves,
  Map as MapIcon,
  ChevronDown,
  ChevronRight,
  Info,
  Radio,
  Sliders,
  Sparkles,
} from 'lucide-react'
import {
  OceanVariable,
  ViewMode,
  Instrument,
  Selection,
  CoastalStation,
  CurrentSystem,
  TsunamiScenario,
  SpatialBoundary,
} from './types'

// ============================================================================
// BASEMAP STYLES: MULTI-RESOLUTION TILE PYRAMIDS (Z = 0 -> 18)
// Reverse-engineered high-fidelity GIS architecture matching InVictus & NOAA/GEBCO.
// ============================================================================

export type BasemapMode = 'ocean' | 'satellite' | 'dark'

const BASEMAP_CONFIGS: Record<
  BasemapMode,
  {
    name: string
    description: string
    style: maplibregl.StyleSpecification
  }
> = {
  ocean: {
    name: 'Ocean Bathymetry',
    description: 'GEBCO & NOAA depth contours, trenches, undersea ridges & soundings',
    style: {
      version: 8,
      sources: {
        'esri-ocean-base': {
          type: 'raster',
          tiles: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}',
          ],
          tileSize: 256,
          maxzoom: 16,
          attribution: '© Esri, GEBCO, NOAA, National Geographic',
        },
        'esri-ocean-ref': {
          type: 'raster',
          tiles: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Reference/MapServer/tile/{z}/{y}/{x}',
          ],
          tileSize: 256,
          maxzoom: 16,
        },
      },
      layers: [
        {
          id: 'esri-ocean-base-layer',
          type: 'raster',
          source: 'esri-ocean-base',
          minzoom: 0,
          maxzoom: 22,
        },
        {
          id: 'esri-ocean-ref-layer',
          type: 'raster',
          source: 'esri-ocean-ref',
          minzoom: 0,
          maxzoom: 22,
        },
      ],
    },
  },
  satellite: {
    name: 'Satellite Imagery',
    description: 'High-res sub-meter coastal reefs, atolls, harbors & topography',
    style: {
      version: 8,
      sources: {
        'esri-imagery': {
          type: 'raster',
          tiles: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          ],
          tileSize: 256,
          maxzoom: 19,
          attribution: '© Esri, Maxar, Earthstar Geographics',
        },
        'carto-labels': {
          type: 'raster',
          tiles: [
            'https://basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}@2x.png',
          ],
          tileSize: 256,
          maxzoom: 19,
        },
      },
      layers: [
        {
          id: 'esri-imagery-layer',
          type: 'raster',
          source: 'esri-imagery',
          minzoom: 0,
          maxzoom: 22,
        },
        {
          id: 'carto-labels-layer',
          type: 'raster',
          source: 'carto-labels',
          minzoom: 0,
          maxzoom: 22,
        },
      ],
    },
  },
  dark: {
    name: 'Tactical Dark',
    description: 'Nautical high-contrast cybernetic bathymetry for ocean data overlays',
    style: {
      version: 8,
      sources: {
        'carto-dark': {
          type: 'raster',
          tiles: [
            'https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}@2x.png',
          ],
          tileSize: 256,
          maxzoom: 19,
          attribution: '© CARTO, OpenStreetMap contributors',
        },
      },
      layers: [
        {
          id: 'carto-dark-layer',
          type: 'raster',
          source: 'carto-dark',
          minzoom: 0,
          maxzoom: 22,
        },
      ],
    },
  },
}

// Famous oceanographic exploration coordinates in the Indian Ocean sector
const REGIONAL_BOOKMARKS = [
  { name: 'Indian Ocean Overview', lon: 78.0, lat: 2.0, zoom: 3.0, pitch: 15 },
  { name: 'Lakshadweep Coral Reefs', lon: 72.6, lat: 10.5, zoom: 7.2, pitch: 48 },
  { name: 'Arabian Sea Upwelling', lon: 65.0, lat: 16.0, zoom: 5.2, pitch: 30 },
  { name: 'Bay of Bengal Basin', lon: 88.5, lat: 13.5, zoom: 5.0, pitch: 25 },
  { name: 'Swatch of No Ground Trench', lon: 89.2, lat: 21.0, zoom: 8.0, pitch: 52 },
  { name: 'Sunda / Java Trench (Abyssal)', lon: 98.0, lat: -1.0, zoom: 5.8, pitch: 42 },
  { name: 'Carlsberg Mid-Ocean Ridge', lon: 60.5, lat: 3.5, zoom: 6.2, pitch: 50 },
]

export interface TiledMapGlobeProps {
  variable: OceanVariable
  depth: number
  timestamp?: string
  timeIndex?: number
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
  showVectorBorders?: boolean
  showGraticule?: boolean
  showIslandLabels?: boolean
  showHotspots?: boolean
  onInstrument: (instrument: Instrument) => void
  onSelectPoint?: (selection: Selection) => void
  onSelectStation?: (station: CoastalStation) => void
  onSelectCurrentSystem?: (sys: CurrentSystem) => void
  onAreaCornerSelect?: (coord: { latitude: number; longitude: number }) => void
  onAreaHover?: (coord: { latitude: number; longitude: number }) => void
  onLaunchDive?: (lat: number, lon: number) => void
}

export function TiledMapGlobe({
  variable,
  depth,
  instruments,
  selection,
  teleportNonce,
  showStreamlines = true,
  showParticles = true,
  flowIntensity = 1.0,
  flowSpeed = 1.0,
  showIsochrones = false,
  tsunamiHour = 0,
  selectedStation,
  tsunamiScenario,
  isSelectingArea = false,
  activeBoundary,
  anchorCorner,
  hoverCorner,
  onInstrument,
  onSelectPoint,
  onSelectStation,
  onLaunchDive,
}: TiledMapGlobeProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const animFrameRef = useRef<number | null>(null)
  const canvasOverlayRef = useRef<HTMLCanvasElement | null>(null)

  // Basemap & projection state
  const [basemap, setBasemap] = useState<BasemapMode>('ocean')
  const [isGlobe, setIsGlobe] = useState<boolean>(true)
  const [zoomLevel, setZoomLevel] = useState<number>(3.2)
  const [hoverCoord, setHoverCoord] = useState<{ lat: number; lon: number } | null>(null)
  const [selectedPin, setSelectedPin] = useState<{ lat: number; lon: number; depthM: number; name: string } | null>(null)
  const [showBookmarks, setShowBookmarks] = useState(false)
  const [showLayersMenu, setShowLayersMenu] = useState(false)

  // Initialize MapLibre GL Map with 3D Globe Projection
  useEffect(() => {
    if (!containerRef.current) return

    const initialStyle = BASEMAP_CONFIGS[basemap].style

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: initialStyle,
      center: [selection?.longitude ?? 78.0, selection?.latitude ?? 10.0],
      zoom: 3.2,
      minZoom: 1,
      maxZoom: 18,
      pitch: 24,
      bearing: 0,
      attributionControl: false,
    })

    // Enable native 3D Globe projection
    if (isGlobe && typeof map.setProjection === 'function') {
      try {
        map.setProjection({ type: 'globe' })
      } catch (err) {
        console.warn('MapLibre Globe projection init:', err)
      }
    }

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true, showCompass: true }), 'top-right')

    map.on('zoom', () => {
      setZoomLevel(Number(map.getZoom().toFixed(1)))
    })

    map.on('mousemove', (e) => {
      setHoverCoord({
        lat: Number(e.lngLat.lat.toFixed(4)),
        lon: Number(e.lngLat.lng.toFixed(4)),
      })
    })

    // Click handler for inspecting coordinates & launching deep dives
    map.on('click', (e) => {
      const lat = Number(e.lngLat.lat.toFixed(4))
      const lon = Number(e.lngLat.lng.toFixed(4))
      
      // Approximate ocean bathymetric depth for coordinate
      const absLat = Math.abs(lat)
      const distFromCoast = Math.min(absLat * 60, 420)
      const estimatedDepth = Math.round(Math.min(5800, Math.max(35, distFromCoast * 12 + 180)))

      setSelectedPin({
        lat,
        lon,
        depthM: estimatedDepth,
        name: `Sector [${lat > 0 ? lat + '°N' : Math.abs(lat) + '°S'}, ${lon > 0 ? lon + '°E' : Math.abs(lon) + '°W'}]`,
      })

      if (onSelectPoint) {
        onSelectPoint({ latitude: lat, longitude: lon })
      }
    })

    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  // Switch Projection (Globe <-> Flat Mercator)
  const toggleProjection = useCallback(() => {
    const map = mapRef.current
    if (!map || typeof map.setProjection !== 'function') return

    const nextMode = !isGlobe
    setIsGlobe(nextMode)
    try {
      map.setProjection({ type: nextMode ? 'globe' : 'mercator' })
      if (!nextMode) {
        map.easeTo({ pitch: 0, duration: 800 })
      } else {
        map.easeTo({ pitch: 24, duration: 800 })
      }
    } catch (err) {
      console.warn('Projection toggle error:', err)
    }
  }, [isGlobe])

  // Switch Basemap Style seamlessly
  const handleBasemapChange = useCallback((newBasemap: BasemapMode) => {
    const map = mapRef.current
    if (!map) return

    setBasemap(newBasemap)
    const newStyle = BASEMAP_CONFIGS[newBasemap].style
    map.setStyle(newStyle, { diff: false })

    // Reapply globe projection after style swap
    map.once('style.load', () => {
      if (isGlobe && typeof map.setProjection === 'function') {
        try {
          map.setProjection({ type: 'globe' })
        } catch {
          // ignore
        }
      }
    })
  }, [isGlobe])

  // Teleport/Fly to selection when updated from sidebar or search
  useEffect(() => {
    const map = mapRef.current
    if (!map || !selection) return

    map.flyTo({
      center: [selection.longitude, selection.latitude],
      zoom: Math.max(map.getZoom(), 5.5),
      pitch: 38,
      duration: 1800,
      essential: true,
    })
  }, [selection, teleportNonce])

  // Smooth fly-to bookmark presets
  const handleFlyToBookmark = useCallback((bm: (typeof REGIONAL_BOOKMARKS)[0]) => {
    const map = mapRef.current
    if (!map) return

    map.flyTo({
      center: [bm.lon, bm.lat],
      zoom: bm.zoom,
      pitch: bm.pitch,
      duration: 2000,
      essential: true,
    })
    setShowBookmarks(false)
  }, [])

  // Manage Argo & Mooring Buoy HTML Markers with interactive glass popups
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const activeMarkers: maplibregl.Marker[] = []

    instruments.forEach((inst) => {
      const el = document.createElement('div')
      el.className = 'gis-buoy-marker'
      el.title = `${inst.name} (${inst.kind})`
      
      const isBGC = inst.kind === 'BGC-Argo'
      const isGlider = inst.kind === 'Glider'
      const color = isGlider ? '#f59e0b' : isBGC ? '#10b981' : '#00f2fe'

      el.innerHTML = `
        <div style="
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: ${color};
          border: 2px solid #ffffff;
          box-shadow: 0 0 10px ${color}, 0 0 20px rgba(0,0,0,0.5);
          cursor: pointer;
          transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
        "></div>
      `

      el.addEventListener('mouseenter', () => {
        el.style.transform = 'scale(1.55)'
      })
      el.addEventListener('mouseleave', () => {
        el.style.transform = 'scale(1.0)'
      })

      el.addEventListener('click', (e) => {
        e.stopPropagation()
        onInstrument(inst)
        map.flyTo({
          center: [inst.longitude, inst.latitude],
          zoom: 7.2,
          pitch: 42,
          duration: 1600,
        })
      })

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([inst.longitude, inst.latitude])
        .addTo(map)

      activeMarkers.push(marker)
    })

    return () => {
      activeMarkers.forEach((m) => m.remove())
    }
  }, [instruments, onInstrument])

  // Canvas-based Dynamic Ocean Currents Streamlines Animation
  useEffect(() => {
    const canvas = canvasOverlayRef.current
    const map = mapRef.current
    if (!canvas || !map || !showParticles) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const resizeCanvas = () => {
      if (!canvas || !map) return
      const rect = map.getCanvas().getBoundingClientRect()
      canvas.width = rect.width
      canvas.height = rect.height
    }

    resizeCanvas()
    map.on('resize', resizeCanvas)

    // Current particle simulation seed points in the Indian Ocean basin
    const PARTICLE_COUNT = 280
    const particles = Array.from({ length: PARTICLE_COUNT }, () => {
      const lon = 40 + Math.random() * 65
      const lat = -25 + Math.random() * 45
      return {
        lon,
        lat,
        age: Math.random() * 100,
        maxAge: 70 + Math.random() * 60,
        speedFactor: 0.8 + Math.random() * 0.5,
      }
    })

    let lastTime = performance.now()

    const renderCurrents = (now: number) => {
      const dt = Math.min((now - lastTime) / 1000, 0.1)
      lastTime = now

      ctx.clearRect(0, 0, canvas.width, canvas.height)

      const zoom = map.getZoom()
      // Scale particle visual length and opacity with zoom
      const alpha = Math.min(0.85, Math.max(0.2, 0.45 * flowIntensity))

      particles.forEach((p) => {
        p.age += 1

        // Synthetic Indian Ocean Monsoonal Current Vector Field:
        // Strong eastward Equatorial Countercurrent between 2°S and 4°N,
        // Anticyclonic Arabian Sea gyre, clockwise Bay of Bengal drift.
        let u = 0.4
        let v = 0.0

        if (p.lat > 5 && p.lon < 75) {
          // Arabian Sea clockwise gyre
          const cx = 65, cy = 15
          const dx = p.lon - cx, dy = p.lat - cy
          u = -dy * 0.05 + 0.3
          v = dx * 0.05
        } else if (p.lat > 5 && p.lon >= 75) {
          // Bay of Bengal drift
          u = 0.35
          v = 0.15
        } else if (p.lat >= -5 && p.lat <= 5) {
          // Equatorial Jet
          u = 0.85
          v = Math.sin(p.lon * 0.1) * 0.1
        } else {
          // South Indian Ocean subtropical gyre (westward drift)
          u = -0.45
          v = -0.1
        }

        const effectiveSpeed = 0.12 * flowSpeed * p.speedFactor
        const prevLng = p.lon
        const prevLat = p.lat

        p.lon += u * effectiveSpeed * dt * 8.0
        p.lat += v * effectiveSpeed * dt * 8.0

        // Wrap around boundaries
        if (p.lon > 105 || p.lon < 38 || p.lat > 28 || p.lat < -35 || p.age > p.maxAge) {
          p.lon = 42 + Math.random() * 60
          p.lat = -25 + Math.random() * 45
          p.age = 0
        }

        // Project geo coordinates to map screen coordinates
        const p1 = map.project([prevLng, prevLat])
        const p2 = map.project([p.lon, p.lat])

        // Only draw if inside screen viewport
        if (
          p2.x >= 0 &&
          p2.x <= canvas.width &&
          p2.y >= 0 &&
          p2.y <= canvas.height
        ) {
          const fade = Math.sin((p.age / p.maxAge) * Math.PI)
          ctx.beginPath()
          ctx.moveTo(p1.x, p1.y)
          ctx.lineTo(p2.x, p2.y)
          ctx.strokeStyle = `rgba(0, 242, 254, ${alpha * fade})`
          ctx.lineWidth = Math.min(2.5, Math.max(1.2, zoom * 0.28))
          ctx.lineCap = 'round'
          ctx.stroke()
        }
      })

      animFrameRef.current = requestAnimationFrame(renderCurrents)
    }

    animFrameRef.current = requestAnimationFrame(renderCurrents)

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
      map.off('resize', resizeCanvas)
    }
  }, [showParticles, flowSpeed, flowIntensity])

  return (
    <div className="gis-tiled-globe-container" style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      {/* 1. Underlying MapLibre GL Tiled Canvas (Multi-Resolution Slippy Pyramids) */}
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {/* 2. Superimposed Ocean Currents Vector Streamlines Overlay */}
      <canvas
        ref={canvasOverlayRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          zIndex: 2,
        }}
      />

      {/* 3. Sleek Floating Top Control Toolbar (Glassmorphism GIS HUD) */}
      <div
        className="gis-topbar-hud"
        style={{
          position: 'absolute',
          top: '18px',
          left: '320px',
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
        }}
      >
        {/* Basemap Style Selector Dropdown */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setShowLayersMenu(!showLayersMenu)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 14px',
              background: 'rgba(10, 20, 36, 0.82)',
              backdropFilter: 'blur(12px)',
              border: '1px solid rgba(0, 242, 254, 0.25)',
              borderRadius: '24px',
              color: '#e2e8f0',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
              transition: 'all 0.2s ease',
            }}
          >
            <Layers size={14} color="#00f2fe" />
            <span>{BASEMAP_CONFIGS[basemap].name}</span>
            <ChevronDown size={12} color="#94a3b8" />
          </button>

          {showLayersMenu && (
            <div
              style={{
                position: 'absolute',
                top: '42px',
                left: 0,
                width: '240px',
                background: 'rgba(8, 16, 30, 0.95)',
                backdropFilter: 'blur(16px)',
                border: '1px solid rgba(0, 242, 254, 0.3)',
                borderRadius: '12px',
                padding: '8px',
                boxShadow: '0 12px 32px rgba(0, 0, 0, 0.65)',
                zIndex: 20,
              }}
            >
              {(Object.keys(BASEMAP_CONFIGS) as BasemapMode[]).map((key) => {
                const item = BASEMAP_CONFIGS[key]
                const isActive = basemap === key
                return (
                  <button
                    key={key}
                    onClick={() => {
                      handleBasemapChange(key)
                      setShowLayersMenu(false)
                    }}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      width: '100%',
                      textAlign: 'left',
                      padding: '8px 10px',
                      borderRadius: '8px',
                      background: isActive ? 'rgba(0, 242, 254, 0.15)' : 'transparent',
                      border: isActive ? '1px solid rgba(0, 242, 254, 0.4)' : '1px solid transparent',
                      color: isActive ? '#00f2fe' : '#cbd5e1',
                      cursor: 'pointer',
                      marginBottom: '4px',
                      transition: 'background 0.15s ease',
                    }}
                  >
                    <span style={{ fontSize: '12px', fontWeight: 600 }}>{item.name}</span>
                    <span style={{ fontSize: '10px', color: '#94a3b8', marginTop: '2px' }}>
                      {item.description}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* 3D Globe vs 2.5D Mercator Projection Toggle */}
        <button
          onClick={toggleProjection}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 14px',
            background: isGlobe ? 'rgba(0, 242, 254, 0.18)' : 'rgba(10, 20, 36, 0.82)',
            backdropFilter: 'blur(12px)',
            border: isGlobe ? '1px solid #00f2fe' : '1px solid rgba(255, 255, 255, 0.15)',
            borderRadius: '24px',
            color: isGlobe ? '#00f2fe' : '#e2e8f0',
            fontSize: '12px',
            fontWeight: 600,
            cursor: 'pointer',
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
            transition: 'all 0.2s ease',
          }}
          title={isGlobe ? 'Switch to 2D/2.5D Planar Mercator Map' : 'Switch to 3D Spherical Earth Globe'}
        >
          {isGlobe ? <Globe size={14} color="#00f2fe" /> : <MapIcon size={14} />}
          <span>{isGlobe ? '3D Globe' : '2.5D Planar'}</span>
        </button>

        {/* Ocean Exploration Bookmarks */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setShowBookmarks(!showBookmarks)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 14px',
              background: 'rgba(10, 20, 36, 0.82)',
              backdropFilter: 'blur(12px)',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              borderRadius: '24px',
              color: '#e2e8f0',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
            }}
          >
            <Compass size={14} color="#38bdf8" />
            <span>Ocean Bookmarks</span>
            <ChevronDown size={12} color="#94a3b8" />
          </button>

          {showBookmarks && (
            <div
              style={{
                position: 'absolute',
                top: '42px',
                left: 0,
                width: '230px',
                background: 'rgba(8, 16, 30, 0.95)',
                backdropFilter: 'blur(16px)',
                border: '1px solid rgba(56, 189, 248, 0.3)',
                borderRadius: '12px',
                padding: '8px',
                boxShadow: '0 12px 32px rgba(0, 0, 0, 0.65)',
                zIndex: 20,
              }}
            >
              {REGIONAL_BOOKMARKS.map((bm) => (
                <button
                  key={bm.name}
                  onClick={() => handleFlyToBookmark(bm)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: '8px',
                    background: 'transparent',
                    border: 'none',
                    color: '#e2e8f0',
                    fontSize: '12px',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'background 0.15s ease',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(56, 189, 248, 0.15)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <span>{bm.name}</span>
                  <ChevronRight size={12} color="#94a3b8" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 4. Telemetry Glass Capsule: Zoom, Coordinates, and Depth */}
      <div
        className="gis-bottom-coords"
        style={{
          position: 'absolute',
          bottom: '22px',
          left: '320px',
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '8px 16px',
          background: 'rgba(10, 20, 36, 0.85)',
          backdropFilter: 'blur(14px)',
          border: '1px solid rgba(0, 242, 254, 0.25)',
          borderRadius: '30px',
          color: '#cbd5e1',
          fontSize: '11px',
          fontFamily: 'monospace',
          boxShadow: '0 4px 18px rgba(0, 0, 0, 0.5)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Radio size={12} color="#10b981" />
          <span style={{ color: '#10b981', fontWeight: 600 }}>MULTI-RES TILES</span>
          <span style={{ color: '#64748b' }}>•</span>
          <span>LOD Z{zoomLevel}</span>
        </div>

        {hoverCoord && (
          <>
            <span style={{ color: '#64748b' }}>•</span>
            <span>
              {hoverCoord.lat >= 0 ? `${hoverCoord.lat}°N` : `${Math.abs(hoverCoord.lat)}°S`},{' '}
              {hoverCoord.lon >= 0 ? `${hoverCoord.lon}°E` : `${Math.abs(hoverCoord.lon)}°W`}
            </span>
          </>
        )}

        <span style={{ color: '#64748b' }}>•</span>
        <span style={{ color: '#00f2fe' }}>
          {instruments.length} Buoys Active
        </span>
      </div>

      {/* 5. Clicked Point Deep Dive Launch Card */}
      {selectedPin && (
        <div
          className="gis-selected-pin-card"
          style={{
            position: 'absolute',
            bottom: '72px',
            left: '320px',
            zIndex: 15,
            width: '320px',
            background: 'rgba(8, 16, 32, 0.92)',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(0, 242, 254, 0.4)',
            borderRadius: '16px',
            padding: '16px',
            boxShadow: '0 16px 40px rgba(0, 0, 0, 0.75)',
            color: '#f8fafc',
            animation: 'fadeIn 0.2s ease',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#00f2fe', fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em' }}>
                <Activity size={12} />
                <span>OCEANOGRAPHIC SECTOR</span>
              </div>
              <h4 style={{ margin: '4px 0 2px 0', fontSize: '14px', fontWeight: 600 }}>{selectedPin.name}</h4>
            </div>
            <button
              onClick={() => setSelectedPin(null)}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#94a3b8',
                cursor: 'pointer',
                padding: '4px',
              }}
            >
              ✕
            </button>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '8px',
              margin: '12px 0',
              padding: '10px',
              background: 'rgba(15, 23, 42, 0.6)',
              borderRadius: '8px',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              fontSize: '11px',
            }}
          >
            <div>
              <span style={{ color: '#94a3b8' }}>Bathymetry:</span>
              <div style={{ color: '#38bdf8', fontWeight: 600, fontSize: '13px' }}>
                -{selectedPin.depthM} m
              </div>
            </div>
            <div>
              <span style={{ color: '#94a3b8' }}>Classification:</span>
              <div style={{ color: '#34d399', fontWeight: 600, fontSize: '13px' }}>
                {selectedPin.depthM < 200 ? 'Continental Shelf' : selectedPin.depthM < 2000 ? 'Bathyal Slope' : 'Abyssal Plain'}
              </div>
            </div>
          </div>

          {/* Launch 3D Deep Dive Button */}
          <button
            onClick={() => {
              if (onLaunchDive) {
                onLaunchDive(selectedPin.lat, selectedPin.lon)
              }
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              width: '100%',
              padding: '10px 16px',
              background: 'linear-gradient(135deg, #00f2fe 0%, #0369a1 100%)',
              border: 'none',
              borderRadius: '10px',
              color: '#ffffff',
              fontSize: '13px',
              fontWeight: 700,
              cursor: 'pointer',
              boxShadow: '0 4px 18px rgba(0, 242, 254, 0.35)',
              transition: 'transform 0.15s ease, box-shadow 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-1px)'
              e.currentTarget.style.boxShadow = '0 6px 22px rgba(0, 242, 254, 0.5)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)'
              e.currentTarget.style.boxShadow = '0 4px 18px rgba(0, 242, 254, 0.35)'
            }}
          >
            <Eye size={15} />
            <span>Launch 3D Submersible Dive Here</span>
          </button>
        </div>
      )}
    </div>
  )
}

export default TiledMapGlobe
