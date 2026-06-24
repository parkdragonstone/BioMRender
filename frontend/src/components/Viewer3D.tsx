import { useRef, useMemo, useEffect, useState, forwardRef, useImperativeHandle } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Html } from '@react-three/drei'
import * as THREE from 'three'
import { playback } from '../playback'
import type { Trial, Skeleton } from '../types'

const MM = 0.001 // mm -> meters for the scene

export type AxisMode = 'zup' | 'yup'
export interface ClickMods { additive: boolean }

function frameIndex(n: number) {
  return Math.max(0, Math.min(n - 1, Math.floor(playback.frame)))
}

// remap raw (x,y,z) mm into scene meters. y-up data -> swap to z-up scene (z,x,y).
function remap(x: number, y: number, z: number, mode: AxisMode): [number, number, number] {
  return mode === 'yup' ? [z * MM, x * MM, y * MM] : [x * MM, y * MM, z * MM]
}

// ------------------------------------------------------------------ markers
function Markers({
  trial, skeleton, selection, pending, axisMode, onClick, onHover,
}: {
  trial: Trial; skeleton: Skeleton; selection: Set<string>; pending: string | null
  axisMode: AxisMode; onClick: (name: string, mods: ClickMods) => void
  onHover: (name: string | null) => void
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null!)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const nM = trial.nMarkers
  const selKey = [...selection].sort().join('|')

  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    const base = new THREE.Color(skeleton.markerColor)
    const sel = new THREE.Color('#ffd23f')
    const pend = new THREE.Color('#ff8c42')
    for (let m = 0; m < nM; m++) {
      const name = trial.markerNames[m]
      const c = name === pending ? pend
        : selection.has(name) ? sel
        : skeleton.markerColors[name] ? new THREE.Color(skeleton.markerColors[name])
        : base
      mesh.setColorAt(m, c)
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }, [selKey, pending, skeleton, nM, trial.markerNames])

  useFrame(() => {
    const mesh = meshRef.current
    if (!mesh) return
    const f = frameIndex(trial.nFrames)
    const pts = trial.points
    for (let m = 0; m < nM; m++) {
      const i = (f * nM + m) * 3
      const x = pts[i], y = pts[i + 1], z = pts[i + 2]
      if (Number.isNaN(x)) {
        dummy.position.set(0, 0, -9999)
        dummy.scale.setScalar(0.0001)
      } else {
        const [sx, sy, sz] = remap(x, y, z, axisMode)
        dummy.position.set(sx, sy, sz)
        const name = trial.markerNames[m]
        dummy.scale.setScalar(name === pending ? 1.8 : selection.has(name) ? 1.6 : 1)
      }
      dummy.updateMatrix()
      mesh.setMatrixAt(m, dummy.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, nM]}
      onPointerDown={(e) => {
        e.stopPropagation()
        if (e.instanceId == null) return
        const ne = e.nativeEvent as PointerEvent
        onClick(trial.markerNames[e.instanceId], { additive: ne.ctrlKey || ne.metaKey })
      }}
      onPointerMove={(e) => {
        e.stopPropagation()
        if (e.instanceId != null) {
          onHover(trial.markerNames[e.instanceId])
          document.body.style.cursor = 'pointer'
        }
      }}
      onPointerOut={() => { onHover(null); document.body.style.cursor = 'auto' }}
    >
      <sphereGeometry args={[0.012, 16, 16]} />
      <meshStandardMaterial roughness={0.4} metalness={0.1} />
    </instancedMesh>
  )
}

