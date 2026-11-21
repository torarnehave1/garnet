// The time axis of a history line. An event's metadata.year is a number: a whole year (1956), or a
// decimal year for events closer together than that (2026.873 = 15 Nov 2026 16:09: the year plus
// the part of it that had passed). The axis spans what the events span, and its marks follow the
// span: decades and years for a long history, months, days or hours for a short one.

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'des']

function daysIn(y: number) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365
}
function toDate(v: number) {
  const y = Math.floor(v)
  return new Date(Date.UTC(y, 0, 1) + (v - y) * daysIn(y) * 86400000)
}
function toYear(d: Date) {
  const y = d.getUTCFullYear()
  return y + (d.getTime() - Date.UTC(y, 0, 1)) / (daysIn(y) * 86400000)
}

// The width of the axis in years. Whole-year lines keep at least one year, as before; a line whose
// events lie within one year gets just the time they span (an hour at the least).
export function histSpan(y0: number, y1: number) {
  const s = y1 - y0
  if (Number.isInteger(y0) && Number.isInteger(y1)) return Math.max(1, s)
  return Math.max(1 / 8760, s)
}

export function histTicks(y0: number, y1: number): { year: number; label: string }[] {
  const span = histSpan(y0, y1)
  const out: { year: number; label: string }[] = []
  if (span >= 3) {
    const step = span > 60 ? 20 : span > 15 ? 10 : span > 6 ? 2 : 1
    for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) out.push({ year: y, label: String(y) })
    return out
  }
  const a = toDate(y0)
  const b = toDate(y0 + span)
  const days = (b.getTime() - a.getTime()) / 86400000
  if (days > 60) {
    // Months; the year is named in January and on the first mark.
    const step = days > 400 ? 3 : 1
    const d = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + 1, 1))
    for (; d <= b; d.setUTCMonth(d.getUTCMonth() + step)) {
      const m = d.getUTCMonth()
      out.push({ year: toYear(d), label: MONTHS[m] + (m === 0 || !out.length ? ' ' + d.getUTCFullYear() : '') })
    }
    return out
  }
  if (days > 2) {
    // Days at midnight, as 15.11.
    const step = days > 20 ? 7 : 1
    const d = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate() + 1))
    for (; d <= b; d.setUTCDate(d.getUTCDate() + step))
      out.push({ year: toYear(d), label: d.getUTCDate() + '.' + String(d.getUTCMonth() + 1).padStart(2, '0') })
    return out
  }
  // Hours, every 3 or 6, with the day at midnight.
  const step = days > 1 ? 6 : 3
  const d = new Date(Math.ceil(a.getTime() / (step * 3600000)) * step * 3600000)
  for (; d <= b; d.setTime(d.getTime() + step * 3600000)) {
    const h = d.getUTCHours()
    out.push({ year: toYear(d), label: h === 0 ? d.getUTCDate() + '.' + String(d.getUTCMonth() + 1).padStart(2, '0') : String(h).padStart(2, '0') + ':00' })
  }
  return out
}

// A chosen period of a history line (2026-11-21): the axis shows [a, b] across most of its width,
// and the events before and after it are pressed into a narrow strip at each edge, so they stay
// in sight. Without a period the axis is linear over the whole span.
export type HistView = { a: number; b: number }
export const EDGE = 0.06

function edges(y0: number, y1: number, v: HistView) {
  return { left: v.a > y0 + 1e-9 ? EDGE : 0, right: v.b < y1 - 1e-9 ? EDGE : 0 }
}

// Where a year stands on the axis, from 0 (left end) to 1 (right end).
export function histFrac(y0: number, y1: number, view: HistView | undefined, y: number) {
  if (!view) return (y - y0) / histSpan(y0, y1)
  const { left, right } = edges(y0, y1, view)
  if (y < view.a) return left * ((y - y0) / Math.max(view.a - y0, 1e-9))
  if (y > view.b) return 1 - right + right * ((y - view.b) / Math.max(y1 - view.b, 1e-9))
  return left + (1 - left - right) * ((y - view.a) / Math.max(view.b - view.a, 1e-9))
}

// The year at a place on the axis (0..1): the inverse of histFrac.
export function histYearAt(y0: number, y1: number, view: HistView | undefined, f: number) {
  f = Math.min(1, Math.max(0, f))
  if (!view) return y0 + f * histSpan(y0, y1)
  const { left, right } = edges(y0, y1, view)
  if (f < left) return y0 + (f / left) * (view.a - y0)
  if (f > 1 - right) return view.b + ((f - (1 - right)) / right) * (y1 - view.b)
  return view.a + ((f - left) / Math.max(1 - left - right, 1e-9)) * (view.b - view.a)
}

// The period a double-click opens: the group of events around the clicked year, where groups are
// split by gaps longer than a tenth of what is shown now. When the click finds no smaller group,
// the shown period narrows to a quarter around the click.
export function histZoomAt(y0: number, y1: number, view: HistView | undefined, years: number[], at: number): HistView {
  const a0 = view ? view.a : y0
  const b0 = view ? view.b : y0 + histSpan(y0, y1)
  const span = b0 - a0
  const ys = years.filter((y) => y >= a0 && y <= b0).sort((p, q) => p - q)
  const groups: number[][] = []
  for (const y of ys) {
    const g = groups[groups.length - 1]
    if (g && y - g[g.length - 1] <= span / 10) g.push(y)
    else groups.push([y])
  }
  let best: number[] | null = null
  let bd = Infinity
  for (const g of groups) {
    const d = at < g[0] ? g[0] - at : at > g[g.length - 1] ? at - g[g.length - 1] : 0
    if (d < bd) {
      bd = d
      best = g
    }
  }
  let a: number
  let b: number
  if (best && best.length > 1 && best[best.length - 1] - best[0] < span * 0.6) {
    const pad = Math.max((best[best.length - 1] - best[0]) * 0.08, 1 / 8760)
    a = best[0] - pad
    b = best[best.length - 1] + pad
  } else {
    a = at - span / 8
    b = at + span / 8
  }
  a = Math.max(y0, a)
  b = Math.min(y0 + histSpan(y0, y1), b)
  if (b - a < 1 / 8760) b = a + 1 / 8760
  return { a, b }
}
