import { useState } from 'react'

// Choose several meta areas. Nothing changes until Show is pressed.
// The search box narrows the list (any part of the name, # and case ignored); ticks are kept
// while searching, and the ones already chosen stay at the top so they can be unticked.
export function TagPanel({ counts, chosen, onDone, onCancel }: { counts: [string, number][]; chosen: string[]; onDone: (tags: string[]) => void; onCancel: () => void }) {
  const [sel, setSel] = useState(() => new Set(chosen))
  const [q, setQ] = useState('')
  const needle = q.replace(/#/g, '').trim().toUpperCase()
  const match = (t: string) => !needle || t.toUpperCase().includes(needle)
  const shown = needle ? [...counts.filter(([t]) => match(t) && t.slice(1).toUpperCase().startsWith(needle)), ...counts.filter(([t]) => match(t) && !t.slice(1).toUpperCase().startsWith(needle))] : counts
  const ticked = counts.filter(([t]) => sel.has(t) && !shown.some(([s]) => s === t))
  const show = () => onDone(counts.map((c) => c[0]).filter((t) => sel.has(t)))
  const toggle = (t: string, on: boolean) => {
    const next = new Set(sel)
    if (on) next.add(t)
    else next.delete(t)
    setSel(next)
  }
  const row = ([t, n]: [string, number]) => (
    <label key={t}>
      <input type="checkbox" checked={sel.has(t)} onChange={(e) => toggle(t, e.target.checked)} />
      {t} ({n})
    </label>
  )
  return (
    <div className="panel" role="dialog" aria-label="Choose meta areas" onKeyDown={(e) => e.key === 'Escape' && onCancel()}>
      <div className="panelhead">
        <strong>Meta areas</strong>
        <span>
          <button className="ghost" type="button" onClick={() => setSel(new Set())}>
            Clear
          </button>{' '}
          <button type="button" onClick={show}>
            Show{sel.size ? ` ${sel.size}` : ''}
          </button>
        </span>
      </div>
      <div className="panelsearch">
        <input
          type="search"
          placeholder="Search meta areas"
          aria-label="Search meta areas"
          autoFocus
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            // Enter ticks the only match left; Enter again shows.
            if (e.key !== 'Enter') return
            e.preventDefault()
            if (shown.length === 1 && !sel.has(shown[0][0])) toggle(shown[0][0], true)
            else show()
          }}
        />
        {needle && (
          <span className="muted">
            {shown.length} of {counts.length}
          </span>
        )}
      </div>
      <div className="panellist">
        {needle && ticked.map(row)}
        {shown.map(row)}
        {!counts.length && <p className="muted">No meta areas in these graphs.</p>}
        {counts.length > 0 && needle && !shown.length && <p className="muted">No meta area contains “{q.trim()}”.</p>}
      </div>
    </div>
  )
}
