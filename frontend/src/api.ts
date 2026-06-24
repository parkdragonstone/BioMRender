import type { Trial, Plate, Emg, InterpMethod, MarkerStat } from './types'

function decodeF32(b64: string): Float32Array {
  if (!b64) return new Float32Array(0)
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Float32Array(bytes.buffer)
}

function encodeF32(arr: Float32Array): string {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

function hydrate(raw: any): Trial {
  const plates: Plate[] = (raw.plates || []).map((p: any) => ({
    corners: p.corners,
    origin: p.origin,
    hasData: p.hasData,
    nFrames: p.nFrames,
    force: p.force ? decodeF32(p.force) : undefined,
    cop: p.cop ? decodeF32(p.cop) : undefined,
    moment: p.moment ? decodeF32(p.moment) : undefined,
  }))
  let emg: Emg | null = null
  if (raw.emg) {
    emg = { ...raw.emg, data: decodeF32(raw.emg.data) }
  }
  return {
    trialId: raw.trialId,
    name: raw.name,
    source: raw.source,
    markerNames: raw.markerNames,
    markerRate: raw.markerRate,
    nFrames: raw.nFrames,
    nMarkers: raw.nMarkers,
    units: raw.units,
    points: decodeF32(raw.points),
    stats: raw.stats,
    plates,
    emg,
  }
}

export async function uploadTrial(file: File): Promise<Trial> {
  const fd = new FormData()
  fd.append('file', file)
  const r = await fetch('/api/trial/upload', { method: 'POST', body: fd })
  if (!r.ok) throw new Error(await r.text())
  return hydrate(await r.json())
}

export interface InterpResult {
  marker: string
  data: Float32Array
  nFrames: number
  beforeValid: number
  afterValid: number
  filled: number
  stats: MarkerStat[]
}

export async function setMarker(
  trialId: string, marker: string, data: Float32Array,
): Promise<{ stats: MarkerStat[] }> {
  const r = await fetch('/api/set_marker', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trialId, marker, data: encodeF32(data) }),
  })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

/** Fetch the edited trial serialised back to C3D/TRC bytes. */
export async function fetchTrialBlob(trialId: string): Promise<{ name: string; blob: Blob }> {
  const r = await fetch(`/api/download/${trialId}`)
  if (!r.ok) throw new Error(await r.text())
  const blob = await r.blob()
  const cd = r.headers.get('Content-Disposition') || ''
  const m = cd.match(/filename="?([^"]+)"?/)
  return { name: m ? m[1] : `trial_${trialId}`, blob }
}

/** Trigger a browser download of a blob (overwrite fallback). */
export function downloadBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export interface InterpOpts {
  maxGap?: number | null
  rangeStart?: number | null
  rangeEnd?: number | null
}

export async function interpolate(
  trialId: string, marker: string, method: InterpMethod, sources: string[] = [],
  opts: InterpOpts = {},
): Promise<InterpResult> {
  const r = await fetch('/api/interpolate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trialId, marker, method, sources, apply: true, ...opts }),
  })
  if (!r.ok) throw new Error(await r.text())
  const j = await r.json()
  return { ...j, data: decodeF32(j.data) }
}
