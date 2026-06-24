import { useEffect, useRef, useState } from 'react'
import { playback } from '../playback'
import type { Trial } from '../types'

export default function Timeline({ trial }: { trial: Trial }) {
  const [frame, setFrame] = useState(0)
  const [playing, setPlaying] = useState(false)
  const sliderRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const unsub = playback.subscribe((f) => {
      setFrame(f)
      setPlaying(playback.playing)
    })
    return unsub
  }, [])

  const fi = Math.floor(frame)
  const time = (frame / (trial.markerRate || 30)).toFixed(2)

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '8px 14px',
      background: 'var(--bg-1)', borderTop: '1px solid var(--line)',
    }}>
      <button
        className="primary"
        style={{ width: 78, height: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}
        onClick={() => playback.toggle()}
      >
        {playing ? '❚❚ Pause' : '▶ Play'}
      </button>
      <button onClick={() => playback.seek(0)} title="To start">⏮</button>
      <span style={{ width: 130, fontVariantNumeric: 'tabular-nums' }} className="muted">
        {fi} / {trial.nFrames - 1} &nbsp;·&nbsp; {time}s
      </span>
      <input
        ref={sliderRef}
        type="range"
        min={0}
        max={trial.nFrames - 1}
        step={1}
        value={fi}
        onChange={(e) => playback.seek(parseInt(e.target.value))}
        style={{ flex: 1, accentColor: 'var(--accent)' }}
      />
      <select
        defaultValue="1"
        onChange={(e) => playback.setSpeed(parseFloat(e.target.value))}
        title="Speed"
      >
        <option value="0.25">0.25×</option>
        <option value="0.5">0.5×</option>
        <option value="1">1×</option>
        <option value="2">2×</option>
        <option value="4">4×</option>
      </select>
    </div>
  )
}
