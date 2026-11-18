import { useCallback, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from 'react'

export interface PanZoom {
  z: number
  x: number
  y: number
}

const MIN = 0.25
const MAX = 8
const clamp = (z: number) => Math.min(MAX, Math.max(MIN, z))

// Zoom and pan for one surface: buttons, the wheel, dragging with one finger or the mouse,
// and pinching with two fingers. The surface needs `touch-action: none`.
export function usePanZoom() {
  const [t, setT] = useState<PanZoom>({ z: 1, x: 0, y: 0 })
  const zRef = useRef(1)
  zRef.current = t.z
  const pts = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ d: number; z: number } | null>(null)

  const zoomBy = useCallback((f: number) => setT((p) => ({ ...p, z: clamp(p.z * f) })), [])
  const reset = useCallback(() => setT({ z: 1, x: 0, y: 0 }), [])

  const handlers = useMemo(() => {
    const spread = () => {
      const [a, b] = [...pts.current.values()]
      return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
    }
    const drop = (e: PointerEvent<HTMLElement>) => {
      pts.current.delete(e.pointerId)
      if (pts.current.size < 2) pinch.current = null
    }
    return {
      onPointerDown(e: PointerEvent<HTMLElement>) {
        try {
          e.currentTarget.setPointerCapture(e.pointerId)
        } catch {
          /* the pointer is already gone */
        }
        pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
        if (pts.current.size === 2) pinch.current = { d: spread(), z: zRef.current }
      },
      onPointerMove(e: PointerEvent<HTMLElement>) {
        const prev = pts.current.get(e.pointerId)
        if (!prev) return
        const dx = e.clientX - prev.x
        const dy = e.clientY - prev.y
        pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
        const p = pinch.current
        if (pts.current.size >= 2 && p && p.d > 0) {
          const z = clamp((p.z * spread()) / p.d)
          setT((o) => ({ ...o, z }))
        } else if (pts.current.size === 1) setT((o) => ({ ...o, x: o.x + dx, y: o.y + dy }))
      },
      onPointerUp: drop,
      onPointerCancel: drop,
      onWheel(e: WheelEvent<HTMLElement>) {
        zoomBy(e.deltaY > 0 ? 1 / 1.15 : 1.15)
      },
    }
  }, [zoomBy])

  return { t, zoomBy, reset, handlers }
}
