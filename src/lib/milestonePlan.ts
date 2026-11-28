// Milestone plans with PSO result paths (graph type milepaelsplan, chosen by Tor Arne 2026-11-26,
// Systemutviklingsplan node 9 and the graph "Milepælsplan og PSO i Garnet – analyse").
// One graph is one plan:
//
//   milepael-start   the start and header: "Avtale inngått" (exactly one per graph)
//   milepael-p       a milestone in the P path (Personutvikling)
//   milepael-s       a milestone in the S path (Systemutvikling)
//   milepael-o       a milestone in the O path (Organisasjonsutvikling)
//   milepael-slutt   the end: "Levert i henhold til avtale"
//
// The edges are logical dependencies: the target cannot be reached before the source. The order is
// logical, not by date: a milestone's row is one below the latest of those it depends on (the
// longest path from the start), so milestones with no dependency between them are parallel and may
// share a row. An edge between two milestones of the same type is drawn solid, between two types
// dashed; an edge to or from the start or the end is a thin line.

import type { KgEdge, KgNode } from './types'

export const MP_START = 'milepael-start'
export const MP_END = 'milepael-slutt'
export const MP_LANES = [
  { type: 'milepael-p', key: 'P', name: 'Personutvikling', color: '#2e6f8e' },
  { type: 'milepael-s', key: 'S', name: 'Systemutvikling', color: '#c77f3a' },
  { type: 'milepael-o', key: 'O', name: 'Organisasjonsutvikling', color: '#5b8a5f' },
] as const
export const MP_TYPES = new Set<string>([MP_START, MP_END, ...MP_LANES.map((l) => l.type)])

// Vertical layout, in gaps: a row's step, a box's height, and the space between two milestones
// stacked in the same lane and row.
export const MP_ROW = 2.75
export const MP_BOX_H = 2.15
export const MP_STACK = 0.35

export type MpKind = 'start' | 'ms' | 'end'
export type MpDep = 'in' | 'x' | 'end'
export interface MpPlan {
  rows: number // rows from the start (row 0) to the end (the last row)
  height: number // gaps from the top of row 0 to the foot of the lowest box
  // Each placed node: its lane (0 P, 1 S, 2 O; -1 for start and end, which span the lanes), its row,
  // its top in gaps from the top of row 0, what it is, its code (P1, S2 …), and whether it is reached.
  items: Record<string, { lane: number; row: number; y: number; kind: MpKind; code: string; done: boolean }>
  deps: { s: string; t: string; kind: MpDep }[]
}

const reached = (v: unknown) => typeof v === 'string' && /^(nådd|nadd|reached|done|ferdig)$/i.test(v.trim())

/** The layout of a milestone plan from its graph's nodes and edges; null without a start node. */
export function layoutMilestonePlan(nodes: KgNode[], edges: KgEdge[]): MpPlan | null {
  const kinds = new Map<string, { kind: MpKind; lane: number }>()
  for (const n of nodes) {
    if (n.type === MP_START) kinds.set(n.id, { kind: 'start', lane: -1 })
    else if (n.type === MP_END) kinds.set(n.id, { kind: 'end', lane: -1 })
    else {
      const lane = MP_LANES.findIndex((l) => l.type === n.type)
      if (lane >= 0) kinds.set(n.id, { kind: 'ms', lane })
    }
  }
  if (![...kinds.values()].some((k) => k.kind === 'start')) return null
  const into = new Map<string, string[]>()
  const deps: MpPlan['deps'] = []
  for (const e of edges) {
    const a = kinds.get(e.source)
    const b = kinds.get(e.target)
    if (!a || !b || e.source === e.target) continue
    const l = into.get(e.target)
    if (l) l.push(e.source)
    else into.set(e.target, [e.source])
    deps.push({ s: e.source, t: e.target, kind: a.kind !== 'ms' || b.kind !== 'ms' ? 'end' : a.lane === b.lane ? 'in' : 'x' })
  }
  // Row = the longest path from the start. A cycle (a mistake in the plan) is cut where it closes.
  const row = new Map<string, number>()
  const busy = new Set<string>()
  const rowOf = (id: string): number => {
    const known = row.get(id)
    if (known !== undefined) return known
    if (busy.has(id)) return 0
    busy.add(id)
    const k = kinds.get(id)!
    // A milestone that depends on nothing stands just under the start, never beside it.
    const r = k.kind === 'start' ? 0 : Math.max(1, ...(into.get(id) ?? []).map((s) => rowOf(s) + 1))
    busy.delete(id)
    row.set(id, r)
    return r
  }
  for (const id of kinds.keys()) rowOf(id)
  // The start stays on top and the end at the bottom, whatever the edges say.
  let last = 0
  for (const [id, k] of kinds) if (k.kind !== 'end') last = Math.max(last, k.kind === 'start' ? 0 : row.get(id)!)
  for (const [id, k] of kinds) {
    if (k.kind === 'start') row.set(id, 0)
    if (k.kind === 'end') row.set(id, last + 1)
  }
  // Codes in each lane follow the rows (and the graph's own order within a row): P1, P2 …
  const byNode = new Map(nodes.map((n, i) => [n.id, i]))
  const items: MpPlan['items'] = {}
  for (const [lane, l] of MP_LANES.entries()) {
    const ids = [...kinds].filter(([, k]) => k.kind === 'ms' && k.lane === lane).map(([id]) => id)
    ids.sort((a, b) => row.get(a)! - row.get(b)! || byNode.get(a)! - byNode.get(b)!)
    ids.forEach((id, i) => (items[id] = { lane, row: row.get(id)!, kind: 'ms', y: 0, code: l.key + (i + 1), done: false }))
  }
  for (const [id, k] of kinds) if (k.kind !== 'ms') items[id] = { lane: -1, row: row.get(id)!, y: 0, kind: k.kind, code: '', done: false }
  for (const n of nodes) if (items[n.id]) items[n.id].done = reached(n.metadata?.status)
  const rows = Math.max(...Object.values(items).map((x) => x.row)) + 1
  // Milestones in the same lane and row are parallel. They stack inside the row, in code order,
  // instead of covering each other (2026-11-28), and a row grows to its fullest lane.
  const groups = new Map<string, string[]>()
  for (const [id, it] of Object.entries(items)) {
    const k = it.row + ':' + it.lane
    const gr = groups.get(k)
    if (gr) gr.push(id)
    else groups.set(k, [id])
  }
  const num = (id: string) => Number(items[id].code.slice(1)) || 0
  const slots = new Array<number>(rows).fill(1)
  for (const [k, gr] of groups) {
    gr.sort((a, b) => num(a) - num(b))
    const r = Number(k.split(':')[0])
    slots[r] = Math.max(slots[r], gr.length)
  }
  const rowTop: number[] = []
  let y = 0
  for (let r = 0; r < rows; r++) {
    rowTop[r] = y
    y += slots[r] * MP_BOX_H + (slots[r] - 1) * MP_STACK + (MP_ROW - MP_BOX_H)
  }
  for (const gr of groups.values()) gr.forEach((id, i) => (items[id].y = rowTop[items[id].row] + i * (MP_BOX_H + MP_STACK)))
  const height = Math.max(...Object.values(items).map((x) => x.y)) + MP_BOX_H
  return { rows, height, items, deps }
}
