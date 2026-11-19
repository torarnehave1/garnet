import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type Simulation, type SimulationLinkDatum, type SimulationNodeDatum } from 'd3-force'
import { select, type Selection } from 'd3-selection'
import 'd3-transition'
import { zoom as d3zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom'
import { courseOrder, flowOrder, nodeName, STATUS_COLOR, statusKind, taskOrder, type StatusKind } from '../lib/graphRules'
import { beat, PULSE_PLAIN, pulseColor, ripples, rippleSpan, versionText, type PulseMode } from '../lib/pulse'
import { colorOf, hash, LOOSE, when } from '../lib/rows'
import { typeIcon } from '../lib/typeIcons'
import type { KgGraph, Row } from '../lib/types'
import { SEED } from './seed'

/* ---------- what is drawn ---------- */
interface Base extends SimulationNodeDatum {
  id: string
  x: number
  y: number
}
export interface Hub extends Base {
  kind: 'h'
  tag: string
  color: string
  members: GraphItem[]
  first: number
  vis: number
  seed: number
}
export interface GraphItem extends Base {
  kind: 'g'
  title: string
  n: number
  status: string
  tags: string[]
  live: string
  types: string[]
  world: string
  order: number
  t: number
  r: number
  color: string
  sem: GraphItem[]
  flowRows: number
  // A course (a graph with a kurs-steg node) that has a card image: drawn as a square with that image.
  image: string
  // The graph's header image: drawn inside the circle once the circle is large on screen.
  header: string
  createdBy: string
  version: number | null
  sharedVia?: string // reached only through a share with this World of the viewer's
  sharedMode?: 'read' | 'write'
  sharedWith?: { world: string; mode: 'read' | 'write' }[]
}
export interface NodeItem extends Base {
  kind: 'n'
  nid: string
  label: string
  type: string
  parent: GraphItem
  order: number
  r: number
  color: string
  links: NodeItem[]
  flow: { row: number; num: number } | null
  status: StatusKind
}
export type Item = Hub | GraphItem | NodeItem

// What makes a graph a course, and the size its card image is kept at (one square bitmap per course).
const COURSE_TYPE = 'kurs-steg'
const PIC = 256
// A graph's header image shows inside its circle from the first zoom (as the Zoom chip shows
// it) and is 95 % there at the second (Tor Arne, 2026-11-19: 95 % at zoom 4.9).
const HEADER_FROM_Z = 3.5
const HEADER_95_Z = 4.9

type Link<S extends Item = Item, T extends Item = Item> = SimulationLinkDatum<Item> & { source: S; target: T }
interface SemLink extends Link<GraphItem, GraphItem> {
  word: string
}
interface FlowLink extends Link {
  stem?: boolean
}

export interface Months {
  base: number
  n: number
  gp: number[]
  np: number[]
  gmax: number
  nmax: number
}

export interface Snapshot {
  kk: number
  N: number
  skeleton: boolean
  dated: boolean
  hubCount: number
  hubsShown: number
  nodesShown: number
  nodesTotal: number
  cur: { title: string; t: number } | null
  playing: boolean
}

export interface Focus {
  id: string
  fx: number
  fy: number
  z: number
}

export interface EngineEvents {
  onSnapshot(s: Snapshot): void
  // byUser: the item was clicked, not put back by a restored view.
  onSelect(d: Item | null, byUser?: boolean): void
  onContext(g: GraphItem, clientX: number, clientY: number): void
  onZoom(z: number): void
  onFocus(f: Focus): void
  onUserMove(): void
}

const ICON_MIN_PX = 9 // A node this many pixels in radius, or more, shows its type icon.
const ICON_FILL = 0.68 // How much of the node the icon fills (1 = edge to edge).
const SPREAD_K = 12 // From this zoom (as the Zoom chip shows it), node names spread out.
const STOP = new Set(
  'with from that this what have your about into their they will been were when which there than then also only over under more most some such these those just like for and the med for som det den der har ikke eller til fra hva hvordan hvorfor som'.split(' '),
)

export class Engine {
  private cv: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private ev: EngineEvents
  private reduced = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  private W = 0
  private H = 0
  private dpr = 1
  T: ZoomTransform = zoomIdentity
  zoom0 = 1
  private zoomer: ZoomBehavior<HTMLCanvasElement, unknown>
  private sel: Selection<HTMLCanvasElement, unknown, null, undefined>

  graphs: GraphItem[] = []
  hubs: Hub[] = []
  inner: NodeItem[] = []
  private nodes: Item[] = []
  private metaLinks: Link<GraphItem, Hub>[] = []
  private semLinks: SemLink[] = []
  private containLinks: Link<NodeItem, GraphItem>[] = []
  private innerLinks: Link<NodeItem, NodeItem>[] = []
  private flowLinks: FlowLink[] = []
  private sim: Simulation<Item, undefined> | null = null

  months: Months | null = null
  private cum = [0]
  dated = false
  N = 0
  k = 0
  skeleton = true
  detailOn = false
  playing = false
  speed = 8
  showMeta = true
  showSem = true
  // The pulse layer: saved changes in the last week per graph id (lib/pulse.ts), and how it is shown.
  pulseMode: PulseMode = 'off'
  pulse: Map<string, number> = new Map()
  setPulseMode(mode: PulseMode) {
    this.pulseMode = mode
  }
  // The same map may be filled in afterwards: it is read again on every frame.
  setPulse(counts: Map<string, number>) {
    this.pulse = counts
  }
  // The nodes a text search found, by graph id: ringed on the map. null: no search is on.
  private found: Map<string, Set<string>> | null = null
  setFound(found: Map<string, Set<string>> | null) {
    this.found = found
  }
  // Each changed graph's current version number, for the Version mode. Filled in like the counts.
  private pulseVersions: Map<string, number> = new Map()
  setPulseVersions(versions: Map<string, number>) {
    this.pulseVersions = versions
  }

  selected: Item | null = null
  private near: Set<Item> | null = null
  private fitToken = 0
  viewSet = false

  private raf = 0
  private lastFrame = 0
  private lastKK = -1
  private swallowClick = false
  private pressT = 0
  private pressAt: { clientX: number; clientY: number } | null = null
  private cleanup: (() => void)[] = []
  // Course images by address: null while loading or when the address gave no picture.
  private pics = new Map<string, HTMLCanvasElement | null>()

  constructor(cv: HTMLCanvasElement, ev: EngineEvents) {
    this.cv = cv
    this.ctx = cv.getContext('2d')!
    this.ev = ev
    this.sel = select(cv)
    this.zoomer = d3zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.15, 48])
      .on('zoom', (e) => {
        if (e.sourceEvent) {
          this.fitToken++
          this.viewSet = true
          this.ev.onUserMove()
        }
        this.T = e.transform
        this.ev.onZoom(this.T.k / this.zoom0)
      })
      .on('end', (e) => {
        if (e.sourceEvent) this.saveFocus()
      })
    this.sel.call(this.zoomer).on('dblclick.zoom', null)
    this.resize()
    this.T = zoomIdentity.translate(this.W / 2, this.H / 2 - 30).scale(Math.max(0.35, Math.min(this.W, this.H) / 1050))
    this.zoom0 = this.T.k
    this.sel.call(this.zoomer.transform, this.T)
    this.wire()
    this.raf = requestAnimationFrame(this.frame)
  }

  destroy() {
    cancelAnimationFrame(this.raf)
    this.sim?.stop()
    this.sel.on('.zoom', null)
    this.cleanup.forEach((f) => f())
  }

  /* ---------- building the network ---------- */
  // seed: with no rows, draw the largest meta areas from SEED (before the first answer arrives).
  build(rows: Row[], detail: Record<string, KgGraph> | null, type: string, only: boolean, seed = true) {
    this.skeleton = !rows.length && seed
    this.detailOn = !!detail
    // Where everything stood before, so a refresh does not throw the picture around.
    const stood = new Map<string, { x: number; y: number }>()
    this.nodes.forEach((o) => {
      if (isFinite(o.x) && isFinite(o.y)) stood.set(o.id, { x: o.x, y: o.y })
    })
    // Growth runs by created date, oldest first. Without dates, the list order reversed.
    const list = rows
      .slice()
      .reverse()
      .map((g) => ({ g, t: when(g) }))
    this.dated = list.length > 0 && list.filter((x) => x.t).length >= list.length / 2
    if (this.dated) list.sort((a, b) => a.t - b.t)
    this.graphs = list.map(({ g, t }, i) => ({
      id: g.id,
      kind: 'g',
      title: g.title,
      n: g.n,
      status: g.status,
      tags: g.tags,
      live: g.live,
      types: g.types || [],
      world: g.world || '',
      order: i,
      t,
      r: Math.min(6, 1.8 + Math.sqrt(g.n) * 0.35),
      image: (g.types || []).includes(COURSE_TYPE) ? g.image || '' : '',
      header: g.header || '',
      color: g.tags.length ? colorOf(g.tags[0]) : LOOSE,
      sem: [],
      flowRows: 0,
      createdBy: g.createdBy,
      version: g.version,
      sharedVia: g.sharedVia,
      sharedMode: g.sharedMode,
      sharedWith: g.sharedWith,
      x: 0,
      y: 0,
    }))
    const graphs = this.graphs
    this.N = graphs.length
    this.cum = [0]
    graphs.forEach((g, i) => this.cum.push(this.cum[i] + (g.n || 0)))

    // Speed of growth: new graphs and new nodes per calendar month.
    this.months = null
    const withDate = graphs.filter((g) => g.t)
    if (this.dated && withDate.length) {
      const d0 = new Date(withDate[0].t)
      const dl = new Date(withDate[withDate.length - 1].t)
      const base = d0.getFullYear() * 12 + d0.getMonth()
      const count = dl.getFullYear() * 12 + dl.getMonth() - base + 1
      const gp = new Array(count).fill(0)
      const np = new Array(count).fill(0)
      withDate.forEach((g) => {
        const d = new Date(g.t)
        const ix = d.getFullYear() * 12 + d.getMonth() - base
        gp[ix]++
        np[ix] += g.n || 0
      })
      this.months = { base, n: count, gp, np, gmax: Math.max(1, ...gp), nmax: Math.max(1, ...np) }
    }

    const hubBy = new Map<string, Hub>()
    this.hubs = []
    const hub = (tag: string) => {
      let h = hubBy.get(tag)
      if (!h) {
        h = { id: tag, kind: 'h', tag, color: colorOf(tag), members: [], first: Infinity, vis: 0, seed: 0, x: 0, y: 0 }
        hubBy.set(tag, h)
        this.hubs.push(h)
      }
      return h
    }
    if (this.skeleton)
      SEED.forEach(([tag, n]) => {
        const h = hub(tag)
        h.seed = n
        h.first = -1
      })
    this.metaLinks = []
    graphs.forEach((g) =>
      g.tags.forEach((t) => {
        const h = hub(t)
        h.members.push(g)
        if (g.order < h.first) h.first = g.order
        this.metaLinks.push({ source: g, target: h })
      }),
    )

    // Semantic links: graphs sharing an uncommon title word (4+ letters, 2 to 10 graphs), chained by creation.
    const words = new Map<string, GraphItem[]>()
    graphs.forEach((g) => {
      const toks = g.title.toLowerCase().match(/[\p{L}]{4,}/gu) || []
      const seen = new Set<string>()
      toks.forEach((w) => {
        if (!STOP.has(w) && !seen.has(w)) {
          seen.add(w)
          if (!words.has(w)) words.set(w, [])
          words.get(w)!.push(g)
        }
      })
    })
    this.semLinks = []
    const pair = new Set<string>()
    words.forEach((wl, w) => {
      if (wl.length < 2 || wl.length > 10) return
      for (let i = 1; i < wl.length && this.semLinks.length < 3000; i++) {
        const a = wl[i - 1]
        const b = wl[i]
        const key = a.order + '-' + b.order
        if (pair.has(key)) continue
        pair.add(key)
        this.semLinks.push({ source: a, target: b, word: w })
        a.sem.push(b)
        b.sem.push(a)
      }
    })

    // Starting positions: meta areas over an oval, graphs next to their first meta area.
    this.hubs.forEach((h, i) => {
      const a = i * 2.39996
      const rad = 30 + Math.sqrt(i) * 26
      h.x = Math.cos(a) * rad * 1.35
      h.y = Math.sin(a) * rad
    })
    graphs.forEach((g) => {
      const h = g.tags.length ? hubBy.get(g.tags[0]) : null
      const a = (hash(g.id) % 628) / 100
      if (h) {
        g.x = h.x + Math.cos(a) * 20
        g.y = h.y + Math.sin(a) * 20
      } else {
        const rad = 380 + (hash(g.id) % 90)
        g.x = Math.cos(a) * rad * 1.35
        g.y = Math.sin(a) * rad
      }
    })

    // Inside the graphs: each node becomes a small dot tied to its graph.
    this.inner = []
    this.containLinks = []
    this.innerLinks = []
    this.flowLinks = []
    if (detail)
      graphs.forEach((g) => {
        const d = detail[g.id]
        if (!d) return
        const by = new Map<string, NodeItem>()
        g.r = g.image ? 9 : 5.5
        const nodesIn = only && type !== '*' ? d.nodes.filter((n) => (n.type || '') === type) : d.nodes
        nodesIn.forEach((n, i) => {
          const a = i * 2.39996
          const o: NodeItem = {
            id: g.id + '/' + n.id,
            nid: n.id,
            kind: 'n',
            label: nodeName(n.label),
            type: n.type || '',
            parent: g,
            order: g.order,
            r: 1.8,
            color: g.color,
            x: g.x + Math.cos(a) * (8 + i * 0.3),
            y: g.y + Math.sin(a) * (8 + i * 0.3),
            links: [],
            flow: null,
            // Task state lives in the node's own data (metadata.status).
            status: n.type === 'oppgave' ? statusKind(n.metadata?.status) : '',
          }
          by.set(n.id, o)
          this.inner.push(o)
        })
        // Flow steps, or else course steps, or else tasks, stand in a column beside the graph.
        let row = 0
        let stepNo = 0
        let head: NodeItem | null = null
        let column = flowOrder(d.nodes, d.edges)
        // Course steps are not tied to each other in the graph (a step's summary and transcript
        // stand between them), so the column's own order ties them: each to the one before it.
        let course = false
        if (!column.length) {
          column = courseOrder(d.nodes, d.edges)
          course = column.length > 0
        }
        if (!column.length) column = taskOrder(d.nodes, d.edges)
        let before: NodeItem | null = null
        column.forEach((id) => {
          const o = by.get(id)
          if (!o) return
          o.flow = { row: row++, num: o.type === 'flow-step' ? ++stepNo : 0 }
          o.r = 2.2
          if (!head) head = o
          if (course && before) this.flowLinks.push({ source: before, target: o })
          before = o
        })
        g.flowRows = row
        if (head) this.flowLinks.push({ source: g, target: head, stem: true })
        nodesIn.forEach((n) => {
          const o = by.get(n.id)!
          if (!o.flow) this.containLinks.push({ source: o, target: g })
        })
        d.edges.forEach((e) => {
          const a = by.get(e.source)
          const b = by.get(e.target)
          if (a && b && a !== b) {
            // In a course column the line between two steps is already drawn from the order.
            if (a.flow && b.flow) {
              if (!course) this.flowLinks.push({ source: a, target: b })
            } else this.innerLinks.push({ source: a, target: b })
            a.links.push(b)
            b.links.push(a)
          }
        })
      })

    this.nodes = [...this.hubs, ...graphs, ...this.inner]
    let kept = 0
    this.nodes.forEach((o) => {
      const was = stood.get(o.id)
      if (was) {
        o.x = was.x
        o.y = was.y
        kept++
      }
    })
    const calm = this.nodes.length > 0 && kept >= this.nodes.length * 0.8
    this.sim?.stop()
    const detailOn = this.detailOn
    this.sim = forceSimulation<Item>(this.nodes)
      .force('meta', forceLink<Item, Link>(this.metaLinks).distance(detailOn ? 90 : 26).strength(detailOn ? 0.12 : 0.45))
      .force('contain', forceLink<Item, Link>(this.containLinks).distance(16).strength(0.8))
      .force('inner', forceLink<Item, Link>(this.innerLinks).distance(12).strength(0.2))
      .force('sem', forceLink<Item, Link>(this.semLinks).distance(70).strength(0.04))
      .force(
        'charge',
        forceManyBody<Item>()
          .strength((d) => (d.kind === 'h' ? -140 : d.kind === 'n' ? -7 : detailOn ? -90 : -9))
          .distanceMax(420),
      )
      .force('x', forceX<Item>(0).strength(0.022))
      .force('y', forceY<Item>(0).strength(0.042))
      .force('collide', forceCollide<Item>((d) => (d.kind === 'h' ? this.hubR(d, true) + 2 : d.r + 1)).iterations(1))
      .alphaDecay(0.018)
      .stop()
    if (calm) this.sim.alpha(0.12)
    if (this.reduced) for (let i = 0; i < (calm ? 40 : 220); i++) this.sim.tick()
    else this.sim.restart()
    this.selected = null
    this.near = null
    this.ev.onSelect(null)
    this.lastKK = -1
    this.setK(this.N)
  }

  // Task state lives in each task node's own data (metadata.status), which the node index does
  // not carry. Graphs with tasks are read whole afterwards and their tasks coloured here.
  graphsWithTasks(): string[] {
    const ids = new Set<string>()
    for (const o of this.inner) if (o.type === 'oppgave') ids.add(o.parent.id)
    return [...ids]
  }
  setTaskStatus(graphId: string, byNode: Record<string, unknown>) {
    for (const o of this.inner) if (o.type === 'oppgave' && o.parent.id === graphId) o.status = statusKind(byNode[o.nid])
  }

  /* ---------- time ---------- */
  setK(v: number) {
    this.k = Math.max(0, Math.min(this.N, v))
    const kk = Math.floor(this.k)
    this.hubs.forEach((h) => {
      if (this.skeleton) {
        h.vis = h.seed
        return
      }
      let c = 0
      for (const m of h.members) if (m.order < kk) c++
      h.vis = c
    })
    if (kk !== this.lastKK) {
      this.lastKK = kk
      this.emit()
    }
  }
  play(from: number) {
    if (!this.N) return
    if (this.k >= this.N) this.setK(from)
    this.playing = true
    this.emit()
  }
  pause() {
    if (!this.playing) return
    this.playing = false
    this.emit()
  }
  // The k at which the graphs created up to time t are shown.
  kAtTime(t: number) {
    let lo = 0
    let hi = this.N
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (this.graphs[mid].t <= t) lo = mid + 1
      else hi = mid
    }
    return lo
  }
  snapshot(): Snapshot {
    const kk = Math.floor(this.k)
    const cur = kk > 0 ? this.graphs[kk - 1] : null
    return {
      kk,
      N: this.N,
      skeleton: this.skeleton,
      dated: this.dated,
      hubCount: this.hubs.length,
      hubsShown: this.hubs.filter((h) => h.vis).length,
      nodesShown: this.cum[kk] || 0,
      nodesTotal: this.cum[this.N] || 0,
      cur: cur ? { title: cur.title, t: cur.t } : null,
      playing: this.playing,
    }
  }
  private emit() {
    this.ev.onSnapshot(this.snapshot())
  }

  /* ---------- view ---------- */
  resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1)
    this.W = this.cv.clientWidth
    this.H = this.cv.clientHeight
    this.cv.width = Math.round(this.W * this.dpr)
    this.cv.height = Math.round(this.H * this.dpr)
  }
  // Bring the shown graphs into view once they have found their places. Moving by hand cancels it.
  fitView() {
    const mine = ++this.fitToken
    setTimeout(
      () => {
        if (mine !== this.fitToken || !this.graphs.length) return
        this.viewSet = true
        let x0 = Infinity
        let y0 = Infinity
        let x1 = -Infinity
        let y1 = -Infinity
        for (const d of [...this.graphs, ...this.inner]) {
          if (!isFinite(d.x) || !isFinite(d.y)) continue
          if (d.x < x0) x0 = d.x
          if (d.x > x1) x1 = d.x
          if (d.y < y0) y0 = d.y
          if (d.y > y1) y1 = d.y
        }
        if (!isFinite(x0)) return
        // The controls cover the lower part of the screen, so the frame is the area above them.
        const low = Math.min(190, this.H * 0.3)
        const pad = 48
        const bw = Math.max(80, x1 - x0)
        const bh = Math.max(80, y1 - y0)
        const kf = Math.max(0.15, Math.min(10, Math.min((this.W - 2 * pad) / bw, (this.H - low - 2 * pad) / bh)))
        const t = zoomIdentity
          .translate(this.W / 2, (this.H - low) / 2)
          .scale(kf)
          .translate(-(x0 + x1) / 2, -(y0 + y1) / 2)
        if (this.reduced) this.sel.call(this.zoomer.transform, t)
        else this.sel.transition().duration(700).call(this.zoomer.transform, t)
      },
      this.reduced ? 0 : 1100,
    )
  }
  // Back to a remembered graph, at its place on the screen and zoom. False when that graph is not shown.
  restoreFocus(want: Focus, onMissing: () => void) {
    const mine = ++this.fitToken
    setTimeout(
      () => {
        if (mine !== this.fitToken) return
        const g = this.graphs.find((x) => x.id === want.id)
        if (!g || !isFinite(g.x)) {
          onMissing()
          this.fitView()
          return
        }
        const kz = Math.max(0.15, Math.min(48, (+want.z || 1) * this.zoom0))
        const t = zoomIdentity.translate((+want.fx || 0.5) * this.W - kz * g.x, (+want.fy || 0.5) * this.H - kz * g.y).scale(kz)
        this.viewSet = true
        this.sel.call(this.zoomer.transform, t)
      },
      this.reduced ? 0 : 900,
    )
  }
  // The graph nearest the middle of the screen, where it stands, and the zoom.
  private saveFocus() {
    if (!this.graphs.length || !this.W || !this.H) return
    let best: Focus | null = null
    let bd = Infinity
    for (const g of this.graphs) {
      if (g.order >= this.k || !isFinite(g.x)) continue
      const sx = this.T.applyX(g.x)
      const sy = this.T.applyY(g.y)
      const dd = (sx - this.W / 2) ** 2 + (sy - this.H / 2) ** 2
      if (dd < bd) {
        bd = dd
        best = { id: g.id, fx: sx / this.W, fy: sy / this.H, z: this.T.k / this.zoom0 }
      }
    }
    if (best) this.ev.onFocus(best)
  }

  /* ---------- selection ---------- */
  select(d: Item | null, byUser = false) {
    this.selected = d
    this.near = null
    if (d) {
      const near = new Set<Item>()
      if (d.kind === 'h') d.members.forEach((g) => near.add(g))
      else if (d.kind === 'n') {
        near.add(d.parent)
        d.links.forEach((o) => near.add(o))
      } else {
        this.inner.forEach((o) => {
          if (o.parent === d) near.add(o)
        })
        d.tags.forEach((t) => this.hubs.forEach((h) => h.tag === t && near.add(h)))
        d.sem.forEach((g) => near.add(g))
      }
      this.near = near
    }
    this.ev.onSelect(d, byUser)
  }
  // A tap pushes the neighbours outwards a little; the simulation lets them settle back.
  private nudge(d: Item | null) {
    if (!d || !this.sim || !this.near) return
    this.near.forEach((o) => {
      const dx = o.x - d.x
      const dy = o.y - d.y
      const dist = Math.sqrt(dx * dx + dy * dy) || 1
      const push = o.kind === 'h' ? 2.5 : 5
      o.vx = (o.vx || 0) + (dx / dist) * push
      o.vy = (o.vy || 0) + (dy / dist) * push
    })
    this.sim.alpha(Math.max(this.sim.alpha(), 0.22)).restart()
  }
  private pick(clientX: number, clientY: number): Item | null {
    const box = this.cv.getBoundingClientRect()
    const x = (clientX - box.left - this.T.x) / this.T.k
    const y = (clientY - box.top - this.T.y) / this.T.k
    const kk = Math.floor(this.k)
    let best: Item | null = null
    let bd = Infinity
    for (const d of this.nodes) {
      if (d.kind === 'h' ? !d.vis : d.order >= kk) continue
      const r = (d.kind === 'h' ? this.hubR(d, false) : d.r) + 8 / this.T.k
      const dist = (d.x - x) ** 2 + (d.y - y) ** 2
      if (dist < r * r && dist < bd) {
        bd = dist
        best = d
      }
    }
    return best
  }
  private graphOf(d: Item | null): GraphItem | null {
    return d ? (d.kind === 'g' ? d : d.kind === 'n' ? d.parent : null) : null
  }
  private openMenu(clientX: number, clientY: number) {
    const g = this.graphOf(this.pick(clientX, clientY))
    if (!g) return false
    this.ev.onContext(g, clientX, clientY)
    return true
  }
  private wire() {
    const cv = this.cv
    const on = <K extends keyof HTMLElementEventMap>(name: K, fn: (e: HTMLElementEventMap[K]) => void) => {
      cv.addEventListener(name, fn as EventListener)
      this.cleanup.push(() => cv.removeEventListener(name, fn as EventListener))
    }
    on('click', (e) => {
      if (this.swallowClick) {
        this.swallowClick = false
        return
      }
      const d = this.pick(e.clientX, e.clientY)
      this.select(d, true)
      this.nudge(d)
    })
    on('contextmenu', (e) => {
      e.preventDefault()
      this.openMenu(e.clientX, e.clientY)
    })
    // A long press on a touch screen opens the same menu.
    on('pointerdown', (e) => {
      clearTimeout(this.pressT)
      this.pressAt = null
      if (e.pointerType === 'mouse') return
      this.pressAt = { clientX: e.clientX, clientY: e.clientY }
      this.pressT = window.setTimeout(() => {
        if (this.pressAt && this.openMenu(this.pressAt.clientX, this.pressAt.clientY)) this.swallowClick = true
        this.pressAt = null
      }, 550)
    })
    on('pointermove', (e) => {
      if (this.pressAt && Math.abs(e.clientX - this.pressAt.clientX) + Math.abs(e.clientY - this.pressAt.clientY) > 12) {
        clearTimeout(this.pressT)
        this.pressAt = null
      }
    })
    const stop = () => {
      clearTimeout(this.pressT)
      this.pressAt = null
    }
    on('pointerup', stop)
    on('pointercancel', stop)
    on('pointerleave', stop)
    on('mousemove', (e) => {
      cv.style.cursor = this.pick(e.clientX, e.clientY) ? 'pointer' : ''
    })
    const onResize = () => this.resize()
    window.addEventListener('resize', onResize)
    this.cleanup.push(() => window.removeEventListener('resize', onResize))
    // The canvas also changes size without the window: the chat panel pushes it aside.
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(onResize)
      ro.observe(cv)
      this.cleanup.push(() => ro.disconnect())
    }
  }

  /* ---------- drawing ---------- */
  private frame = (now: number) => {
    const dt = Math.min(0.1, Math.max(0, (now - this.lastFrame) / 1000))
    this.lastFrame = now
    if (this.playing) {
      this.setK(this.k + this.speed * dt)
      if (this.k >= this.N) {
        this.playing = false
        this.emit()
      }
    }
    this.draw()
    this.raf = requestAnimationFrame(this.frame)
  }
  hubR(h: Hub, full: boolean) {
    const c = this.skeleton ? h.seed : full ? h.members.length : h.vis
    return 3 + Math.sqrt(c) * 2.1
  }
  // Labels keep about the same size on screen at any zoom.
  private fs(base: number) {
    return Math.min(base * 2.4, base * Math.max(1, Math.pow(this.T.k / this.zoom0, 0.45))) / this.T.k
  }
  // A course image, cut to a centred square and kept small. Fetched the first time the course is
  // at least 12 px wide on screen, once per address; until then, and if it fails, the square
  // stays in the graph's colour. Garnet never reads pixels back, so no CORS request is needed.
  private pic(url: string, px: number): HTMLCanvasElement | null {
    const got = this.pics.get(url)
    if (got !== undefined) return got
    if (px < 12) return null
    this.pics.set(url, null)
    const img = new Image()
    img.decoding = 'async'
    img.referrerPolicy = 'no-referrer'
    img.onload = () => {
      const side = Math.min(img.naturalWidth, img.naturalHeight)
      if (!side) return
      const c = document.createElement('canvas')
      c.width = c.height = PIC
      c.getContext('2d')!.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, PIC, PIC)
      this.pics.set(url, c)
    }
    img.src = url
    return null
  }
  private isNear(d: Item) {
    return !this.selected || d === this.selected || (this.near !== null && this.near.has(d))
  }
  private draw() {
    const { ctx, T, dpr, W, H } = this
    const kk = Math.floor(this.k)
    const now = performance.now()
    const sel = this.selected
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.globalAlpha = 1
    ctx.fillStyle = '#0b1220'
    ctx.fillRect(0, 0, W, H)
    ctx.setTransform(dpr * T.k, 0, 0, dpr * T.k, dpr * T.x, dpr * T.y)
    if (this.detailOn && this.flowLinks.length) {
      // Flow steps follow their graph: one row per step, wide enough apart for the labels.
      const close = T.k >= 3
      const gap = close ? Math.min(12, Math.max(4.5, this.fs(9) * 1.6)) : 4.5
      const off = close ? Math.min(30, Math.max(9, this.fs(10) * 6)) : 9
      for (const d of this.inner) {
        if (!d.flow) continue
        d.x = d.fx = d.parent.x + d.parent.r + off
        d.y = d.fy = d.parent.y + (d.flow.row - (d.parent.flowRows - 1) / 2) * gap
      }
    }
    ctx.lineWidth = 0.6 / Math.sqrt(T.k)
    const line = (a: Item, b: Item) => {
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
    }
    const touches = (l: Link) => l.source === sel || l.target === sel
    if (this.showSem) {
      ctx.strokeStyle = '#cfe0ff'
      for (const l of this.semLinks) {
        if (l.source.order >= kk || l.target.order >= kk) continue
        ctx.globalAlpha = sel ? (touches(l) ? 0.8 : 0.03) : 0.13
        line(l.source, l.target)
      }
    }
    if (this.showMeta) {
      for (const l of this.metaLinks) {
        if (l.source.order >= kk) continue
        ctx.strokeStyle = l.target.color
        ctx.globalAlpha = sel ? (touches(l) ? 0.85 : 0.03) : 0.22
        line(l.source, l.target)
      }
    }
    if (this.detailOn) {
      for (const l of this.containLinks) {
        if (l.source.order >= kk) continue
        ctx.strokeStyle = l.target.color
        ctx.globalAlpha = sel ? (touches(l) ? 0.8 : 0.04) : 0.28
        line(l.source, l.target)
      }
      ctx.strokeStyle = '#e8eef7'
      for (const l of this.innerLinks) {
        if (l.source.order >= kk) continue
        ctx.globalAlpha = sel ? (touches(l) ? 0.9 : 0.04) : 0.4
        line(l.source, l.target)
      }
      ctx.fillStyle = '#e8eef7'
      for (const l of this.flowLinks) {
        const tgt = l.target as GraphItem | NodeItem
        if (tgt.order >= kk) continue
        ctx.globalAlpha = sel ? (touches(l) ? 0.9 : 0.04) : 0.5
        line(l.source, l.target)
        if (!l.stem && T.k >= 3) {
          // Arrowhead at the step the edge points to.
          const ang = Math.atan2(tgt.y - l.source.y, tgt.x - l.source.x)
          const ah = Math.max(0.7, 5 / T.k)
          const hx = tgt.x - Math.cos(ang) * tgt.r
          const hy = tgt.y - Math.sin(ang) * tgt.r
          ctx.beginPath()
          ctx.moveTo(hx, hy)
          ctx.lineTo(hx - Math.cos(ang - 0.45) * ah, hy - Math.sin(ang - 0.45) * ah)
          ctx.lineTo(hx - Math.cos(ang + 0.45) * ah, hy - Math.sin(ang + 0.45) * ah)
          ctx.closePath()
          ctx.fill()
        }
      }
      for (const d of this.inner) {
        if (d.order >= kk) continue
        ctx.globalAlpha = this.isNear(d) ? 0.85 : 0.1
        ctx.fillStyle = (d.status && STATUS_COLOR[d.status]) || d.color
        // Flow and task column nodes are squares; every other node is a dot.
        if (d.flow) {
          ctx.fillRect(d.x - d.r, d.y - d.r, d.r * 2, d.r * 2)
          continue
        }
        ctx.beginPath()
        ctx.arc(d.x, d.y, d.r, 0, 6.2832)
        ctx.fill()
      }
      this.drawTypeIcons(kk)
      // A ring round each node that holds the searched text.
      if (this.found) {
        ctx.strokeStyle = '#ffd166'
        ctx.lineWidth = 1.6 / T.k
        for (const d of this.inner) {
          if (d.order >= kk || !this.found.get(d.parent.id)?.has(d.nid)) continue
          ctx.globalAlpha = this.isNear(d) ? 1 : 0.15
          ctx.beginPath()
          ctx.arc(d.x, d.y, d.r * (d.flow ? 1.45 : 1) + 2.2 / T.k, 0, 6.2832)
          ctx.stroke()
        }
      }
    }
    // With the pulse layer on, graphs without a change in the week step back. Not in Version
    // mode: there every graph carries its version number, changed in the week or not.
    const pulseOn = this.pulseMode !== 'off' && !this.skeleton && this.pulse.size > 0
    for (const d of this.graphs) {
      if (d.order >= kk) continue
      const age = kk - d.order
      const fresh = this.playing && age < 14
      ctx.globalAlpha = (this.isNear(d) ? 0.95 : 0.12) * (pulseOn && this.pulseMode !== 'count' && !this.pulse.has(d.id) ? 0.35 : 1)
      ctx.fillStyle = fresh ? '#ffffff' : d.color
      const r = d.r + (fresh ? (14 - age) * 0.35 : 0)
      if (d.image) {
        // A course: a square in the graph's colour, its card image inside once it has loaded.
        ctx.fillRect(d.x - r, d.y - r, r * 2, r * 2)
        const pic = this.pic(d.image, r * 2 * T.k)
        if (pic) {
          const edge = r * 0.08
          ctx.drawImage(pic, d.x - r + edge, d.y - r + edge, (r - edge) * 2, (r - edge) * 2)
        }
        continue
      }
      ctx.beginPath()
      ctx.arc(d.x, d.y, r, 0, 6.2832)
      ctx.fill()
      const z = T.k / this.zoom0
      if (d.header && z > HEADER_FROM_Z && !fresh) {
        // Zoomed in: the header image fills the circle, inside a rim of the graph's colour.
        const pic = this.pic(d.header, Math.max(12, r * 2 * T.k))
        if (pic) {
          const inner = r * 0.92
          const a = ctx.globalAlpha
          ctx.save()
          ctx.globalAlpha = a * Math.min(1, ((z - HEADER_FROM_Z) / (HEADER_95_Z - HEADER_FROM_Z)) * 0.95)
          ctx.beginPath()
          ctx.arc(d.x, d.y, inner, 0, 6.2832)
          ctx.clip()
          ctx.drawImage(pic, d.x - inner, d.y - inner, inner * 2, inner * 2)
          ctx.restore()
          ctx.globalAlpha = a
        }
      }
    }
    if (pulseOn) this.drawPulse(kk, now)
    this.hubs.forEach((d, i) => {
      if (!d.vis) return
      const r = this.hubR(d, false)
      const breath = this.reduced ? 0 : Math.sin(now / 1400 + i) * 0.6
      ctx.globalAlpha = this.isNear(d) ? 0.2 : 0.04
      ctx.fillStyle = d.color
      ctx.beginPath()
      ctx.arc(d.x, d.y, r * 1.9 + breath, 0, 6.2832)
      ctx.fill()
      ctx.globalAlpha = this.isNear(d) ? 1 : 0.15
      ctx.beginPath()
      ctx.arc(d.x, d.y, r, 0, 6.2832)
      ctx.fill()
    })
    const min = T.k < 0.7 ? 12 : T.k < 1.2 ? 6 : T.k < 2.2 ? 3 : 1
    ctx.font = '500 ' + this.fs(11) + "px 'IBM Plex Sans',system-ui,sans-serif"
    ctx.textAlign = 'center'
    ctx.fillStyle = '#e8eef7'
    for (const d of this.hubs) {
      if (!d.vis || (d.vis < min && d !== sel)) continue
      ctx.globalAlpha = this.isNear(d) ? 0.92 : 0.1
      ctx.fillText(d.tag, d.x, d.y - this.hubR(d, false) - 4 / T.k)
    }
    if (this.detailOn && T.k >= 0.8) {
      // Graph titles, and node labels once zoomed in close.
      ctx.fillStyle = '#8fa0b8'
      ctx.font = this.fs(10) + "px 'IBM Plex Sans',system-ui,sans-serif"
      for (const d of this.graphs) {
        if (d.order >= kk) continue
        ctx.globalAlpha = this.isNear(d) ? 0.9 : 0.08
        ctx.fillText(d.title.length > 30 ? d.title.slice(0, 29) + '…' : d.title, d.x, d.y + d.r + this.fs(10) * 1.1)
      }
      if (T.k >= 3) {
        ctx.font = this.fs(9) + "px 'IBM Plex Sans',system-ui,sans-serif"
        const spread = T.k / this.zoom0 >= SPREAD_K
        const todo: NodeItem[] = []
        for (const d of this.inner) {
          if (d.order >= kk) continue
          if (spread && !d.flow) {
            todo.push(d)
            continue
          }
          ctx.globalAlpha = this.isNear(d) ? (d.flow ? 0.92 : 0.75) : 0.06
          if (d.flow) {
            // Flow steps: numbered, to the right of the square, one line each.
            ctx.textAlign = 'left'
            ctx.fillText(this.flowText(d), d.x + d.r + 4 / T.k, d.y + this.fs(9) * 0.35)
            ctx.textAlign = 'center'
          } else ctx.fillText(d.label.length > 24 ? d.label.slice(0, 23) + '…' : d.label, d.x, d.y - d.r - 3 / T.k)
        }
        if (todo.length) this.spreadLabels(todo, kk)
      }
    }
    if (this.pulseMode === 'count' && !this.skeleton) this.drawPulseCounts(kk)
    ctx.globalAlpha = 1
  }
  // How far out from a graph's centre its pulse ring stands. A course is a square: the ring goes round its corners.
  private pulseR(d: GraphItem) {
    return (d.image ? d.r * 1.42 : d.r) + 2.5 / this.T.k
  }
  // A ring round every graph that was changed in the week. Colour: the ring's colour is the count.
  // Count: one colour, the number is written beside it. Beat: one colour, a faster beat for more.
  // A node's type as an icon inside its dot or square, once the node is large enough on the
  // screen to hold one. Further out, the dots stay plain.
  private drawTypeIcons(kk: number) {
    const { ctx, T, W, H } = this
    if (!this.inner.length) return
    ctx.strokeStyle = '#0b1220'
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (const d of this.inner) {
      if (d.order >= kk) continue
      const px = d.r * T.k
      if (px < ICON_MIN_PX) continue
      const sx = d.x * T.k + T.x
      const sy = d.y * T.k + T.y
      if (sx < -px || sy < -px || sx > W + px || sy > H + px) continue // outside the window
      const icon = typeIcon(d.type)
      if (!icon) continue
      const s = (d.r * ICON_FILL * 2) / 24
      ctx.globalAlpha = this.isNear(d) ? 0.9 : 0.12
      ctx.save()
      ctx.translate(d.x - 12 * s, d.y - 12 * s)
      ctx.scale(s, s)
      ctx.lineWidth = 2.2
      ctx.stroke(icon)
      ctx.restore()
    }
  }
  private drawPulse(kk: number, now: number) {
    const { ctx, T } = this
    const px = 1 / T.k
    const beating = this.pulseMode === 'beat' && !this.reduced
    ctx.lineWidth = 2 * px
    for (const d of this.graphs) {
      if (d.order >= kk) continue
      const n = this.pulse.get(d.id)
      if (!n) continue
      if (this.pulseMode === 'ripple') {
        this.drawRipple(d, n, now)
        continue
      }
      // Reduced motion: the beat is not animated, so the colour carries the count instead.
      const color = this.pulseMode === 'color' || (this.pulseMode === 'beat' && this.reduced) ? pulseColor(n) : PULSE_PLAIN
      const e = beating ? beat(now, n, (hash(d.id) % 1000) / 1000) : 1
      const a = (this.isNear(d) ? 0.95 : 0.12) * (beating ? 0.3 + 0.7 * e : 1)
      const rr = this.pulseR(d) + (beating ? e * 5 * px : 0)
      ctx.beginPath()
      ctx.arc(d.x, d.y, rr, 0, 6.2832)
      // A soft fill so the ring is found from far out, then the ring itself.
      ctx.globalAlpha = a * 0.18
      ctx.fillStyle = color
      ctx.fill()
      ctx.globalAlpha = a
      ctx.strokeStyle = color
      ctx.stroke()
    }
  }
  // Rings in water: n rings travel out from the graph and fade, so 12 changes is twelve rings at once.
  private drawRipple(d: GraphItem, n: number, now: number) {
    const { ctx, T } = this
    const px = 1 / T.k
    const r0 = this.pulseR(d)
    const span = rippleSpan(n) * px
    const near = this.isNear(d) ? 0.95 : 0.12
    const color = pulseColor(n)
    ctx.strokeStyle = color
    ctx.lineWidth = 1.5 * px
    // The graph's own ring stays, so a changed graph is found even between waves.
    ctx.globalAlpha = near
    ctx.beginPath()
    ctx.arc(d.x, d.y, r0, 0, 6.2832)
    ctx.stroke()
    for (const p of ripples(now, n, (hash(d.id) % 1000) / 1000, this.reduced)) {
      const still = this.reduced
      ctx.globalAlpha = near * (still ? 0.75 - 0.5 * p : (1 - p) * Math.min(1, p * 8))
      ctx.beginPath()
      ctx.arc(d.x, d.y, r0 + (still ? (p + 1 / Math.max(1, n)) : p) * span, 0, 6.2832)
      ctx.stroke()
    }
  }
  // Version mode: "V. n" beside every graph that has a version number, changed in the week or
  // not. The number comes with the index (Row.version); for a graph whose history has been read
  // the history's number is used. Far out only the graphs with the highest numbers are labelled.
  private drawPulseCounts(kk: number) {
    const { ctx, T } = this
    const least = T.k < 0.7 ? 50 : T.k < 1.2 ? 20 : T.k < 2.2 ? 5 : 1
    const size = this.fs(10)
    ctx.font = '600 ' + size + "px 'IBM Plex Sans',system-ui,sans-serif"
    ctx.textAlign = 'left'
    ctx.lineJoin = 'round'
    ctx.lineWidth = 3 / T.k
    ctx.strokeStyle = '#0b1220'
    ctx.fillStyle = '#e8eef7'
    for (const d of this.graphs) {
      if (d.order >= kk) continue
      const v = this.pulseVersions.get(d.id) ?? d.version
      if (v == null || (v < least && d !== this.selected)) continue
      const rr = this.pulseR(d)
      const x = d.x + rr * 0.8
      const y = d.y - rr * 0.8
      ctx.globalAlpha = this.isNear(d) ? 1 : 0.12
      ctx.strokeText(versionText(v), x, y)
      ctx.fillText(versionText(v), x, y)
    }
    ctx.textAlign = 'center'
  }
  private flowText(d: NodeItem) {
    const lab = d.label.length > 44 ? d.label.slice(0, 43) + '…' : d.label
    return (d.flow?.num ? d.flow.num + '. ' : d.status === 'done' ? '✓ ' : '') + lab
  }
  // Each name goes where it is free: above, right, left, below. When all four are taken it moves
  // outward, away from its graph, with a thin line back to the node. No free place: left out.
  private spreadLabels(list: NodeItem[], kk: number) {
    const { ctx, T } = this
    const h = this.fs(9)
    const gap = 3 / T.k
    const pad = 1.5 / T.k
    const reach = 140 / T.k
    const boxes: [number, number, number, number][] = []
    const vx0 = -T.x / T.k - reach
    const vy0 = -T.y / T.k - reach
    const vx1 = (this.W - T.x) / T.k + reach
    const vy1 = (this.H - T.y) / T.k + reach
    const seen = (n: Item) => n.x > vx0 && n.x < vx1 && n.y > vy0 && n.y < vy1
    const free = (a: number, b: number, c: number, e: number) => {
      for (const o of boxes) if (a < o[2] && c > o[0] && b < o[3] && e > o[1]) return false
      return true
    }
    const short = (t: string, n: number) => (t.length > n ? t.slice(0, n - 1) + '…' : t)
    for (const d of this.graphs) {
      if (d.order >= kk || !seen(d)) continue
      boxes.push([d.x - d.r, d.y - d.r, d.x + d.r, d.y + d.r])
      const tw = (ctx.measureText(short(d.title, 30)).width * 10) / 9
      boxes.push([d.x - tw / 2, d.y + d.r + this.fs(10) * 0.2, d.x + tw / 2, d.y + d.r + this.fs(10) * 1.35])
    }
    for (const d of this.inner) {
      if (d.order >= kk || !seen(d)) continue
      boxes.push([d.x - d.r, d.y - d.r, d.x + d.r, d.y + d.r])
      if (d.flow) boxes.push([d.x + d.r + 4 / T.k, d.y - h / 2, d.x + d.r + 4 / T.k + ctx.measureText(this.flowText(d)).width, d.y + h / 2])
    }
    // With something selected, its own names get the first pick of places.
    list = list.filter(seen)
    if (this.selected) list.sort((a, b) => (this.isNear(b) ? 1 : 0) - (this.isNear(a) ? 1 : 0))
    ctx.textAlign = 'left'
    ctx.lineWidth = 0.8 / T.k
    ctx.strokeStyle = '#9fb0c8'
    for (const d of list) {
      const text = short(d.label, 28)
      const w = ctx.measureText(text).width
      let put: [number, number] | null = null
      let lead: [number, number] | null = null
      const tries: [number, number][] = [
        [d.x - w / 2, d.y - d.r - gap - h],
        [d.x + d.r + gap, d.y - h / 2],
        [d.x - d.r - gap - w, d.y - h / 2],
        [d.x - w / 2, d.y + d.r + gap],
      ]
      for (let j = 0; j < 4 && !put; j++) if (free(tries[j][0] - pad, tries[j][1] - pad, tries[j][0] + w + pad, tries[j][1] + h + pad)) put = tries[j]
      let ux = d.x - d.parent.x
      let uy = d.y - d.parent.y
      const ul = Math.hypot(ux, uy)
      if (ul < 1e-6) {
        ux = 0
        uy = -1
      } else {
        ux /= ul
        uy /= ul
      }
      for (let j = 1; j <= 9 && !put; j++) {
        const ax = d.x + ux * (d.r + gap + j * h * 1.4)
        const ay = d.y + uy * (d.r + gap + j * h * 1.4)
        const bx = ux > 0.3 ? ax + gap : ux < -0.3 ? ax - gap - w : ax - w / 2
        const by = uy > 0.3 ? ay : uy < -0.3 ? ay - h : ay - h / 2
        if (free(bx - pad, by - pad, bx + w + pad, by + h + pad)) {
          put = [bx, by]
          lead = [ax, ay]
        }
      }
      if (!put) continue
      boxes.push([put[0] - pad, put[1] - pad, put[0] + w + pad, put[1] + h + pad])
      const a = this.isNear(d) ? 0.75 : 0.06
      if (lead) {
        ctx.globalAlpha = a * 0.55
        ctx.beginPath()
        ctx.moveTo(d.x + ux * d.r, d.y + uy * d.r)
        ctx.lineTo(lead[0], lead[1])
        ctx.stroke()
      }
      ctx.globalAlpha = a
      ctx.fillText(text, put[0], put[1] + h * 0.82)
    }
    ctx.textAlign = 'center'
  }
}
