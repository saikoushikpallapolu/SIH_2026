export type OceanVariable = 'temperature' | 'salinity' | 'chlorophyll' | 'currents'
export type ViewMode = 'explore' | 'analysis' | 'dive'

export interface Instrument {
  id: string
  kind: 'Argo float' | 'BGC-Argo' | 'Glider'
  name: string
  latitude: number
  longitude: number
  depth: number
  timestamp: string
  temperature: number
  salinity: number
  chlorophyll: number
  heading?: number
}

export interface Selection {
  latitude: number
  longitude: number
}
