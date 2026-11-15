import { useLayoutEffect, useRef, useState } from 'react'
import type { GraphItem } from '../engine/Engine'

export function ContextMenu({
  graph,
  x,
  y,
  canChange,
  reason,
  onRename,
  onDelete,
}: {
  graph: GraphItem
  x: number
  y: number
  canChange: boolean
  reason: string
  onRename: () => void
  onDelete: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })
  useLayoutEffect(() => {
    const el = ref.current
    const mw = el?.offsetWidth || 220
    const mh = el?.offsetHeight || 120
    setPos({ left: Math.max(8, Math.min(x, window.innerWidth - mw - 8)), top: Math.max(8, Math.min(y, window.innerHeight - mh - 8)) })
    el?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
  }, [x, y])
  return (
    <div className="ctx" ref={ref} role="menu" aria-label="Actions for this graph" style={pos}>
      <div className="ctxhead">{graph.title}</div>
      <button type="button" className="ctxitem" role="menuitem" disabled={!canChange} onClick={onRename}>
        Rename graph…
      </button>
      <button type="button" className="ctxitem warn" role="menuitem" disabled={!canChange} onClick={onDelete}>
        Delete graph…
      </button>
      {!canChange && <div className="ctxnote">{reason}</div>}
    </div>
  )
}
