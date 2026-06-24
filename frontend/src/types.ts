export interface MarkerStat {
  name: string
  valid: number
  total: number
  percent: number
}

export interface Plate {
  corners: number[]      // 12 numbers = 4 x (x,y,z) mm
  origin: number[]
  hasData: boolean
  nFrames: number
  force?: Float32Array   // (nF,3) N
  cop?: Float32Array     // (nF,3) mm
  moment?: Float32Array  // (nF,3) N*mm
}

export interface Emg {
  rate: number
  names: string[]
  nFrames: number
  data: Float32Array     // (nFrames, nCh) row-major
  nCh: number
}

export interface Trial {
  trialId: string
  name: string
  source: 'c3d' | 'trc'
  markerNames: string[]
  markerRate: number
  nFrames: number
  nMarkers: number
  units: string
  points: Float32Array   // frame-major: (f*nM + m)*3 + c, mm, NaN = missing
  stats: MarkerStat[]
  plates: Plate[]
  emg?: Emg | null
}

export interface Skeleton {
  markerColor: string
  skeletonColor: string
  markerColors: Record<string, string>   // per-marker overrides
  connections: [string, string][]
}

export type InterpMethod = 'linear' | 'cubic' | 'rigid' | 'pattern'

// What the bottom panel is currently plotting.
export type SeriesTarget =
  | { kind: 'marker'; name: string }
  | { kind: 'grf'; plates: number[] }   // >1 plate = resultant (summed) force
  | null
