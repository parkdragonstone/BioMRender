import { useEffect, useRef, useState } from 'react'

// 8 base colours selectable directly; "More color…" reveals the full native picker.
export const PALETTE = [
  '#2ecc71', '#ff5d6c', '#3a87f0', '#ffd23f',
  '#ff8c42', '#8b7bff', '#22d3ee', '#f2f4f8',
]

export default function ColorPicker({
  value, onChange, size = 16, title,
}: {
  value: string; onChange: (c: string) => void; size?: number; title?: string
}) {
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setCustom(false) }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const pick = (c: string) => { onChange(c); setOpen(false); setCustom(false) }

  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        title={title}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }}
        style={{
          width: size, height: size, padding: 0, borderRadius: 4,
          border: '1px solid var(--line)', background: value, cursor: 'pointer',
        }}
      />
      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', top: size + 6, left: 0, zIndex: 50,
            background: 'var(--bg-3)', border: '1px solid var(--line)', borderRadius: 8,
            padding: 8, boxShadow: '0 6px 20px rgba(0,0,0,.5)', width: 132,
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
            {PALETTE.map((c) => (
              <button key={c} onClick={() => pick(c)} title={c}
                style={{
                  width: 22, height: 22, padding: 0, borderRadius: 5, cursor: 'pointer',
                  background: c,
                  border: value.toLowerCase() === c.toLowerCase()
                    ? '2px solid var(--text-0)' : '1px solid var(--line)',
                }} />
            ))}
          </div>
          {custom ? (
            <div className="row" style={{ marginTop: 8, gap: 6 }}>
              <input type="color" value={value} onChange={(e) => onChange(e.target.value)}
                style={{ width: 28, height: 24, padding: 0 }} />
              <span className="muted" style={{ fontSize: 11 }}>{value}</span>
            </div>
          ) : (
            <button onClick={() => setCustom(true)}
              style={{ marginTop: 8, width: '100%', fontSize: 11, padding: '4px 6px' }}>
              More color…
            </button>
          )}
        </div>
      )}
    </span>
  )
}
