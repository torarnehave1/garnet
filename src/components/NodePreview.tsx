import { useEffect, useState } from 'react'
import { loadGraph } from '../api/kg'
import { textHtml } from '../lib/graphRules'
import type { KgNode, User } from '../lib/types'
import { loadApprovedTypes, RegisteredTypeNode } from '../lib/vegvisrNode'

const VIEW = 'https://editor.vegvisr.org/view?graphId='

// A node shown in the panel at the right by its type's own approved renderer (viewRules.ts), the
// same picture Knowledge Editor gives. If the renderer cannot be had, the node's text is shown.
export default function NodePreview({ user, graphId, nodeId, world, title, type, onClose }: { user: User; graphId: string; nodeId: string; world: string; title: string; type: string; onClose: () => void }) {
  const [node, setNode] = useState<KgNode | null>(null)
  const [rendered, setRendered] = useState<boolean | null>(null) // null: not known yet
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    setNode(null)
    setRendered(null)
    setError('')
    Promise.all([loadGraph(user, graphId), loadApprovedTypes(world || null)])
      .then(([g, types]) => {
        if (!live) return
        const n = g.nodes.find((x) => x.id === nodeId)
        if (!n) return setError('The node was not found in the graph.')
        setNode(n)
        setRendered(types.has(type))
      })
      .catch((e) => {
        if (live) setError('Could not load the node from the graph (' + String((e as Error)?.message || 'unknown error') + ').')
      })
    return () => {
      live = false
    }
  }, [user, graphId, nodeId, world, type])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <aside className="preview" aria-label={'Node ' + title}>
      <div className="previewHead">
        <strong>{title}</strong>
        <button type="button" className="ghost" aria-label="Close the preview" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="previewBody">
        {error && <p className="previewNote">{error}</p>}
        {!error && !node && <p className="previewNote">Loading the node…</p>}
        {node && rendered && <RegisteredTypeNode node={node} world={world || null} />}
        {node && rendered === false && (
          <>
            <p className="previewNote">The view for the node type {type} could not be loaded, so the node’s text is shown.</p>
            {/* textHtml escapes everything it takes from the graph before adding its own tags. */}
            <div className="cardBody" dangerouslySetInnerHTML={{ __html: textHtml(node) }} />
          </>
        )}
      </div>
      <p className="previewFoot">
        <a href={VIEW + encodeURIComponent(graphId)} target="_blank" rel="noopener">
          Open the graph in VEGR.AI
        </a>
      </p>
    </aside>
  )
}
