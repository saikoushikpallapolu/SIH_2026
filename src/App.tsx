import { useEffect, useMemo, useState } from 'react'
import { Activity, ArrowDown, ArrowUp, ChevronLeft, ChevronRight, CircleGauge, Compass, Crosshair, Droplets, Gamepad2, Layers3, MapPinned, Maximize2, Pause, Play, SlidersHorizontal, ThermometerSun, Waves } from 'lucide-react'
import GlobeScene from './GlobeScene'
import ImmersiveOcean from './ImmersiveOcean'
import { instruments, mockValue, timeSteps, variableMeta } from './mockOceanData'
import type { Instrument, OceanVariable, Selection, ViewMode } from './types'

const depthStops = [0, 25, 75, 150, 300, 500, 750, 1000, 1500, 2000, 3000, 5000]

function formatTime(value: string) {
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(new Date(value)).replace(',', ' ·') + ' UTC'
}

export default function App() {
  const [variable, setVariable] = useState<OceanVariable>('temperature')
  const [mode, setMode] = useState<ViewMode>('explore')
  const [depth, setDepth] = useState(25)
  const [timeIndex, setTimeIndex] = useState(4)
  const [isPlaying, setIsPlaying] = useState(false)
  const [selectedInstrument, setSelectedInstrument] = useState<Instrument | null>(instruments[2])
  const [selection, setSelection] = useState<Selection>({ latitude: 13.4, longitude: 73.7 })
  const [profileOpen, setProfileOpen] = useState(false)
  const [fieldScale, setFieldScale] = useState<[number, number]>(variableMeta.temperature.scale)
  const [overlayStrength, setOverlayStrength] = useState(.77)
  const [transectStart, setTransectStart] = useState<Selection | null>({ latitude: 15, longitude: 62 })
  const [transectEnd, setTransectEnd] = useState<Selection | null>({ latitude: 16, longitude: 89 })
  const [editingTransectPoint, setEditingTransectPoint] = useState<'start' | 'end' | null>(null)
  const [diveTelemetry, setDiveTelemetry] = useState({ depth: 460, temperature: 26.1 })

  useEffect(() => {
    if (!isPlaying) return
    const timer = window.setInterval(() => setTimeIndex((index) => (index + 1) % timeSteps.length), 1100)
    return () => window.clearInterval(timer)
  }, [isPlaying])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowDown') setDepth((value) => depthStops[Math.min(depthStops.findIndex((stop) => stop >= value) + 1, depthStops.length - 1)])
      if (event.key === 'ArrowUp') setDepth((value) => depthStops[Math.max(depthStops.findIndex((stop) => stop >= value) - 1, 0)])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => setFieldScale(variableMeta[variable].scale), [variable])

  const locationValue = useMemo(() => mockValue(variable, selection.latitude, selection.longitude, depth, timeIndex), [variable, selection, depth, timeIndex])
  const activeMeta = variableMeta[variable]
  const stepDepth = (direction: -1 | 1) => setDepth((value) => {
    const index = depthStops.findIndex((stop) => stop >= value)
    return depthStops[Math.max(0, Math.min(depthStops.length - 1, index + direction))]
  })

  return <main className="app-shell">
    <div className="globe-wrap">
      {mode === 'dive' ? <ImmersiveOcean variable={variable} selection={selection} timeIndex={timeIndex} onTelemetry={(telemetry) => { setDiveTelemetry(telemetry); setDepth(telemetry.depth) }} /> : <GlobeScene variable={variable} depth={depth} timeIndex={timeIndex} mode={mode} overlayStrength={overlayStrength} instruments={instruments} onInstrument={setSelectedInstrument} onSelectPoint={(point) => {
        setSelection(point); setSelectedInstrument(null)
        if (editingTransectPoint === 'start') setTransectStart(point)
        if (editingTransectPoint === 'end') setTransectEnd(point)
        setEditingTransectPoint(null)
      }} />}
    </div>

    <header className="topbar glass">
      <div className="brand"><span className="brand-mark"><Waves size={18} /></span><span>Ocean<span>Scope</span></span><small>INDIA</small></div>
      <div className="status"><span className="pulse" /> {mode === 'dive' ? 'IMMERSIVE OCEAN SIMULATION' : 'GLOBAL OCEAN EXPLORER'} <i /> Prototype data</div>
      <button className="icon-button" aria-label="Fullscreen"><Maximize2 size={18} /></button>
    </header>

    <aside className="left-rail glass">
      <section>
        <p className="eyebrow">OCEAN STATE</p>
        <h1>{mode === 'dive' ? <>Dive the<br /><em>Indian Ocean.</em></> : <>Indian Ocean<br /><em>in motion.</em></>}</h1>
        <p className="subtle">{mode === 'dive' ? 'Navigate the selected ocean region from the surface to the rough seafloor.' : 'Choose a location on Earth, then enter an explorable underwater world.'}</p>
      </section>
      <section className="control-group">
        <label><SlidersHorizontal size={14} /> VARIABLE</label>
        <div className="variable-list">
          {(Object.keys(variableMeta) as OceanVariable[]).map((item) => <button key={item} className={variable === item ? 'active' : ''} onClick={() => setVariable(item)}>
            {item === 'temperature' ? <ThermometerSun size={16} /> : item === 'salinity' ? <Droplets size={16} /> : item === 'chlorophyll' ? <Activity size={16} /> : <CircleGauge size={16} />}
            <span>{variableMeta[item].label}</span><i style={{ background: variableMeta[item].colors[1] }} />
          </button>)}
        </div>
      </section>
      <section className="control-group mode-controls">
        <label><Layers3 size={14} /> VIEW MODE</label>
        <div className="segmented two-mode"><button className={mode === 'explore' ? 'selected' : ''} onClick={() => setMode('explore')}>globe</button><button className={mode === 'dive' ? 'selected' : ''} onClick={() => setMode('dive')}>ocean dive</button></div>
      </section>
      <section className="legend">
        <div><span>{activeMeta.label}</span><b>{activeMeta.unit}</b></div>
        <div className="gradient" style={{ background: `linear-gradient(90deg, ${activeMeta.colors[0]}, ${activeMeta.colors[1]})` }} />
        <div className="legend-scale"><span>{activeMeta.range.split(' — ')[0]}</span><span>{activeMeta.range.split(' — ')[1]}</span></div>
      </section>
    </aside>

    {mode !== 'dive' && <section className="location-card glass">
      <div className="card-kicker"><MapPinned size={14} /> SELECTED WATER COLUMN</div>
      <div className="coordinate"><strong>{selection.latitude.toFixed(2)}°{selection.latitude >= 0 ? 'N' : 'S'}</strong><strong>{Math.abs(selection.longitude).toFixed(2)}°{selection.longitude >= 0 ? 'E' : 'W'}</strong></div>
      <div className="value-row"><span>{activeMeta.label} at {depth} m</span><b>{locationValue.toFixed(variable === 'chlorophyll' ? 2 : 1)} <small>{activeMeta.unit}</small></b></div>
      <p>Tap the globe to choose an area, then enter Ocean Dive.</p>
    </section>}

    {mode === 'explore' && <section className="depth-controller glass">
      <div><p className="eyebrow">WATER COLUMN</p><strong>{depth.toLocaleString()}<small>m</small></strong></div>
      <div className="depth-actions"><button onClick={() => stepDepth(-1)} aria-label="Ascend"><ArrowUp size={17} /></button><button onClick={() => stepDepth(1)} aria-label="Descend"><ArrowDown size={17} /></button></div>
      <input aria-label="Depth" type="range" min="0" max="5000" step="25" value={depth} onChange={(event) => setDepth(Number(event.target.value))} />
      <div className="depth-labels"><span>SURFACE</span><span>ABYSS</span></div>
    </section>}

    {mode === 'explore' && <section className="instrument-card glass">
      <div className="card-kicker"><Crosshair size={14} /> {selectedInstrument ? selectedInstrument.kind.toUpperCase() : 'OCEAN POINT'}</div>
      {selectedInstrument ? <>
        <div className="instrument-title"><div className={`instrument-dot ${selectedInstrument.kind === 'Glider' ? 'amber' : ''}`} /><div><strong>{selectedInstrument.name}</strong><span>Updated {formatTime(selectedInstrument.timestamp)}</span></div></div>
        <div className="instrument-metrics"><div><span>TEMP</span><b>{selectedInstrument.temperature.toFixed(1)}°C</b></div><div><span>SAL</span><b>{selectedInstrument.salinity.toFixed(1)}</b></div><div><span>CHL-A</span><b>{selectedInstrument.chlorophyll.toFixed(2)}</b></div></div>
        {selectedInstrument.kind === 'Glider' && <div className="glider-track"><span>MISSION TRACK</span><div><i /> <i /> <i /> <i /> <b>↗</b></div></div>}
        <button className="profile-button" onClick={() => setProfileOpen(true)}>Open depth profile <ChevronRight size={15} /></button>
      </> : <p className="empty-state">Choose an Argo float or Glider marker to compare measured profiles with the model field.</p>}
    </section>}
    {mode === 'dive' && <><section className="dive-hud glass"><div className="card-kicker"><Compass size={14} /> {selection.latitude.toFixed(2)}°N · {selection.longitude.toFixed(2)}°E</div><div className="dive-readout"><div><span>DEPTH</span><strong>{diveTelemetry.depth}<small>m</small></strong></div><div><span>WATER TEMP</span><strong>{diveTelemetry.temperature.toFixed(1)}<small>°C</small></strong></div></div><div className="depth-rail"><i style={{ height: `${Math.min(100, diveTelemetry.depth / 20)}%` }} /></div><button onClick={() => setMode('explore')} className="return-globe">Return to globe</button></section><div className="dive-guide glass"><Gamepad2 size={15} /><span><b>Click water</b> to look around · <b>W A S D</b> to swim · <b>↑ ↓</b> to change depth · <b>Shift</b> to accelerate</span></div></>}

    {mode !== 'dive' && <footer className="timeline glass">
      <button className="play-button" onClick={() => setIsPlaying((playing) => !playing)} aria-label={isPlaying ? 'Pause time animation' : 'Play time animation'}>{isPlaying ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}</button>
      <div className="time-control"><div className="time-label"><span>{formatTime(timeSteps[timeIndex])}</span><b>3-day model cycle</b></div><input aria-label="Time" type="range" min="0" max={timeSteps.length - 1} step="1" value={timeIndex} onChange={(event) => setTimeIndex(Number(event.target.value))} /><div className="ticks">{timeSteps.map((step, index) => <button key={step} className={index === timeIndex ? 'current' : ''} onClick={() => setTimeIndex(index)}><i />{index % 2 === 0 && <span>{new Date(step).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>}</button>)}</div></div>
      <button className="timeline-arrow" onClick={() => setTimeIndex((value) => Math.max(value - 1, 0))}><ChevronLeft size={18} /></button>
      <button className="timeline-arrow" onClick={() => setTimeIndex((value) => Math.min(value + 1, timeSteps.length - 1))}><ChevronRight size={18} /></button>
    </footer>}
    {profileOpen && selectedInstrument && <ProfilePanel instrument={selectedInstrument} onClose={() => setProfileOpen(false)} />}
  </main>
}

