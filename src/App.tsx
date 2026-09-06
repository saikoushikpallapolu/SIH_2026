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
  MapPin,
  Navigation,
  Pause,
  Play,
  Radio,
  RotateCcw,
  SlidersHorizontal,
  Thermometer,
  Waves,
  Wind,
  X,
  Zap,
} from 'lucide-react'
import GlobeScene from './GlobeScene'
import ImmersiveOcean from './ImmersiveOcean'
import { instruments } from './mockOceanData'
import {
  CURRENT_SYSTEMS,
  DEPTH_STOPS,
  getCompassHeading,
  getTsunamiScenarioById,
  querySubgridTelemetry,
  SCIENTIFIC_PALETTES,
  TSUNAMI_SCENARIOS,
  type SubgridTelemetry,
} from './oceanDataEngine'
import type { CoastalStation, CurrentSystem, Instrument, OceanVariable, Selection, TsunamiScenario, ViewMode } from './types'

// Converts month index 0..299 into readable year/month
function formatEpoch(monthIndex: number): string {
  const year = 2000 + Math.floor(monthIndex / 12)
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const month = monthNames[monthIndex % 12]
  let tag = ''
  if (monthIndex === 59) tag = ' · 2004 Tsunami'
  else if (monthIndex === 292) tag = ' · Heatwave'
  else if (monthIndex === 294) tag = ' · Monsoon Peak'
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
  const [variable, setVariable] = useState<OceanVariable>('temperature')
  const [mode, setMode] = useState<ViewMode>(() => {
    try {
      const p = new URLSearchParams(window.location.search).get('mode')
      if (p === 'explore' || p === 'currents' || p === 'dive') return p
    } catch {}
    return 'tsunami'
  })
  const [depth, setDepth] = useState<number>(25)
  const [monthIndex, setMonthIndex] = useState<number>(292) // May 2024 pre-monsoon heatwave baseline
  const [isPlaying, setIsPlaying] = useState<boolean>(false)
  const [selection, setSelection] = useState<Selection>({ latitude: 3.316, longitude: 95.854 })
  const [selectedInstrument, setSelectedInstrument] = useState<Instrument | null>(null)
  const [teleportNonce, setTeleportNonce] = useState<number>(0)
  const [telemetry, setTelemetry] = useState<SubgridTelemetry | null>(null)
  const [profileOpen, setProfileOpen] = useState<boolean>(false)
  const [zenMode, setZenMode] = useState<boolean>(false)
  const [diveTelemetry, setDiveTelemetry] = useState({ depth: 460, temperature: 26.1 })

  // Currents Mode State
  const [showVectorArrows, setShowVectorArrows] = useState<boolean>(true)
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

  // Playback timer for 25-year time steps (Explore mode)
  useEffect(() => {
    if (!isPlaying || mode === 'tsunami') return
    const timer = window.setInterval(() => {
      setMonthIndex((prev) => (prev + 1) % 300)
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

  return (
    <main className="app-shell">
      {/* 3D Visual Canvas */}
      <div className="globe-wrap">
        {mode === 'dive' ? (
          <ImmersiveOcean
            variable={variable}
            selection={selection}
            timeIndex={Math.floor(monthIndex / 50)}
            onTelemetry={(tel) => {
              setDiveTelemetry(tel)
              setDepth(tel.depth)
            }}
          />
        ) : (
          <GlobeScene
            variable={variable}
            depth={depth}
            timeIndex={monthIndex % 12}
            mode={mode}
            overlayStrength={0.78}
            instruments={instruments}
            selection={selection}
            teleportNonce={teleportNonce}
            showVectorArrows={showVectorArrows}
            showCurrentLabels={showCurrentLabels}
            showIsochrones={showIsochrones}
            tsunamiHour={tsunamiHour}
            tsunamiScenario={activeScenario}
            selectedStation={selectedStation}
            onInstrument={handleInstrumentSelect}
            onSelectPoint={handlePointSelect}
            onSelectStation={handleStationSelect}
            onSelectCurrentSystem={handleCurrentSystemSelect}
          />
        )}
      </div>

      {/* Minimalist Topbar */}
      {!zenMode && (
        <header className="topbar glass">
          <div className="brand">
            <span className="brand-mark">
              <Waves size={16} />
            </span>
            <span>
              Ocean<span>Scope</span>
            </span>
            <small>INDIA</small>
          </div>

          <div className="nav-center">
            <button
              className={mode === 'explore' ? 'active' : ''}
              onClick={() => {
                setMode('explore')
                setIsTsunamiPlaying(false)
              }}
            >
              <Globe2 size={14} /> Globe
            </button>
            <button
              className={mode === 'currents' ? 'active' : ''}
              onClick={() => {
                setMode('currents')
                setVariable('currents')
                setIsTsunamiPlaying(false)
              }}
            >
              <Wind size={14} /> Ocean Currents
            </button>
            <button
              className={mode === 'tsunami' ? 'active' : ''}
              onClick={() => {
                setMode('tsunami')
                setIsPlaying(false)
                setIsTsunamiPlaying(true)
                setSelection({ latitude: activeScenario.epicenter.latitude, longitude: activeScenario.epicenter.longitude })
                setTeleportNonce(Date.now())
              }}
            >
              <Radio size={14} /> Tsunami Visualisation
            </button>
            <button
              className={mode === 'dive' ? 'active' : ''}
              onClick={() => {
                setMode('dive')
                setIsTsunamiPlaying(false)
              }}
            >
              <Compass size={14} /> Ocean Dive
            </button>
          </div>

          <div className="topbar-actions">
            {mode === 'tsunami' ? (
              <div className="status-badge alert">
                <span className="pulse red" />
                <span>{activeScenario.shortName.toUpperCase()} PROPAGATION</span>
              </div>
            ) : mode === 'currents' ? (
              <div className="status-badge currents">
                <span className="pulse cyan" />
                <span>GEOSTROPHIC & JET CURRENTS</span>
              </div>
            ) : (
              <div className="status-badge">
                <span className="pulse" />
                <span>25-YR ATLAS</span>
              </div>
            )}
            <button
              className="icon-btn"
              onClick={() => setZenMode(true)}
              title="Zen Mode (Hide UI)"
              aria-label="Hide UI"
            >
              <EyeOff size={15} />
            </button>
          </div>
        </header>
      )}

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

      {/* 1. GENERAL EXPLORE MODE: Sub-Grid Telemetry Card */}
      {!zenMode && mode === 'explore' && telemetry && (
        <section className="subgrid-card glass">
          <div className="basin-badge">
            <MapPin size={13} />
            <span>{telemetry.basin}</span>
          </div>

          <div className="subgrid-coords">
            <span>
              {Math.abs(telemetry.coordinate.latitude).toFixed(4)}°
              {telemetry.coordinate.latitude >= 0 ? 'N' : 'S'}
            </span>
            <span>
              {Math.abs(telemetry.coordinate.longitude).toFixed(4)}°
              {telemetry.coordinate.longitude >= 0 ? 'E' : 'W'}
            </span>
          </div>

          <div className="subgrid-metrics">
            <div className="metric-box">
              <span>WATER TEMP</span>
              <strong>
                {telemetry.temperature_c.toFixed(1)}
                <small>°C</small>
              </strong>
            </div>
            <div className="metric-box">
              <span>SALINITY</span>
              <strong>
                {telemetry.salinity_psu.toFixed(1)}
                <small>PSU</small>
              </strong>
            </div>
            <div className="metric-box">
              <span>SEABED DEPTH</span>
              <strong>
                {Math.round(telemetry.seabed_depth_m).toLocaleString()}
                <small>m</small>
              </strong>
            </div>
            <div className="metric-box">
              <span>CURRENT SPEED</span>
              <strong>
                {telemetry.current_speed_m_s.toFixed(2)}
                <small>m/s</small>
              </strong>
            </div>
          </div>

          <div className="subgrid-actions">
            <button
              className="teleport-btn"
              onClick={handleTeleportCamera}
              title="Smoothly swoop camera to this coordinate"
            >
              <Crosshair size={13} /> Teleport
            </button>
            <button
              className="dive-action-btn"
              onClick={() => setMode('dive')}
              title="Dive underwater at this exact coordinate"
            >
              <Navigation size={13} /> Dive In
            </button>
            <button
              className="dive-action-btn"
              onClick={() => setProfileOpen(true)}
              title="View full CTD depth profile"
            >
              <Activity size={13} /> Profile
            </button>
          </div>
        </section>
      )}

      {/* 2. CURRENTS MODE: Floating Direction & Velocity Compass Probe HUD */}
      {!zenMode && mode === 'currents' && telemetry && (
        <aside className="currents-probe-card glass">
          <div className="probe-header">
            <div className="probe-title">
              <Wind size={15} color="#00f2fe" />
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

          {/* Layer Toggles */}
          <div className="currents-toggle-row">
            <button
              className={`toggle-pill ${showVectorArrows ? 'active' : ''}`}
              onClick={() => setShowVectorArrows((v) => !v)}
            >
              <Zap size={12} />
              <span>3D Vector Arrows: {showVectorArrows ? 'ON' : 'OFF'}</span>
            </button>
            <button
              className={`toggle-pill ${showCurrentLabels ? 'active' : ''}`}
              onClick={() => setShowCurrentLabels((v) => !v)}
            >
              <MapPin size={12} />
              <span>System Pins: {showCurrentLabels ? 'ON' : 'OFF'}</span>
            </button>
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
          {/* Scenario Selector Dropdown */}
          <div className="tsunami-scenario-selector-wrap">
            <div className="scenario-selector-label">
              <SlidersHorizontal size={13} color="#00e5ff" />
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
              <Radio size={16} color="#ff3d00" />
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
                  color: '#00e5ff',
                  border: '1px solid rgba(0, 229, 255, 0.25)',
                  cursor: 'pointer',
                  background: 'rgba(0, 229, 255, 0.08)'
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

      {/* Dive HUD (Minimalist) */}
      {!zenMode && mode === 'dive' && (
        <>
          <section className="dive-hud-clean glass">
            <div className="dive-title">
              <Compass size={13} />
              <span>
                {Math.abs(selection.latitude).toFixed(2)}°N · {Math.abs(selection.longitude).toFixed(2)}°E
              </span>
            </div>
            <div className="dive-depth-big">
              {diveTelemetry.depth}
              <small>m</small>
            </div>
            <div style={{ fontSize: 12, color: '#8ec9db', fontFamily: 'DM Mono' }}>
              Water: <b>{diveTelemetry.temperature.toFixed(1)}°C</b>
            </div>
          </section>

          <div className="dive-controls-hint glass">
            <Compass size={13} />
            <span>
              Use <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> to swim · <kbd>↑</kbd> <kbd>↓</kbd> for depth · Click & drag water to look
            </span>
          </div>
        </>
      )}

      {/* Standard Floating Bottom Dock for Explore & Currents Mode */}
      {!zenMode && mode !== 'tsunami' && mode !== 'dive' && (
        <footer className="bottom-dock glass">
          <div className="dock-top-row">
            {/* Variable Pills */}
            <div className="variable-pills">
              <button
                className={`var-pill ${variable === 'temperature' ? 'active' : ''}`}
                onClick={() => setVariable('temperature')}
                title="cmocean thermal: SST & Thermocline"
              >
                <Thermometer size={13} />
                <span>Thermal</span>
                <i style={{ color: '#ff6b4a' }} />
              </button>
              <button
                className={`var-pill ${variable === 'salinity' ? 'active' : ''}`}
                onClick={() => setVariable('salinity')}
                title="cmocean haline: Arabian Evaporation Basin vs Bengal River Plumes"
              >
                <Droplets size={13} />
                <span>Halocline</span>
                <i style={{ color: '#5ce5d5' }} />
              </button>
              <button
                className={`var-pill ${variable === 'chlorophyll' ? 'active' : ''}`}
                onClick={() => setVariable('chlorophyll')}
                title="NASA alga: Coastal Upwelling Blooms vs Oligotrophic Desert"
              >
                <Activity size={13} />
                <span>Biomass</span>
                <i style={{ color: '#7cd362' }} />
              </button>
              <button
                className={`var-pill ${variable === 'currents' ? 'active' : ''}`}
                onClick={() => {
                  setVariable('currents')
                  setMode('currents')
                }}
                title="cmocean speed: Active Geodesic Streamline Flow"
              >
                <Wind size={13} />
                <span>Streamlines</span>
                <i style={{ color: '#00f2fe' }} />
              </button>
            </div>

            {/* Depth Selector */}
            <div className="depth-selector">
              <SlidersHorizontal size={13} color="#70e2ff" />
              <span>{depth === 0 ? 'Surface' : `${depth.toLocaleString()} m`}</span>
              <input
                type="range"
                min="0"
                max="5000"
                step="25"
                value={depth}
                onChange={(e) => setDepth(Number(e.target.value))}
                title="Select depth layer"
              />
            </div>
          </div>

          <div className="dock-theme-hint">
            <span>THEME: <b>{palette.name}</b> · {palette.description}</span>
          </div>

          <div className="dock-bottom-row">
            {/* Play/Pause */}
            <button
              className="play-toggle"
              onClick={() => setIsPlaying((p) => !p)}
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" />}
            </button>

            {/* Timeline Scrubber */}
            <div className="timeline-slider-wrap">
              <span className="epoch-badge">{formatEpoch(monthIndex)}</span>
              <input
                type="range"
                min="0"
                max="299"
                value={monthIndex}
                onChange={(e) => setMonthIndex(Number(e.target.value))}
                title="Scrub across 25 years (2000 - 2024)"
              />
            </div>

            {/* Colorbar */}
            <div className="colorbar-wrap">
              <span>{palette.range[0]}</span>
              <div
                className="colorbar-bar"
                style={{
                  background: `linear-gradient(90deg, ${palette.stops.join(', ')})`,
                }}
              />
              <span>
                {palette.range[1]} {palette.unit}
              </span>
            </div>
          </div>
        </footer>
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