// ------------------------------------------------------------------ skeleton
function SkeletonLines({ trial, skeleton, axisMode }: { trial: Trial; skeleton: Skeleton; axisMode: AxisMode }) {
  const ref = useRef<THREE.LineSegments>(null!)
  const idxPairs = useMemo(() => {
    const map = new Map(trial.markerNames.map((n, i) => [n, i]))
    return skeleton.connections
      .map(([a, b]) => [map.get(a), map.get(b)] as [number | undefined, number | undefined])
      .filter(([a, b]) => a != null && b != null) as [number, number][]
  }, [skeleton.connections, trial.markerNames])

  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(Math.max(1, idxPairs.length) * 6), 3))
    return g
  }, [idxPairs])

  useFrame(() => {
    if (!ref.current || idxPairs.length === 0) return
    const f = frameIndex(trial.nFrames)
    const pts = trial.points, nM = trial.nMarkers
    const pos = geom.getAttribute('position') as THREE.BufferAttribute
    const arr = pos.array as Float32Array
    for (let k = 0; k < idxPairs.length; k++) {
      const [a, b] = idxPairs[k]
      const ia = (f * nM + a) * 3, ib = (f * nM + b) * 3
      const o = k * 6
      if (Number.isNaN(pts[ia]) || Number.isNaN(pts[ib])) {
        for (let j = 0; j < 6; j++) arr[o + j] = 0
      } else {
        const [ax, ay, az] = remap(pts[ia], pts[ia + 1], pts[ia + 2], axisMode)
        const [bx, by, bz] = remap(pts[ib], pts[ib + 1], pts[ib + 2], axisMode)
        arr[o] = ax; arr[o + 1] = ay; arr[o + 2] = az
        arr[o + 3] = bx; arr[o + 4] = by; arr[o + 5] = bz
      }
    }
    pos.needsUpdate = true
  })

  return (
    <lineSegments ref={ref} geometry={geom}>
      <lineBasicMaterial color={skeleton.skeletonColor} linewidth={2} />
    </lineSegments>
  )
}

// ------------------------------------------------------------------ GRF
function GRF({ trial, axisMode, selectedPlates, onSelectPlate }: {
  trial: Trial; axisMode: AxisMode; selectedPlates: number[]
  onSelectPlate: (i: number, additive: boolean) => void
}) {
  const sel = new Set(selectedPlates)
  return (
    <group>
      {trial.plates.map((_, i) => (
        <PlateViz key={i} trial={trial} plateIdx={i} axisMode={axisMode} selected={sel.has(i)}
          onClick={(additive) => onSelectPlate(i, additive)} />
      ))}
    </group>
  )
}

function PlateViz({ trial, plateIdx, axisMode, selected, onClick }: {
  trial: Trial; plateIdx: number; axisMode: AxisMode; selected: boolean
  onClick: (additive: boolean) => void
}) {
  const plate = trial.plates[plateIdx]
  const plateColor = selected ? '#ffd23f' : '#3a87f0'
  const shaft = useRef<THREE.Line>(null!)
  const head = useRef<THREE.Mesh>(null!)

  const cornersV = useMemo(() => {
    const c = plate.corners
    const arr: [number, number, number][] = []
    for (let i = 0; i < 4; i++) arr.push(remap(c[i * 3], c[i * 3 + 1], c[i * 3 + 2], axisMode))
    return arr
  }, [plate.corners, axisMode])

  const outline = useMemo(() => {
    const pts = cornersV.map((p) => new THREE.Vector3(p[0], p[1], p[2]))
    pts.push(pts[0].clone())
    return new THREE.BufferGeometry().setFromPoints(pts)
  }, [cornersV])

  // filled (mostly transparent) quad — this is the click target for the plate
  const quad = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      ...cornersV[0], ...cornersV[1], ...cornersV[2], ...cornersV[3],
    ]), 3))
    g.setIndex([0, 1, 2, 0, 2, 3])
    g.computeVertexNormals()
    return g
  }, [cornersV])

  const center = useMemo(() => {
    const v = new THREE.Vector3()
    cornersV.forEach((p) => v.add(new THREE.Vector3(p[0], p[1], p[2])))
    return v.multiplyScalar(0.25)
  }, [cornersV])

  const shaftGeom = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3))
    return g
  }, [])

  const FORCE = 0.0006 // N -> meters

  useFrame(() => {
    if (!plate.hasData || !plate.force || !plate.cop) return
    // force/analog is sampled faster than markers — map the marker playback
    // frame onto the analog timeline so the GRF shows at the right instant.
    const f = Math.max(0, Math.min(plate.nFrames - 1,
      Math.round((playback.frame / Math.max(1, trial.nFrames - 1)) * (plate.nFrames - 1))))
    const fx = plate.force[f * 3], fy = plate.force[f * 3 + 1], fz = plate.force[f * 3 + 2]
    const mag = Math.hypot(fx, fy, fz)
    const visible = mag > 20 && !Number.isNaN(fx)   // COP is unreliable at low force
    if (shaft.current) shaft.current.visible = visible
    if (head.current) head.current.visible = visible
    if (!visible) return
    const [ox, oy, oz] = remap(plate.cop[f * 3], plate.cop[f * 3 + 1], plate.cop[f * 3 + 2], axisMode)
    const [dx, dy, dz] = remap(fx * FORCE / MM, fy * FORCE / MM, fz * FORCE / MM, axisMode)
    const ex = ox + dx, ey = oy + dy, ez = oz + dz
    const pos = shaftGeom.getAttribute('position') as THREE.BufferAttribute
    const arr = pos.array as Float32Array
    arr[0] = ox; arr[1] = oy; arr[2] = oz; arr[3] = ex; arr[4] = ey; arr[5] = ez
    pos.needsUpdate = true
    if (head.current) {
      head.current.position.set(ex, ey, ez)
      head.current.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(ex - ox, ey - oy, ez - oz).normalize(),
      )
    }
  })

  return (
    <group>
      {/* clickable hit-area = only the plate quad */}
      <mesh geometry={quad} onPointerDown={(e) => { e.stopPropagation(); const ne = e.nativeEvent as PointerEvent; onClick(ne.ctrlKey || ne.metaKey) }}>
        <meshBasicMaterial color={plateColor} transparent opacity={selected ? 0.3 : 0.14} side={THREE.DoubleSide} />
      </mesh>
      <line geometry={outline}>
        <lineBasicMaterial color={plateColor} />
      </line>
      <group position={center}>
        <Html center style={{ pointerEvents: 'none' }} zIndexRange={[150, 0]}>
          <div style={{
            color: selected ? '#ffd23f' : '#bcd4ff', fontSize: 12, fontWeight: 700, letterSpacing: .5,
            background: 'rgba(16,18,26,.55)', padding: '1px 6px', borderRadius: 5, whiteSpace: 'nowrap',
            border: selected ? '1px solid #ffd23f' : 'none',
          }}>FP{plateIdx + 1}</div>
        </Html>
      </group>
      {plate.hasData && (
        <>
          <line ref={shaft} geometry={shaftGeom}>
            <lineBasicMaterial color="#ff5d6c" linewidth={3} />
          </line>
          <mesh ref={head}>
            <coneGeometry args={[0.02, 0.06, 12]} />
            <meshStandardMaterial color="#ff5d6c" />
          </mesh>
        </>
      )}
    </group>
  )
}

