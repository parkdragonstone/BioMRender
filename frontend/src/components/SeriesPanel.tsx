import { useEffect, useRef, useState } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { playback } from '../playback'
import type { Trial, SeriesTarget } from '../types'

interface Built {
  xs: number[]
  series: { label: string; data: (number | null)[]; stroke: string }[]
  yLabel: string
  title: string
  nan: [number, number][]   // missing-data spans in FRAME units
  dataMax: number
}

function build(trial: Trial, target: NonNullable<SeriesTarget>): Built {
  if (target.kind === 'marker') {
    const m = trial.markerNames.indexOf(target.name)
    const n = trial.nFrames, nM = trial.nMarkers
    // uPlot needs `null` (not NaN) for gaps, else the y-scale breaks and lines vanish
    const xs = new Array(n)
    const X: (number | null)[] = new Array(n), Y: (number | null)[] = new Array(n), Z: (number | null)[] = new Array(n)
    const nan: [number, number][] = []
    let s = -1
    for (let f = 0; f < n; f++) {
      xs[f] = f
      const i = (f * nM + m) * 3
      const x = trial.points[i]
      if (Number.isNaN(x)) {
        X[f] = null; Y[f] = null; Z[f] = null
        if (s < 0) s = f
      } else {
        X[f] = x; Y[f] = trial.points[i + 1]; Z[f] = trial.points[i + 2]
        if (s >= 0) { nan.push([s - 0.5, f - 0.5]); s = -1 }
      }
    }
    if (s >= 0) nan.push([s - 0.5, n - 0.5])
    return {
      xs,
      series: [
        { label: 'X', data: X, stroke: '#ff5d6c' },
        { label: 'Y', data: Y, stroke: '#2ecc71' },
        { label: 'Z', data: Z, stroke: '#3a87f0' },
      ],
      yLabel: 'mm', title: `Marker: ${target.name}`, nan, dataMax: n - 1,
    }
  }
  // GRF: map analog frames onto the marker-frame x-axis so it lines up with playback
  const plates = target.plates.filter((i) => trial.plates[i]?.hasData && trial.plates[i].force)
  const nA = plates.length ? trial.plates[plates[0]].nFrames : 0
  const nMF = trial.nFrames
  const xs = new Array(nA), FX = new Array(nA).fill(0), FY = new Array(nA).fill(0), FZ = new Array(nA).fill(0)
  for (let f = 0; f < nA; f++) {
    xs[f] = nA > 1 ? (f * (nMF - 1)) / (nA - 1) : 0
    for (const i of plates) {
      const force = trial.plates[i].force!
      FX[f] += force[f * 3]; FY[f] += force[f * 3 + 1]; FZ[f] += force[f * 3 + 2]
    }
  }
  return {
    xs,
    series: [
      { label: 'Fx', data: FX, stroke: '#ff5d6c' },
      { label: 'Fy', data: FY, stroke: '#2ecc71' },
      { label: 'Fz', data: FZ, stroke: '#3a87f0' },
    ],
    yLabel: 'N',
    title: plates.length > 1
      ? `Resultant force · FP ${plates.map((i) => i + 1).join(' + ')}`
      : `Force plate ${(plates[0] ?? 0) + 1}`,
    nan: [], dataMax: nMF - 1,
  }
}

