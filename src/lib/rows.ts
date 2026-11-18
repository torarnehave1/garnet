import type { Filters, Row } from './types'

export const PALETTE = ['#f2b45a', '#6fd3c7', '#ef8fa3', '#9db7ff', '#c9a2f2', '#9bd67a', '#f29a6b', '#6fc3ef']
export const LOOSE = '#7f8ea8'
export const SHARED = 'Vegvisr.org (shared)'

export function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}
export function colorOf(tag: string): string {
  return PALETTE[hash(tag) % PALETTE.length]
}

// "#A #B" → ["#A", "#B"], upper case, no repeats.
export function parseTags(m: string | undefined | null): string[] {
  const s = (m || '').trim()
  if (!s || s === '(none)') return []
  const parts = s.indexOf('#') >= 0 ? s.split('#') : [s]
  const out: string[] = []
  const seen = new Set<string>()
  for (let p of parts) {
    p = p.trim().toUpperCase()
    if (p && !seen.has(p)) {
      seen.add(p)
      out.push('#' + p)
    }
  }
  return out
}

// Created time in ms. Falls back to a 13-digit stamp at the end of an old-style id.
export function when(g: { created: string; id: string }): number {
  let t = NaN
  if (g.created) {
    const c = String(g.created).replace(' ', 'T')
    t = Date.parse(c + (/[zZ]|[+-]\d\d:?\d\d$/.test(c) ? '' : 'Z'))
  }
  if (isNaN(t)) {
    const m = /_(\d{13})$/.exec(g.id)
    if (m) t = +m[1]
  }
  return isNaN(t) ? 0 : t
}
export function yearOf(r: Row): number {
  const t = when(r)
  return t ? new Date(t).getUTCFullYear() : 0
}

export interface Option {
  value: string
  label: string
}

export function worldRows(rows: Row[], world: string): Row[] {
  return world === '*' ? rows : rows.filter((r) => (r.world || '') === world)
}

// Every World the person can use is listed, also one with no graphs yet (count 0).
export function worldOptions(rows: Row[], worlds: string[] = []): Option[] {
  const count = new Map<string, number>()
  rows.forEach((r) => count.set(r.world || '', (count.get(r.world || '') || 0) + 1))
  worlds.forEach((w) => w && !count.has(w) && count.set(w, 0))
  const names = Array.from(count.keys()).sort()
  const out: Option[] = [{ value: '*', label: `All (${rows.length})` }]
  if (names.length > 1) names.forEach((w) => out.push({ value: w, label: `${w || SHARED} (${count.get(w)})` }))
  return out
}

