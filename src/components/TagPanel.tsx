import { useState } from 'react'

// Choose several meta areas. Nothing changes until Show is pressed.
export function TagPanel({ counts, chosen, onDone, onCancel }: { counts: [string, number][]; chosen: string[]; onDone: (tags: string[]) => void; onCancel: () => void }) {
  const [sel, setSel] = useState(() => new Set(chosen))
  return (
    <div className="panel" role="dialog" aria-label="Choose meta areas" onKeyDown={(e) => e.key === 'Escape' && onCancel()}>
      <div className="panelhead">
        <strong>Meta areas</strong>
        <span>
          <button className="ghost" type="button" onClick={() => setSel(new Set())}>
            Clear
          </button>{' '}
          <button type="button" onClick={() => onDone(counts.map((c) => c[0]).filter((t) => sel.has(t)))}>
            Show
          </button>
        </span>
      </div>
      <div className="panellist">
        {counts.map(([t, n]) => (
          <label key={t}>
            <input
              type="checkbox"
              checked={sel.has(t)}
              onChange={(e) => {
                const next = new Set(sel)
                if (e.target.checked) next.add(t)
                else next.delete(t)
                setSel(next)
              }}
            />
            {t} ({n})
          </label>
        ))}
        {!counts.length && <p className="muted">No meta areas in these graphs.</p>}
      </div>
    </div>
  )
}
