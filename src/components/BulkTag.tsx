import { useRef, useState } from 'react'
import { readMetaArea, writeMetaArea } from '../api/kg'
import { normTag, withTag, withoutTag } from '../lib/rows'
import type { Row, User } from '../lib/types'

// Add one meta area to, or take it off, every graph the filters show now.
// Garnet changes nothing by itself: the box names the meta area and how many graphs, and waits for a yes.
// Each graph is read fresh before it is written, because the server replaces the whole meta-area
// string; only the one tag changes, the others stay exactly as they were written.
type Mode = 'add' | 'remove'
interface Change {
  id: string
  metaArea: string
}
interface Done {
  mode: Mode
  tag: string
  changed: string[]
  skipped: number
  failed: { id: string; title: string; why: string }[]
  stopped: boolean
}

const AT_ONCE = 4

export function BulkTag({
  user,
  rows,
  tags,
  why,
  onChanged,
  onClose,
}: {
  user: User
  rows: Row[]
  tags: string[]
  why: (e: unknown) => string
  onChanged: (c: Change[]) => void
  onClose: () => void
}) {
  const [mode, setMode] = useState<Mode>('add')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [count, setCount] = useState(0)
  const [done, setDone] = useState<Done | null>(null)
  const stop = useRef(false)
  const tag = normTag(text)
  const have = tag ? rows.filter((r) => r.tags.includes(tag)).length : 0
  const touches = mode === 'add' ? rows.length - have : have

  async function run(m: Mode, t: string, ids: string[]) {
    setBusy(true)
    setCount(0)
    stop.current = false
    const byId = new Map(rows.map((r) => [r.id, r]))
    const res: Done = { mode: m, tag: t, changed: [], skipped: 0, failed: [], stopped: false }
    const queue = [...ids]
    const changes: Change[] = []
    const work = async () => {
      for (let id = queue.shift(); id; id = queue.shift()) {
        if (stop.current) {
          res.stopped = true
          return
        }
        try {
          const raw = await readMetaArea(user, id)
          const next = m === 'add' ? withTag(raw, t) : withoutTag(raw, t)
          if (next == null) res.skipped++
          else {
            const stored = await writeMetaArea(user, id, next)
            res.changed.push(id)
            changes.push({ id, metaArea: stored })
          }
        } catch (e) {
          res.failed.push({ id, title: byId.get(id)?.title || id, why: why(e) })
        }
        setCount((n) => n + 1)
      }
    }
    await Promise.all(Array.from({ length: Math.min(AT_ONCE, ids.length) }, work))
    // One update of the picture at the end, not one per graph.
    if (changes.length) onChanged(changes)
    setBusy(false)
    setDone(res)
  }

  if (done) {
    const undo: Mode = done.mode === 'add' ? 'remove' : 'add'
    return (
      <div className="veil" role="dialog" aria-modal="true" aria-labelledby="bulkTitle" onKeyDown={(e) => e.key === 'Escape' && !busy && onClose()}>
        <div className="dlgbox">
          <h2 id="bulkTitle">{busy ? 'Undoing…' : done.stopped ? 'Stopped' : 'Done'}</h2>
          <p>
            {done.tag} {done.mode === 'add' ? 'added to' : 'taken off'} {done.changed.length} graph{done.changed.length === 1 ? '' : 's'}
            {done.skipped ? `, ${done.skipped} already ${done.mode === 'add' ? 'had it' : 'without it'}` : ''}
            {done.stopped ? ', the rest left as they were' : ''}.
          </p>
          {busy && <p className="muted">{count} of {done.changed.length}</p>}
          {done.failed.length > 0 && (
            <div className="dlgerr" role="alert">
              <p>{done.failed.length} could not be changed:</p>
              <ul className="bulkFails">
                {done.failed.slice(0, 8).map((f) => (
                  <li key={f.id}>
                    “{f.title}”: {f.why}
                  </li>
                ))}
                {done.failed.length > 8 && <li>and {done.failed.length - 8} more.</li>}
              </ul>
            </div>
          )}
          <div className="dlgrow">
            <button className="ghost" type="button" disabled={busy} onClick={onClose}>
              Close
            </button>{' '}
            {done.changed.length > 0 && (
              <button type="button" disabled={busy} onClick={() => run(undo, done.tag, done.changed)}>
                {busy ? 'Working…' : 'Undo'}
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="veil" role="dialog" aria-modal="true" aria-labelledby="bulkTitle" onKeyDown={(e) => e.key === 'Escape' && !busy && onClose()}>
      <div className="dlgbox">
        <h2 id="bulkTitle">Meta area on the graphs shown</h2>
        <p>The filters show {rows.length} graph{rows.length === 1 ? '' : 's'}. Change all of them:</p>
        <div className="bulkMode" role="group" aria-label="Add or take off">
          <label>
            <input type="radio" name="bulkMode" checked={mode === 'add'} disabled={busy} onChange={() => setMode('add')} /> Add
          </label>
          <label>
            <input type="radio" name="bulkMode" checked={mode === 'remove'} disabled={busy} onChange={() => setMode('remove')} /> Take off
          </label>
        </div>
        <input
          type="text"
          className="dlgInput"
          list="bulkTags"
          placeholder="#METAAREA"
          aria-label="Meta area"
          autoComplete="off"
          autoFocus
          disabled={busy}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <datalist id="bulkTags">
          {tags.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
        <p>
          {!tag
            ? 'Type a meta area or choose one from the list.'
            : touches === 0
              ? mode === 'add'
                ? `All ${rows.length} already have ${tag}. Nothing to change.`
                : `None of them has ${tag}. Nothing to change.`
              : mode === 'add'
                ? `${tag} will be added to ${touches} graph${touches === 1 ? '' : 's'}${have ? ` (${have} already have it)` : ''}.`
                : `${tag} will be taken off ${touches} graph${touches === 1 ? '' : 's'}. Their other meta areas stay.`}{' '}
          {tag && touches > 0 && 'Each graph gets a new version. Only graphs you own (or all, as Superadmin) can be changed.'}
        </p>
        {busy && (
          <p className="muted">
            {count} of {touches}…
          </p>
        )}
        <div className="dlgrow">
          {busy ? (
            <button className="ghost" type="button" onClick={() => (stop.current = true)}>
              Stop
            </button>
          ) : (
            <button className="ghost" type="button" onClick={onClose}>
              Cancel
            </button>
          )}{' '}
          <button
            type="button"
            disabled={busy || !tag || touches === 0}
            onClick={() =>
              run(
                mode,
                tag,
                rows.filter((r) => (mode === 'add' ? !r.tags.includes(tag) : r.tags.includes(tag))).map((r) => r.id),
              )
            }
          >
            {busy ? 'Working…' : mode === 'add' ? `Add to ${touches}` : `Take off ${touches}`}
          </button>
        </div>
      </div>
    </div>
  )
}
