import { useEffect, useState } from 'react'

// What a text search of the map found (search_text on the MCP server).
export interface Found {
  q: string
  ids: Set<string>
  nodes: Map<string, Set<string>>
  of: number // graphs on the map that were searched
  partial: boolean
  suggestions: string[]
  suggestionNote: string | null
}

interface Props {
  active: string // the search that is on now, '' for none
  busy: boolean
  found: Found | null
  error: string
  onSearch: (q: string) => void
  onClear: () => void
}

// The search field at the top of the map (architect's ask 2026-11-18): write a whole word, press
// Enter, and the map keeps the graphs that contain it. It searches only the graphs the map shows,
// so it is offered once meta areas are chosen. Nothing is searched while typing.
export function SearchBar({ active, busy, found, error, onSearch, onClear }: Props) {
  const [text, setText] = useState(active)
  // A search started elsewhere (a suggested spelling) or cleared: the field follows.
  useEffect(() => setText(active), [active])
  const n = found ? found.ids.size : 0
  return (
    <form
      className="mapsearch"
      role="search"
      onSubmit={(e) => {
        e.preventDefault()
        const q = text.trim()
        if (q) onSearch(q)
        else onClear()
      }}
    >
      <div className="mapsearchRow">
        <input
          type="search"
          value={text}
          placeholder="Search the map: a whole word, then Enter"
          aria-label="Search the graphs on the map for a word"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="search"
          onChange={(e) => setText(e.target.value)}
        />
        {(active || text) && (
          <button
            type="button"
            className="ghost"
            aria-label="Clear the search"
            onClick={() => {
              setText('')
              onClear()
            }}
          >
            ×
          </button>
        )}
      </div>
      <div className="mapsearchNote" role="status">
        {busy && 'Searching…'}
        {!busy && error && <span className="mapsearchErr">{error}</span>}
        {!busy && !error && found && n > 0 && (
          <>
            <b>{n.toLocaleString()}</b> of {found.of.toLocaleString()} {found.of === 1 ? 'graph' : 'graphs'} on the map {n === 1 ? 'contains' : 'contain'} “{found.q}”.
          </>
        )}
        {!busy && !error && found && n === 0 && (
          <>
            No graph on the map contains “{found.q}”.{' '}
            {found.suggestions.length > 0 && (
              <>
                Did you mean{' '}
                {found.suggestions.map((s, i) => (
                  <span key={s}>
                    {i > 0 && ', '}
                    <button type="button" className="ghost" onClick={() => onSearch(s)}>
                      {s}
                    </button>
                  </span>
                ))}
                ?
              </>
            )}
            {!found.suggestions.length && found.suggestionNote && <span>{found.suggestionNote}</span>}
          </>
        )}
        {!busy && !error && found?.partial && ' The search stopped at its reading limit, so there may be more: choose fewer meta areas.'}
        {!busy && !error && !found && !active && 'Use * for part of a word, for example puls*.'}
      </div>
    </form>
  )
}
