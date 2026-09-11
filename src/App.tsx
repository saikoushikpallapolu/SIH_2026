import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  Clock,
  Compass,
  Crosshair,
  Droplets,
  Eye,
  EyeOff,
  Globe2,
  Layers3,
  Lock,
  MapPin,
  Navigation,
  Pause,
  Play,
  Radio,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Square,
  Thermometer,
  Waves,
  Wind,
  X,
  Zap,
} from 'lucide-react'
import GlobeScene from './GlobeScene'
import ImmersiveOcean, { type DiveTelemetry } from './ImmersiveOcean'
import catalogData from '../data/processed/observations/instruments_catalog.json'
import type { Instrument as CatalogInstrument } from './types'
const instruments = catalogData as CatalogInstrument[]
import {
  BENCHMARK_REGIONS,
  CURRENT_SYSTEMS,
  DEPTH_STOPS,
  computeMarineBiomass,
  computeSpatialBoundary,
  getCompassHeading,
  getRegionalDiveProfile,
  getTsunamiScenarioById,
  isDryLand,
  isPointInIndianOcean,
  OCEAN_HOTSPOTS,
  querySubgridTelemetry,
  SCIENTIFIC_PALETTES,
  TSUNAMI_SCENARIOS,
  type OceanHotspot,
  type SubgridTelemetry,
  timestampToMonthIndex,
  monthIndexToTimestamp,
  resolveDatasetTimestamp,
} from './oceanDataEngine'
import { DEPTH_LEVELS, type CoastalStation, type CurrentSystem, type Instrument, type OceanVariable, type Selection, type SpatialBoundary, type TsunamiScenario, type ViewMode } from './types'

// Checks whether an arbitrary geographic boundary encloses any ocean / marine cells
function boundaryContainsMarine(boundary: SpatialBoundary): boolean {
  const [minLat, maxLat, minLon, maxLon] = boundary.bbox
  for (let r = 0; r <= 4; r++) {
    const lat = minLat + (r / 4) * (maxLat - minLat)
    for (let c = 0; c <= 4; c++) {
      const lon = minLon + (c / 4) * (maxLon - minLon)
      if (!isDryLand(lat, lon)) {
        return true
      }
    }
  }
  return false
}

// Converts canonical ISO date string (YYYY-MM-DD) or month index 0..299 into readable year/month
function formatEpoch(timestampOrMonthIndex: string | number): string {
  const mIndex =
    typeof timestampOrMonthIndex === 'string'
      ? timestampToMonthIndex(timestampOrMonthIndex)
      : timestampOrMonthIndex
  const year = 2000 + Math.floor(mIndex / 12)
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const month = monthNames[mIndex % 12]
  let tag = ''
  if (mIndex === 59) tag = ' · 2004 Tsunami'
  else if (mIndex === 292) tag = ' · Heatwave'
  else if (mIndex === 294) tag = ' · Monsoon Peak'
  return `${month} ${year}${tag}`
}

// Converts decimal hours after scenario earthquake origin into formatted UTC clock
function formatScenarioTime(originIso: string, hours: number): string {
  try {
    const originMs = new Date(originIso).getTime()
    const currentMs = originMs + hours * 3600 * 1000
    const date = new Date(currentMs)
    const hh = date.getUTCHours().toString().padStart(2, '0')
    const mm = date.getUTCMinutes().toString().padStart(2, '0')
    const ss = date.getUTCSeconds().toString().padStart(2, '0')
    return `${hh}:${mm}:${ss} UTC`
  } catch {
    return `+${hours.toFixed(2)}h`
  }
}

