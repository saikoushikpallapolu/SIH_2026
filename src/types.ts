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

export type SpatialBoundaryType = 'bbox' | 'polygon'

export interface SpatialBoundary {
  type: SpatialBoundaryType
  bbox: [number, number, number, number] // [minLat, maxLat, minLon, maxLon]
  vertices: [number, number][]          // Geodesic boundary coordinates [[lat, lon], ...]
  center: [number, number]              // [centerLat, centerLon]
  width_km: number
  height_km: number
  area_km2: number
  label?: string
}

export interface TerrainSliceData {
  dataset: string
  native_resolution_deg: number
  grid_res: number
  bounds: {
    min_lat: number
    max_lat: number
    min_lon: number
    max_lon: number
  }
  min_elevation_m: number
  max_elevation_m: number
  land_fraction: number
  ocean_fraction: number
  elevation_grid: Float32Array
  coastline_segments?: [number, number][][]
  shelf_break_segments?: [number, number][][]
}

export interface CTDLevel {
  depth_m: number
  in_water_column: boolean
  temperature_c: number | null
  salinity_psu: number | null
  bedrock_cutoff: boolean
}

export interface OceanPointProfile {
  is_land: boolean
  coordinate: { lat: number; lon: number }
  seabed_depth_m?: number
  elevation_m?: number
  status?: string
  message?: string
  levels?: CTDLevel[]
  thermocline?: {
    detected: boolean
    classification: 'Thermocline' | 'Temperature Profile'
    max_gradient_c_per_m?: number
    depth_range_m?: [number, number]
  }
  halocline?: {
    detected: boolean
    classification: 'Halocline' | 'Salinity Profile'
    max_gradient_psu_per_m?: number
    depth_range_m?: [number, number]
  }
  provenance: {
    source: string
    bathymetry_source: string
  }
}