// ------------------------------------------------------------------ box select
type Rect = { x: number; y: number; w: number; h: number }
export interface RectHandle { set: (r: Rect | null) => void }

// DOM overlay (sibling of the Canvas) that draws the selection rectangle.
// Kept outside the R3F tree so dragging never re-renders the 3D scene.
const RectOverlay = forwardRef<RectHandle>((_, ref) => {
  const [rect, setRect] = useState<Rect | null>(null)
  useImperativeHandle(ref, () => ({ set: setRect }), [])
  if (!rect) return null
  return (
    <div style={{
      position: 'absolute', left: rect.x, top: rect.y, width: rect.w, height: rect.h,
      border: '1px solid var(--accent-2)', background: 'rgba(139,123,255,.15)',
      pointerEvents: 'none', zIndex: 4,
    }} />
  )
})

function BoxSelect({
  trial, axisMode, makeMode, onSelect, rectRef,
}: {
  trial: Trial; axisMode: AxisMode; makeMode: boolean
  onSelect: (names: string[]) => void; rectRef: React.RefObject<RectHandle | null>
}) {
  const { camera, gl, size } = useThree()
  const controls = useThree((s) => s.controls) as { enabled: boolean } | null
  const drag = useRef(false)
  const start = useRef<[number, number]>([0, 0])
  const box = useRef<Rect | null>(null)

  useEffect(() => {
    const el = gl.domElement
    const down = (e: PointerEvent) => {
      // Ctrl/Cmd + left drag starts a box-select; read the modifier from the
      // pointer event itself (robust regardless of keyboard focus).
      if (makeMode || e.button !== 0 || !(e.ctrlKey || e.metaKey)) return
      const r = el.getBoundingClientRect()
      start.current = [e.clientX - r.left, e.clientY - r.top]
      drag.current = true
      box.current = { x: start.current[0], y: start.current[1], w: 0, h: 0 }
      rectRef.current?.set(box.current)
      if (controls) controls.enabled = false   // freeze the camera while dragging
    }
    const move = (e: PointerEvent) => {
      if (!drag.current) return
      const r = el.getBoundingClientRect()
      const x = e.clientX - r.left, y = e.clientY - r.top
      const [sx, sy] = start.current
      box.current = { x: Math.min(sx, x), y: Math.min(sy, y), w: Math.abs(x - sx), h: Math.abs(y - sy) }
      rectRef.current?.set(box.current)
    }
    const up = () => {
      if (!drag.current) return
      drag.current = false
      if (controls) controls.enabled = true
      const cur = box.current
      box.current = null
      rectRef.current?.set(null)
      if (cur && (cur.w > 3 || cur.h > 3)) {
        const f = frameIndex(trial.nFrames)
        const v = new THREE.Vector3()
        const found: string[] = []
        for (let m = 0; m < trial.nMarkers; m++) {
          const i = (f * trial.nMarkers + m) * 3
          if (Number.isNaN(trial.points[i])) continue
          const [px, py, pz] = remap(trial.points[i], trial.points[i + 1], trial.points[i + 2], axisMode)
          v.set(px, py, pz).project(camera)
          const sxp = (v.x * 0.5 + 0.5) * size.width
          const syp = (-v.y * 0.5 + 0.5) * size.height
          if (sxp >= cur.x && sxp <= cur.x + cur.w && syp >= cur.y && syp <= cur.y + cur.h)
            found.push(trial.markerNames[m])
        }
        if (found.length) onSelect(found)
      }
    }
    el.addEventListener('pointerdown', down)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      el.removeEventListener('pointerdown', down)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [gl, camera, size, trial, axisMode, makeMode, onSelect, rectRef, controls])

  return null
}

// ------------------------------------------------------------------ trajectory
function Trail({ trial, name, trailLen, axisMode, color }: {
  trial: Trial; name: string; trailLen: number; axisMode: AxisMode; color: string
}) {
  const ref = useRef<THREE.Line>(null!)
  const m = trial.markerNames.indexOf(name)
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((trailLen + 1) * 3), 3))
    return g
  }, [trailLen])

  useFrame(() => {
    if (!ref.current || m < 0) return
    const cur = frameIndex(trial.nFrames)
    const nM = trial.nMarkers
    const pos = geom.getAttribute('position') as THREE.BufferAttribute
    const arr = pos.array as Float32Array
    let count = 0
    for (let i = 0; i <= trailLen; i++) {
      const f = cur - trailLen + i
      if (f < 0) continue
      const pi = (f * nM + m) * 3
      const x = trial.points[pi]
      if (Number.isNaN(x)) continue
      const [sx, sy, sz] = remap(x, trial.points[pi + 1], trial.points[pi + 2], axisMode)
      arr[count * 3] = sx; arr[count * 3 + 1] = sy; arr[count * 3 + 2] = sz
      count++
    }
    geom.setDrawRange(0, count)
    pos.needsUpdate = true
  })

  return (
    <line ref={ref} geometry={geom}>
      <lineBasicMaterial color={color} transparent opacity={0.9} />
    </line>
  )
}

