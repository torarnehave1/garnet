import type { Snapshot } from '../engine/Engine'
import { dayOf, type Option } from '../lib/rows'
import type { Filters, Scope } from '../lib/types'

const SPEEDS: Option[] = [
  { value: '2', label: 'Slow, 2 graphs a second' },
  { value: '8', label: 'Normal, 8 a second' },
  { value: '30', label: 'Fast, 30 a second' },
  { value: '120', label: 'Very fast, 120 a second' },
]

function Select({ id, value, options, onChange, label }: { id: string; value: string; options: Option[]; onChange: (v: string) => void; label: string }) {
  return (
    <label htmlFor={id}>
      {label}{' '}
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export interface DockProps {
  snap: Snapshot
  filters: Filters
  onFilter: (p: Partial<Filters>) => void
  aloneTitle: string // the title of the one graph shown alone, '' when none
  onFind: (text: string) => void
  scope: Scope
  onScope: (s: Scope) => void
  speed: string
  onSpeed: (s: string) => void
  from: string
  fromOptions: Option[]
  onFrom: (v: string) => void
  worldOptions: Option[]
  yearOptions: Option[]
  sinceOptions: Option[]
  typeOptions: Option[]
  tagLabel: string
  onTags: () => void
  onBulkTag: () => void
  onPlay: () => void
  onSlide: (k: number) => void
  onRefresh: () => void
  refreshing: boolean
  // Folded away: the dock, and the info panels on the left with it.
  hidden: boolean
  onHidden: (v: boolean) => void
}

export function Dock(p: DockProps) {
  const hidden = p.hidden
  const toggle = p.onHidden
  const { snap, filters: f } = p
  if (hidden)
    return (
      <div className="dock dockMin">
        <button type="button" className="ghost" aria-expanded={false} title="Show the play and filter controls and the info panels" onClick={() => toggle(false)}>
          Show controls
        </button>
      </div>
    )
  return (
    <div className="dock">
      <button type="button" onClick={p.onPlay}>
        {snap.playing ? 'Pause' : 'Play growth'}
      </button>
      <input type="range" min={0} max={snap.N} step={1} value={snap.kk} aria-label="Position in the history of graphs" onChange={(e) => p.onSlide(+e.target.value)} />
      <div className="opts">
        <Select id="speed" label="Speed" value={p.speed} options={SPEEDS} onChange={p.onSpeed} />
        <Select id="from" label="Play from" value={p.from} options={p.fromOptions} onChange={p.onFrom} />
        <Select
          id="scope"
          label="Graphs"
          value={p.scope}
          options={[
            { value: 'mine', label: 'Mine' },
            { value: 'all', label: 'Everything I can see, all Worlds' },
          ]}
          onChange={(v) => p.onScope(v as Scope)}
        />
        <Select id="world" label="World" value={f.world} options={p.worldOptions} onChange={(v) => p.onFilter({ world: v })} />
        <span className="pickwrap">
          Meta areas{' '}
          <button className="pick" type="button" aria-haspopup="dialog" onClick={p.onTags}>
            {p.tagLabel}
          </button>
        </span>
        <Select id="since" label="Start year" value={f.since} options={p.sinceOptions} onChange={(v) => p.onFilter({ since: v })} />
        <Select id="year" label="Created in" value={f.year} options={p.yearOptions} onChange={(v) => p.onFilter({ year: v })} />
        <span className="daterange">
          <label htmlFor="dfrom">
            Created from{' '}
            <input id="dfrom" type="date" value={f.dateFrom} max={f.dateTo || undefined} onChange={(e) => p.onFilter({ dateFrom: e.target.value })} />
          </label>{' '}
          <label htmlFor="dto">
            to{' '}
            <input id="dto" type="date" value={f.dateTo} min={f.dateFrom || undefined} onChange={(e) => p.onFilter({ dateTo: e.target.value })} />
          </label>
          {(f.dateFrom || f.dateTo) && (
            <button type="button" className="ghost dateclear" aria-label="Clear the created range" title="Clear the created range" onClick={() => p.onFilter({ dateFrom: '', dateTo: '' })}>
              ×
            </button>
          )}
        </span>
        <span className="daterange">
          <label htmlFor="ufrom">
            Updated from{' '}
            <input id="ufrom" type="date" value={f.updFrom} max={f.updTo || undefined} onChange={(e) => p.onFilter({ updFrom: e.target.value })} />
          </label>{' '}
          <label htmlFor="uto">
            to{' '}
            <input id="uto" type="date" value={f.updTo} min={f.updFrom || undefined} onChange={(e) => p.onFilter({ updTo: e.target.value })} />
          </label>
          {(f.updFrom || f.updTo) && (
            <button type="button" className="ghost dateclear" aria-label="Clear the updated range" title="Clear the updated range" onClick={() => p.onFilter({ updFrom: '', updTo: '' })}>
              ×
            </button>
          )}
        </span>
        <label htmlFor="ntype">
          Has node type{' '}
          <input
            type="search"
            className="ntypeFind"
            placeholder="type to find"
            aria-label="Narrow the list of node types by typing the first letters"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={f.find}
            onChange={(e) => p.onFind(e.target.value)}
          />{' '}
          <select id="ntype" value={f.type} onChange={(e) => p.onFilter({ type: e.target.value })}>
            {p.typeOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="onlyType" title="With a node type chosen: inside each graph, show only the nodes of that type">
          <input type="checkbox" id="onlyType" checked={f.only} onChange={(e) => p.onFilter({ only: e.target.checked })} /> Only those nodes
        </label>
        <Select
          id="pub"
          label="Published"
          value={f.pub}
          options={[
            { value: '*', label: 'Any' },
            { value: 'live', label: 'Live on a domain' },
            { value: 'published', label: 'Published' },
            { value: 'private', label: 'Private or draft' },
          ]}
          onChange={(v) => p.onFilter({ pub: v })}
        />
      </div>
      <div className="opts">
        {f.graph && (
          <>
            <button className="ghost" type="button" title="Only this graph is shown; click to show what the filters choose again" onClick={() => p.onFilter({ graph: '' })}>
              Only: {p.aloneTitle.length > 40 ? p.aloneTitle.slice(0, 39) + '…' : p.aloneTitle || 'one graph'} ×
            </button>{' '}
          </>
        )}
        <button className="ghost" type="button" disabled={!snap.N || snap.skeleton} title="Add a meta area to, or take one off, every graph shown" onClick={p.onBulkTag}>
          Meta area on {snap.N} shown…
        </button>{' '}
        <button className="ghost" type="button" disabled={p.refreshing} onClick={p.onRefresh}>
          {p.refreshing ? 'Refreshing…' : 'Refresh from VEGR.AI'}
        </button>{' '}
        <button className="ghost" type="button" aria-expanded={true} title="Fold the play and filter controls and the info panels away, to see more of the map" onClick={() => toggle(true)}>
          Hide controls
        </button>
      </div>
      <div className="latest">
        {snap.kk > 0 && snap.cur ? (
          <>
            {snap.cur.t ? dayOf(snap.cur.t) + ' · ' : `Graph ${snap.kk}: `}
            <b>{snap.cur.title}</b>
          </>
        ) : snap.N > 0 ? (
          'Before the first graph'
        ) : (
          ''
        )}
      </div>
    </div>
  )
}
