import { useLayoutEffect, useRef, useState } from 'react'
import type { GraphItem } from '../engine/Engine'

export function ContextMenu({
  graph,
  x,
  y,
  onRename,
  onDelete,
  onMove,
  onShare,
}: {
  graph: GraphItem
  x: number
  y: number
  onRename: () => void
  onDelete: () => void
  onMove?: () => void // only when the person may move graphs and there is a World to move to
  onShare?: () => void // only for a graph stored in a World, not one reached through a share
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
      <button type="button" className="ctxitem" role="menuitem" onClick={onRename}>
        Rename graph…
      </button>
      {onMove && (
        <button type="button" className="ctxitem" role="menuitem" onClick={onMove}>
          Move to World…
        </button>
      )}
      {onShare && (
        <button type="button" className="ctxitem" role="menuitem" onClick={onShare}>
          Share with World…
        </button>
      )}
      <button type="button" className="ctxitem warn" role="menuitem" onClick={onDelete}>
        Delete graph…
      </button>
    </div>
  )
}
