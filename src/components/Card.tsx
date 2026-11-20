import { useEffect, useState } from 'react'
import { loadGraph } from '../api/kg'
import type { Item, NodeItem } from '../engine/Engine'
import { useEditorBase, viewLink } from '../lib/editorLink'
import { textHtml } from '../lib/graphRules'
import { dayOf, SHARED } from '../lib/rows'
import type { User } from '../lib/types'


// The node's own text, read from the graph (already cached when the node is drawn).
function NodeText({ graphId, nodeId, user }: { graphId: string; nodeId: string; user: User }) {
  const [html, setHtml] = useState('<p>Loading the text…</p>')
  useEffect(() => {
    let live = true
    setHtml('<p>Loading the text…</p>')
    loadGraph(user, graphId)
      .then((g) => {
        const node = g.nodes.find((n) => n.id === nodeId)
        if (live) setHtml(node ? textHtml(node) : '<p>The node was not found in the graph.</p>')
      })
      .catch((e) => {
        if (live) setHtml('<p>Could not load the text from the graph (' + String(e?.message || 'unknown error').replace(/[<>&]/g, '') + ').</p>')
      })
    return () => {
      live = false
    }
  }, [graphId, nodeId, user])
  // textHtml escapes everything it takes from the graph before adding its own tags.
  return <div className="cardBody" dangerouslySetInnerHTML={{ __html: html }} />
}

export function Card({ item, user, N, skeleton, scopeAll, onClose, onDiagram }: { item: Item | null; user: User; N: number; skeleton: boolean; scopeAll: boolean; onClose: () => void; onDiagram: (n: NodeItem) => void }) {
  // A Virtual World has no editor of its own: its defining graph opens in the platform editor.
  const editor = useEditorBase(item?.kind === 'g' ? (item.virtual ? '' : item.world) : item?.kind === 'n' ? item.parent.world : '')
  if (!item) return null
  let title = ''
  let meta = ''
  let body = null
  let link: { href: string; text: string } | null = null
  if (item.kind === 'h') {
    title = item.tag
    meta = skeleton ? `${item.seed} graphs on 13 Nov 2026` : `${item.vis} of ${item.members.length} graphs shown at this point in the history`
  } else if (item.kind === 'n') {
    title = item.label
    meta = 'Node' + (item.type ? ' of type ' + item.type : '') + ' in the graph ' + item.parent.title + (item.links.length ? ` · ${item.links.length} edges` : '')
    body = <NodeText graphId={item.parent.id} nodeId={item.nid} user={user} />
    link = { href: viewLink(editor, item.parent.id), text: 'Open Knowledge Graph' }
  } else if (item.virtual) {
    // A member of a Virtual World: not a graph on the server, only a node in the defining graph.
    title = item.title
    meta = `Member of the Virtual World ${item.world.replace(/ \(virtual\)$/, '')}. This World is not real: it is defined in a knowledge graph and has no account of its own.` + (item.tags.length ? ' · ' + item.tags.join(' ') : '')
    body = <NodeText graphId={item.virtual.graphId} nodeId={item.virtual.nodeId} user={user} />
    link = { href: viewLink(editor, item.virtual.graphId), text: 'Open the graph that defines this Virtual World' }
  } else {
    const d = item
    title = d.title
    meta =
      (d.t ? 'Created ' + dayOf(d.t) + ' · ' : '') +
      `Graph ${d.order + 1} of ${N} · ${d.n} nodes · ${d.status} · ` +
      (d.tags.length ? d.tags.join(' ') : 'no meta area') +
      (scopeAll ? ' · World: ' + (d.world || SHARED) : '') +
      (d.sharedVia ? ` · shared with ${d.sharedVia} from ${d.world} (${d.sharedMode === 'write' ? 'read and write' : 'read only'})` : '') +
      (d.sharedWith?.length ? ' · shared with ' + d.sharedWith.map((s) => `${s.world} (${s.mode === 'write' ? 'read and write' : 'read only'})`).join(', ') : '') +
      (d.sem.length ? ` · ${d.sem.length} semantic links` : '') +
      (d.types.length ? ' · node types: ' + d.types.join(', ') : '') +
      (d.live ? ' · live at ' + d.live : '')
    link = { href: viewLink(editor, d.id), text: 'Open Knowledge Graph' }
  }
  return (
    <div className="card">
      <button className="x" type="button" aria-label="Close" onClick={onClose}>
        ×
      </button>
      <h2>{title}</h2>
      <p>{meta}</p>
      {body}
      {item.kind === 'n' && item.type === 'mermaid-diagram' && (
        <p>
          <button type="button" className="ghost" onClick={() => onDiagram(item)}>
            Show the diagram
          </button>
        </p>
      )}
      {link && (
        <p>
          <a href={link.href} target="_blank" rel="noopener">
            {link.text}
          </a>
        </p>
      )}
    </div>
  )
}