export default function App() {
  const [mode, setMode] = useState<ViewMode>(() => {
    try {
      const p = new URLSearchParams(window.location.search).get('mode')
      if (p === 'explore' || p === 'currents' || p === 'dive' || p === 'tsunami') return p
    } catch {}
    return 'explore'
  })
  const [variable, setVariable] = useState<OceanVariable>(() => {
    try {
      const p = new URLSearchParams(window.location.search).get('mode')
      if (p === 'currents') return 'currents'
    } catch {}
    return 'temperature'
  })
  const [depth, setDepth] = useState<number>(() => {
    try {
      const p = new URLSearchParams(window.location.search).get('depth')
      if (p) {
        const val = parseInt(p, 10)
        if (!isNaN(val)) return val
      }
    } catch {}
    return 0 // Surface default: displays verified real NOAA OISST daily SST
  })
  // Canonical Universal Time State (Single source of truth: ISO calendar date string YYYY-MM-DD)
  const [selectedTimestamp, setSelectedTimestamp] = useState<string>('2024-05-01')
  // Derived monthIndex (0..299) computed from canonical timestamp for backward compatibility
  const monthIndex = useMemo(() => timestampToMonthIndex(selectedTimestamp), [selectedTimestamp])
  const [isPlaying, setIsPlaying] = useState<boolean>(true)
  const [selection, setSelection] = useState<Selection>({ latitude: 3.316, longitude: 95.854 })
  const [selectedInstrument, setSelectedInstrument] = useState<Instrument | null>(null)
  const [teleportNonce, setTeleportNonce] = useState<number>(0)
  const [showInstruments, setShowInstruments] = useState<boolean>(false)
  const [overlayStrength, setOverlayStrength] = useState<number>(0.0) // Default 0.0: pristine base Earth model without data overlays
  const [showSpecialSpots, setShowSpecialSpots] = useState<boolean>(false) // Default false: clean view of globe
  const [showIslandLabels, setShowIslandLabels] = useState<boolean>(false) // Default false: clean view of globe
  const [showVectorBorders, setShowVectorBorders] = useState<boolean>(true)
  const [showGraticule, setShowGraticule] = useState<boolean>(true)
  const [telemetry, setTelemetry] = useState<SubgridTelemetry | null>(null)
  const [profileOpen, setProfileOpen] = useState<boolean>(false)
  const [zenMode, setZenMode] = useState<boolean>(false)
  const [diveTelemetry, setDiveTelemetry] = useState<DiveTelemetry>({
    depth: 24,
    depthLevelIndex: 2,
    temperature: 28.5,
    salinity: 35.2,
    density: 1024.1,
    chlorophyll: 1.85,
    currentSpeed: 0.45,
    currentU: 0.35,
    currentV: 0.18,
    temperatureProfile: [28.5, 28.2, 27.8, 26.5, 24.0, 20.5, 16.2, 12.0, 8.5, 5.2, 3.8, 2.5, 2.0, 1.8, 1.5, 1.2],
    biomass: computeMarineBiomass(1.85, 24),
    regionalProfile: getRegionalDiveProfile(12.5, 68.3, 292),
    status: 'valid',
    seabedDepth: 2500,
    isRealData: false,
    dataSource: 'Initializing...',
  })
  const [hotspotsOpen, setHotspotsOpen] = useState<boolean>(false)
  const [selectedHotspotCategory, setSelectedHotspotCategory] = useState<string>('all')

  // Filtered hotspots list based on active category
  const filteredHotspots = useMemo(() => {
    if (selectedHotspotCategory === 'all') return OCEAN_HOTSPOTS
    return OCEAN_HOTSPOTS.filter((h) => h.category === selectedHotspotCategory)
  }, [selectedHotspotCategory])

  // Currents Mode State
  const [showStreamlines, setShowStreamlines] = useState<boolean>(true)
  const [showParticles, setShowParticles] = useState<boolean>(true)
  const [flowIntensity, setFlowIntensity] = useState<number>(1.0)
  const [flowSpeed, setFlowSpeed] = useState<number>(1.0)
  const [showVectorArrows, setShowVectorArrows] = useState<boolean>(false)
  const [showCurrentLabels, setShowCurrentLabels] = useState<boolean>(true)
  const [selectedCurrentSystem, setSelectedCurrentSystem] = useState<CurrentSystem | null>(null)

  // Tsunami Simulation State & Scenario Selector
  const [selectedTsunamiId, setSelectedTsunamiId] = useState<string>(() => {
    try {
      const p = new URLSearchParams(window.location.search).get('scenario')
      if (p) return p
    } catch {}
    return '2004_sumatra'
  })
  const activeScenario = useMemo(() => getTsunamiScenarioById(selectedTsunamiId), [selectedTsunamiId])
  const [tsunamiHour, setTsunamiHour] = useState<number>(() => {
    try {
      const p = new URLSearchParams(window.location.search).get('hour')
      if (p) return parseFloat(p)
    } catch {}
    return 2.15
  })
  const [isTsunamiPlaying, setIsTsunamiPlaying] = useState<boolean>(true)
  const [tsunamiSpeed, setTsunamiSpeed] = useState<number>(1)
  const [showIsochrones, setShowIsochrones] = useState<boolean>(true)
  const [selectedStation, setSelectedStation] = useState<CoastalStation | null>(null)

  // Regional Deep Dive & Interactive Bounding Box Selection State (100% Area Selection)
  const [isSelectingArea, setIsSelectingArea] = useState<boolean>(false)
  const [activeBoundary, setActiveBoundary] = useState<SpatialBoundary | null>(null)
  const [anchorCorner, setAnchorCorner] = useState<{ latitude: number; longitude: number } | null>(null)
  const [hoverCorner, setHoverCorner] = useState<{ latitude: number; longitude: number } | null>(null)

  // Escape key cancels in-progress area selection without clearing activeBoundary
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isSelectingArea) {
        setIsSelectingArea(false)
        setAnchorCorner(null)
        setHoverCorner(null)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isSelectingArea])

  const handleToggleAreaSelection = () => {
    if (isSelectingArea) {
      // Cancelling selection: clear only anchorCorner and hoverCorner, preserve activeBoundary
      setIsSelectingArea(false)
      setAnchorCorner(null)
      setHoverCorner(null)
    } else {
      // Entering selection mode: clear in-progress anchors, preserve activeBoundary
      setIsSelectingArea(true)
      setAnchorCorner(null)
      setHoverCorner(null)
    }
  }

  const handleAreaCornerSelect = (coord: { latitude: number; longitude: number }) => {
    if (!isSelectingArea) return

    if (!anchorCorner) {
      // First click: drop Corner A with reticle
      // Rule: Do NOT clear existing activeBoundary here!
      setAnchorCorner(coord)
      setHoverCorner(null)
    } else {
      // Second click: lock bounding box
      const minLat = Math.min(anchorCorner.latitude, coord.latitude)
      const maxLat = Math.max(anchorCorner.latitude, coord.latitude)
      const minLon = Math.min(anchorCorner.longitude, coord.longitude)
      const maxLon = Math.max(anchorCorner.longitude, coord.longitude)

      // Guard against accidental double click at exact same spot (<0.2 deg)
      if (Math.abs(maxLat - minLat) < 0.2 && Math.abs(maxLon - minLon) < 0.2) {
        return
      }

      const newBoundary = computeSpatialBoundary(
        { latitude: minLat, longitude: minLon },
        { latitude: maxLat, longitude: maxLon },
        `Selected Region (${minLat.toFixed(1)}°–${maxLat.toFixed(1)}°N, ${minLon.toFixed(1)}°–${maxLon.toFixed(1)}°E)`
      )
      // Rule: Replace activeBoundary ONLY after valid second corner is completed
      setActiveBoundary(newBoundary)
      setAnchorCorner(null)
      setHoverCorner(null)
      setIsSelectingArea(false)
      setSelection({ latitude: newBoundary.center[0], longitude: newBoundary.center[1] })
    }
  }

  const handleAreaHover = (coord: { latitude: number; longitude: number }) => {
    if (isSelectingArea && anchorCorner) {
      setHoverCorner(coord)
    }
  }

  const handleBenchmarkSelect = (regionBoundary: SpatialBoundary) => {
    setActiveBoundary(regionBoundary)
    setAnchorCorner(null)
    setHoverCorner(null)
    setIsSelectingArea(false)
    setSelection({ latitude: regionBoundary.center[0], longitude: regionBoundary.center[1] })
    setTeleportNonce(Date.now())
  }

  // Query live subgrid telemetry on selection, depth, or time change
  useEffect(() => {
    let active = true
    querySubgridTelemetry(selection.latitude, selection.longitude, depth, monthIndex).then((res) => {
      if (active) setTelemetry(res)
    })
    return () => {
      active = false
    }
  }, [selection, depth, monthIndex])

  // Universal playback timer: steps canonical date month-by-month; stops cleanly at end of series
  useEffect(() => {
    if (!isPlaying || mode === 'tsunami') return
    const timer = window.setInterval(() => {
      setSelectedTimestamp((curr) => {
        const currIndex = timestampToMonthIndex(curr)
        // If reached end of valid dataset range (month index 299 = 2024-12), halt cleanly without wrapping
        if (currIndex >= 299) {
          setIsPlaying(false)
          return curr
        }
        return monthIndexToTimestamp(currIndex + 1)
      })
    }, 1200)
    return () => window.clearInterval(timer)
  }, [isPlaying, mode])

  // Playback timer for Tsunami shockwave simulation (smooth 60fps continuous animation)
  useEffect(() => {
    if (!isTsunamiPlaying || mode !== 'tsunami') return
    let animId: number
    let lastTime = performance.now()

    const loop = (now: number) => {
      const deltaSec = (now - lastTime) / 1000
      lastTime = now

      // Smooth elapsed hours progression: 1 hr simulation per ~4 seconds at 1x
      const rate = 0.25 * tsunamiSpeed
      setTsunamiHour((prev) => {
        const next = prev + deltaSec * rate
        if (next > 11.0) return 0.0
        return Math.round(next * 1000) / 1000
      })

      animId = requestAnimationFrame(loop)
    }

    animId = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(animId)
  }, [isTsunamiPlaying, tsunamiSpeed, mode])

  const palette = SCIENTIFIC_PALETTES[variable]

  const isInsideIndianOcean = isPointInIndianOcean(selection.latitude, selection.longitude)
  const canDive = isInsideIndianOcean && !telemetry?.is_land

  const handleJumpToIndianOcean = () => {
    setSelection({ latitude: 12.5, longitude: 68.3 })
    setSelectedInstrument(null)
    setTeleportNonce(Date.now())
  }

  const handlePointSelect = (coord: Selection) => {
    setSelection(coord)
    setSelectedInstrument(null)
  }

  const handleInstrumentSelect = (inst: Instrument) => {
    setSelectedInstrument(inst)
    setSelection({ latitude: inst.latitude, longitude: inst.longitude })
    setTeleportNonce(Date.now())
  }

  const handleCurrentSystemSelect = (sys: CurrentSystem) => {
    setSelectedCurrentSystem(sys)
    setSelection({ latitude: sys.lat, longitude: sys.lon })
    setTeleportNonce(Date.now())
  }

  const handleStationSelect = (st: CoastalStation) => {
    setSelectedStation(st)
    setSelection({ latitude: st.lat, longitude: st.lon })
    setTeleportNonce(Date.now())
  }

  const handleHotspotSelect = (spot: OceanHotspot) => {
    setSelection({ latitude: spot.latitude, longitude: spot.longitude })
    setDepth(spot.defaultDepth)
    setSelectedInstrument(null)
    setTeleportNonce(Date.now())
  }

  const handleTeleportCamera = () => {
    setTeleportNonce(Date.now())
  }

  const handleScenarioChange = (id: string) => {
    setSelectedTsunamiId(id)
    const sc = getTsunamiScenarioById(id)
    setTsunamiHour(0.0)
    setIsTsunamiPlaying(true)
    setSelectedStation(null)
    setSelection({ latitude: sc.epicenter.latitude, longitude: sc.epicenter.longitude })
    setTeleportNonce(Date.now())
  }

  // Calculate compass bearing for currently selected coordinate
  const compass = useMemo(() => {
    if (!telemetry) return { deg: 0, label: '000° N', knots: 0 }
    return getCompassHeading(telemetry.current_vector.u, telemetry.current_vector.v)
  }, [telemetry])

  // Active scenario impacted stations calculation
  const impactedStations = useMemo(() => {
    return activeScenario.coastal_stations.filter((st) => tsunamiHour >= st.arrival_hours)
  }, [activeScenario, tsunamiHour])

  // Stable deep dive boundary
  const diveBoundary = useMemo(() => {
    if (activeBoundary) return activeBoundary
    const lat = selection.latitude
    const lon = selection.longitude
    return computeSpatialBoundary(
      {
        latitude: Math.max(-44, lat - 2.5),
        longitude: Math.max(21, lon - 2.5),
      },
      {
        latitude: Math.min(31, lat + 2.5),
        longitude: Math.min(124, lon + 2.5),
      },
      `Region (${lat.toFixed(1)}°N, ${lon.toFixed(1)}°E)`
    )
  }, [activeBoundary, selection.latitude, selection.longitude])

  return (
    <main className="app-shell">
      {/* 3D Visual Canvas */}
      <div className="globe-wrap">
        {mode === 'dive' ? (
          <ImmersiveOcean
            variable={variable}
            selection={isInsideIndianOcean ? selection : { latitude: 12.5, longitude: 68.3 }}
            boundary={diveBoundary}
            timestamp={selectedTimestamp}
            timeIndex={monthIndex}
            onTelemetry={(tel) => {
              setDiveTelemetry(tel)
            }}
            onExit={() => setMode('explore')}
          />
        ) : (
          <GlobeScene
            variable={variable}
            depth={depth}
            timestamp={selectedTimestamp}
            timeIndex={monthIndex}
            mode={mode}
            overlayStrength={overlayStrength}
            instruments={showInstruments ? instruments : []}
            selection={selection}
            teleportNonce={teleportNonce}
            showVectorArrows={showVectorArrows}
            showCurrentLabels={showCurrentLabels}
            showStreamlines={showStreamlines}
            showParticles={showParticles}
            flowIntensity={flowIntensity}
            flowSpeed={flowSpeed}
            showIsochrones={showIsochrones}
            tsunamiHour={tsunamiHour}
            tsunamiScenario={activeScenario}
            selectedStation={selectedStation}
            isSelectingArea={isSelectingArea}
            activeBoundary={activeBoundary}
            anchorCorner={anchorCorner}
            hoverCorner={hoverCorner}
            showVectorBorders={showVectorBorders}
            showGraticule={showGraticule}
            showIslandLabels={showIslandLabels}
            showHotspots={showSpecialSpots}
            onInstrument={handleInstrumentSelect}
            onSelectPoint={handlePointSelect}
            onSelectStation={handleStationSelect}
            onSelectCurrentSystem={handleCurrentSystemSelect}
            onAreaCornerSelect={handleAreaCornerSelect}
            onAreaHover={handleAreaHover}
          />
        )}
      </div>



      {/* Zen Mode Unhide Button */}
      {zenMode && (
        <button
          className="icon-btn glass"
          style={{ position: 'absolute', top: 20, right: 20, zIndex: 50 }}
          onClick={() => setZenMode(false)}
          title="Show UI"
        >
          <Eye size={16} />
        </button>
      )}



      {/* 2. CURRENTS MODE: Floating Direction & Velocity Compass Probe HUD */}
      {!zenMode && mode === 'currents' && telemetry && (
        <aside className="currents-probe-card glass">
          <div className="probe-header">
            <div className="probe-title">
              <Wind size={15} color="#ffffff" />
              <span>CURRENT VELOCITY & BEARING</span>
            </div>
            <div className="subgrid-coords-compact">
              {Math.abs(telemetry.coordinate.latitude).toFixed(2)}°
              {telemetry.coordinate.latitude >= 0 ? 'N' : 'S'} ·{' '}
              {Math.abs(telemetry.coordinate.longitude).toFixed(2)}°
              {telemetry.coordinate.longitude >= 0 ? 'E' : 'W'}
            </div>
          </div>

          {/* Compass Gauge + Speed */}
          <div className="compass-gauge-wrap">
            <div className="compass-dial">
              <div
                className="compass-needle"
                style={{ transform: `rotate(${compass.deg}deg)` }}
              >
                <div className="needle-head" />
                <div className="needle-tail" />
              </div>
              <span className="cardinal n">N</span>
              <span className="cardinal e">E</span>
              <span className="cardinal s">S</span>
              <span className="cardinal w">W</span>
            </div>

            <div className="compass-readings">
              <div className="reading-big">
                <strong>{telemetry.current_speed_m_s.toFixed(2)}</strong>
                <span>m/s</span>
                <small>({compass.knots} kn)</small>
              </div>
              <div className="heading-badge">
                <Compass size={12} />
                <span>Bearing: <b>{compass.label}</b></span>
              </div>
            </div>
          </div>

          {/* U and V Velocity Vector Components */}
          <div className="vector-components-grid">
            <div className="comp-box">
              <span>ZONAL (u: East/West)</span>
              <strong>
                {telemetry.current_vector.u >= 0 ? '+' : ''}
                {telemetry.current_vector.u.toFixed(2)}
                <small>m/s</small>
              </strong>
            </div>
            <div className="comp-box">
              <span>MERIDIONAL (v: North/South)</span>
              <strong>
                {telemetry.current_vector.v >= 0 ? '+' : ''}
                {telemetry.current_vector.v.toFixed(2)}
                <small>m/s</small>
              </strong>
            </div>
          </div>

          {/* Fluid Flow Streamline & Motion Controls */}
          <div className="currents-toggle-row">
            <button
              className={`toggle-pill ${showStreamlines ? 'active' : ''}`}
              onClick={() => setShowStreamlines((v) => !v)}
              title="Toggle continuous curved ocean flow streamlines"
            >
              <Waves size={12} />
              <span>Streamlines: {showStreamlines ? 'ON' : 'OFF'}</span>
            </button>
            <button
              className={`toggle-pill ${showParticles ? 'active' : ''}`}
              onClick={() => setShowParticles((v) => !v)}
              title="Toggle luminous flow particles and glowing trails"
            >
              <Zap size={12} />
              <span>Particles: {showParticles ? 'ON' : 'OFF'}</span>
            </button>
          </div>

          {/* Flow Speed & Intensity Sliders */}
          <div className="flow-sliders-wrap">
            <div className="flow-slider-row">
              <span className="flow-slider-label">Flow Speed</span>
              <input
                type="range"
                min={0.5}
                max={2.5}
                step={0.1}
                value={flowSpeed}
                onChange={(e) => setFlowSpeed(parseFloat(e.target.value))}
                className="flow-range"
              />
              <span className="flow-slider-val">{flowSpeed.toFixed(1)}x</span>
            </div>
            <div className="flow-slider-row">
              <span className="flow-slider-label">Intensity</span>
              <input
                type="range"
                min={0.4}
                max={1.6}
                step={0.1}
                value={flowIntensity}
                onChange={(e) => setFlowIntensity(parseFloat(e.target.value))}
                className="flow-range"
              />
              <span className="flow-slider-val">{Math.round(flowIntensity * 100)}%</span>
            </div>
          </div>

          {/* Major Current Systems Quick-Swoop Selector */}
          <div className="current-systems-selector">
            <div className="selector-title">
              <span>MAJOR INDIAN OCEAN CURRENTS (CLICK TO FLY)</span>
            </div>
            <div className="systems-pills-scroll">
              {CURRENT_SYSTEMS.map((sys) => (
                <button
                  key={sys.id}
                  className={`sys-pill ${selectedCurrentSystem?.id === sys.id ? 'active' : ''}`}
                  onClick={() => handleCurrentSystemSelect(sys)}
                >
                  <b>{sys.name}</b>
                  <small>{sys.flowDirection}</small>
                </button>
              ))}
            </div>
          </div>
        </aside>
      )}

      {/* 3. TSUNAMI MODE: Dedicated Scenario-Driven Telemetry & Station Impact HUD */}
      {!zenMode && mode === 'tsunami' && (
        <aside className="tsunami-telemetry-card glass">
          {/* Brand Header & Zen View Toggle */}
          <div className="dock-brand-header">
            <div className="brand">
              <span className="brand-mark">
                <Waves size={15} />
              </span>
              <span className="brand-text">
                OceanScope
              </span>
              <small className="brand-badge">INDIA</small>
            </div>
            <button
              className="zen-btn"
              onClick={() => setZenMode(true)}
              title="Zen Mode (Hide UI)"
              aria-label="Hide UI"
            >
              <EyeOff size={13} />
            </button>
          </div>

          {/* Mode Navigation Buttons (Monochrome Black & White) */}
          <div className="dock-nav-grid">
            <button
              className="nav-mode-btn"
              onClick={() => {
                setMode('explore')
                setHotspotsOpen(false)
                setIsTsunamiPlaying(false)
              }}
            >
              <Globe2 size={13} />
              <span>Globe</span>
            </button>
            <button
              className="nav-mode-btn active"
              onClick={() => {
                setMode('tsunami')
                setHotspotsOpen(false)
                setIsPlaying(false)
                setIsTsunamiPlaying(true)
                setSelection({ latitude: activeScenario.epicenter.latitude, longitude: activeScenario.epicenter.longitude })
                setTeleportNonce(Date.now())
              }}
            >
              <Radio size={13} />
              <span>Tsunami</span>
            </button>
            <button
              className={`nav-mode-btn ${!boundaryContainsMarine(diveBoundary) ? 'disabled-btn' : ''}`}
              onClick={() => {
                if (!boundaryContainsMarine(diveBoundary)) return
                setMode('dive')
                setHotspotsOpen(false)
                setIsTsunamiPlaying(false)
              }}
              disabled={!boundaryContainsMarine(diveBoundary)}
              title={
                boundaryContainsMarine(diveBoundary)
                  ? "Regional 3D Deep Dive"
                  : "Selected region is inland."
              }
            >
              <Compass size={13} />
              <span>3D Dive</span>
            </button>
            <button
              className={`nav-mode-btn ${hotspotsOpen ? 'active' : ''}`}
              onClick={() => setHotspotsOpen((v) => !v)}
              title="Browse 18 Curated Biological Upwellings, Deep Trenches & Coral Atolls"
            >
              <Sparkles size={13} />
              <span>Hotspots</span>
            </button>
          </div>

          {/* Scenario Selector Dropdown */}
          <div className="tsunami-scenario-selector-wrap">
            <div className="scenario-selector-label">
              <SlidersHorizontal size={13} color="#ffffff" />
              <span>SELECT TSUNAMI PROPAGATION SCENARIO:</span>
            </div>
            <select
              className="scenario-select-dropdown"
              value={selectedTsunamiId}
              onChange={(e) => handleScenarioChange(e.target.value)}
              title="Select which historical Indian Ocean tsunami propagation to view"
            >
              {TSUNAMI_SCENARIOS.map((sc) => (
                <option key={sc.id} value={sc.id}>
                  {sc.title} ({sc.magnitude ? `Mw ${sc.magnitude}` : sc.shortName})
                </option>
              ))}
            </select>
          </div>

          <div className="tsunami-header">
            <div className="tsunami-title">
              <Radio size={16} color="#ffffff" />
              <div>
                <strong>{activeScenario.title.toUpperCase()}</strong>
                <span>{activeScenario.origin_time_label}</span>
              </div>
            </div>
            <div className="tsunami-header-actions" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                className="recenter-ocean-btn glass"
                onClick={() => {
                  setSelection({ latitude: activeScenario.epicenter.latitude, longitude: activeScenario.epicenter.longitude })
                  setTeleportNonce(Date.now())
                }}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 10,
                  padding: '4px 8px',
                  borderRadius: 6,
                  color: '#ffffff',
                  border: '1px solid rgba(255, 255, 255, 0.25)',
                  cursor: 'pointer',
                  background: '#000000'
                }}
                title="Recenter camera on Indian Ocean basin & epicenter"
              >
                <Compass size={11} /> Recenter Ocean
              </button>
              <div className="tsunami-timer-badge">
                <Clock size={12} />
                <span>+{tsunamiHour.toFixed(2)}h elapsed</span>
              </div>
            </div>
          </div>

          <div className="scenario-briefing-card">
            <div className="briefing-row">
              <span className="brief-label">FAULT MECHANISM:</span>
              <span className="brief-val">{activeScenario.mechanism}</span>
            </div>
            <p className="scenario-desc">{activeScenario.description}</p>
            <div className="incois-impact-badge">
              <span className="incois-tag">INCOIS EARLY WARNING SIGNIFICANCE:</span>
              <p>{activeScenario.incois_significance}</p>
            </div>
          </div>

          <div className="tsunami-stats-grid">
            <div className="stat-card">
              <span>SIMULATION UTC</span>
              <strong>{formatScenarioTime(activeScenario.origin_time, tsunamiHour)}</strong>
            </div>
            <div className="stat-card">
              <span>WAVEFRONT RADIUS</span>
              <strong>
                {Math.round(tsunamiHour * activeScenario.open_ocean_speed_kmh).toLocaleString()}
                <small>km</small>
              </strong>
            </div>
            <div className="stat-card">
              <span>OPEN OCEAN SPEED</span>
              <strong>
                {activeScenario.open_ocean_speed_kmh} <small>km/h</small>
              </strong>
            </div>
            <div className="stat-card alert">
              <span>COASTAL STATIONS HIT</span>
              <strong style={{ color: '#ff5252' }}>
                {impactedStations.length} / {activeScenario.coastal_stations.length}
              </strong>
            </div>
          </div>

          {/* Selected Station Details Card */}
          {selectedStation && (
            <div className="station-detail-dossier glass">
              <div className="station-dossier-header">
                <div>
                  <h4>{selectedStation.name}</h4>
                  <span>{selectedStation.region} · {selectedStation.dist_km.toLocaleString()} km from epicenter</span>
                </div>
                <button className="icon-btn" onClick={() => setSelectedStation(null)}>
                  <X size={14} />
                </button>
              </div>
              <div className="station-dossier-grid">
                <div>
                  <span>ETA / ARRIVAL</span>
                  <b>+{selectedStation.arrival_hours.toFixed(2)}h ({selectedStation.arrival_utc})</b>
                </div>
                <div>
                  <span>MAX WAVE RUNUP</span>
                  <b style={{ color: '#ff5252', fontSize: 16 }}>{selectedStation.wave_height_m} m</b>
                </div>
                <div style={{ gridColumn: 'span 2' }}>
                  <span>HISTORICAL IMPACT</span>
                  <p>{selectedStation.status}</p>
                </div>
              </div>
            </div>
          )}

          {/* Impacted Stations Ticker */}
          <div className="impact-ticker-wrap">
            <div className="ticker-label">
              <AlertTriangle size={12} color="#ffab00" />
              <span>COASTAL STATIONS ({activeScenario.coastal_stations.length})</span>
            </div>
            <div className="ticker-stations-list">
              {activeScenario.coastal_stations.map((st) => {
                const isHit = tsunamiHour >= st.arrival_hours
                return (
                  <div
                    key={st.id}
                    className={`ticker-item ${isHit ? 'hit' : 'pending'} ${selectedStation?.id === st.id ? 'active' : ''}`}
                    onClick={() => handleStationSelect(st)}
                  >
                    <span className="dot" />
                    <span className="name">{st.name}</span>
                    <span className="time">+{st.arrival_hours.toFixed(1)}h</span>
                    {isHit ? (
                      <b className="height">{st.wave_height_m}m</b>
                    ) : (
                      <small className="eta">ETA</small>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </aside>
      )}

      {/* 3. TSUNAMI MODE: Dedicated Video-Player Time Scrubber Dock */}
      {!zenMode && mode === 'tsunami' && (
        <footer className="tsunami-bottom-dock glass">
          <div className="tsunami-controls-top">
            <div className="player-transport">
              <button
                className="play-btn-big"
                onClick={() => setIsTsunamiPlaying((p) => !p)}
                aria-label={isTsunamiPlaying ? 'Pause' : 'Play'}
              >
                {isTsunamiPlaying ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
              </button>

              <button
                className="icon-transport-btn"
                onClick={() => setTsunamiHour(0.0)}
                title="Reset to 0h (Earthquake origin)"
              >
                <RotateCcw size={14} />
              </button>

              <button
                className="icon-transport-btn"
                onClick={() => setTsunamiHour((h) => Math.max(0, Math.round((h - 0.25) * 100) / 100))}
                title="Step -15 minutes"
              >
                -15m
              </button>

              <button
                className="icon-transport-btn"
                onClick={() => setTsunamiHour((h) => Math.min(12.0, Math.round((h + 0.25) * 100) / 100))}
                title="Step +15 minutes"
              >
                +15m
              </button>

              <div className="speed-pills">
                {[1, 2, 5].map((spd) => (
                  <button
                    key={spd}
                    className={tsunamiSpeed === spd ? 'active' : ''}
                    onClick={() => setTsunamiSpeed(spd)}
                  >
                    {spd}x
                  </button>
                ))}
              </div>

              <button
                className={`icon-transport-btn ${showIsochrones ? 'active' : ''}`}
                onClick={() => setShowIsochrones((v) => !v)}
                title="Toggle Travel-Time Isochrone Contours"
                style={{ fontSize: '11px', fontWeight: 600, padding: '0 8px', width: 'auto' }}
              >
                Contours
              </button>
            </div>

            {/* Time Scrubber Slider */}
            <div className="tsunami-slider-wrap">
              <div className="slider-label-row">
                <span>0.0h Origin</span>
                <span className="active-hour">
                  T+{tsunamiHour.toFixed(2)}h · {formatScenarioTime(activeScenario.origin_time, tsunamiHour)}
                </span>
                <span>12.0h Elapsed</span>
              </div>
              <input
                type="range"
                min="0"
                max="12"
                step="0.05"
                value={tsunamiHour}
                onChange={(e) => setTsunamiHour(Number(e.target.value))}
                title="Scrub tsunami shockwave propagation across Indian Ocean"
              />
            </div>
          </div>

          {/* Dynamic Scenario Milestone Jumps */}
          <div className="milestone-jumps-row">
            <span className="milestone-label">KEY MILESTONES:</span>
            {activeScenario.milestones.map((m, idx) => (
              <button
                key={idx}
                className={`milestone-btn ${Math.abs(tsunamiHour - m.hour) < 0.15 ? 'active' : ''}`}
                onClick={() => setTsunamiHour(m.hour)}
                title={m.desc}
              >
                {m.label}
              </button>
            ))}
          </div>
        </footer>
      )}



      {/* Dive HUD (Enhanced with Marine Biomass, Chlorophyll & Plankton Productivity) */}
      {!zenMode && mode === 'dive' && (
        <>
          <section className="dive-hud-clean glass">
            <div className="dive-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Compass size={13} />
                <span>
                  {Math.abs(selection.latitude).toFixed(2)}°{selection.latitude >= 0 ? 'N' : 'S'} ·{' '}
                  {Math.abs(selection.longitude).toFixed(2)}°{selection.longitude >= 0 ? 'E' : 'W'}
                </span>
              </div>
              <span
                style={{
                  fontSize: '0.68em',
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                  padding: '2px 7px',
                  borderRadius: '4px',
                  background: diveTelemetry.isRealData ? 'rgba(16, 185, 129, 0.18)' : 'rgba(56, 189, 248, 0.18)',
                  color: diveTelemetry.isRealData ? '#10b981' : '#38bdf8',
                  border: `1px solid ${diveTelemetry.isRealData ? 'rgba(16, 185, 129, 0.4)' : 'rgba(56, 189, 248, 0.4)'}`,
                }}
              >
                {diveTelemetry.isRealData ? '● NOAA GODAS 3D' : '● DIGITAL TWIN'}
              </span>
            </div>
            <div className="dive-depth-big">
              {diveTelemetry.depth === 0 ? (
                <>
                  <span style={{ fontSize: '0.62em', letterSpacing: '0.04em' }}>SURFACE</span>
                  <small style={{ fontSize: '0.45em', marginLeft: '6px' }}>0m</small>
                </>
              ) : (
                <>
                  {diveTelemetry.depth}
                  <small>m</small>
                </>
              )}
            </div>
            <div className="dive-hud-metrics-row">
              <div className="dive-chip">
                <span>TEMP</span>
                {diveTelemetry.temperature !== null ? (
                  <b>{diveTelemetry.temperature.toFixed(1)}°C</b>
                ) : diveTelemetry.status === 'below_seabed' ? (
                  <b style={{ color: '#f59e0b', fontSize: '0.85em' }}>SEABED</b>
                ) : diveTelemetry.status === 'land' ? (
                  <b style={{ color: '#ef4444', fontSize: '0.85em' }}>LAND</b>
                ) : (
                  <b style={{ color: '#94a3b8' }}>--</b>
                )}
              </div>
              {diveTelemetry.salinity !== undefined && (
                <div className="dive-chip">
                  <span>SALINITY</span>
                  {diveTelemetry.salinity !== null ? (
                    <b>{diveTelemetry.salinity.toFixed(1)} PSU</b>
                  ) : (
                    <b style={{ color: '#94a3b8' }}>--</b>
                  )}
                </div>
              )}
              {diveTelemetry.density !== undefined && diveTelemetry.density !== null && (
                <div className="dive-chip">
                  <span>DENSITY</span>
                  <b>{diveTelemetry.density.toFixed(1)} kg/m³</b>
                </div>
              )}
              {diveTelemetry.chlorophyll !== undefined && (
                <div className="dive-chip chl">
                  <span>CHL-A</span>
                  <b>{diveTelemetry.chlorophyll.toFixed(2)} mg/m³</b>
                </div>
              )}
              {diveTelemetry.seabedDepth !== undefined && diveTelemetry.seabedDepth !== null && (
                <div className="dive-chip">
                  <span>SEABED</span>
                  <b>{Math.round(diveTelemetry.seabedDepth)}m</b>
                </div>
              )}
            </div>

            {diveTelemetry.biomass && (
              <div className="dive-biomass-panel">
                <div className="biomass-badge-row">
                  <span className="pulse emerald" />
                  <span className="biomass-state-text">{diveTelemetry.biomass.school_activity.toUpperCase()}</span>
                  <span className="biomass-fish-count">· ~{diveTelemetry.biomass.estimated_fish_count} Fish</span>
                </div>
                <div className="biomass-subtext">
                  Primary Prod: <b>{diveTelemetry.biomass.primary_productivity_mg_c} mg C/m²/d</b>
                </div>
              </div>
            )}
          </section>

          <div className="dive-controls-hint glass" style={{ bottom: '130px' }}>
            <Compass size={13} />
            <span>
              <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> Move · <kbd>↑</kbd>/<kbd>Space</kbd> Ascend into Air · <kbd>↓</kbd>/<kbd>C</kbd> Dive · Drag to Look 360° · <kbd>Shift</kbd> Turbo
            </span>
          </div>

          <button
            className="back-to-globe-btn glass"
            onClick={() => setMode('explore')}
            title="Return to 3D Globe"
            style={{
              position: 'absolute',
              top: '20px',
              left: '20px',
              zIndex: 30,
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '10px 16px',
              borderRadius: '10px',
              color: '#000000',
              background: '#ffffff',
              border: '1px solid #ffffff',
              cursor: 'pointer',
              fontWeight: 700,
              fontSize: '12px',
            }}
          >
            ← Back to Globe
          </button>
        </>
      )}

      {/* Ergonomic Side Docks: All Controls on Left & Right Flanks (100% Clear Vertical View) */}
      {!zenMode && mode !== 'tsunami' && (
        <>
          {/* LEFT SIDE DOCK: Ocean Layers, Intensity/Depth Sliders & Map Annotation Toggles */}
          <aside className="side-dock-left glass" aria-label="Layers and Display Controls">
            {/* Brand Header & Zen View Toggle */}
            <div className="dock-brand-header">
              <div className="brand">
                <span className="brand-mark">
                  <Waves size={15} />
                </span>
                <span className="brand-text">
                  OceanScope
                </span>
                <small className="brand-badge">INDIA</small>
              </div>
              <button
                className="zen-btn"
                onClick={() => setZenMode(true)}
                title="Zen Mode (Hide UI)"
                aria-label="Hide UI"
              >
                <EyeOff size={13} />
              </button>
            </div>

            {/* Mode Navigation Buttons (Monochrome Black & White) */}
            <div className="dock-nav-grid">
              <button
                className={`nav-mode-btn ${mode === 'explore' && !hotspotsOpen ? 'active' : ''}`}
                onClick={() => {
                  setMode('explore')
                  setHotspotsOpen(false)
                  setIsTsunamiPlaying(false)
                }}
              >
                <Globe2 size={13} />
                <span>Globe</span>
              </button>
              <button
                className="nav-mode-btn"
                onClick={() => {
                  setMode('tsunami')
                  setHotspotsOpen(false)
                  setIsPlaying(false)
                  setIsTsunamiPlaying(true)
                  setSelection({ latitude: activeScenario.epicenter.latitude, longitude: activeScenario.epicenter.longitude })
                  setTeleportNonce(Date.now())
                }}
              >
                <Radio size={13} />
                <span>Tsunami</span>
              </button>
              <button
                className={`nav-mode-btn ${mode === 'dive' ? 'active' : ''} ${!boundaryContainsMarine(diveBoundary) ? 'disabled-btn' : ''}`}
                onClick={() => {
                  if (!boundaryContainsMarine(diveBoundary)) return
                  setMode('dive')
                  setHotspotsOpen(false)
                  setIsTsunamiPlaying(false)
                }}
                disabled={!boundaryContainsMarine(diveBoundary)}
                title={
                  boundaryContainsMarine(diveBoundary)
                    ? "Regional 3D Deep Dive"
                    : "Selected region is inland."
                }
              >
                <Compass size={13} />
                <span>3D Dive</span>
              </button>
              <button
                className={`nav-mode-btn ${hotspotsOpen ? 'active' : ''}`}
                onClick={() => setHotspotsOpen((v) => !v)}
                title="Browse 18 Curated Biological Upwellings, Deep Trenches & Coral Atolls"
              >
                <Sparkles size={13} />
                <span>Hotspots</span>
              </button>
            </div>

            {/* 1. Scientific Variables & Natural Earth Mode */}
            <div className="dock-section">
              <div className="dock-section-title">
                <Layers3 size={12} color="#ffffff" />
                <span>OCEAN LAYERS</span>
              </div>
              <div className="vertical-var-pills">
                <button
                  className={`var-pill ${overlayStrength === 0 ? 'active' : ''}`}
                  onClick={() => setOverlayStrength(0.0)}
                  title="Pristine Natural Earth Globe (0% Data Overlay, True Satellite)"
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Globe2 size={13} />
                    <span>Natural Earth</span>
                  </div>
                  <i style={{ color: '#ffffff' }} />
                </button>
                <button
                  className={`var-pill ${variable === 'temperature' && overlayStrength > 0 ? 'active' : ''}`}
                  onClick={() => {
                    setVariable('temperature')
                    if (overlayStrength === 0) setOverlayStrength(0.78)
                    if (mode === 'currents') setMode('explore')
                  }}
                  title="cmocean thermal: Sea Surface Temperature & Thermocline"
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Thermometer size={13} />
                    <span>Thermal (SST)</span>
                  </div>
                  <i style={{ color: '#ffffff' }} />
                </button>
                <button
                  className={`var-pill ${variable === 'salinity' && overlayStrength > 0 ? 'active' : ''}`}
                  onClick={() => {
                    setVariable('salinity')
                    if (overlayStrength === 0) setOverlayStrength(0.78)
                    if (mode === 'currents') setMode('explore')
                  }}
                  title="cmocean haline: Arabian Evaporation Basin vs Bengal Plumes"
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Droplets size={13} />
                    <span>Salinity</span>
                  </div>
                  <i style={{ color: '#ffffff' }} />
                </button>
                <button
                  className={`var-pill ${variable === 'chlorophyll' && overlayStrength > 0 ? 'active' : ''}`}
                  onClick={() => {
                    setVariable('chlorophyll')
                    if (overlayStrength === 0) setOverlayStrength(0.78)
                    if (mode === 'currents') setMode('explore')
                  }}
                  title="NASA alga: Coastal Upwelling Blooms vs Oligotrophic Desert"
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Sparkles size={13} />
                    <span>Chlorophyll</span>
                  </div>
                  <i style={{ color: '#ffffff' }} />
                </button>
                <button
                  className={`var-pill ${variable === 'currents' && overlayStrength > 0 ? 'active' : ''}`}
                  onClick={() => {
                    setVariable('currents')
                    if (overlayStrength === 0) setOverlayStrength(0.78)
                    setMode('currents')
                  }}
                  title="cmocean speed: Active Geodesic Streamline Flow"
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Wind size={13} />
                    <span>Ocean Currents</span>
                  </div>
                  <i style={{ color: '#ffffff' }} />
                </button>
              </div>
            </div>

            {/* 2. Intensity & Depth Sliders */}
            <div className="dock-section">
              <div className="dock-section-title">
                <SlidersHorizontal size={12} color="#ffffff" />
                <span>INTENSITY & DEPTH</span>
              </div>
              <div className="side-slider-row">
                <div className="side-slider-header">
                  <span>Data Opacity</span>
                  <b>{Math.round(overlayStrength * 100)}%</b>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={overlayStrength}
                  onChange={(e) => setOverlayStrength(parseFloat(e.target.value))}
                  title="Adjust ocean data overlay transparency"
                />
              </div>

              <div className="side-slider-row">
                <div className="side-slider-header">
                  <span>Depth Level</span>
                  <b>{depth === 0 ? 'Surface (0m)' : `${depth}m`}</b>
                </div>
                <input
                  type="range"
                  min="0"
                  max="15"
                  step="1"
                  value={(DEPTH_LEVELS as readonly number[]).indexOf(depth) >= 0 ? (DEPTH_LEVELS as readonly number[]).indexOf(depth) : 0}
                  onChange={(e) => setDepth(DEPTH_LEVELS[parseInt(e.target.value, 10)] ?? 0)}
                  title="Scrub vertical 3D depth layer (0m - 1000m)"
                />
              </div>
            </div>

            {/* 3. High-Precision Map Annotation Toggles */}
            <div className="dock-section">
              <div className="dock-section-title">
                <Globe2 size={12} color="#ffffff" />
                <span>MAP OVERLAYS</span>
              </div>

              <button
                className={`dock-toggle-item ${showSpecialSpots ? 'active' : ''}`}
                onClick={() => setShowSpecialSpots((v) => !v)}
                title="Toggle Special Ocean Spots & Upwellings (Oman, Java Trench, Sunda, etc.)"
              >
                <div className="toggle-left">
                  <Sparkles size={13} color={showSpecialSpots ? '#ffffff' : '#94a3b8'} />
                  <span>Special Spots</span>
                </div>
                <span className={`status-pill ${showSpecialSpots ? 'on' : 'off'}`}>
                  {showSpecialSpots ? 'SHOWN' : 'HIDDEN'}
                </span>
              </button>

              <button
                className={`dock-toggle-item ${showIslandLabels ? 'active' : ''}`}
                onClick={() => setShowIslandLabels((v) => !v)}
                title="Toggle Island Badges & Targets (Lakshadweep, Andaman, Nicobar, Maldives)"
              >
                <div className="toggle-left">
                  <MapPin size={13} color={showIslandLabels ? '#ffffff' : '#94a3b8'} />
                  <span>Island Badges</span>
                </div>
                <span className={`status-pill ${showIslandLabels ? 'on' : 'off'}`}>
                  {showIslandLabels ? 'SHOWN' : 'HIDDEN'}
                </span>
              </button>

              <button
                className={`dock-toggle-item ${showVectorBorders ? 'active' : ''}`}
                onClick={() => setShowVectorBorders((v) => !v)}
                title="Toggle 1:10m Vector Coastlines & Sovereign Borders"
              >
                <div className="toggle-left">
                  <Compass size={13} color={showVectorBorders ? '#ffffff' : '#94a3b8'} />
                  <span>Vector Borders</span>
                </div>
                <span className={`status-pill ${showVectorBorders ? 'on' : 'off'}`}>
                  {showVectorBorders ? 'SHOWN' : 'HIDDEN'}
                </span>
              </button>

              <button
                className={`dock-toggle-item ${showGraticule ? 'active' : ''}`}
                onClick={() => setShowGraticule((v) => !v)}
                title="Toggle 10° Spherical Lat/Lon Coordinate Grid"
              >
                <div className="toggle-left">
                  <Globe2 size={13} color={showGraticule ? '#ffffff' : '#64748b'} />
                  <span>Lat/Lon Grid</span>
                </div>
                <span className={`status-pill ${showGraticule ? 'on' : 'off'}`}>
                  {showGraticule ? 'SHOWN' : 'HIDDEN'}
                </span>
              </button>

              <button
                className={`dock-toggle-item ${showInstruments ? 'active' : ''}`}
                onClick={() => setShowInstruments((v) => !v)}
                title="Toggle In-situ Observation Instruments (Argo Floats & Gliders)"
              >
                <div className="toggle-left">
                  <Radio size={13} color={showInstruments ? '#ffffff' : '#94a3b8'} />
                  <span>Instruments</span>
                </div>
                <span className={`status-pill ${showInstruments ? 'on' : 'off'}`}>
                  {showInstruments ? 'SHOWN' : 'HIDDEN'}
                </span>
              </button>

              {/* One-Click Clean View Shortcut */}
              <button
                className="clean-view-btn"
                onClick={() => {
                  setOverlayStrength(0.0)
                  setShowSpecialSpots(false)
                  setShowIslandLabels(false)
                  setShowInstruments(false)
                }}
                title="One click to hide all overlays and location tags for a completely pure globe view"
              >
                <Eye size={13} />
                <span>Pure Clean View</span>
              </button>
            </div>
          </aside>

          {/* RIGHT SIDE DOCK: Timeline Playback, Area Selection & Live Telemetry Inspector */}
          <aside className="side-dock-right glass" aria-label="Timeline and Region Controls">
            {/* 1. 25-Year Atlas Timeline */}
            <div className="dock-section">
              <div className="dock-section-title">
                <Clock size={12} color="#ffffff" />
                <span>25-YEAR ATLAS TIMELINE</span>
              </div>

              <div className="timeline-playback-row">
                <button
                  className="play-toggle"
                  onClick={() => setIsPlaying((p) => !p)}
                  aria-label={isPlaying ? 'Pause' : 'Play'}
                >
                  {isPlaying ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" />}
                </button>
                <span className="epoch-badge">{formatEpoch(selectedTimestamp)}</span>
              </div>

              <div className="timeline-slider-wrap-side">
                <input
                  type="range"
                  min="0"
                  max="299"
                  value={monthIndex}
                  onChange={(e) => setSelectedTimestamp(monthIndexToTimestamp(Number(e.target.value)))}
                  title="Scrub across 25 years (2000 - 2024)"
                />
              </div>

              {/* Colorbar Palette */}
              {overlayStrength > 0 && (
                <div className="colorbar-wrap-side">
                  <div className="colorbar-labels">
                    <span>{palette.range[0]} {palette.unit}</span>
                    <span>{palette.range[1]} {palette.unit}</span>
                  </div>
                  <div
                    className="colorbar-bar"
                    style={{
                      background: `linear-gradient(90deg, ${palette.stops.join(', ')})`,
                    }}
                  />
                  <span className="palette-desc">{palette.name} · {palette.description}</span>
                </div>
              )}
            </div>

            {/* 2. Area Selection & Benchmark Presets */}
            <div className="dock-section">
              <div className="dock-section-title">
                <Square size={12} color="#ffffff" />
                <span>REGIONAL 3D BOUNDING BOX</span>
              </div>

              <div className="area-select-action-row">
                <button
                  className={`draw-toggle-btn ${isSelectingArea ? 'active' : ''}`}
                  onClick={handleToggleAreaSelection}
                  title={isSelectingArea ? 'Cancel area selection (Esc)' : 'Draw geographic bounding box on globe'}
                >
                  {isSelectingArea ? <X size={13} /> : <Crosshair size={13} />}
                  <span>{isSelectingArea ? 'Cancel Selection' : 'Select Area'}</span>
                </button>
                {activeBoundary && !isSelectingArea && (
                  <button
                    className="benchmark-chip"
                    onClick={() => {
                      setActiveBoundary(null)
                      setAnchorCorner(null)
                      setHoverCorner(null)
                    }}
                    title="Clear current area selection"
                  >
                    <X size={11} /> Clear
                  </button>
                )}
              </div>

              <div className="side-instructions">
                {anchorCorner
                  ? `✦ Corner A: (${anchorCorner.latitude.toFixed(1)}°, ${anchorCorner.longitude.toFixed(1)}°) — Click opposite corner`
                  : isSelectingArea
                  ? '✦ Click globe to set first corner (Esc to cancel)'
                  : activeBoundary
                  ? `✦ Selected: ${activeBoundary.label || 'Region'} (${activeBoundary.width_km} × ${activeBoundary.height_km} km)`
                  : '✦ Click \'Select Area\' to draw a 3D bounding box'}
              </div>

              <div className="benchmark-chips-grid">
                {BENCHMARK_REGIONS.map((reg) => (
                  <button
                    key={reg.id}
                    className={`benchmark-chip ${activeBoundary?.label === reg.name ? 'active' : ''}`}
                    onClick={() => handleBenchmarkSelect(reg.boundary)}
                    title={reg.subtitle}
                  >
                    {reg.name.split('&')[0].trim()}
                  </button>
                ))}
              </div>

              {activeBoundary && boundaryContainsMarine(activeBoundary) && (
                <button
                  className="dive-now-btn"
                  style={{ marginTop: '8px' }}
                  onClick={() => {
                    setMode('dive')
                    setIsTsunamiPlaying(false)
                  }}
                  title="Enter 3D Digital Twin Block with true ETOPO bathymetry"
                >
                  <Navigation size={13} />
                  <span>3D Deep Dive ({activeBoundary.width_km} × {activeBoundary.height_km} km)</span>
                </button>
              )}
            </div>

            {/* 3. Live Coordinate Telemetry Inspector */}
            {telemetry && (
              <div className="dock-section">
                <div className="dock-section-title">
                  <Compass size={12} color="#ffffff" />
                  <span>TELEMETRY INSPECTOR</span>
                </div>

                <div className="telemetry-compact-grid">
                  <div className="tel-item">
                    <label>COORDINATE</label>
                    <span>
                      {Math.abs(selection.latitude).toFixed(2)}°{selection.latitude >= 0 ? 'N' : 'S'},{' '}
                      {Math.abs(selection.longitude).toFixed(2)}°{selection.longitude >= 0 ? 'E' : 'W'}
                    </span>
                  </div>
                  <div className="tel-item">
                    <label>SEABED</label>
                    <span>{Math.round(telemetry.seabed_depth_m).toLocaleString()} m</span>
                  </div>
                  <div className="tel-item">
                    <label>SST / TEMP</label>
                    <span>{telemetry.temperature_c.toFixed(1)}°C</span>
                  </div>
                  <div className="tel-item">
                    <label>SALINITY</label>
                    <span>{telemetry.salinity_psu.toFixed(1)} PSU</span>
                  </div>
                  {telemetry.current_speed_m_s !== undefined && (
                    <div className="tel-item" style={{ gridColumn: 'span 2' }}>
                      <label>SURFACE CURRENT</label>
                      <span>{telemetry.current_speed_m_s.toFixed(2)} m/s ({compass.label})</span>
                    </div>
                  )}
                </div>

                <button
                  className="view-profile-btn"
                  onClick={() => setProfileOpen(true)}
                  title="Open full depth profile curve modal"
                >
                  <Activity size={12} /> View CTD Depth Profile
                </button>
              </div>
            )}
          </aside>
        </>
      )}

      {/* Collapsible Depth Profile Drawer / Modal */}
      {profileOpen && telemetry && (
        <aside className="profile-drawer glass" aria-label="Depth Profile Curve">
          <div className="profile-header">
            <div>
              <h3>Water Column Profile</h3>
              <span>
                {telemetry.basin} · {Math.abs(telemetry.coordinate.latitude).toFixed(2)}°N,{' '}
                {Math.abs(telemetry.coordinate.longitude).toFixed(2)}°E
              </span>
            </div>
            <button className="icon-btn" onClick={() => setProfileOpen(false)} aria-label="Close">
              <X size={16} />
            </button>
          </div>

          <DepthProfileChart telemetry={telemetry} currentDepth={depth} />

          <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#7faab8', fontFamily: 'DM Mono' }}>
            <span>Seabed: <b>{Math.round(telemetry.seabed_depth_m).toLocaleString()} m</b></span>
            <span>Source: <b>25-Yr 4D Binary Cube</b></span>
          </div>
        </aside>
      )}

      {/* Collapsible Ocean Hotspots & Biomes Drawer */}
      {hotspotsOpen && (
        <aside className="hotspots-drawer glass" aria-label="Ocean Hotspots & Biomes">
          <div className="hotspots-header">
            <div className="title-row">
              <Sparkles size={16} color="#10b981" />
              <div>
                <h3>Ocean Hotspots & Biomes</h3>
                <span>18 Curated Biological Upwellings, Deep Trenches & Coral Atolls</span>
              </div>
            </div>
            <button className="icon-btn" onClick={() => setHotspotsOpen(false)} aria-label="Close">
              <X size={16} />
            </button>
          </div>

          {/* Filter category pills */}
          <div className="hotspot-filter-pills">
            {[
              { id: 'all', label: 'All Hotspots (18)' },
              { id: 'bloom_upwelling', label: 'Upwelling Blooms (8)' },
              { id: 'trench_abyss', label: 'Deep Trenches (3)' },
              { id: 'delta_estuary', label: 'River Plumes (3)' },
              { id: 'coral_atoll', label: 'Coral Atolls (2)' },
              { id: 'volcanic_ridge', label: 'Volcanic Ridges (2)' },
            ].map((cat) => (
              <button
                key={cat.id}
                className={`filter-pill ${selectedHotspotCategory === cat.id ? 'active' : ''}`}
                onClick={() => setSelectedHotspotCategory(cat.id)}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {/* Scrollable list of hotspot cards */}
          <div className="hotspots-scroll-list">
            {filteredHotspots.map((spot) => (
              <div
                key={spot.id}
                className={`hotspot-card glass ${Math.abs(selection.latitude - spot.latitude) < 0.2 && Math.abs(selection.longitude - spot.longitude) < 0.2 ? 'active' : ''}`}
                onClick={() => handleHotspotSelect(spot)}
              >
                <div className="hotspot-card-top">
                  <div className="hotspot-name-block">
                    <h4>{spot.name}</h4>
                    <p>{spot.subtitle}</p>
                  </div>
                  <span
                    className="hotspot-category-badge"
                    style={{
                      borderColor: spot.badgeColor,
                      color: spot.badgeColor,
                      background: `${spot.badgeColor}18`,
                    }}
                  >
                    {spot.categoryLabel}
                  </span>
                </div>

                <p className="hotspot-description">{spot.description}</p>

                <div className="hotspot-card-footer">
                  <div className="hotspot-geo-tag">
                    <MapPin size={11} />
                    <span>
                      {Math.abs(spot.latitude).toFixed(1)}°{spot.latitude >= 0 ? 'N' : 'S'},{' '}
                      {Math.abs(spot.longitude).toFixed(1)}°{spot.longitude >= 0 ? 'E' : 'W'} · Depth: {spot.defaultDepth}m
                    </span>
                  </div>
                  <div className="hotspot-actions">
                    <button
                      className="hotspot-fly-btn"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleHotspotSelect(spot)
                      }}
                    >
                      <Crosshair size={11} /> Swoop
                    </button>
                    {isPointInIndianOcean(spot.latitude, spot.longitude) && (
                      <button
                        className="hotspot-dive-btn"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleHotspotSelect(spot)
                          setMode('dive')
                          setHotspotsOpen(false)
                        }}
                      >
                        <Navigation size={11} /> Dive In
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </aside>
      )}
    </main>
  )
}

function DepthProfileChart({
  telemetry,
  currentDepth,
}: {
  telemetry: SubgridTelemetry
  currentDepth: number
}) {
  const temps = telemetry.ctd_profile.temperatures
  const depths = DEPTH_STOPS.slice(0, temps.length)

  const minTemp = 2
  const maxTemp = 32
  const maxPlotDepth = 2000

  const width = 340
  const height = 180
  const padL = 35
  const padR = 20
  const padT = 15
  const padB = 25

  const points = depths.map((d, i) => {
    const t = temps[i] ?? 20
    const clampedD = Math.min(d, maxPlotDepth)
    const x = padL + ((t - minTemp) / (maxTemp - minTemp)) * (width - padL - padR)
    const y = padT + (clampedD / maxPlotDepth) * (height - padT - padB)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')

  const currentY = padT + (Math.min(currentDepth, maxPlotDepth) / maxPlotDepth) * (height - padT - padB)

  return (
    <svg className="profile-chart-svg" viewBox={`0 0 ${width} ${height}`}>
      {[0, 500, 1000, 1500, 2000].map((d) => {
        const y = padT + (d / maxPlotDepth) * (height - padT - padB)
        return (
          <g key={d}>
            <line x1={padL} x2={width - padR} y1={y} y2={y} className="chart-grid-line" />
            <text x={padL - 6} y={y + 3} textAnchor="end" fill="#6991a0" fontSize={8}>
              {d}m
            </text>
          </g>
        )
      })}

      {[5, 15, 25].map((tempVal) => {
        const x = padL + ((tempVal - minTemp) / (maxTemp - minTemp)) * (width - padL - padR)
        return (
          <g key={tempVal}>
            <line x1={x} x2={x} y1={padT} y2={height - padB} className="chart-grid-line" />
            <text x={x} y={height - 8} textAnchor="middle" fill="#6991a0" fontSize={8}>
              {tempVal}°C
            </text>
          </g>
        )
      })}

      <polyline
        points={points}
        fill="none"
        stroke="#00f2fe"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      <line
        x1={padL}
        x2={width - padR}
        y1={currentY}
        y2={currentY}
        stroke="#ffd166"
        strokeWidth={1.5}
        strokeDasharray="4 2"
      />
      <text x={width - padR} y={currentY - 4} textAnchor="end" fill="#ffd166" fontSize={8}>
        Active Depth: {currentDepth}m
      </text>
    </svg>
  )
}
