import { Crosshair, LocateFixed, ScanLine, SlidersHorizontal, X } from 'lucide-react'
import { variableMeta } from './mockOceanData'
import type { OceanVariable, Selection } from './types'

type TransectPoint = Selection | null

interface Props {
  variable: OceanVariable
  depth: number
  scale: [number, number]
  overlayStrength: number
  onDepthChange: (value: number) => void
  transectStart: TransectPoint
  transectEnd: TransectPoint
  editingPoint: 'start' | 'end' | null
  onScaleChange: (value: [number, number]) => void
  onOverlayChange: (value: number) => void
  onPickPoint: (point: 'start' | 'end') => void
  onClose: () => void
}

function coordinate(point: TransectPoint) {
  if (!point) return 'Click globe'
  return `${Math.abs(point.latitude).toFixed(1)}°${point.latitude >= 0 ? 'N' : 'S'}, ${Math.abs(point.longitude).toFixed(1)}°${point.longitude >= 0 ? 'E' : 'W'}`
}

function heatColor(value: number, variable: OceanVariable) {
  if (variable === 'temperature') return `hsl(${220 - value * 180} 88% ${35 + value * 25}%)`
  if (variable === 'salinity') return `hsl(${258 - value * 70} 76% ${31 + value * 28}%)`
  if (variable === 'chlorophyll') return `hsl(${205 - value * 105} 72% ${18 + value * 39}%)`
  return `hsl(${204 - value * 25} 82% ${32 + value * 37}%)`
}

function TransectPlot({ variable }: { variable: OceanVariable }) {
  const cells = Array.from({ length: 14 * 8 }, (_, index) => {
    const x = index % 14
    const y = Math.floor(index / 14)
    const wave = Math.sin(x * .62 + y * .75) * .26 + Math.cos(x * .23 - y * .61) * .22
    const surface = 1 - y / 9.5
    return { x, y, value: Math.max(0, Math.min(1, surface + wave)) }
  })
  return <svg className="transect-plot" viewBox="0 0 478 200" role="img" aria-label={`${variableMeta[variable].label} vertical cross section from transect A to B`}>
    <defs><linearGradient id="seabed" x1="0" y1="0" x2="1" y2="0"><stop stopColor="#1d4157" /><stop offset=".45" stopColor="#0a1e2e" /><stop offset="1" stopColor="#274a5e" /></linearGradient></defs>
    <rect x="47" y="15" width="398" height="150" fill="#061a29" rx="2" />
    {cells.map(({ x, y, value }) => <rect key={`${x}-${y}`} x={48 + x * 28.35} y={16 + y * 18.7} width="29.2" height="19.6" fill={heatColor(value, variable)} opacity={.94 - y * .025} />)}
    {[15, 65, 115, 165].map((y, index) => <g key={y}><line x1="47" x2="445" y1={y} y2={y} className="section-grid" /><text x="3" y={y + 4}>{index === 0 ? '0 m' : `${index * 500} m`}</text></g>)}
    <path d="M47 145 C102 129 134 153 185 137 S270 144 323 125 S392 151 445 120 L445 165 L47 165 Z" fill="url(#seabed)" opacity=".9" />
    <text x="48" y="186">A · Arabian Sea</text><text x="355" y="186">B · Bay of Bengal</text>
  </svg>
}

export default function AnalysisWorkspace(props: Props) {
  const { variable, scale, overlayStrength, transectStart, transectEnd, editingPoint, onScaleChange, onOverlayChange, onPickPoint, onClose } = props
  const meta = variableMeta[variable]
  return <section className="analysis-workspace glass" aria-label="Scientific analysis workspace">
    <header className="analysis-header"><div><p className="eyebrow">SCIENTIFIC ANALYSIS</p><strong>Depth section &amp; field calibration</strong></div><button onClick={onClose} aria-label="Close analysis workspace"><X size={17} /></button></header>
    <div className="analysis-metadata"><span><ScanLine size={13} /> Horizontal slice: <b>{props.depth} m</b></span><span><LocateFixed size={13} /> CF-grid mock</span></div>
    <label className="analysis-depth">DEPTH SLICE <b>{props.depth} m</b><input aria-label="Analysis depth slice" type="range" min="0" max="5000" step="25" value={props.depth} onChange={(event) => props.onDepthChange(Number(event.target.value))} /></label>
    <TransectPlot variable={variable} />
    <div className="transect-controls"><div><span>TRANSECT A</span><b>{coordinate(transectStart)}</b><button className={editingPoint === 'start' ? 'picking' : ''} onClick={() => onPickPoint('start')}><Crosshair size={12} /> set A</button></div><div><span>TRANSECT B</span><b>{coordinate(transectEnd)}</b><button className={editingPoint === 'end' ? 'picking' : ''} onClick={() => onPickPoint('end')}><Crosshair size={12} /> set B</button></div></div>
    <div className="calibration"><div className="calibration-label"><span><SlidersHorizontal size={13} /> COLOURBAR</span><b>{meta.unit}</b></div><div className="scale-fields"><label>MIN<input type="number" step="any" value={scale[0]} onChange={(event) => onScaleChange([Number(event.target.value), Math.max(Number(event.target.value), scale[1])])} /></label><label>MAX<input type="number" step="any" value={scale[1]} onChange={(event) => onScaleChange([Math.min(scale[0], Number(event.target.value)), Number(event.target.value)])} /></label></div><div className="analysis-gradient" style={{ background: `linear-gradient(90deg, ${meta.colors[0]}, ${meta.colors[1]})` }} /><label className="opacity-control">OVERLAY OPACITY <b>{Math.round(overlayStrength * 100)}%</b><input aria-label="Ocean data overlay opacity" type="range" min="0.25" max="0.95" step="0.05" value={overlayStrength} onChange={(event) => onOverlayChange(Number(event.target.value))} /></label></div>
  </section>
}
