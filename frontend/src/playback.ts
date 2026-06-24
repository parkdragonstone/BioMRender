// Frame clock shared across the 3D viewer, timeline and plots.
// The current frame lives in a plain object (not React state) so the animation
// loop can run at 60fps without re-rendering the component tree.  Light UI bits
// (scrubber, plot cursor) subscribe and update themselves.

type Listener = (frame: number) => void

class Playback {
  frame = 0
  nFrames = 1
  rate = 30          // source fps
  speed = 1
  playing = false
  private listeners = new Set<Listener>()
  private last = 0
  private raf = 0

  constructor() {
    this.tick = this.tick.bind(this)
    this.raf = requestAnimationFrame(this.tick)
  }

  setTrial(nFrames: number, rate: number) {
    this.nFrames = Math.max(1, nFrames)
    this.rate = rate > 0 ? rate : 30
    this.frame = 0
    this.emit()
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn)
    fn(this.frame)
    return () => this.listeners.delete(fn)
  }

  private emit() {
    for (const fn of this.listeners) fn(this.frame)
  }

  play() { this.playing = true; this.last = performance.now(); this.emit() }
  pause() { this.playing = false; this.emit() }
  toggle() { this.playing ? this.pause() : this.play() }

  seek(f: number) {
    this.frame = Math.max(0, Math.min(this.nFrames - 1, f))
    this.emit()
  }

  // step one (or `delta`) whole frame(s); pauses playback so the view holds
  step(delta: number) {
    if (this.playing) this.pause()
    this.seek(Math.round(this.frame) + delta)
  }

  setSpeed(s: number) { this.speed = s }

  private tick(now: number) {
    if (this.playing) {
      const dt = (now - this.last) / 1000
      this.last = now
      this.frame += dt * this.rate * this.speed
      if (this.frame >= this.nFrames - 1) {
        this.frame = 0          // loop back to start
      }
      this.emit()
    }
    this.raf = requestAnimationFrame(this.tick)
  }
}

export const playback = new Playback()
