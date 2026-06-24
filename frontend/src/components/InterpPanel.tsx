import { useState } from 'react'
import type { Trial, InterpMethod } from '../types'

export default function InterpPanel({
  trial, selected, busy, hasSelection, onApply,
}: {
  trial: Trial; selected: string | null; busy: boolean; hasSelection: boolean
  onApply: (method: InterpMethod, sources: string[], maxGap: number | null) => void
}) {
  const [method, setMethod] = useState<InterpMethod>('linear')
  const [sources, setSources] = useState<string[]>([])
  const [maxGap, setMaxGap] = useState(15)

  const others = trial.markerNames.filter((n) => n !== selected)
  const usesMaxGap = method === 'linear' || method === 'cubic'

  const apply = () => {
    if (!selected) return
    onApply(method, sources, usesMaxGap ? maxGap : null)
  }

  return (
    <div style={{ padding: 12, borderTop: '1px solid var(--line)' }}>
      <div style={{ fontWeight: 600, marginBottom: 10 }}>Interpolation (gap fill)</div>

      <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>
        Target: {selected ? <b style={{ color: 'var(--text-0)' }}>{selected}</b> : 'select a marker'}
      </div>

      <select value={method} onChange={(e) => { setMethod(e.target.value as InterpMethod); setSources([]) }}
        style={{ width: '100%', marginBottom: 8 }}>
        <option value="linear">Linear</option>
        <option value="cubic">Cubic spline</option>
        <option value="rigid">Rigid body (3 segment markers)</option>
        <option value="pattern">Pattern (1 similar marker)</option>
      </select>

      {usesMaxGap && (
        <label className="row" style={{ fontSize: 11, marginBottom: 8, gap: 6 }}>
          <span className="muted">Max gap (frames)</span>
          <input type="number" min={1} max={100000} value={maxGap}
            onChange={(e) => setMaxGap(Math.max(1, parseInt(e.target.value) || 15))}
            style={{ width: 64 }} title="gaps longer than this are not filled" />
        </label>
      )}

      {method === 'rigid' && (
        <>
          <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>
            Pick ≥3 markers on the same segment:
          </div>
          <select multiple value={sources} size={6}
            onChange={(e) => setSources(Array.from(e.target.selectedOptions, (o) => o.value))}
            style={{ width: '100%', marginBottom: 8 }}>
            {others.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </>
      )}

      {method === 'pattern' && (
        <select value={sources[0] || ''} onChange={(e) => setSources([e.target.value])}
          style={{ width: '100%', marginBottom: 8 }}>
          <option value="">donor marker…</option>
          {others.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      )}

      <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>
        {hasSelection ? 'Filling only the selected frame range (graph).' : 'Filling all gaps in the trajectory.'}
      </div>

      <button className="primary" style={{ width: '100%' }}
        disabled={busy || !selected ||
          (method === 'rigid' && sources.length < 3) ||
          (method === 'pattern' && sources.length < 1)}
        onClick={apply}>
        {busy ? 'Filling…' : 'Fill gaps'}
      </button>
    </div>
  )
}
