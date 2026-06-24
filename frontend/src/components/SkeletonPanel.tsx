import { useRef, useState } from 'react'
import type { Trial, Skeleton } from '../types'
import ColorPicker from './ColorPicker'

export default function SkeletonPanel({
  trial, skeleton, setSkeleton, makeMode, pending, onToggleMake,
}: {
  trial: Trial; skeleton: Skeleton; setSkeleton: (s: Skeleton) => void
  makeMode: boolean; pending: string | null; onToggleMake: () => void
}) {
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const add = () => {
    if (!a || !b || a === b) return
    if (skeleton.connections.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) return
    setSkeleton({ ...skeleton, connections: [...skeleton.connections, [a, b]] })
  }
  const remove = (i: number) =>
    setSkeleton({ ...skeleton, connections: skeleton.connections.filter((_, k) => k !== i) })

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(skeleton, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${trial.name.replace(/\.[^.]+$/, '')}_skeleton.json`
    a.click(); URL.revokeObjectURL(url)
  }

  const importJson = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const j = JSON.parse(reader.result as string)
        setSkeleton({
          markerColor: j.markerColor || '#2ecc71',
          skeletonColor: j.skeletonColor || '#2ecc71',
          markerColors: j.markerColors || {},
          connections: (j.connections || []).filter(
            (c: any) => Array.isArray(c) && c.length === 2,
          ),
        })
      } catch { alert('Invalid skeleton JSON') }
    }
    reader.readAsText(file)
  }

  return (
    <div style={{ padding: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontWeight: 600 }}>Skeleton</span>
        <div className="row">
          <button onClick={() => fileRef.current?.click()}>Import</button>
          <button onClick={exportJson}>Export</button>
          <input ref={fileRef} type="file" accept=".json" hidden
            onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])} />
        </div>
      </div>

      <button
        className={makeMode ? 'primary' : ''}
        style={{ width: '100%', marginBottom: 8 }}
        onClick={onToggleMake}
      >
        {makeMode ? '● Click markers in 3D… (Esc to stop)' : 'Make Skeleton (click in 3D)'}
      </button>
      {makeMode && (
        <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>
          {pending ? <>start: <b style={{ color: 'var(--text-0)' }}>{pending}</b> — click next marker</>
            : 'click the first marker'}
        </div>
      )}

      <div className="row" style={{ gap: 8, marginBottom: 10, fontSize: 11 }}>
        <span className="muted">Skeleton colour</span>
        <ColorPicker value={skeleton.skeletonColor}
          onChange={(c) => setSkeleton({ ...skeleton, skeletonColor: c })}
          title="skeleton line colour" />
      </div>

      <div className="row" style={{ marginBottom: 8 }}>
        <select value={a} onChange={(e) => setA(e.target.value)} style={{ flex: 1 }}>
          <option value="">from…</option>
          {trial.markerNames.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <select value={b} onChange={(e) => setB(e.target.value)} style={{ flex: 1 }}>
          <option value="">to…</option>
          {trial.markerNames.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <button className="primary" onClick={add}>+</button>
      </div>

      <div style={{ maxHeight: 220, overflowY: 'auto' }}>
        {skeleton.connections.length === 0 && (
          <div className="muted" style={{ fontSize: 11 }}>No connections yet.</div>
        )}
        {skeleton.connections.map(([x, y], i) => (
          <div key={i} className="row" style={{
            justifyContent: 'space-between', padding: '4px 6px', fontSize: 11,
            borderBottom: '1px solid #1c2030',
          }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {x} — {y}
            </span>
            <button onClick={() => remove(i)} style={{ padding: '1px 7px' }}>✕</button>
          </div>
        ))}
      </div>
      <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
        {skeleton.connections.length} connections
      </div>
    </div>
  )
}