function ProfilePanel({ instrument, onClose }: { instrument: Instrument; onClose: () => void }) {
  const temperatures = Array.from({ length: 9 }, (_, index) => instrument.temperature - index * 1.72 + Math.sin(index) * .35)
  const modelTemperatures = temperatures.map((value, index) => value + .4 - Math.sin(index * 1.45) * .5)
  const points = temperatures.map((value, index) => `${42 + (value - 8) * 7},${26 + index * 24}`).join(' ')
  const modelPoints = modelTemperatures.map((value, index) => `${42 + (value - 8) * 7},${26 + index * 24}`).join(' ')
  return <section className="profile-panel glass" aria-label="Instrument depth profile">
    <header><div><p className="eyebrow">OBSERVED PROFILE</p><strong>{instrument.name}</strong></div><button onClick={onClose} aria-label="Close profile">×</button></header>
    <div className="chart-label"><span>Temperature <b>°C</b></span><span>0–2000 m</span></div>
    <svg viewBox="0 0 220 226" role="img" aria-label="Observed and modelled temperature against depth"><defs><linearGradient id="profile-line" x1="0" x2="1"><stop stopColor="#81efff" /><stop offset="1" stopColor="#ffd268" /></linearGradient></defs>{[26, 74, 122, 170, 218].map((y) => <line key={y} x1="25" x2="206" y1={y} y2={y} className="chart-grid" />)}<polyline points={modelPoints} fill="none" stroke="#8e96bc" strokeWidth="2" strokeDasharray="4 3" strokeLinecap="round" /><polyline points={points} fill="none" stroke="url(#profile-line)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />{temperatures.map((value, index) => <circle key={index} cx={42 + (value - 8) * 7} cy={26 + index * 24} r="3" fill="#d5fbff" />)}<text x="2" y="29">0</text><text x="2" y="125">1000</text><text x="2" y="221">2000m</text></svg>
    <div className="profile-foot"><span><i /> observation <i className="model-dot" /> model</span><span>QC: <b>good</b></span></div>
  </section>
}
