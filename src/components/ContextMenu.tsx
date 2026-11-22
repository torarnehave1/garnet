import { useLayoutEffect, useRef, useState } from 'react'
import type { GraphItem, NodeItem } from '../engine/Engine'

export function ContextMenu({
  graph,
  node,
  marked,
  onInterest,
  x,
  y,
  onRename,
  onMetaArea,
  alone,
  onAlone,
  cards,
  onCards,
  onDelete,
  onMove,
  onShare,
}: {
  graph: GraphItem
  node: NodeItem | null // the node right-clicked, null when it was the graph itself
  marked: boolean // the node is marked as interesting
  onInterest: () => void
  x: number
  y: number
  onRename: () => void
  onMetaArea: () => void
  alone: boolean // this graph is the one shown alone
  onAlone: () => void
  cards: boolean // this graph's nodes are shown as cards (lib/cards.ts)
  onCards: () => void
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
    <div className="ctx" ref={ref} role="menu" aria-label={node ? 'Actions for this node and its graph' : 'Actions for this graph'} style={pos}>
      {node && (
        <>
          <div className="ctxhead">{node.label || 'Node'}</div>
          <button type="button" className="ctxitem" role="menuitem" onClick={onInterest}>
            {marked ? 'Remove interest mark' : 'Mark node as interesting'}
          </button>
        </>
      )}
      <div className="ctxhead">{graph.title}</div>
      <button type="button" className="ctxitem" role="menuitem" onClick={onAlone}>
        {alone ? 'Show all graphs again' : 'Show only this graph'}
      </button>
      <button type="button" className="ctxitem" role="menuitem" onClick={onCards}>
        {cards ? 'Show nodes as a network' : 'Show nodes as cards'}
      </button>
      <button type="button" className="ctxitem" role="menuitem" onClick={onRename}>
        Rename graph…
      </button>
      <button type="button" className="ctxitem" role="menuitem" onClick={onMetaArea}>
        Add meta area…
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
