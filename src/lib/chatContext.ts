import type { Item } from '../engine/Engine'
import type { Filters, Row, Scope } from './types'
import { SHARED, when } from './rows'

// What the person has chosen in Garnet right now, for the chat model. Small on purpose: the filters
// in words, the count, what is clicked, and the exact graph_index call (VEGR.AI MCP) that returns
// the chosen graphs. The model pulls the list only when a question needs it, the way it narrows
// any other MCP question, instead of carrying thousands of rows in every prompt.

export interface ViewState {
  scope: Scope
  filters: Filters
  shown: Row[] // after the filters, before the time slider
  kk: number // graphs the time slider shows (the oldest kk)
  selected: Item | null
}

const iso = (ms: number) => new Date(ms).toISOString()

/** graph_index arguments that return exactly the chosen graphs (dev-worker mcp/index-filter.js). */
export function indexArgs(v: ViewState): Record<string, unknown> {
  const f = v.filters
  const a: Record<string, unknown> = { scope: v.scope }
  if (f.world !== '*') a.world = f.world || 'shared'
  if (f.tags.length) a.metaAreas = f.tags
  if (f.type !== '*') a.nodeType = f.type
  if (f.pub !== '*') a.published = f.pub
  let from = f.since !== '*' ? `${f.since}-01-01` : ''
  let to = ''
  if (f.year !== '*') {
    if (!from || f.year > from.slice(0, 4)) from = `${f.year}-01-01`
    to = `${f.year}-12-31`
  }
  // The time slider shows the oldest kk: up to and including the kk-th one's creation time.
  if (v.kk > 0 && v.kk < v.shown.length) {
    const t = v.shown.map(when).sort((x, y) => x - y)[v.kk - 1]
    if (t && (!to || iso(t) < to)) to = iso(t)
  }
  if (from) a.createdFrom = from
  if (to) a.createdTo = to
  return a
}

export function viewContext(v: ViewState): string {
  const f = v.filters
  const count = v.kk > 0 && v.kk < v.shown.length ? v.kk : v.shown.length
  const filters = [
    `Graphs: ${v.scope === 'mine' ? 'only the person’s own' : 'everything the person can see, all Worlds'}`,
    `World: ${f.world === '*' ? 'all' : f.world || SHARED}`,
    `Meta areas: ${f.tags.length ? f.tags.join(', ') : 'all'}`,
    f.type !== '*' ? `Has node type: ${f.type}` : '',
    f.pub !== '*' ? `Published: ${f.pub}` : '',
    f.year !== '*' ? `Created in: ${f.year}` : '',
    f.since !== '*' ? `Start year: ${f.since}` : '',
    count < v.shown.length ? `Time slider: the oldest ${count} of ${v.shown.length}` : '',
  ].filter(Boolean)

  const sel = v.selected
  const clicked = !sel
    ? 'nothing'
    : sel.kind === 'g'
      ? `the graph “${sel.title}” (graphId ${sel.id})`
      : sel.kind === 'n'
        ? `the node “${sel.label}” (nodeId ${sel.nid}, type ${sel.type}) in the graph “${sel.parent.title}” (graphId ${sel.parent.id})`
        : `the meta area ${sel.tag}`

  return [
    'WHAT THE PERSON HAS CHOSEN IN GARNET NOW (the network map beside this chat). The person CHOOSES graphs with the filters below: "chosen", "selected", "valgt", "these graphs", "the ones here" mean exactly that set. A clicked item is named separately; use it for "this graph" / "denne grafen".',
    'Filters: ' + filters.join(' · '),
    `Chosen graphs: ${count}. Answer "how many" from this number, without a tool.`,
    `Clicked on the map: ${clicked}.`,
    `To list or read the chosen graphs, call mcp_call with server "vegr", tool_name "graph_index" and exactly these arguments, adding brief:true; for more than 200, page with offset/limit 200 and wait for each page: ${JSON.stringify(indexArgs(v))}`,
  ].join('\n')
}
