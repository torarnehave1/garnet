// Project timelines (graph type Prosjekt-tidslinje, chosen by Tor Arne 2026-11-22, Systemutviklingsplan
// node 8). A graph holding one project-timeline node is a project told period by period, drawn in the
// map in the style of a Mermaid timeline: section bands on top, a date box per date, the events as
// notes under their date, milestones as circles with a Lucide icon.
//
//   project-timeline            the header: label = the timeline's name
//   project-timeline-section    a period: metadata { from, to (YYYY-MM-DD), color? }
//   project-timeline-milestone  a milestone: metadata { date (YYYY-MM-DD), icon? (Lucide name), color? }
//   any other node with metadata.date (YYYY-MM-DD) is an event
//
// An event and a milestone belong to a section by their date; no edges are needed. Dates stand in
// columns of equal width, as Mermaid draws them, not on a linear time scale.

import {
  Award,
  Briefcase,
  Calendar,
  CalendarCheck,
  CircleCheck,
  CircleDot,
  Clock,
  FileText,
  Flag,
  FlagTriangleRight,
  Gavel,
  Handshake,
  Heart,
  Hourglass,
  Landmark,
  Lightbulb,
  Mail,
  MapPin,
  Mic,
  Milestone,
  PartyPopper,
  Presentation,
  Rocket,
  Send,
  Sprout,
  Star,
  Target,
  Trophy,
  Users,
  type IconNode,
} from 'lucide'
import type { KgNode } from './types'
import { iconPath } from './typeIcons'

export const PT_TYPE = 'project-timeline'
export const PT_SECTION = 'project-timeline-section'
export const PT_MILESTONE = 'project-timeline-milestone'

// The Lucide icons a milestone may name (metadata.icon). A name not in the list is drawn as a flag.
const ICONS: Record<string, IconNode> = {
  award: Award,
  briefcase: Briefcase,
  calendar: Calendar,
  'calendar-check': CalendarCheck,
  'circle-check': CircleCheck,
  'circle-dot': CircleDot,
  clock: Clock,
  'file-text': FileText,
  flag: Flag,
  'flag-triangle-right': FlagTriangleRight,
  gavel: Gavel,
  handshake: Handshake,
  heart: Heart,
  hourglass: Hourglass,
  landmark: Landmark,
  lightbulb: Lightbulb,
  mail: Mail,
  'map-pin': MapPin,
  mic: Mic,
  milestone: Milestone,
  'party-popper': PartyPopper,
  presentation: Presentation,
  rocket: Rocket,
  send: Send,
  sprout: Sprout,
  star: Star,
  target: Target,
  trophy: Trophy,
  users: Users,
}
const paths = new Map<string, Path2D>()
/** A milestone's icon as a path in a 24 × 24 box; a flag when the name is unknown. */
export function milestoneIcon(name: string | undefined): Path2D {
  const key = name && ICONS[name] ? name : 'flag'
  let p = paths.get(key)
  if (!p) paths.set(key, (p = iconPath(ICONS[key])))
  return p
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
// A date as YYYY-MM-DD, or null. Only the day counts; a time after it is ignored.
function day(v: unknown): string | null {
  const m = typeof v === 'string' ? /^(\d{4})-(\d{2})-(\d{2})/.exec(v.trim()) : null
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}
// "5 Sep", or "5 Sep 2027" when the timeline spans more than one year.
function dateLabel(d: string, withYear: boolean) {
  const [y, m, dd] = d.split('-').map(Number)
  return `${dd} ${MONTHS[m - 1]}${withYear ? ' ' + y : ''}`
}
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

export type PtKind = 'event' | 'milestone' | 'section'
export interface PtSection {
  nid: string
  name: string
  color?: string
  c0: number // first column it covers
  c1: number // last column it covers
}
export interface PtLayout {
  cols: string[] // the label of each column (one per date), left to right
  sections: PtSection[]
  rows: number // how many notes the tallest column holds
  // Each placed node: its column and row (a section's row is -2, above the date boxes).
  items: Record<string, { col: number; row: number; kind: PtKind; icon?: string; color?: string }>
}

/** The layout of a project timeline from its graph's nodes; null when it has fewer than one date. */
export function layoutTimeline(nodes: KgNode[]): PtLayout | null {
  const dated: { n: KgNode; d: string; kind: 'event' | 'milestone' }[] = []
  const secs: { n: KgNode; from: string; to: string }[] = []
  for (const n of nodes) {
    if (n.type === PT_TYPE) continue
    const md = n.metadata || {}
    if (n.type === PT_SECTION) {
      const from = day(md.from)
      const to = day(md.to) ?? from
      if (from && to) secs.push({ n, from: from <= to ? from : to, to: from <= to ? to : from })
      continue
    }
    const d = day(md.date)
    if (d) dated.push({ n, d, kind: n.type === PT_MILESTONE ? 'milestone' : 'event' })
  }
  if (!dated.length) return null
  const days = [...new Set(dated.map((x) => x.d))].sort()
  const withYear = days[0].slice(0, 4) !== days[days.length - 1].slice(0, 4)
  const col = new Map(days.map((d, i) => [d, i]))
  const items: PtLayout['items'] = {}
  // In each column the milestones come first, then the events, in the graph's own order.
  const fill = new Array(days.length).fill(0)
  for (const kind of ['milestone', 'event'] as const)
    for (const x of dated) {
      if (x.kind !== kind) continue
      const c = col.get(x.d)!
      const md = x.n.metadata || {}
      items[x.n.id] = { col: c, row: fill[c]++, kind, icon: kind === 'milestone' ? str(md.icon) : undefined, color: str(md.color) }
    }
  const sections: PtSection[] = []
  for (const s of secs.sort((a, b) => (a.from < b.from ? -1 : 1))) {
    const inside = days.map((d, i) => (d >= s.from && d <= s.to ? i : -1)).filter((i) => i >= 0)
    if (!inside.length) continue // a period with no date in it has no columns to cover
    const sec: PtSection = { nid: s.n.id, name: s.n.label || '', color: str(s.n.metadata?.color), c0: inside[0], c1: inside[inside.length - 1] }
    sections.push(sec)
    items[s.n.id] = { col: sec.c0, row: -2, kind: 'section', color: sec.color }
  }
  return { cols: days.map((d) => dateLabel(d, withYear)), sections, rows: Math.max(1, ...fill), items }
}

/** The section a column belongs to, if any. */
export function sectionOf(lay: { sections: PtSection[] }, c: number): PtSection | undefined {
  return lay.sections.find((s) => c >= s.c0 && c <= s.c1)
}
