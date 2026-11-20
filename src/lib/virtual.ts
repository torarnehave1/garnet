import { parseTags } from './rows'
import type { KgGraph, KgNode, Row } from './types'

// Virtual Worlds (architect's choice 2026-11-20). A Virtual World is a World that is defined in a
// knowledge graph and has no Cloudflare account, domain or storage of its own. It is not real; it
// is the first step toward a simulation layer.
//
// One node of the type "virtual-world" is one Virtual World: its label is the World's name, and
// every node it has an edge to is a member of that World. A graph may hold one such node or many.
// Garnet shows each member as one circle on the map, in a World of its own in the World list.
// Nothing about a member exists on the server apart from its node in the defining graph, so a
// member cannot be renamed, deleted, moved, shared, searched or given a pulse.
export const VIRTUAL_TYPE = 'virtual-world'

/** The name the World list shows, so a Virtual World is never taken for a real one. */
export const virtualWorldName = (label: string | undefined) => `${(label || '').trim() || 'Virtual World'} (virtual)`

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

// A member's meta areas: its own metadata.metaArea when it has one, else its region, so the
// members of a World gather by region on the map the way graphs gather by meta area.
function memberTags(n: KgNode): string[] {
  return parseTags(text(n.metadata?.metaArea) || text(n.metadata?.region))
}

/**
 * The Virtual Worlds one graph defines, and their members as rows for the map.
 * `base` is the defining graph's own created and updated time: a member has none of its own.
 */
export function virtualRows(graphId: string, base: { created: string; updated: string }, g: KgGraph): { worlds: string[]; rows: Row[] } {
  const byId = new Map(g.nodes.map((n) => [n.id, n]))
  const worlds: string[] = []
  const rows: Row[] = []
  for (const w of g.nodes) {
    if (w.type !== VIRTUAL_TYPE) continue
    const world = virtualWorldName(w.label)
    if (!worlds.includes(world)) worlds.push(world)
    const seen = new Set<string>()
    for (const e of g.edges) {
      if (e.source !== w.id || seen.has(e.target)) continue
      const m = byId.get(e.target)
      // Another World in the same graph is not a member of this one.
      if (!m || m.type === VIRTUAL_TYPE) continue
      seen.add(m.id)
      rows.push({
        id: `vw:${graphId}:${w.id}:${m.id}`,
        title: (m.label || '').trim() || '(unnamed)',
        n: 0,
        status: 'virtual',
        tags: memberTags(m),
        live: '',
        created: text(m.metadata?.created) || base.created,
        updated: base.updated,
        world,
        types: [],
        image: '',
        header: '',
        createdBy: '',
        version: null,
        virtual: { graphId, nodeId: m.id },
      })
    }
  }
  return { worlds, rows }
}
