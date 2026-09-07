export type OceanVariable = 'temperature' | 'salinity' | 'chlorophyll' | 'currents'
export type ViewMode = 'explore' | 'currents' | 'tsunami' | 'dive' | 'analysis'

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

export interface CoastalStation {
  id: string
  name: string
  region: string
  lat: number
  lon: number
  dist_km: number
  arrival_hours: number
  arrival_utc: string
  wave_height_m: number
  status: string
}

export interface CurrentSystem {
  id: string
  name: string
  lat: number
  lon: number
  description: string
  seasonality: string
  typicalSpeed: string
  flowDirection: string
}

export interface TsunamiScenario {
  id: string
  title: string
  shortName: string
  year: number
  origin_time: string
  origin_time_label: string
  magnitude: number
  depth_km: number
  mechanism: string
  epicenter: {
    latitude: number
    longitude: number
    location_name: string
  }
  rupture_length_km: number
  rupture_duration_sec: number
  rupture_arc: { lat: number; lon: number; name?: string }[]
  open_ocean_speed_kmh: number
  max_runup_m: number
  total_fatalities?: string
  description: string
  incois_significance: string
  isochrones: { hour: number; radius_km: number; label: string }[]
  coastal_stations: CoastalStation[]
  satellite_pass?: {
    mission: string
    pass_id: string
    flyover_label: string
    crest_cm: number
    trough_cm: number
    lat_start: number
    lat_end: number
    lon: number
  }
  milestones: { hour: number; label: string; desc: string }[]
}

export interface VectorSample {
  lat: number
  lon: number
  u: number
  v: number
  speed: number
  knots: number
  heading: number
}