export function tagCounts(rows: Row[]): [string, number][] {
  const count = new Map<string, number>()
  rows.forEach((r) => r.tags.forEach((t) => count.set(t, (count.get(t) || 0) + 1)))
  return Array.from(count.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

export function yearOptions(rows: Row[]): Option[] {
  const count = new Map<number, number>()
  rows.forEach((r) => {
    const y = yearOf(r)
    if (y) count.set(y, (count.get(y) || 0) + 1)
  })
  const ys = Array.from(count.keys()).sort((a, b) => b - a)
  return [{ value: '*', label: 'Any year' }, ...ys.map((y) => ({ value: String(y), label: `${y} (${count.get(y)})` }))]
}

export function sinceOptions(rows: Row[]): Option[] {
  const ys = Array.from(new Set(rows.map(yearOf).filter(Boolean))).sort((a, b) => a - b)
  return [{ value: '*', label: 'The beginning' }, ...ys.map((y) => ({ value: String(y), label: `From ${y}` }))]
}

// Node types, most used first. Text in the find box narrows it: types that start with the
// text come first, then types that contain it.
export function typeList(rows: Row[], find: string): { all: [string, number][]; names: string[] } {
  const count = new Map<string, number>()
  rows.forEach((r) => (r.types || []).forEach((t) => count.set(t, (count.get(t) || 0) + 1)))
  const all = Array.from(count.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const q = find.trim().toLowerCase()
  let names = all.map((e) => e[0])
  if (q) {
    const starts = names.filter((t) => t.toLowerCase().startsWith(q))
    names = starts.concat(names.filter((t) => t.toLowerCase().indexOf(q) > 0))
  }
  return { all, names }
}

// When the graph was last updated (ms), 0 when the index gave no time. A time without a zone is UTC.
export function updatedMs(r: { updated: string }): number {
  if (!r.updated) return 0
  const c = String(r.updated).trim().replace(' ', 'T')
  const t = Date.parse(c + (/[zZ]|[+-]\d\d:?\d\d$/.test(c) ? '' : 'Z'))
  return isNaN(t) ? 0 : t
}

export function shownRows(rows: Row[], f: Filters): Row[] {
  const tags = new Set(f.tags)
  return worldRows(rows, f.world).filter((r) => {
    if (f.year !== '*' && String(yearOf(r)) !== f.year) return false
    if (f.since !== '*' && yearOf(r) < +f.since) return false
    if (f.dateFrom || f.dateTo) {
      const t = when(r)
      if (!t) return false // no creation time: outside any date range
      if (f.dateFrom && t < dayStart(f.dateFrom)) return false
      if (f.dateTo && t > dayStart(f.dateTo) + 86400000 - 1) return false
    }
    if (f.updFrom || f.updTo) {
      const u = updatedMs(r)
      if (!u) return false // no update time: outside any date range
      if (f.updFrom && u < dayStart(f.updFrom)) return false
      if (f.updTo && u > dayStart(f.updTo) + 86400000 - 1) return false
    }
    if (tags.size && !r.tags.some((x) => tags.has(x))) return false
    if (f.type !== '*' && (r.types || []).indexOf(f.type) < 0) return false
    if (f.pub === 'live' && !r.live) return false
    if (f.pub === 'published' && r.status !== 'published') return false
    if (f.pub === 'private' && r.status === 'published') return false
    return true
  })
}

export const DEFAULT_FILTERS: Filters = { tags: [], type: '*', find: '', only: true, pub: '*', year: '*', since: '*', world: '*', dateFrom: '', dateTo: '', updFrom: '', updTo: '' }

// A day as the date filter reads it: from midnight UTC, the way the server's graph_index reads a bare date.
export const dayStart = (d: string) => Date.parse(d + 'T00:00:00Z')

export function monthOf(t: number) {
  return new Date(t).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}
export function dayOf(t: number) {
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}
export function stamp(ms: number) {
  const d = new Date(ms)
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

// A meta area as the person typed it → "#LIKETHIS": upper case, one leading #, single spaces.
export function normTag(s: string): string {
  const t = s.replace(/#/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase()
  return t ? '#' + t : ''
}

// The stored meta-area string split into its tags as written (case kept), so a change touches
// only the one tag it is about.
function rawTags(raw: string | null | undefined): string[] {
  const s = (raw || '').trim()
  if (!s || s === '(none)') return []
  return (s.indexOf('#') >= 0 ? s.split('#') : [s]).map((p) => p.trim()).filter(Boolean)
}

// The whole new string with the tag added, or null when the graph already has it.
export function withTag(raw: string | null | undefined, tag: string): string | null {
  const body = tag.replace(/^#/, '')
  const have = rawTags(raw)
  if (have.some((p) => p.toUpperCase() === body)) return null
  return [...have, body].map((p) => '#' + p).join(' ')
}

// The whole new string without the tag, or null when the graph does not have it.
export function withoutTag(raw: string | null | undefined, tag: string): string | null {
  const body = tag.replace(/^#/, '')
  const have = rawTags(raw)
  const keep = have.filter((p) => p.toUpperCase() !== body)
  if (keep.length === have.length) return null
  return keep.map((p) => '#' + p).join(' ')
}
