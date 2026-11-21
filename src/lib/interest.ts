// Interest marks (architect's ask 2026-11-21): a node marked as interesting through the context
// menu ripples on the map in its own colour, until the mark is taken away. Kept in this browser,
// by user: marking writes nothing to the graph, so the graph does not count as changed.
export const INTEREST_COLOR = '#5ce1e6' // teal: apart from the rose change pulse and the amber search

export type Interests = Map<string, number> // "graphId/nodeId" -> when it was marked (ms)

export const interestKey = (graphId: string, nodeId: string) => graphId + '/' + nodeId
const key = (email: string) => 'garnet.interest.' + (email || 'anon')

export function readInterests(email: string): Interests {
  const out: Interests = new Map()
  try {
    const o = JSON.parse(localStorage.getItem(key(email)) || '{}') as Record<string, number>
    for (const k of Object.keys(o)) if (typeof o[k] === 'number') out.set(k, o[k])
  } catch {
    /* storage may be unavailable or hold something else: no marks */
  }
  return out
}

/** The marks with this node marked, or unmarked if it was marked, saved. */
export function toggleInterest(email: string, had: Interests, graphId: string, nodeId: string, now: number): Interests {
  const out = new Map(had)
  const k = interestKey(graphId, nodeId)
  if (out.has(k)) out.delete(k)
  else out.set(k, now)
  try {
    localStorage.setItem(key(email), JSON.stringify(Object.fromEntries(out)))
  } catch {
    /* storage may be unavailable; the marks then last this visit only */
  }
  return out
}
