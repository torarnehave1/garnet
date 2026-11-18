// The pulse of the week: how many saved versions each graph got in the last PULSE_DAYS days.
// A test layer (architect's ask 2026-11-18) with three ways of showing the same number, so they
// can be compared on the map: a colour scale, the number itself, and a beat that goes faster.

export const PULSE_DAYS = 7
// The store keeps the 20 newest versions of a graph, so 20 means "20 or more".
export const PULSE_CAP = 20

export type PulseMode = 'off' | 'color' | 'count' | 'beat'
export const PULSE_MODES: { value: PulseMode; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'color', label: 'Colour' },
  { value: 'count', label: 'Count' },
  { value: 'beat', label: 'Beat' },
]

// One hue (rose), darkest for one change and lightest for the most: on the night-water background
// the lighter step is the stronger one. Each step clears 3:1 against #0b1220.
export const PULSE_STEPS: { from: number; label: string; color: string }[] = [
  { from: 1, label: '1', color: '#af355c' },
  { from: 2, label: '2–4', color: '#dd4677' },
  { from: 5, label: '5–9', color: '#f97096' },
  { from: 10, label: '10–19', color: '#ffa3ba' },
  { from: PULSE_CAP, label: PULSE_CAP + '+', color: '#ffd5df' },
]
// The ring colour where the number or the beat carries the count.
export const PULSE_PLAIN = PULSE_STEPS[2].color

export function pulseColor(n: number): string {
  let c = PULSE_STEPS[0].color
  for (const s of PULSE_STEPS) if (n >= s.from) c = s.color
  return c
}
export const pulseText = (n: number) => (n >= PULSE_CAP ? PULSE_CAP + '+' : String(n))

// A stored time in ms. The history writes "YYYY-MM-DD HH:MM:SS" in UTC; rows carry ISO times.
export function utcMs(s: string | null | undefined): number {
  if (!s) return 0
  const c = String(s).trim().replace(' ', 'T')
  const t = Date.parse(c + (/[zZ]|[+-]\d\d:?\d\d$/.test(c) ? '' : 'Z'))
  return isNaN(t) ? 0 : t
}

export const pulseSince = (now: number) => now - PULSE_DAYS * 86400000

// How many of a graph's saved versions fall inside the window. A graph that was changed in the
// window without a saved version (an older write path) still counts as one change.
export function changesSince(stamps: number[], since: number): number {
  let n = 0
  for (const t of stamps) if (t >= since) n++
  return Math.max(1, Math.min(PULSE_CAP, n))
}

// Beats a minute: about 50 for one change, 150 for twenty. 150 a minute is 2.5 a second, under
// the three flashes a second that the accessibility guidelines set as the limit.
export const beatsPerMinute = (n: number) => 45 + Math.min(PULSE_CAP, Math.max(1, n)) * 5.25

// A heartbeat between 0 and 1 at time `now` (ms): a strong beat and a weaker one after it.
// phase (0..1) moves each graph's beat in time, so the whole map never flashes at once.
export function beat(now: number, n: number, phase: number): number {
  const p = ((now / 60000) * beatsPerMinute(n) + phase) % 1
  const a = (p - 0.1) / 0.055
  const b = (p - 0.34) / 0.07
  return Math.min(1, Math.exp(-a * a) + 0.55 * Math.exp(-b * b))
}
