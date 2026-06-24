import { useState, useMemo } from 'react'
import type { Trial, Skeleton, MarkerStat } from '../types'
import ColorPicker from './ColorPicker'

function pctColor(p: number) {
  if (p >= 99.5) return 'var(--green)'
  if (p >= 90) return 'var(--amber)'
  return 'var(--red)'
}

export interface SelectMods { additive: boolean; range: boolean }

export default function Sidebar({
  trial, stats, skeleton, setSkeleton, selection, primary, onSelect, order, setOrder,
}: {
  trial: Trial; stats: MarkerStat[]; skeleton: Skeleton
  setSkeleton: (s: Skeleton) => void; selection: string[]; primary: string | null
  onSelect: (n: string, mods: SelectMods) => void
  order: string[]; setOrder: (o: string[]) => void
}) {
  const [filter, setFilter] = useState('')
  const [batchColor, setBatchColor] = useState('#ff8c42')
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [overIdx, setOverIdx] = useState<number | null>(null)
  const selSet = useMemo(() => new Set(selection), [selection])

  // stats in the user-defined order
  const ordered = useMemo(() => {
    const byName = new Map(stats.map((s) => [s.name, s]))
    const list = order.map((n) => byName.get(n)).filter(Boolean) as MarkerStat[]
    // include any markers missing from `order` (safety)
    for (const s of stats) if (!order.includes(s.name)) list.push(s)
    return list
  }, [stats, order])

  const filtering = filter.trim().length > 0
  const filtered = useMemo(
    () => ordered.filter((s) => s.name.toLowerCase().includes(filter.toLowerCase())),
    [ordered, filter],
  )

  const doReorder = (from: number, to: number) => {
    if (from === to) return
    const next = order.slice()
    const [m] = next.splice(from, 1)
    next.splice(to, 0, m)
    setOrder(next)
  }

  const totalValid = stats.reduce((a, s) => a + s.valid, 0)
  const totalAll = stats.length * trial.nFrames
  const overallPct = totalAll ? ((100 * totalValid) / totalAll).toFixed(1) : '0'

  const applyBatch = () => {
    const mc = { ...skeleton.markerColors }
    for (const n of selection) mc[n] = batchColor
    setSkeleton({ ...skeleton, markerColors: mc })
  }
  const clearBatch = () => {
    const mc = { ...skeleton.markerColors }
    for (const n of selection) delete mc[n]
    setSkeleton({ ...skeleton, markerColors: mc })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-1)' }}>
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--line)' }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>
          Markers <span className="muted">({trial.nMarkers})</span>
        </div>
        <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>
          {trial.nFrames} frames @ {trial.markerRate}Hz · overall valid {overallPct}%
        </div>

        <div className="row" style={{ marginBottom: 8 }}>
          <input
            type="text" placeholder="filter…" value={filter}
            onChange={(e) => setFilter(e.target.value)} style={{ flex: 1 }}
          />
        </div>

        <div className="row" style={{ gap: 8, fontSize: 11 }}>
          <span className="muted" style={{ flexShrink: 0 }}>{selection.length} selected</span>
          <ColorPicker value={batchColor} onChange={setBatchColor} title="colour for selected markers" />
          <button disabled={!selection.length} onClick={applyBatch} style={{ padding: '4px 8px' }}>Apply</button>
          <button disabled={!selection.length} onClick={clearBatch} style={{ padding: '4px 8px' }}>Reset</button>
        </div>
        <div className="muted" style={{ fontSize: 10, marginTop: 4 }}>
          Shift = range · Ctrl/⌘ = toggle
        </div>
      </div>

      {filtering && (
        <div className="muted" style={{ fontSize: 10, padding: '4px 14px' }}>
          clear the filter to reorder markers
        </div>
      )}
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {filtered.map((s, idx) => {
          const isSel = selSet.has(s.name)
          const isPrimary = s.name === primary
          const override = skeleton.markerColors[s.name]
          return (
            <div
              key={s.name}
              draggable={!filtering}
              onDragStart={() => setDragIdx(idx)}
              onDragOver={(e) => { if (!filtering) { e.preventDefault(); setOverIdx(idx) } }}
              onDrop={(e) => {
                e.preventDefault()
                if (!filtering && dragIdx != null) doReorder(dragIdx, idx)
                setDragIdx(null); setOverIdx(null)
              }}
              onDragEnd={() => { setDragIdx(null); setOverIdx(null) }}
              onClick={(e) => onSelect(s.name, { additive: e.ctrlKey || e.metaKey, range: e.shiftKey })}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '7px 14px',
                cursor: 'pointer', borderBottom: '1px solid #1c2030',
                borderTop: overIdx === idx && dragIdx != null ? '2px solid var(--accent-2)' : '2px solid transparent',
                background: isPrimary ? 'rgba(108,92,231,.28)' : isSel ? 'rgba(108,92,231,.14)' : 'transparent',
                userSelect: 'none', opacity: dragIdx === idx ? 0.4 : 1,
              }}
            >
              {!filtering && (
                <span className="muted" style={{ cursor: 'grab', fontSize: 13, lineHeight: 1 }}
                  title="drag to reorder">⠿</span>
              )}
              <span onClick={(e) => e.stopPropagation()}>
                <ColorPicker
                  value={override || skeleton.markerColor}
                  onChange={(c) => setSkeleton({
                    ...skeleton,
                    markerColors: { ...skeleton.markerColors, [s.name]: c },
                  })}
                  title="per-marker colour"
                />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.name}
                </div>
                <div style={{ height: 3, background: '#262b3c', borderRadius: 3, marginTop: 4 }}>
                  <div style={{
                    width: `${s.percent}%`, height: '100%', borderRadius: 3,
                    background: pctColor(s.percent),
                  }} />
                </div>
              </div>
              <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 11 }}>
                <div style={{ color: pctColor(s.percent) }}>{s.percent}%</div>
                <div className="muted">{s.valid}/{s.total}</div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
