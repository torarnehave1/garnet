// Card view (Tor Arne, 2026-11-22): a graph whose nodes lie on top of each other in the network can
// be shown as cards instead, chosen per graph from the context menu ("Show nodes as cards"). The
// cards stand in columns by month, oldest to the left, and under each month one card per node in
// date order. It is drawn with the project timeline's machinery (Engine.setCards): the month is
// the date box, the card is the note. A node's date is metadata.date (YYYY-MM-DD); a node with
// no date (an About node, the graph's header) stays beside the graph's circle, out of the grid.
// The choice is kept per person in this browser, not in the graph.

import type { PtLayout } from './projectTimeline'
import type { KgNode } from './types'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function day(v: unknown): string | null {
  const m = typeof v === 'string' ? /^(\d{4})-(\d{2})-(\d{2})/.exec(v.trim()) : null
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

/** The card layout of a graph's nodes; null when no node has a date. */
export function layoutCards(nodes: KgNode[]): PtLayout | null {
  const dated = nodes
    .map((n, i) => ({ n, i, d: day(n.metadata?.date) }))
    .filter((x): x is { n: KgNode; i: number; d: string } => !!x.d)
    .sort((a, b) => (a.d === b.d ? a.i - b.i : a.d < b.d ? -1 : 1))
  if (!dated.length) return null
  const months = [...new Set(dated.map((x) => x.d.slice(0, 7)))].sort()
  const col = new Map(months.map((m, i) => [m, i]))
  const fill = new Array(months.length).fill(0)
  const items: PtLayout['items'] = {}
  for (const x of dated) {
    const c = col.get(x.d.slice(0, 7))!
    items[x.n.id] = { col: c, row: fill[c]++, kind: 'event' }
  }
  const cols = months.map((m) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`)
  return { cols, sections: [], rows: Math.max(1, ...fill), items }
}

const KEY = 'garnet_cards'

/** The graphs this person has chosen to see as cards. */
export function readCards(): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]')
    return new Set(Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

export function writeCards(ids: Set<string>) {
  try {
    localStorage.setItem(KEY, JSON.stringify([...ids]))
  } catch {
    /* storage may be off; the choice then lasts for this visit */
  }
}
