import { useEffect, useRef, useState } from 'react'
import { loadHistory } from '../api/kg'
import type { Engine } from '../engine/Engine'
import { changesSince, PULSE_CAP, pulseSince, utcMs, type PulseMode } from './pulse'
import type { Row, User } from './types'

// Reading the version history is one request per graph, so it is done only for the graphs on the
// map that were changed in the window, a few at a time, the most recently changed first.
const AT_ONCE = 6
const MOST = 300

export interface PulseSummary {
  changed: number // graphs on the map changed in the window
  changes: number // saved changes counted so far
  read: number // graphs whose history has been read
  toRead: number
  failed: number // history could not be read: shown as one change
  capped: number // graphs with all 20 kept versions inside the window: 20 or more
  skipped: number // changed graphs beyond MOST: shown as one change
  top: { id: string; title: string; n: number }[]
  done: boolean
}

/**
 * The pulse layer's numbers: for each shown graph changed in the last week, how many saved
 * versions it got. The map is given every changed graph at once as one change, and each count is
 * filled in as its history arrives, so the layer shows at once and sharpens while it reads.
 */
export function usePulse(engine: Engine | null, user: User, shown: Row[], mode: PulseMode): PulseSummary | null {
  const on = mode !== 'off'
  const [sum, setSum] = useState<PulseSummary | null>(null)
  // The counts from the last reading, so a changed filter redraws with the numbers already known.
  const known = useRef(new Map<string, number>())
  // The version numbers read so far, by graph and its "updated" time, kept across filter changes.
  const knownV = useRef(new Map<string, { updated: string; v: number }>())

  useEffect(() => {
    engine?.setPulseMode(mode)
  }, [engine, mode])

  useEffect(() => {
    if (!engine) return
    if (!on) {
      engine.setPulse(new Map())
      engine.setPulseVersions(new Map())
      return
    }
    const since = pulseSince(Date.now())
    const changed = shown
      .map((r) => ({ r, t: utcMs(r.updated) }))
      .filter((x) => x.t >= since)
      .sort((a, b) => b.t - a.t)
      .map((x) => x.r)
    const counts = new Map<string, number>()
    for (const r of changed) counts.set(r.id, known.current.get(r.id) || 1)
    known.current = counts
    engine.setPulse(counts)
    const versions = new Map<string, number>()
    for (const r of changed) {
      const k = knownV.current.get(r.id)
      if (k && k.updated === r.updated) versions.set(r.id, k.v)
    }
    engine.setPulseVersions(versions)
    const todo = changed.slice(0, MOST)
    let read = 0
    let failed = 0
    let capped = 0
    let stopped = false
    const report = (done: boolean) => {
      if (stopped) return
      let changes = 0
      counts.forEach((n) => (changes += n))
      const top = changed
        .map((r) => ({ id: r.id, title: r.title, n: counts.get(r.id) || 0 }))
        .sort((a, b) => b.n - a.n)
        .slice(0, 3)
        .filter((x) => x.n > 1)
      setSum({ changed: changed.length, changes, read, toRead: todo.length, failed, capped, skipped: changed.length - todo.length, top, done })
    }
    // After this effect, not inside it: the first numbers are known before any history is read.
    void Promise.resolve().then(() => report(!todo.length))
    let next = 0
    let last = 0
    const worker = async () => {
      while (!stopped && next < todo.length) {
        const r = todo[next++]
        try {
          const h = await loadHistory(user, r.id, r.updated)
          if (stopped) return
          const n = changesSince(h.stamps, since)
          counts.set(r.id, n)
          if (h.version != null) {
            versions.set(r.id, h.version)
            knownV.current.set(r.id, { updated: r.updated, v: h.version })
          }
          if (n >= PULSE_CAP) capped++
        } catch {
          failed++
        }
        read++
        // The map reads the counts every frame; the text is refreshed a few times a second.
        const now = Date.now()
        if (now - last > 300) {
          last = now
          report(false)
        }
      }
    }
    Promise.all(Array.from({ length: Math.min(AT_ONCE, todo.length) }, worker)).then(() => report(true))
    return () => {
      stopped = true
    }
  }, [engine, user, shown, on])

  return on ? sum : null
}
