import type { KgGraph, KgNode } from './types'

// A VEGR Flow is a graph with one `flow` node and `flow-step` nodes joined by labelled edges
// (next / approved / rejected / error). flows-worker runs it; Garnet only draws it.
// The same reading as Agent-Builder's src/lib/flowGraph.ts, so both show a flow alike.

export interface FlowBox {
  id: string
  head: boolean // the `flow` node
  label: string
  kind: string // flow-step metadata.kind: action | agent | approval | route | wait | loop | subflow | note
  info: string
  meta: Record<string, unknown>
  x: number
  y: number
}
export interface FlowLine {
  id: string
  source: string
  target: string
  labels: string[] // every route this pair carries ("next", "error", …)
}

export const isFlowGraph = (types: string[]) => types.includes('flow')

// Name and colour per step kind (flows-worker/compile.js STEP_KINDS), as Agent-Builder shows them.
export const KINDS: Record<string, { name: string; hex: string }> = {
  action: { name: 'Action', hex: '#f59e0b' },
  approval: { name: 'Approval', hex: '#10b981' },
  agent: { name: 'Agent', hex: '#0ea5e9' },
  route: { name: 'Route', hex: '#8b5cf6' },
  wait: { name: 'Wait', hex: '#3b82f6' },
  loop: { name: 'Loop', hex: '#d946ef' },
  subflow: { name: 'Subflow', hex: '#6366f1' },
  note: { name: 'Note', hex: '#64748b' },
}
export const kindOf = (k: string) => KINDS[k] || KINDS.note

export const ROUTE_COLORS: Record<string, string> = {
  approved: '#34d399',
  rejected: '#f43f5e',
  error: '#fb923c',
}

// Stored positions are ~200 apart, closer than a box is wide.
const SPREAD_X = 1.6
const SPREAD_Y = 1.25
const ROW_GAP = 130
const COL_GAP = 250

type WithPos = KgNode & { position?: { x?: number; y?: number } }

export function readFlow(g: KgGraph): { boxes: FlowBox[]; lines: FlowLine[] } {
  const boxes: FlowBox[] = (g.nodes as WithPos[])
    .filter((n) => n.type === 'flow' || n.type === 'flow-step')
    .map((n) => {
      const meta = (n.metadata || {}) as Record<string, unknown>
      return {
        id: n.id,
        head: n.type === 'flow',
        label: n.label || n.id,
        kind: n.type === 'flow' ? 'flow' : String(meta.kind || 'note'),
        info: n.info || '',
        meta,
        x: (n.position?.x ?? 0) * SPREAD_X,
        y: (n.position?.y ?? 0) * SPREAD_Y,
      }
    })
  const ids = new Set(boxes.map((b) => b.id))
  // Two edges can join the same pair (a step's "next" and "error" both lead to one step):
  // one line per pair, carrying every route.
  const byPair = new Map<string, FlowLine>()
  for (const e of g.edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) continue
    const key = e.source + '\u0000' + e.target
    const line = byPair.get(key) || { id: e.source + '->' + e.target, source: e.source, target: e.target, labels: [] }
    const l = (e.label || 'next').trim() || 'next'
    if (!line.labels.includes(l)) line.labels.push(l)
    byPair.set(key, line)
  }
  const lines = [...byPair.values()]
  // Flows written by a tool often store every step at 0,0. Unless each box has a place of its own,
  // lay them out in rows by the edges.
  if (new Set(boxes.map((b) => b.x + ',' + b.y)).size < boxes.length) layoutByEdges(boxes, lines)
  return { boxes, lines }
}

// Row 0 is the flow node (or, without one, every step nothing points to); each step goes one row
// below the first step that reaches it; steps nothing reaches go in a last row.
export function layoutByEdges(boxes: FlowBox[], lines: { source: string; target: string }[]): void {
  const out = new Map<string, string[]>()
  const incoming = new Set<string>()
  for (const e of lines) {
    if (e.source === e.target) continue
    out.set(e.source, [...(out.get(e.source) || []), e.target])
    incoming.add(e.target)
  }
  const row = new Map<string, number>()
  const walk = (starts: string[], at: number) => {
    const queue = starts.filter((s) => !row.has(s))
    for (const s of queue) row.set(s, at)
    while (queue.length) {
      const id = queue.shift()!
      for (const t of out.get(id) || []) {
        if (row.has(t)) continue
        row.set(t, (row.get(id) || 0) + 1)
        queue.push(t)
      }
    }
  }
  const head = boxes.find((b) => b.head)
  if (head) walk([head.id], 0)
  walk(boxes.filter((b) => !b.head && !incoming.has(b.id)).map((b) => b.id), head ? 1 : 0)
  const last = Math.max(0, ...row.values()) + 1
  const rows = new Map<number, FlowBox[]>()
  for (const b of boxes) {
    const r = row.has(b.id) ? row.get(b.id)! : last
    rows.set(r, [...(rows.get(r) || []), b])
  }
  for (const [r, list] of rows)
    list.forEach((b, i) => {
      b.x = (i - (list.length - 1) / 2) * COL_GAP
      b.y = r * ROW_GAP
    })
}

// The short line under a step's name.
export function stepSub(b: FlowBox): string {
  const m = b.meta
  if (b.head) {
    const inputs = m.inputs && typeof m.inputs === 'object' ? Object.keys(m.inputs) : []
    return inputs.length ? 'inputs: ' + inputs.join(', ') : ''
  }
  if (b.kind === 'approval') {
    const prev = (m.preview as { toolName?: string } | undefined)?.toolName
    return `${m.approver || 'owner'} · ${m.timeout || '24h'}${prev ? ' · ' + prev : ''}`
  }
  if (b.kind === 'agent') return String(m.model || '')
  return String(m.toolName || '')
}
