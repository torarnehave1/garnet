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

function words(v: ViewState) {
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
  return { count, filters }
}

/** What it takes to set the map back to this view (the chat history keeps it with each question). */
export interface MapState {
  scope: Scope
  filters: Omit<Filters, 'find'>
  until?: string // the time slider: graphs created up to this moment (ISO)
  sel?: { kind: 'g'; id: string } | { kind: 'n'; graph: string; nid: string } | { kind: 'h'; tag: string }
  zoom?: boolean // move in on the selected item (Show on the map for a graph an answer made)
}

export function mapState(v: ViewState): MapState {
  const { find: _find, ...filters } = v.filters
  void _find
  const st: MapState = { scope: v.scope, filters }
  if (v.kk > 0 && v.kk < v.shown.length) {
    const t = v.shown.map(when).sort((x, y) => x - y)[v.kk - 1]
    if (t) st.until = iso(t)
  }
  const sel = v.selected
  if (sel)
    st.sel =
      sel.kind === 'g'
        ? { kind: 'g', id: sel.id }
        : sel.kind === 'n'
          ? { kind: 'n', graph: sel.parent.id, nid: sel.nid }
          : { kind: 'h', tag: sel.tag }
  return st
}

/** How many of the shown graphs the slider shows for a saved cut (all of them without one). */
export function kOf(shown: Row[], until?: string): number {
  if (!until) return shown.length
  const t = Date.parse(until)
  return shown.filter((r) => when(r) <= t).length
}

/** What the map showed, in one line, kept with each question in the chat history. */
export function viewLine(v: ViewState): string {
  const f = v.filters
  const sel = v.selected
  const clicked = !sel
    ? ''
    : sel.kind === 'g'
      ? sel.title
      : sel.kind === 'n'
        ? `${sel.label} (${sel.parent.title})`
        : sel.tag
  return [
    v.scope === 'mine' ? 'Own graphs' : 'All graphs',
    `World ${f.world === '*' ? 'all' : f.world || SHARED}`,
    f.tags.length ? f.tags.join(' ') : '',
    f.type !== '*' ? `node type ${f.type}` : '',
    f.pub !== '*' ? `published ${f.pub}` : '',
    f.year !== '*' ? `created ${f.year}` : '',
    f.since !== '*' ? `from ${f.since}` : '',
    `${words(v).count} graph${words(v).count === 1 ? '' : 's'}`,
    clicked ? `clicked: ${clicked}` : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

export function viewContext(v: ViewState): string {
  const { count, filters } = words(v)
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
    `To list or read the chosen graphs, call mcp_call with server "vegr", tool_name "graph_index" and exactly these arguments: ${JSON.stringify(indexArgs(v))}. Always add brief:true and limit:40 (a longer answer is cut off before you see it); page on with offset 40, 80, … one call at a time. Add order:"newest" when the question is about the newest or latest graphs. Report only rows you have actually read; never fill in titles or dates you have not seen.`,
  ].join('\n')
}
