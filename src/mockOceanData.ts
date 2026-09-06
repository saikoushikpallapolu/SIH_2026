import type { Instrument, OceanVariable } from './types'

export const timeSteps = [
  '2025-06-18T00:00:00Z', '2025-06-21T00:00:00Z', '2025-06-24T00:00:00Z',
  '2025-06-27T00:00:00Z', '2025-06-30T00:00:00Z', '2025-07-03T00:00:00Z',
]

export const instruments: Instrument[] = [
  { id: '2903812', kind: 'Argo float', name: 'Argo 2903812', latitude: 12.8, longitude: 73.1, depth: 1860, timestamp: timeSteps[4], temperature: 27.4, salinity: 35.1, chlorophyll: 0.22 },
  { id: '2903816', kind: 'BGC-Argo', name: 'BGC-Argo 2903816', latitude: 8.2, longitude: 88.6, depth: 1590, timestamp: timeSteps[5], temperature: 28.1, salinity: 34.5, chlorophyll: 0.46 },
  { id: 'glider-io-07', kind: 'Glider', name: 'INCOIS Glider IO-07', latitude: 15.5, longitude: 68.4, depth: 740, timestamp: timeSteps[5], temperature: 25.2, salinity: 35.4, chlorophyll: 0.18, heading: 38 },
  { id: '2903821', kind: 'Argo float', name: 'Argo 2903821', latitude: -9.5, longitude: 91.1, depth: 1940, timestamp: timeSteps[3], temperature: 27.9, salinity: 34.7, chlorophyll: 0.31 },
  { id: 'glider-bob-03', kind: 'Glider', name: 'Bay Glider BG-03', latitude: 17.2, longitude: 86.7, depth: 510, timestamp: timeSteps[5], temperature: 28.8, salinity: 33.8, chlorophyll: 0.63, heading: 121 },
]

export const variableMeta: Record<OceanVariable, { label: string; unit: string; range: string; scale: [number, number]; colors: [string, string] }> = {
  temperature: { label: 'Temperature', unit: '°C', range: '−2 — 31', scale: [-2, 31], colors: ['#1239ff', '#ffcf5b'] },
  salinity: { label: 'Salinity', unit: 'PSU', range: '32 — 37', scale: [32, 37], colors: ['#7b4cff', '#5ce5d5'] },
  chlorophyll: { label: 'Chlorophyll-a', unit: 'mg/m³', range: '0 — 2.2', scale: [0, 2.2], colors: ['#081f39', '#a6ff5b'] },
  currents: { label: 'Current speed', unit: 'm/s', range: '0 — 1.8', scale: [0, 1.8], colors: ['#0db3e6', '#c6f5ff'] },
}

export function mockValue(variable: OceanVariable, latitude: number, longitude: number, depth: number, timeIndex: number) {
  const latitudeRadians = latitude * Math.PI / 180
  const tropicality = Math.max(0, Math.cos(latitudeRadians)) ** 1.35
  const seasonalWave = Math.sin(timeIndex * .82 + longitude * .055 + latitude * .035)
  const deepTemperature = 1.2 + tropicality * .7
  const surfaceTemperature = -1.6 + 31.2 * tropicality + seasonalWave * 1.15
  const thermocline = Math.exp(-Math.max(depth, 0) / (190 + tropicality * 145))
  const temperature = deepTemperature + (surfaceTemperature - deepTemperature) * thermocline
  if (variable === 'temperature') return Math.max(-1.8, temperature)
  if (variable === 'salinity') {
    const subtropicalGyre = Math.sin(Math.abs(latitudeRadians) * 2.4) ** 2
    return 33.4 + subtropicalGyre * 2.05 + Math.min(depth / 1800, 1) * .32 + seasonalWave * .16
  }
  if (variable === 'chlorophyll') {
    const light = Math.exp(-Math.max(depth, 0) / 85)
    const productivity = .2 + (1 - tropicality) * .55 + Math.max(0, seasonalWave) * .25
    return Math.max(.015, productivity * light)
  }
  const equatorialCurrent = Math.exp(-((latitude / 13) ** 2)) * .72
  return Math.max(.025, .11 + equatorialCurrent + Math.abs(seasonalWave) * .34 + Math.exp(-depth / 900) * .12)
}
