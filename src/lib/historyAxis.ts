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
