// The pulse of the week: how many saved versions each graph got in the last PULSE_DAYS days.
// A test layer (architect's ask 2026-11-18) with several ways of showing it, so they can be
// compared on the map: a colour scale, a beat that goes faster, rings in water, and the graph's
// version number (which replaced the plain count, architect's ask 2026-11-18).

export const PULSE_DAYS = 7
// The store keeps the 20 newest versions of a graph, so 20 means "20 or more".
export const PULSE_CAP = 20

export type PulseMode = 'off' | 'color' | 'count' | 'beat' | 'ripple'
export const PULSE_MODES: { value: PulseMode; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'color', label: 'Colour' },
  // Stored as 'count' (the earlier name), so a remembered choice still opens this mode.
  { value: 'count', label: 'Version' },
  { value: 'beat', label: 'Beat' },
  { value: 'ripple', label: 'Ripple' },
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
// The label in Version mode: the graph's current version number.
export const versionText = (v: number) => 'V. ' + v

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

// Ripple (architect's ask 2026-11-18): rings in water. A graph with n changes sends out n rings at
// a time, like a radar; 2 is a small stir, 12 a wide wave train. Each ring takes RIPPLE_SECONDS to
// travel out and fades as it goes. The span grows with n so the rings stay apart to count.
export const RIPPLE_SECONDS = 4
/** How far out (screen px) the outermost ring travels for n changes. */
export const rippleSpan = (n: number) => 8 + 4.5 * Math.min(PULSE_CAP, Math.max(1, n))
/**
 * Where each of the n rings is on its way out, 0 (at the graph) to 1 (gone), at time `now` (ms).
 * still: reduced motion, the rings stand evenly spaced instead of moving.
 */
export function ripples(now: number, n: number, phase: number, still: boolean): number[] {
  const k = Math.min(PULSE_CAP, Math.max(1, n))
  const t = still ? 0 : now / (RIPPLE_SECONDS * 1000) + phase
  const out: number[] = []
  for (let i = 0; i < k; i++) out.push((((t + i / k) % 1) + 1) % 1)
  return out
}
