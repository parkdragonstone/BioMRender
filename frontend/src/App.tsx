import { useCallback, useEffect, useRef, useState } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import Viewer3D, { type AxisMode, type ClickMods } from './components/Viewer3D'
import ErrorBoundary from './components/ErrorBoundary'
import Sidebar, { type SelectMods } from './components/Sidebar'
import Timeline from './components/Timeline'
import SeriesPanel from './components/SeriesPanel'
import SkeletonPanel from './components/SkeletonPanel'
import InterpPanel from './components/InterpPanel'
import { uploadTrial, interpolate, setMarker, fetchTrialBlob, downloadBlob } from './api'
import { filesFromDrop, type DroppedItem } from './dropFiles'
import { playback } from './playback'
import type { Trial, Skeleton, MarkerStat, SeriesTarget, InterpMethod } from './types'

const DEFAULT_SKELETON: Skeleton = {
  markerColor: '#2ecc71', skeletonColor: '#2ecc71', markerColors: {}, connections: [],
}

export default function App() {
  const [trial, setTrial] = useState<Trial | null>(null)
  const [stats, setStats] = useState<MarkerStat[]>([])
  const [skeleton, setSkeleton] = useState<Skeleton>(DEFAULT_SKELETON)
  const [selection, setSelection] = useState<string[]>([])
  const [primary, setPrimary] = useState<string | null>(null)
  const [anchor, setAnchor] = useState<string | null>(null)
  const [markerOrder, setMarkerOrder] = useState<string[]>([])
  const [seriesTarget, setSeriesTarget] = useState<SeriesTarget>(null)
  const [graphSel, setGraphSel] = useState<{ start: number; end: number } | null>(null)
  const [makeMode, setMakeMode] = useState(false)
  const [pending, setPending] = useState<string | null>(null)
  const [axisMode, setAxisMode] = useState<AxisMode>('zup')
  const [showGRF, setShowGRF] = useState(true)
  const [trailOn, setTrailOn] = useState(false)
  const [trailLen, setTrailLen] = useState(150)
  const [overlayH, setOverlayH] = useState(210)
  const [droppedFiles, setDroppedFiles] = useState<DroppedItem[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const dragDepth = useRef(0)
  const undoStack = useRef<{ marker: string; before: Float32Array }[]>([])
  const actionsRef = useRef<{ undo: () => void; save: () => void }>({ undo: () => {}, save: () => {} })
  // writable handle of the currently-open file, when the browser provides one
  // (Chrome/Edge); lets Save overwrite the original in place instead of downloading.
  const fileHandleRef = useRef<FileSystemFileHandle | null>(null)

  // keyboard: space = play/pause, Esc cancels make-mode
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')
      if (e.key === 'Escape') { setMakeMode(false); setPending(null) }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); actionsRef.current.undo() }
      else if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); actionsRef.current.save() }
      else if (e.code === 'Space' && !typing) { e.preventDefault(); playback.toggle() }
      else if (e.key === 'ArrowLeft' && !typing) { e.preventDefault(); playback.step(-1) }
      else if (e.key === 'ArrowRight' && !typing) { e.preventDefault(); playback.step(1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const openTrial = useCallback((t: Trial) => {
    setTrial(t); setStats(t.stats); setSkeleton(DEFAULT_SKELETON)
    setMarkerOrder(t.markerNames)
    undoStack.current = []
    setSelection([]); setPrimary(null); setAnchor(null)
    setSeriesTarget(null); setMakeMode(false); setPending(null)
    playback.setTrial(t.nFrames, t.markerRate)
  }, [])

  const doUpload = async (item: DroppedItem) => {
    setLoading(true); setErr('')
    try {
      openTrial(await uploadTrial(item.file))
      fileHandleRef.current = item.handle ?? null
    }
    catch (e: any) { setErr(String(e.message || e)) }
    finally { setLoading(false) }
  }

  // Upload button: prefer the File System Access picker (gives a writable handle
  // so Save can overwrite in place); fall back to a plain <input type=file>.
  const openViaPicker = async () => {
    const pick = (window as any).showOpenFilePicker
    if (!pick) { fileRef.current?.click(); return }
    let handles: FileSystemFileHandle[]
    try {
      handles = await pick({
        multiple: true,
        types: [{ description: 'Motion capture', accept: { 'application/octet-stream': ['.c3d', '.trc'] } }],
      })
    } catch { return }   // user cancelled
    const items: DroppedItem[] = []
    for (const h of handles) items.push({ file: await h.getFile(), handle: h })
    if (!items.length) return
    setDroppedFiles(items)
    await doUpload(items[0])
    if (items.length > 1) setErr(`Loaded ${items[0].file.name} — ${items.length} files available in the dropdown.`)
  }

  // drag & drop: a file, several files, or a folder of .c3d/.trc
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    dragDepth.current = 0; setDragOver(false)
    const items = await filesFromDrop(e.dataTransfer)
    if (!items.length) { setErr('No .c3d / .trc files found in the drop.'); return }
    setDroppedFiles(items)
    await doUpload(items[0])
    if (items.length > 1) setErr(`Loaded ${items[0].file.name} — ${items.length} files available in the dropdown.`)
  }
  const onDragOver = (e: React.DragEvent) => { e.preventDefault() }
  const onDragEnter = (e: React.DragEvent) => { e.preventDefault(); dragDepth.current++; setDragOver(true) }
  const onDragLeave = (e: React.DragEvent) => { e.preventDefault(); if (--dragDepth.current <= 0) { dragDepth.current = 0; setDragOver(false) } }

  // unified marker selection (sidebar + 3D single click)
  const selectMarker = useCallback((name: string, mods: SelectMods | ClickMods) => {
    if (!trial) return
    const range = 'range' in mods && mods.range
    const additive = mods.additive
    if (range && anchor) {
      const order = markerOrder.length ? markerOrder : trial.markerNames
      const ia = order.indexOf(anchor), ib = order.indexOf(name)
      if (ia >= 0 && ib >= 0) {
        const [lo, hi] = ia < ib ? [ia, ib] : [ib, ia]
        setSelection(order.slice(lo, hi + 1))
        setPrimary(name)
      }
    } else if (additive) {
      setSelection((cur) => cur.includes(name) ? cur.filter((n) => n !== name) : [...cur, name])
      setPrimary(name); setAnchor(name)
    } else {
      setSelection([name]); setPrimary(name); setAnchor(name)
      setSeriesTarget({ kind: 'marker', name })
    }
  }, [trial, anchor, markerOrder])

  // 3D marker click — routes to skeleton-make when active
  const onMarkerClick = (name: string, mods: ClickMods) => {
    if (makeMode) {
      setPending((prev) => {
        if (!prev) return name
        if (prev !== name) {
          setSkeleton((s) => s.connections.some(([x, y]) =>
            (x === prev && y === name) || (x === name && y === prev))
            ? s : { ...s, connections: [...s.connections, [prev, name]] })
        }
        return name // chain from the last node
      })
      return
    }
    selectMarker(name, mods)
  }

  const onBoxSelect = (names: string[]) => {
    if (makeMode) return
    setSelection((cur) => Array.from(new Set([...cur, ...names])))
    setPrimary(names[names.length - 1])
    setAnchor(names[names.length - 1])
  }

  const onBackgroundClick = () => {
    if (makeMode) { setPending(null); return }
    setSelection([]); setPrimary(null)
  }

  const onSelectPlate = (i: number, additive: boolean) => {
    if (!trial) return
    if (!trial.plates[i]?.hasData) { setErr('That force plate has no force data.'); return }
    setSeriesTarget((prev) => {
      if (additive && prev && prev.kind === 'grf') {
        const plates = prev.plates.includes(i)
          ? prev.plates.filter((p) => p !== i)
          : [...prev.plates, i]
        return plates.length ? { kind: 'grf', plates } : null
      }
      return { kind: 'grf', plates: [i] }
    })
  }

  const selectedPlates = seriesTarget?.kind === 'grf' ? seriesTarget.plates : []

  // --- marker edit helpers (extract/write a marker column + undo history) ---
  const extractMarker = (t: Trial, marker: string): Float32Array => {
    const mi = t.markerNames.indexOf(marker), nM = t.nMarkers
    const out = new Float32Array(t.nFrames * 3)
    for (let f = 0; f < t.nFrames; f++) {
      const pi = (f * nM + mi) * 3
      out[f * 3] = t.points[pi]; out[f * 3 + 1] = t.points[pi + 1]; out[f * 3 + 2] = t.points[pi + 2]
    }
    return out
  }
  const writeMarker = (t: Trial, marker: string, data: Float32Array) => {
    const mi = t.markerNames.indexOf(marker), nM = t.nMarkers
    for (let f = 0; f < t.nFrames; f++) {
      const pi = (f * nM + mi) * 3
      t.points[pi] = data[f * 3]; t.points[pi + 1] = data[f * 3 + 1]; t.points[pi + 2] = data[f * 3 + 2]
    }
  }
  const pushUndo = (marker: string) => {
    if (!trial) return
    undoStack.current.push({ marker, before: extractMarker(trial, marker) })
    if (undoStack.current.length > 100) undoStack.current.shift()
  }

  const applyInterp = async (method: InterpMethod, sources: string[], maxGap: number | null) => {
    if (!trial || !primary) return
    setBusy(true); setErr('')
    pushUndo(primary)
    const useSel = graphSel && seriesTarget?.kind === 'marker' && seriesTarget.name === primary
    const range = useSel ? { rangeStart: graphSel!.start, rangeEnd: graphSel!.end } : {}
    try {
      const res = await interpolate(trial.trialId, primary, method, sources, { maxGap, ...range })
      writeMarker(trial, primary, res.data)
      setStats(res.stats)
      setTrial({ ...trial, stats: res.stats })
      const where = useSel ? `frames ${graphSel!.start}–${graphSel!.end}` : 'all gaps'
      setErr(`Filled ${res.filled} frames on ${primary} (${where}, ${res.afterValid}/${trial.nFrames} valid)`)
    } catch (e: any) { undoStack.current.pop(); setErr(String(e.message || e)) }
    finally { setBusy(false) }
  }

  // delete the current playhead frame of the marker shown in the graph
  const deleteCurrentFrame = async () => {
    if (!trial || seriesTarget?.kind !== 'marker') return
    const frame = Math.max(0, Math.min(trial.nFrames - 1, Math.round(playback.frame)))
    await deleteRange(frame, frame)
  }

  // delete an inclusive frame range of the marker shown in the graph
  const deleteRange = async (start: number, end: number) => {
    if (!trial || seriesTarget?.kind !== 'marker') return
    const marker = seriesTarget.name
    const lo = Math.max(0, Math.min(trial.nFrames - 1, Math.min(start, end)))
    const hi = Math.max(0, Math.min(trial.nFrames - 1, Math.max(start, end)))
    pushUndo(marker)
    const data = extractMarker(trial, marker)
    for (let f = lo; f <= hi; f++) { data[f * 3] = NaN; data[f * 3 + 1] = NaN; data[f * 3 + 2] = NaN }
    writeMarker(trial, marker, data)
    try {
      const { stats } = await setMarker(trial.trialId, marker, data)
      setStats(stats); setTrial({ ...trial, stats })
      setErr(lo === hi ? `Deleted frame ${lo} of ${marker}` : `Deleted frames ${lo}–${hi} of ${marker}`)
    } catch (e: any) { setErr(String(e.message || e)) }
  }

  const doUndo = async () => {
    if (!trial) return
    const op = undoStack.current.pop()
    if (!op) { setErr('Nothing to undo'); return }
    writeMarker(trial, op.marker, op.before)
    try {
      const { stats } = await setMarker(trial.trialId, op.marker, op.before)
      setStats(stats); setTrial({ ...trial, stats })
      setErr(`Undid change to ${op.marker}`)
    } catch (e: any) { setErr(String(e.message || e)) }
  }

  const doSave = async () => {
    if (!trial) return
    setErr('Saving…')
    try {
      const { name, blob } = await fetchTrialBlob(trial.trialId)
      const h = fileHandleRef.current as any
      if (h?.createWritable) {
        // overwrite the original file in place
        if (h.requestPermission) {
          const perm = await h.requestPermission({ mode: 'readwrite' })
          if (perm !== 'granted') throw new Error('write permission denied')
        }
        const w = await h.createWritable()
        await w.write(blob)
        await w.close()
        setErr(`Saved (overwrote ${h.name})`)
      } else {
        downloadBlob(name, blob)
        setErr(`Downloaded ${name} (open files via the Upload button in Chrome/Edge to overwrite in place)`)
      }
    } catch (e: any) { setErr(`Save failed: ${String(e.message || e)}`) }
  }

  actionsRef.current = { undo: doUndo, save: doSave }

  const startOverlayDrag = (e: React.MouseEvent) => {
    e.preventDefault()
    const startY = e.clientY, startH = overlayH
    const move = (ev: MouseEvent) =>
      setOverlayH(Math.max(120, Math.min(window.innerHeight - 200, startH + (startY - ev.clientY))))
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', position: 'relative' }}
      onDrop={onDrop} onDragOver={onDragOver} onDragEnter={onDragEnter} onDragLeave={onDragLeave}>
      {dragOver && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 100, pointerEvents: 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(12,13,18,.8)', border: '3px dashed var(--accent-2)',
          color: 'var(--text-0)', fontSize: 20, fontWeight: 600,
        }}>⬇ Drop .c3d / .trc files or a folder to load</div>
      )}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14, padding: '10px 16px',
        background: 'var(--bg-1)', borderBottom: '1px solid var(--line)',
      }}>
        <div style={{ fontWeight: 700, letterSpacing: .3 }}>
          <span style={{ color: 'var(--accent-2)' }}>◆</span> BioM Render
        </div>
        <span className="muted" style={{ fontSize: 11 }}>biomechanics · c3d / trc</span>
        <div style={{ flex: 1 }} />
        {trial && <span className="muted" style={{ fontSize: 12 }}>{trial.name}</span>}
        {droppedFiles.length > 0 && (
          <select value="" onChange={(e) => { const i = parseInt(e.target.value); if (!Number.isNaN(i)) doUpload(droppedFiles[i]) }}
            title="dropped files">
            <option value="">Dropped files ({droppedFiles.length})…</option>
            {droppedFiles.map((d, i) => <option key={i} value={i}>{d.file.name}</option>)}
          </select>
        )}
        <button onClick={openViaPicker}>Upload .c3d / .trc</button>
        <input ref={fileRef} type="file" accept=".c3d,.trc" multiple hidden
          onChange={(e) => { const items = Array.from(e.target.files || []).map((f) => ({ file: f })); if (items.length) { setDroppedFiles(items); doUpload(items[0]) } }} />
        {trial && (
          <>
            <label className="row" style={{ fontSize: 12 }} title="show a trailing path for selected markers">
              <input type="checkbox" checked={trailOn} onChange={(e) => setTrailOn(e.target.checked)} />
              Trail
              <input type="number" min={2} max={1000} value={trailLen} disabled={!trailOn}
                onChange={(e) => setTrailLen(Math.max(2, Math.min(1000, parseInt(e.target.value) || 150)))}
                style={{ width: 52 }} title="trail length (frames)" />
            </label>
            <button onClick={() => setAxisMode((a) => (a === 'zup' ? 'yup' : 'zup'))}
              title="Swap to z,x,y when source data is Y-up">
              {axisMode === 'zup' ? 'Z-up' : 'Y-up'}
            </button>
            <label className="row" style={{ fontSize: 12 }}>
              <input type="checkbox" checked={showGRF} onChange={(e) => setShowGRF(e.target.checked)} />
              GRF
            </label>
            <button onClick={doUndo} title="Undo (Ctrl+Z)">↶ Undo</button>
            <button onClick={doSave} title="Save — overwrites the original file (Ctrl+S)">💾 Save</button>
          </>
        )}
      </div>

      {err && (
        <div style={{
          padding: '6px 16px', fontSize: 12, background: '#1d2030',
          borderBottom: '1px solid var(--line)', color: 'var(--text-1)',
        }}>{err}</div>
      )}

      <div style={{ flex: 1, minHeight: 0 }}>
        {!trial ? (
          <div style={{
            height: '100%', display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 14, color: 'var(--text-1)',
          }}>
            <div style={{ fontSize: 34 }}>◆</div>
            <div>{loading ? 'Loading…' : 'Drag a .c3d / .trc file or a folder here, or upload'}</div>
            <div className="row">
              <button className="primary" onClick={openViaPicker}>Upload .c3d / .trc</button>
            </div>
          </div>
        ) : (
          <PanelGroup direction="horizontal">
            <Panel defaultSize={20} minSize={12} style={{ background: 'var(--bg-1)', overflowY: 'auto' }}>
              <SkeletonPanel trial={trial} skeleton={skeleton} setSkeleton={setSkeleton}
                makeMode={makeMode} pending={pending}
                onToggleMake={() => { setMakeMode((v) => !v); setPending(null) }} />
              <InterpPanel trial={trial} selected={primary} busy={busy}
                hasSelection={graphSel != null && seriesTarget?.kind === 'marker' && seriesTarget.name === primary}
                onApply={applyInterp} />
            </Panel>
            <PanelResizeHandle className="handle-v" />

            <Panel defaultSize={56} minSize={30}>
              <div style={{ position: 'relative', height: '100%' }}>
                <ErrorBoundary>
                  <Viewer3D
                    trial={trial} skeleton={skeleton} selection={selection} primary={primary}
                    pending={pending} makeMode={makeMode} axisMode={axisMode}
                    showGRF={showGRF} selectedPlates={selectedPlates}
                    trailOn={trailOn} trailLen={trailLen}
                    onMarkerClick={onMarkerClick} onBackgroundClick={onBackgroundClick}
                    onBoxSelect={onBoxSelect} onSelectPlate={onSelectPlate}
                  />
                </ErrorBoundary>
                {seriesTarget && (
                  <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
                    <div onMouseDown={startOverlayDrag}
                      style={{ height: 6, cursor: 'row-resize', background: 'var(--accent)' }} />
                    <SeriesPanel trial={trial} target={seriesTarget} height={overlayH}
                      onClose={() => { setSeriesTarget(null); setGraphSel(null) }} onDeleteFrame={deleteCurrentFrame}
                      onDeleteRange={deleteRange} onSelection={setGraphSel} />
                  </div>
                )}
              </div>
            </Panel>
            <PanelResizeHandle className="handle-v" />

            <Panel defaultSize={24} minSize={14}>
              <Sidebar trial={trial} stats={stats} skeleton={skeleton} setSkeleton={setSkeleton}
                selection={selection} primary={primary} onSelect={selectMarker}
                order={markerOrder} setOrder={setMarkerOrder} />
            </Panel>
          </PanelGroup>
        )}
      </div>

      {trial && <Timeline trial={trial} />}
    </div>
  )
}
