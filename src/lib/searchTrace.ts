// The search trace (architect's ask 2026-11-21): a graph that a text search found keeps a colour
// on the map after the search is cleared, and the colour fades over TRACE_DAYS days. Found again,
// it is at full strength again. Kept in this browser, by user: a search writes nothing to a graph.
export const TRACE_DAYS = 7
export const TRACE_MS = TRACE_DAYS * 86400000
// The colour of a search on the map: the same amber as the ring round a found node.
export const TRACE_COLOR = '#ffd166'

export interface Trace {
  t: number // when the search found the graph (ms)
  q: string // the searched text
}
export type Traces = Map<string, Trace>

const key = (email: string) => 'garnet.searchTrace.' + (email || 'anon')

/** The traces that have not faded out yet. */
export function readTraces(email: string, now: number): Traces {
  const out: Traces = new Map()
  try {
    const o = JSON.parse(localStorage.getItem(key(email)) || '{}') as Record<string, Trace>
    for (const id of Object.keys(o)) {
      const x = o[id]
      if (x && typeof x.t === 'number' && now - x.t < TRACE_MS) out.set(id, { t: x.t, q: String(x.q || '') })
    }
  } catch {
    /* storage may be unavailable or hold something else: no traces */
  }
  return out
}

function save(email: string, traces: Traces) {
  try {
    localStorage.setItem(key(email), JSON.stringify(Object.fromEntries(traces)))
  } catch {
    /* storage may be unavailable; the traces then last this visit only */
  }
}

/** The traces with the graphs of a new search added, saved. */
export function addTraces(email: string, had: Traces, ids: Iterable<string>, q: string, now: number): Traces {
  const out: Traces = new Map()
  had.forEach((x, id) => {
    if (now - x.t < TRACE_MS) out.set(id, x)
  })
  for (const id of ids) out.set(id, { t: now, q })
  save(email, out)
  return out
}

export function clearTraces(email: string): Traces {
  const out: Traces = new Map()
  save(email, out)
  return out
}

/** How strong a trace is now: 1 when just found, 0 when faded out. */
export const traceStrength = (t: number, now: number) => Math.max(0, Math.min(1, 1 - (now - t) / TRACE_MS))

/** "today", "yesterday" or "n days ago". */
export function traceAge(t: number, now: number): string {
  const d = Math.floor((now - t) / 86400000)
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d + ' days ago'
}