function Trails({ trial, markers, trailLen, axisMode }: {
  trial: Trial; markers: string[]; trailLen: number; axisMode: AxisMode
}) {
  return <>{markers.map((n) => (
    <Trail key={n} trial={trial} name={n} trailLen={trailLen} axisMode={axisMode} color="#22d3ee" />
  ))}</>
}

// ------------------------------------------------------------------ scene
function SceneSetup() {
  const { camera } = useThree()
  useEffect(() => {
    camera.up.set(0, 0, 1)
    camera.position.set(2.5, -2.5, 1.8)
    camera.lookAt(0, 0, 0.8)
  }, [camera])
  return null
}

function Ground() {
  const grid = useMemo(() => {
    const g = new THREE.GridHelper(10, 40, 0x3a4055, 0x23283a)
    g.rotation.x = Math.PI / 2
    return g
  }, [])
  return <primitive object={grid} />
}

// A name tag anchored to a marker, drawn ABOVE the sphere (screen-space offset)
// so it never hides the marker itself, and always rendered on top (no occlusion).
function MarkerTag({ trial, name, color, axisMode }: { trial: Trial; name: string; color: string; axisMode: AxisMode }) {
  const ref = useRef<THREE.Group>(null!)
  const m = trial.markerNames.indexOf(name)
  useFrame(() => {
    if (!ref.current || m < 0) return
    const f = frameIndex(trial.nFrames)
    const i = (f * trial.nMarkers + m) * 3
    const x = trial.points[i]
    ref.current.visible = !Number.isNaN(x)
    if (!Number.isNaN(x)) {
      const [sx, sy, sz] = remap(x, trial.points[i + 1], trial.points[i + 2], axisMode)
      ref.current.position.set(sx, sy, sz)
    }
  })
  if (m < 0) return null
  return (
    <group ref={ref}>
      <Html style={{ pointerEvents: 'none' }} zIndexRange={[200, 0]}>
        <div style={{
          transform: 'translate(-50%, -175%)',
          background: 'rgba(16,18,26,.92)', color, padding: '2px 8px',
          borderRadius: 6, fontSize: 12, whiteSpace: 'nowrap', border: `1px solid ${color}`,
          boxShadow: '0 2px 8px rgba(0,0,0,.5)',
        }}>{name}</div>
      </Html>
    </group>
  )
}