export default function SeriesPanel({
  trial, target, height, onClose, onDeleteFrame, onDeleteRange, onSelection,
}: {
  trial: Trial; target: SeriesTarget; height: number
  onClose: () => void; onDeleteFrame: () => void
  onDeleteRange: (start: number, end: number) => void
  onSelection: (range: { start: number; end: number } | null) => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const plotRef = useRef<uPlot | null>(null)
  const cursorRef = useRef<HTMLDivElement>(null)
  const nanRef = useRef<[number, number][]>([])
  const selRef = useRef<{ a: number; b: number } | null>(null)
  const placeSelRef = useRef<() => void>(() => {})
  const heightRef = useRef(height); heightRef.current = height
  const [sel, setSel] = useState<{ a: number; b: number } | null>(null)

  // build the plot once per target (NOT per data change, so zoom survives edits)
  useEffect(() => {
    if (!target || !hostRef.current) return
    const host = hostRef.current
    const b = build(trial, target)
    nanRef.current = b.nan
    selRef.current = null; setSel(null)

    const tip = document.createElement('div')
    tip.style.cssText = 'position:absolute;pointer-events:none;display:none;z-index:10;'
      + 'background:rgba(16,18,26,.95);border:1px solid var(--line);border-radius:6px;'
      + 'padding:4px 8px;font-size:11px;white-space:nowrap;color:var(--text-0)'
    const selDiv = document.createElement('div')
    selDiv.style.cssText = 'position:absolute;top:0;bottom:0;display:none;pointer-events:none;z-index:3;'
      + 'background:rgba(255,210,63,.18);border-left:1px solid #ffd23f;border-right:1px solid #ffd23f'

    const placeSel = () => {
      const u = plotRef.current
      if (!u || !selRef.current) { selDiv.style.display = 'none'; return }
      const x1 = u.valToPos(selRef.current.a, 'x'), x2 = u.valToPos(selRef.current.b, 'x')
      selDiv.style.left = Math.min(x1, x2) + 'px'
      selDiv.style.width = Math.abs(x2 - x1) + 'px'
      selDiv.style.display = 'block'
    }
    const placeCursor = () => {
      const u = plotRef.current, c = cursorRef.current
      if (!u || !c) return
      const px = u.valToPos(playback.frame, 'x', false)
      const w = u.bbox.width / devicePixelRatio
      if (Number.isFinite(px) && px >= 0 && px <= w) {
        c.style.left = (u.bbox.left / devicePixelRatio + px) + 'px'; c.style.display = 'block'
      } else c.style.display = 'none'
    }

    const opts: uPlot.Options = {
      width: host.clientWidth || 600,            // fallback so the scale auto-ranges even before layout settles
      height: (heightRef.current - 30) || 180,
      title: b.title,
      cursor: { y: false, drag: { x: false, y: false } },
      legend: { show: true, live: true },
      scales: { x: { time: false, range: (_u, dMin, dMax) => [dMin ?? 0, dMax ?? b.dataMax] } },
      axes: [
        { stroke: '#aab1c4', grid: { stroke: '#23283a' }, ticks: { stroke: '#23283a' },
          values: (_u, v) => v.map((x) => String(Math.round(x))), label: 'frame' },
        { stroke: '#aab1c4', grid: { stroke: '#23283a' }, ticks: { stroke: '#23283a' }, label: b.yLabel },
      ],
      series: [
        {},
        ...b.series.map((s) => ({ label: s.label, stroke: s.stroke, width: 1.5, spanGaps: false })),
      ],
      hooks: {
        drawClear: [(u) => {
          const ctx = u.ctx
          ctx.save()
          ctx.fillStyle = 'rgba(255,93,108,0.16)'
          for (const [a, c] of nanRef.current) {
            const x1 = u.valToPos(a, 'x', true), x2 = u.valToPos(c, 'x', true)
            ctx.fillRect(x1, u.bbox.top, x2 - x1, u.bbox.height)
          }
          ctx.restore()
        }],
        draw: [() => { placeSel(); placeCursor() }],
        setCursor: [(u) => {
          const { idx, left, top } = u.cursor
          if (idx == null || left == null || left < 0) { tip.style.display = 'none'; return }
          let html = `<b>frame ${Math.round((u.data[0] as number[])[idx])}</b>`
          for (let si = 1; si < u.series.length; si++) {
            const s = u.series[si]
            if (s.show === false) continue
            const v = (u.data[si] as (number | null)[])[idx]
            html += `<br><span style="color:${s.stroke}">${s.label}</span> `
              + (v == null || Number.isNaN(v) ? '–' : v.toFixed(1))
          }
          tip.innerHTML = html; tip.style.display = 'block'
          tip.style.left = (left + 14) + 'px'; tip.style.top = ((top ?? 0) + 8) + 'px'
        }],
      },
    }

    const data = [b.xs, ...b.series.map((s) => s.data)] as unknown as uPlot.AlignedData
    const u = new uPlot(opts, data, host)
    plotRef.current = u
    u.over.appendChild(tip)
    u.over.appendChild(selDiv)

    // ---- interactions ----
    const over = u.over
    const dataMax = b.dataMax
    const relX = (e: MouseEvent) => e.clientX - over.getBoundingClientRect().left
    const plotW = () => u.bbox.width / devicePixelRatio
    const clampScale = (min: number, max: number) => {
      const w = max - min
      if (min < 0) { min = 0; max = w }
      if (max > dataMax) { max = dataMax; min = Math.max(0, dataMax - w) }
      u.setScale('x', { min, max })
    }
    let mode: 'scrub' | 'zoom' | 'pan' | 'fsel' | null = null
    let startX = 0, moved = false
    let panMin = 0, panMax = 0

    // window move/up listeners live only DURING a drag (no leaks / cross-talk)
    const onMove = (e: MouseEvent) => {
      if (!mode) return
      const x = relX(e)
      if (Math.abs(x - startX) > 2) moved = true
      if (mode === 'scrub') playback.seek(u.posToVal(x, 'x'))
      else if (mode === 'zoom' && moved) u.setSelect({ left: Math.min(startX, x), top: 0, width: Math.abs(x - startX), height: over.clientHeight }, false)
      else if (mode === 'pan') {
        const dVal = (x - startX) * (panMax - panMin) / plotW()
        clampScale(panMin - dVal, panMax - dVal)
      } else if (mode === 'fsel') {
        selRef.current = { a: u.posToVal(startX, 'x'), b: u.posToVal(x, 'x') }
        placeSel(); setSel({ ...selRef.current })
      }
    }
    const endDrag = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    function onUp(e: MouseEvent) {
      endDrag()
      if (!mode) return
      if (mode === 'zoom' && moved) {
        const a = u.posToVal(startX, 'x'), c = u.posToVal(relX(e), 'x')
        if (Math.abs(c - a) > 1e-4) u.setScale('x', { min: Math.min(a, c), max: Math.max(a, c) })
        u.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false)
      } else if (mode === 'fsel') {
        setSel(selRef.current ? { ...selRef.current } : null)
      } else if (mode === 'scrub' && !moved) {
        // a plain click: if it landed in a red (missing-data) band, select that gap
        const xv = u.posToVal(startX, 'x')
        const band = nanRef.current.find(([a, c]) => xv >= a && xv <= c)
        if (band) { selRef.current = { a: band[0] + 0.5, b: band[1] - 0.5 }; placeSel(); setSel({ ...selRef.current }) }
        else { selRef.current = null; placeSel(); setSel(null) }
      }
      mode = null
    }
    const onDown = (e: MouseEvent) => {
      startX = relX(e); moved = false
      if (e.button === 0) {
        if (e.ctrlKey || e.metaKey) mode = 'zoom'
        else { mode = 'scrub'; playback.seek(u.posToVal(startX, 'x')) }
      } else if (e.button === 2) {
        e.preventDefault()
        if (e.shiftKey) {
          mode = 'fsel'
          const v = u.posToVal(startX, 'x'); selRef.current = { a: v, b: v }; placeSel()
        } else {
          mode = 'pan'; panMin = u.scales.x.min!; panMax = u.scales.x.max!
        }
      } else return
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const xval = u.posToVal(relX(e), 'x')
      const min = u.scales.x.min!, max = u.scales.x.max!
      const f = e.deltaY < 0 ? 0.82 : 1.22
      clampScale(xval - (xval - min) * f, xval + (max - xval) * f)
    }
    const onCtx = (e: Event) => e.preventDefault()
    const onDbl = () => { u.setScale('x', { min: 0, max: dataMax }) }

    over.addEventListener('mousedown', onDown)
    over.addEventListener('wheel', onWheel, { passive: false })
    over.addEventListener('contextmenu', onCtx)
    over.addEventListener('dblclick', onDbl)

    const ro = new ResizeObserver(() => {
      const w = host.clientWidth
      if (w > 0) u.setSize({ width: w, height: heightRef.current - 30 })
    })
    ro.observe(host)
    const unsub = playback.subscribe(placeCursor)

    placeSelRef.current = placeSel
    return () => {
      ro.disconnect(); unsub(); endDrag()
      over.removeEventListener('mousedown', onDown)
      over.removeEventListener('wheel', onWheel)
      over.removeEventListener('contextmenu', onCtx)
      over.removeEventListener('dblclick', onDbl)
      tip.remove(); selDiv.remove()
      u.destroy(); plotRef.current = null
    }
  }, [target])

  // keep the selection overlay in sync with the React selection state, and
  // report the selected frame range (only for marker series) up to App.
  useEffect(() => {
    placeSelRef.current()
    if (target?.kind === 'marker' && sel) {
      onSelection({ start: Math.round(Math.min(sel.a, sel.b)), end: Math.round(Math.max(sel.a, sel.b)) })
    } else onSelection(null)
  }, [sel, target])

  // data changed (e.g. delete/gap-fill) -> update in place, keep current zoom
  useEffect(() => {
    const u = plotRef.current
    if (!u || !target) return
    const b = build(trial, target)
    nanRef.current = b.nan
    // preserve the current zoom on edits, but auto-range if the scale isn't set yet
    const preserve = u.scales.x.min != null
    u.setData([b.xs, ...b.series.map((s) => s.data)] as unknown as uPlot.AlignedData, !preserve)
    u.redraw()   // refresh red bands / curves immediately (no mouse move needed)
  }, [trial])

  // height changed -> resize without rebuild
  useEffect(() => { plotRef.current?.setSize({ width: hostRef.current!.clientWidth, height: height - 30 }) }, [height])

  if (!target) return null

  const delLabel = sel
    ? `🗑 Delete frames ${Math.round(Math.min(sel.a, sel.b))}–${Math.round(Math.max(sel.a, sel.b))}`
    : '🗑 Delete frame'
  const doDelete = () => {
    if (sel) { onDeleteRange(Math.round(Math.min(sel.a, sel.b)), Math.round(Math.max(sel.a, sel.b))); selRef.current = null; setSel(null) }
    else onDeleteFrame()
  }

  return (
    <div style={{
      position: 'relative', height, background: 'rgba(16,18,26,.94)',
      borderTop: '1px solid var(--accent)', backdropFilter: 'blur(2px)',
    }}>
      {target.kind === 'marker' && (
        <button onClick={doDelete}
          title="Delete current frame, or the Shift+right-drag selection (Ctrl+Z to undo)"
          style={{ position: 'absolute', top: 6, left: 8, zIndex: 6, padding: '2px 8px', borderColor: 'var(--red)', color: 'var(--red)' }}
        >{delLabel}</button>
      )}
      <button onClick={onClose} style={{ position: 'absolute', top: 6, right: 8, zIndex: 5, padding: '2px 8px' }}>✕</button>
      <div ref={hostRef} style={{ width: '100%', height: '100%' }} />
      <div ref={cursorRef} style={{
        position: 'absolute', top: 24, bottom: 4, width: 1, background: '#ffd23f',
        pointerEvents: 'none', display: 'none',
      }} />
    </div>
  )
}
