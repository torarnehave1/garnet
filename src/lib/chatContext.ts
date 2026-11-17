import type { Item } from '../engine/Engine'
import type { Filters, Row, Scope } from './types'
import { SHARED } from './rows'

// What the person sees in Garnet right now, written for the chat model: the graphs the filters and
// the time slider leave on the map, the filters themselves and what is selected. Sent with every
// message, so "these graphs" and "the one I selected" mean what is on screen when it is asked.
const MAX_LISTED = 300

export interface ViewState {
  scope: Scope
  filters: Filters
  shown: Row[] // after the filters, before the time slider
  kk: number // graphs the time slider shows
  selected: Item | null
}

const created = (r: Row) => Date.parse(r.created) || 0

export function viewContext(v: ViewState): string {
  const f = v.filters
  // The time slider shows the oldest kk of the filtered graphs.
  const onMap = v.kk > 0 && v.kk < v.shown.length ? [...v.shown].sort((a, b) => created(a) - created(b)).slice(0, v.kk) : v.shown
  const filters = [
    `Graphs: ${v.scope === 'mine' ? 'only the person’s own' : 'everything the person can see, all Worlds'}`,
    `World: ${f.world === '*' ? 'all' : f.world || SHARED}`,
    `Meta areas: ${f.tags.length ? f.tags.join(', ') : 'all'}`,
    f.type !== '*' ? `Has node type: ${f.type}${f.only ? ' (only those nodes drawn)' : ''}` : '',
    f.pub !== '*' ? `Published: ${f.pub}` : '',
    f.year !== '*' ? `Created in: ${f.year}` : '',
    f.since !== '*' ? `Start year: ${f.since}` : '',
  ].filter(Boolean)

  const sel = v.selected
  const selected = !sel
    ? 'nothing'
    : sel.kind === 'g'
      ? `the graph “${sel.title}” (graphId ${sel.id})`
      : sel.kind === 'n'
        ? `the node “${sel.label}” (nodeId ${sel.nid}, type ${sel.type}) in the graph “${sel.parent.title}” (graphId ${sel.parent.id})`
        : `the meta area ${sel.tag}`

  const listed = onMap.slice(0, MAX_LISTED).map((r) => `- ${r.title || '(untitled)'} · ${r.id}${r.world ? ' · ' + r.world : ''}${r.tags.length ? ' · ' + r.tags.join(' ') : ''}`)
  return [
    'WHAT THE PERSON SEES IN GARNET NOW (the network map beside this chat). The person CHOOSES graphs with the filters below: "chosen", "selected", "valgt", "these graphs", "the ones here" mean exactly the graphs listed below. Answer counts and lists from this list, not from a tool. A clicked item is named separately; use it for "this graph" / "denne grafen".',
    'Filters: ' + filters.join(' · '),
    `Chosen graphs on the map: ${onMap.length}${onMap.length < v.shown.length ? ` (the time slider shows the oldest ${onMap.length} of ${v.shown.length} that pass the filters)` : ''}.`,
    `Clicked on the map: ${selected}.`,
    `The chosen graphs (title · graphId · World · meta areas)${onMap.length > MAX_LISTED ? `, the first ${MAX_LISTED} of ${onMap.length}` : ''}:`,
    ...listed,
  ].join('\n')
}
