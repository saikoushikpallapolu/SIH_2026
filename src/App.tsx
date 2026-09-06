import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  Compass,
  Crosshair,
  Droplets,
  Eye,
  EyeOff,
  Globe2,
  Layers3,
  Lock,
  MapPin,
  Maximize2,
  Navigation,
  Pause,
  Play,
  RotateCcw,
  SlidersHorizontal,
  Thermometer,
  Waves,
  Wind,
  X,
} from 'lucide-react'
import GlobeScene from './GlobeScene'
import ImmersiveOcean from './ImmersiveOcean'
import { instruments } from './mockOceanData'
import {
  DEPTH_STOPS,
  isPointInIndianOcean,
  querySubgridTelemetry,
  SCIENTIFIC_PALETTES,
  type SubgridTelemetry,
} from './oceanDataEngine'
import type { Instrument, OceanVariable, Selection, ViewMode } from './types'

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

export default function App() {
  const [variable, setVariable] = useState<OceanVariable>('temperature')
  const [mode, setMode] = useState<ViewMode>('explore')
  const [depth, setDepth] = useState<number>(25)
  const [monthIndex, setMonthIndex] = useState<number>(292) // May 2024 pre-monsoon heatwave baseline
  const [isPlaying, setIsPlaying] = useState<boolean>(false)
  const [selection, setSelection] = useState<Selection>({ latitude: 12.5, longitude: 68.3 })
  const [selectedInstrument, setSelectedInstrument] = useState<Instrument | null>(null)
  const [teleportNonce, setTeleportNonce] = useState<number>(0)
  const [telemetry, setTelemetry] = useState<SubgridTelemetry | null>(null)
  const [profileOpen, setProfileOpen] = useState<boolean>(false)
  const [zenMode, setZenMode] = useState<boolean>(false)
  const [diveTelemetry, setDiveTelemetry] = useState({ depth: 460, temperature: 26.1 })

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

  // Playback timer for 25-year time steps
  useEffect(() => {
    if (!isPlaying) return
    const timer = window.setInterval(() => {
      setMonthIndex((prev) => (prev + 1) % 300)
    }, 1200)
    return () => window.clearInterval(timer)
  }, [isPlaying])

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

  const handleTeleportCamera = () => {
    setTeleportNonce(Date.now())
  }

  return (
    <main className="app-shell">
      {/* 3D Visual Canvas */}
      <div className="globe-wrap">
        {mode === 'dive' ? (
          <ImmersiveOcean
            variable={variable}
            selection={isInsideIndianOcean ? selection : { latitude: 12.5, longitude: 68.3 }}
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
            onInstrument={handleInstrumentSelect}
            onSelectPoint={handlePointSelect}
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
              onClick={() => setMode('explore')}
            >
              <Globe2 size={14} /> Globe
            </button>
            <button
              className={mode === 'dive' ? 'active' : ''}
              onClick={() => {
                if (!canDive) {
                  handleJumpToIndianOcean()
                }
                setMode('dive')
              }}
              title={
                canDive
                  ? 'Ocean Dive simulation'
                  : 'Reposition to Indian Ocean 4D Twin Sector (Arabian Sea) and Dive'
              }
            >
              <Compass size={14} /> Ocean Dive
            </button>
          </div>

          <div className="topbar-actions">
            <div className="status-badge">
              <span className="pulse" />
              <span>25-YR ATLAS</span>
            </div>
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

      {/* Minimalist Floating Sub-Grid Telemetry Card */}
      {!zenMode && mode === 'explore' && telemetry && (
        <section className="subgrid-card glass">
          <div className="basin-badge">
            <MapPin size={13} />
            <span>{telemetry.basin}</span>
            {!isInsideIndianOcean && (
              <span className="global-badge">GLOBAL SCAN</span>
            )}
            {telemetry.is_land && (
              <span className="land-badge">LANDMASS</span>
            )}
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

            {canDive ? (
              <button
                className="dive-action-btn"
                onClick={() => setMode('dive')}
                title="Dive underwater at this exact coordinate"
              >
                <Navigation size={13} /> Dive In
              </button>
            ) : (
              <button
                className="dive-action-btn disabled"
                disabled
                title={
                  telemetry.is_land
                    ? 'Cannot dive: Selected location is on continental landmass'
                    : 'Ocean Dive simulation is exclusively calibrated for the Indian Ocean 4D Twin sector (20°E–125°E, 45°S–32°N)'
                }
              >
                <Lock size={13} /> Dive Locked
              </button>
            )}

            {!isInsideIndianOcean && (
              <button
                className="teleport-btn sector-jump-btn"
                onClick={handleJumpToIndianOcean}
                title="Return beacon to the Indian Ocean 4D Digital Twin sector"
              >
                <RotateCcw size={13} /> Return to Sector
              </button>
            )}

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

      {/* Minimalist Floating Bottom Dock */}
      {!zenMode && mode === 'explore' && (
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
                onClick={() => setVariable('currents')}
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

  // Map temps (range 2..32) and depths (0..2000m for plot display)
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
      {/* Grid lines */}
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

      {/* Temperature ticks at bottom */}
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

      {/* Temperature Curve */}
      <polyline
        points={points}
        fill="none"
        stroke="#00f2fe"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Depth indicator line */}
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
