// The nodes that were changed in the days the "Updated from … to" filter names (architect's ask
// 2026-11-20): a pulse on the node itself, not only on its graph.
//
// From NODE_TIME_SINCE each node carries its own time on the server (metadata.updatedAt, set on
// every write that changes the node's content), and the map reads it with the node list: no extra
// request. Changes made before that carry no time. For days that begin before it, the answer is
// also worked out the earlier way: by comparing two saved versions of the graph (the store keeps
// the 20 newest whole) — the one that stood when the days began, and the newest one written inside
// them. A node that is new, or that reads differently, was changed in those days.
import type { KgNode } from './types'

// Days that begin before this are also answered by comparing versions. Set a little after the
// server began to stamp nodes (deployed 2026-11-20/21), so no change falls between the two ways.
export const NODE_TIME_SINCE = Date.parse('2026-11-22T00:00:00Z')

export interface Saved {
  v: number
  t: number // when the version was written (ms)
}

export interface Pick {
  now: number // the newest version written inside the days
  // The version that stood before the days began. null: the graph was made inside the days, so
  // every node in it is new.
  base: number | null
  // The days began before the oldest version the store still keeps: the comparison starts at
  // that oldest kept version, so earlier changes inside the days are not seen.
  capped: boolean
}

/** Which two versions to compare, or null when no version was written inside the days. */
export function pickVersions(versions: Saved[], from: number, to: number, created: number): Pick | null {
  const sorted = versions.filter((x) => x.t > 0).sort((a, b) => a.v - b.v)
  const inside = sorted.filter((x) => x.t >= from && x.t <= to)
  if (!inside.length) return null
  const now = inside[inside.length - 1].v
  const before = sorted.filter((x) => x.t < from)
  if (before.length) return { now, base: before[before.length - 1].v, capped: false }
  if (created && created >= from) return { now, base: null, capped: false }
  const oldest = sorted[0].v
  return oldest === now ? null : { now, base: oldest, capped: true }
}

// Where a node stands in an editor is not a change to the node.
const PLACE = new Set(['position', 'x', 'y', 'visible'])
function face(n: KgNode): string {
  const o = n as unknown as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(o).sort()) {
    if (PLACE.has(k) || k === 'updatedAt') continue
    let v = o[k]
    // The server's own stamp is not content.
    if (k === 'metadata' && v && typeof v === 'object' && !Array.isArray(v)) {
      const { updatedAt: _t, ...rest } = v as Record<string, unknown>
      v = Object.keys(rest).length ? rest : null
    }
    if (v != null) out[k] = v
  }
  return JSON.stringify(out)
}

/** The ids of the nodes in `now` that are new or read differently than in `base`. */
export function changedNodes(base: KgNode[] | null, now: KgNode[]): string[] {
  if (!base) return now.map((n) => n.id).filter(Boolean)
  const was = new Map(base.map((n) => [n.id, face(n)]))
  return now.filter((n) => n.id && was.get(n.id) !== face(n)).map((n) => n.id)
}