function MarkerTags({ trial, primary, hovered, axisMode }: {
  trial: Trial; primary: string | null; hovered: string | null; axisMode: AxisMode
}) {
  const tags: { name: string; color: string }[] = []
  if (primary) tags.push({ name: primary, color: '#ffd23f' })
  if (hovered && hovered !== primary) tags.push({ name: hovered, color: '#8b7bff' })
  return <>{tags.map((t) => <MarkerTag key={t.name} trial={trial} name={t.name} color={t.color} axisMode={axisMode} />)}</>
}

export default function Viewer3D({
  trial, skeleton, selection, primary, pending, makeMode, axisMode, showGRF, selectedPlates,
  trailOn, trailLen,
  onMarkerClick, onBackgroundClick, onBoxSelect, onSelectPlate,
}: {
  trial: Trial; skeleton: Skeleton; selection: string[]; primary: string | null
  pending: string | null; makeMode: boolean; axisMode: AxisMode; showGRF: boolean
  selectedPlates: number[]; trailOn: boolean; trailLen: number
  onMarkerClick: (name: string, mods: ClickMods) => void
  onBackgroundClick: () => void
  onBoxSelect: (names: string[]) => void
  onSelectPlate: (i: number, additive: boolean) => void
}) {
  const selSet = useMemo(() => new Set(selection), [selection])
  const [hovered, setHovered] = useState<string | null>(null)
  const rectRef = useRef<RectHandle | null>(null)
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
    <Canvas
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      camera={{ fov: 50, near: 0.01, far: 1000 }}
      onPointerMissed={onBackgroundClick}
      onCreated={({ gl }) => {
        // Allow the GL context to be restored instead of permanently lost
        // (otherwise a context-loss event tears down the whole canvas).
        gl.domElement.addEventListener('webglcontextlost', (e) => e.preventDefault(), false)
      }}
      style={{ background: 'radial-gradient(circle at 50% 30%, #181b27 0%, #0c0d12 70%)' }}
    >
      <SceneSetup />
      <ambientLight intensity={0.7} />
      <directionalLight position={[5, -5, 8]} intensity={0.8} />
      <Ground />
      <axesHelper args={[0.4]} />
      <Markers trial={trial} skeleton={skeleton} selection={selSet} pending={pending}
        axisMode={axisMode} onClick={onMarkerClick} onHover={setHovered} />
      <SkeletonLines trial={trial} skeleton={skeleton} axisMode={axisMode} />
      {trailOn && selection.length > 0 && (
        <Trails trial={trial} markers={selection} trailLen={trailLen} axisMode={axisMode} />
      )}
      {showGRF && <GRF trial={trial} axisMode={axisMode} selectedPlates={selectedPlates} onSelectPlate={onSelectPlate} />}
      <MarkerTags trial={trial} primary={pending || primary} hovered={hovered} axisMode={axisMode} />
      <BoxSelect trial={trial} axisMode={axisMode} makeMode={makeMode}
        onSelect={onBoxSelect} rectRef={rectRef} />
      <OrbitControls
        makeDefault
        enablePan enableZoom enableRotate
        target={[0, 0, 0.8]}
        mouseButtons={{
          LEFT: THREE.MOUSE.ROTATE,
          MIDDLE: THREE.MOUSE.DOLLY,
          RIGHT: THREE.MOUSE.PAN,
        }}
      />
    </Canvas>
    <RectOverlay ref={rectRef} />
    </div>
  )
}
