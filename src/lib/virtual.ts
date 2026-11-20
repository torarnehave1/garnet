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

// Simulated member numbers (architect's choice 2026-11-20): the virtual-world node keeps them in
// metadata.simulated.members as { memberNodeId: number }. They are invented, kept in one place and
// apart from anything real on the member nodes, so a simulation can change them without touching
// the members themselves.
function simulatedMembers(w: KgNode): Map<string, number> {
  const out = new Map<string, number>()
  const sim = (w.metadata as { simulated?: { members?: unknown } } | undefined)?.simulated?.members
  if (!sim || typeof sim !== 'object') return out
  for (const [id, v] of Object.entries(sim as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out.set(id, Math.round(v))
  }
  return out
}

// Connections between members (architect's ask 2026-11-20): the virtual-world node keeps them in
// metadata.connections as [{ a, b, perWeek }], a and b being member node ids. perWeek is how many
// exchanges a week the connection carries (for instance e-mail threads); the map draws a line
// with a pulse that travels faster for a higher number.
function connections(w: KgNode): { a: string; b: string; perWeek: number }[] {
  const list = (w.metadata as { connections?: unknown } | undefined)?.connections
  if (!Array.isArray(list)) return []
  const out: { a: string; b: string; perWeek: number }[] = []
  for (const c of list as Record<string, unknown>[]) {
    if (!c || typeof c.a !== 'string' || typeof c.b !== 'string' || c.a === c.b) continue
    const n = typeof c.perWeek === 'number' && Number.isFinite(c.perWeek) && c.perWeek > 0 ? c.perWeek : 0
    if (n) out.push({ a: c.a, b: c.b, perWeek: n })
  }
  return out
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
    const sim = simulatedMembers(w)
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
        virtual: { graphId, nodeId: m.id, ...(sim.has(m.id) ? { members: sim.get(m.id) } : {}) },
      })
    }
    // A connection is kept on its first member's row, and only when both ends are members.
    const rowId = (id: string) => `vw:${graphId}:${w.id}:${id}`
    for (const c of connections(w)) {
      if (!seen.has(c.a) || !seen.has(c.b)) continue
      const row = rows.find((r) => r.id === rowId(c.a))
      if (row?.virtual) (row.virtual.links ||= []).push({ to: rowId(c.b), perWeek: c.perWeek })
    }
  }
  return { worlds, rows }
}
