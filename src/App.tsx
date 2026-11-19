import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { clearUser, completeMagicLink, isSuperadmin, magicInUrl, readUser } from './api/auth'
import { clearCaches, deleteGraph, loadGraph, loadIndex, loadNodes, moveGraphToWorld, renameGraph, restoreGraph, searchText } from './api/kg'
import type { McpError } from './api/mcp'
import { Brand } from './components/Brand'
import { BulkTag } from './components/BulkTag'
import { Card } from './components/Card'
import { ChatPanel } from './components/ChatPanel'
import { ContextMenu } from './components/ContextMenu'
import { Dialog, type DialogSpec } from './components/Dialog'
import { Dock } from './components/Dock'
import { Login } from './components/Login'
import { applyRules, nodeView, readRules, RULES_GRAPH_ID } from './lib/viewRules'
import { PulseBar } from './components/PulseBar'
import { SearchBar, type Found } from './components/SearchBar'
import { ImpersonationBar, isImpersonating, returnToOwnLogin } from './components/ImpersonationBar'
import { readLang, T } from './lib/lang'
import { RateChart } from './components/RateChart'
import { TagPanel } from './components/TagPanel'
import { isFlowGraph } from './lib/flow'
import { kOf, mapState, viewContext, viewLine, type MapState } from './lib/chatContext'
import { PULSE_MODES, type PulseMode } from './lib/pulse'
import { usePulse } from './lib/usePulse'
// React Flow is loaded only when a flow is opened.
const FlowPanel = lazy(() => import('./components/FlowPanel'))
const DiagramModal = lazy(() => import('./components/DiagramModal'))
const NodePreview = lazy(() => import('./components/NodePreview'))
import { Engine, type Focus, type GraphItem, type Item, type Snapshot } from './engine/Engine'
import {
  DEFAULT_FILTERS,
  monthOf,
  SHARED,
  parseTags,
  shownRows,
  sinceOptions,
  stamp,
  tagCounts,
  typeList,
  worldOptions,
  worldRows,
  yearOf,
  yearOptions,
  type Option,
} from './lib/rows'
import type { Filters, Row, Scope, User } from './lib/types'

/* ---------- a chat question's view, set back on the map ---------- */
// After each build: the time slider to the saved cut and the clicked item, found again by id.
// `last`: no second build (with the nodes) follows, so the wish is done.
function placeRestore(engine: Engine, want: { current: MapState | null }, shown: Row[], last: boolean) {
  const r = want.current
  if (!r) return
  if (r.until) engine.setK(kOf(shown, r.until))
  const s = r.sel
  const item: Item | undefined = !s
    ? undefined
    : s.kind === 'g'
      ? engine.graphs.find((g) => g.id === s.id)
      : s.kind === 'n'
        ? engine.inner.find((o) => o.nid === s.nid && o.parent.id === s.graph)
        : engine.hubs.find((h) => h.tag === s.tag)
  if (item || last) engine.select(item || null)
  if (item && r.zoom) {
    if (!r.until) engine.setK(Infinity) // the whole time line, so a new graph is drawn
    engine.restoreFocus({ id: item.kind === 'n' ? item.parent.id : item.kind === 'g' ? item.id : '', fx: 0.6, fy: 0.45, z: 2.5 }, () => {})
  }
  if (last) want.current = null
}

/* ---------- what is kept in this browser ---------- */
const VIEW_KEY = 'garnet-view-v1'
const SCOPE_KEY = 'garnet-scope'
// The pulse layer's last choice (off, colour, version, beat or ripple), remembered in this browser.
const PULSE_KEY = 'garnet-pulse'
const NO_ROWS: Row[] = []
function readPulseMode(): PulseMode {
  try {
    const v = localStorage.getItem(PULSE_KEY)
    if (PULSE_MODES.some((m) => m.value === v)) return v as PulseMode
  } catch {
    /* storage blocked */
  }
  return 'off'
}

interface SavedView {
  f: Partial<Filters>
  focus: Focus | null
}
function readView(): SavedView | null {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) || 'null')
    return v && typeof v === 'object' ? v : null
  } catch {
    return null
  }
}
function storeView(v: SavedView) {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify(v))
  } catch {
    /* storage blocked */
  }
}
function rowsKey(scope: Scope, user: User | null) {
  return `garnet-rows-v1-${scope}-${user?.email || 'anon'}`
}
function readCache(scope: Scope, user: User | null): { at: number; rows: Row[] } | null {
  try {
    const c = JSON.parse(localStorage.getItem(rowsKey(scope, user)) || 'null')
    return c && Array.isArray(c.rows) && c.rows.length ? c : null
  } catch {
    return null
  }
}
// The Worlds the person can use, empty ones too, kept beside the rows.
function worldsKey(user: User | null) {
  return `garnet-worlds-v1-${user?.email || 'anon'}`
}
function readWorlds(user: User | null): string[] {
  try {
    const w = JSON.parse(localStorage.getItem(worldsKey(user)) || '[]')
    return Array.isArray(w) ? w.map(String) : []
  } catch {
    return []
  }
}
function writeWorlds(user: User | null, worlds: string[]) {
  try {
    localStorage.setItem(worldsKey(user), JSON.stringify(worlds))
  } catch {
    /* storage blocked */
  }
}
function writeCache(scope: Scope, user: User | null, rows: Row[]) {
  try {
    localStorage.setItem(rowsKey(scope, user), JSON.stringify({ at: Date.now(), rows }))
  } catch {
    /* storage full or blocked */
  }
}

// Filters that name something no longer in the list fall back to "any". The stored choice is
// kept, so it comes back when the graphs that carry it come back.
function reconcile(f: Filters, rows: Row[], worlds: string[]): Filters {
  if (!rows.length) return f
  const out = { ...f }
  if (out.world !== '*' && !worldOptions(rows, worlds).some((o) => o.value === out.world && o.value !== '*')) out.world = '*'
  const wr = worldRows(rows, out.world)
  const tags = new Set(wr.flatMap((r) => r.tags))
  out.tags = out.tags.filter((t) => tags.has(t))
  if (out.type !== '*' && !wr.some((r) => r.types.includes(out.type))) out.type = '*'
  const years = new Set(wr.map(yearOf).filter(Boolean).map(String))
  if (out.year !== '*' && !years.has(out.year)) out.year = '*'
  if (out.since !== '*' && !years.has(out.since)) out.since = '*'
  return out
}

// What went wrong, in words the person can act on.
function why(e: unknown): string {
  const err = e as McpError & { plain?: boolean }
  const msg = String(err?.message || '')
  if (err?.plain) return msg
  if (err?.status === 401) return 'Your login is no longer valid. Sign in again and try once more.'
  if (err?.code === 'INSUFFICIENT_SCOPE' || /INSUFFICIENT_SCOPE|graph:delete/.test(msg))
    return 'Your VEGR.AI connection is not allowed to do this. Deleting needs the "delete graphs" permission on your Claude connection to KG Manager.'
  if (err?.code === 'FORBIDDEN_GRAPH') return 'Only the person who created this graph (or a Superadmin) can do that.'
  if (err?.code === 'VERSION_CONFLICT') return 'The graph was changed a moment ago. Try again.'
  if (err?.code === 'GRAPH_NOT_FOUND' || err?.code === 'NOT_FOUND') return 'VEGR.AI could not find it. It may already be gone; press Refresh.'
  if (/live page/.test(msg)) return 'This graph serves a live page, so it was not deleted. Take the page down first.'
  return 'It did not work' + (msg ? ' (' + msg + ')' : '') + '.'
}
function plain(message: string) {
  return Object.assign(new Error(message), { plain: true })
}

const EMPTY: Snapshot = { kk: 0, N: 0, skeleton: true, dated: false, hubCount: 0, hubsShown: 0, nodesShown: 0, nodesTotal: 0, cur: null, playing: false }

// Signed in, or the Garnet sign-in page. A sign-in link brings the person back here with ?magic=.
export default function App() {
  const [user, setUser] = useState<User | null>(readUser)
  const [magic] = useState(magicInUrl)
  const [checking, setChecking] = useState(!!magic)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!magic) return
    completeMagicLink(magic)
      .then(setUser)
      .catch((e) => {
        setError(T[readLang()].badLink((e as Error).message))
        const u = new URL(window.location.href)
        u.searchParams.delete('magic')
        window.history.replaceState({}, '', u.toString())
      })
      .finally(() => setChecking(false))
  }, [magic])
  if (checking)
    return (
      <main className="login">
        <p className="loginLead">{T[readLang()].signingIn}</p>
      </main>
    )
  if (!user) return <Login error={error} />
  return (
    <Garnet
      user={user}
      onSignOut={() => {
        // Signing out while logged in as someone else returns to the real login first, then signs that out.
        returnToOwnLogin()
        clearUser()
        clearCaches()
        setUser(null)
      }}
    />
  )
}

function Garnet({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  const cvRef = useRef<HTMLCanvasElement>(null)
  const [engine, setEngine] = useState<Engine | null>(null)
  const [scope, setScope] = useState<Scope>(() => {
    try {
      return localStorage.getItem(SCOPE_KEY) === 'all' ? 'all' : 'mine'
    } catch {
      return 'mine'
    }
  })
  const saved = useRef<SavedView | null>(readView())
  const focusWant = useRef<Focus | null>(saved.current?.focus || null)
  const [filters, setFilters] = useState<Filters>(() => ({ ...DEFAULT_FILTERS, ...(saved.current?.f || {}) }))
  const [rows, setRows] = useState<Row[]>([])
  const [loaded, setLoaded] = useState(false)
  const keep = useRef(true) // The next render follows a new read of the graphs, not a filter changed by hand.
  const restoreWant = useRef<MapState | null>(null) // a chat question's view, waiting for the map to draw it
  const [freshness, setFreshness] = useState('')
  const [progress, setProgress] = useState('')
  const [note, setNote] = useState('')
  const [nodeNote, setNodeNote] = useState('')
  const [snap, setSnap] = useState<Snapshot>(EMPTY)
  const [selected, setSelected] = useState<Item | null>(null)
  // The mermaid-diagram node shown in the whole window, if any.
  const [diagram, setDiagram] = useState<{ graphId: string; nodeId: string; title: string } | null>(null)
  const closeDiagram = useCallback(() => setDiagram(null), [])
  // The node shown in the panel at the right by its type's own renderer, if any (viewRules.ts).
  const [preview, setPreview] = useState<{ graphId: string; nodeId: string; world: string; title: string; type: string; full: boolean } | null>(null)
  const closePreview = useCallback(() => setPreview(null), [])
  const [, bump] = useState(0)
  const [zoomZ, setZoomZ] = useState(1)
  const [sw, setSw] = useState({ rate: true, meta: true, sem: true })
  const [pulseMode, setPulseMode] = useState<PulseMode>(readPulseMode)
  const [speed, setSpeed] = useState('8')
  const [from, setFrom] = useState('0')
  const [tagOpen, setTagOpen] = useState(false)
  const [menu, setMenu] = useState<{ g: GraphItem; x: number; y: number } | null>(null)
  const [dialog, setDialog] = useState<DialogSpec | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  // A graph with a flow node opens its flow in the right-hand panel when it, or one of its nodes, is
  // clicked. Closed by hand, it stays closed until something is clicked again.
  const [flowClosed, setFlowClosed] = useState<string | null>(null)
  // The chat on the left. Once opened it stays mounted, so closing it keeps the conversation.
  const [chat, setChat] = useState<'never' | 'open' | 'closed'>('never')
  // An open chat sits beside the map, not over it: the map, the head and the dock move right (index.css .chatside).
  useEffect(() => {
    const root = document.getElementById('root')
    root?.classList.toggle('chatside', chat === 'open')
    return () => root?.classList.remove('chatside')
  }, [chat])
  const flowGraph = selected?.kind === 'g' ? selected : selected?.kind === 'n' ? selected.parent : null
  const flowOf =
    flowGraph && isFlowGraph(flowGraph.types) && flowClosed !== flowGraph.id
      ? { graph: flowGraph, step: selected?.kind === 'n' ? selected.nid : null }
      : null

  const [worlds, setWorlds] = useState<string[]>(() => readWorlds(user))
  const eff = useMemo(() => reconcile(filters, rows, worlds), [filters, rows, worlds])
  const effRef = useRef(eff)
  effRef.current = eff
  // Where a clicked node of each type opens: read from the rules graph at start and after every
  // refresh (rows change, and Refresh has emptied the graph cache). Unreadable: the reserve in code.
  useEffect(() => {
    let live = true
    loadGraph(user, RULES_GRAPH_ID)
      .then((g) => {
        if (live) applyRules(readRules(g.nodes))
      })
      .catch(() => {
        if (live) applyRules(null)
      })
    return () => {
      live = false
    }
  }, [user, rows])

  /* ---------- text search of the map ---------- */
  // searchQ is the search that is on; found is the server's answer to it. The map then keeps only
  // the graphs that contain the text, on top of the filters.
  const [searchQ, setSearchQ] = useState('')
  const [found, setFound] = useState<Found | null>(null)
  const [searchBusy, setSearchBusy] = useState(false)
  const [searchErr, setSearchErr] = useState('')
  const foundRef = useRef(found)
  foundRef.current = found
  // The graphs the map shows: the filters' graphs, and of those the ones a search found.
  const shownFor = (rs: Row[], f: Filters): Row[] => {
    const base = shownRows(rs, f)
    const fd = foundRef.current
    return fd ? base.filter((r) => fd.ids.has(r.id)) : base
  }
  // The search field is offered once meta areas are chosen (architect 2026-11-18): it searches the
  // graphs on the map, and with nothing chosen that is the whole collection.
  const canSearch = eff.tags.length > 0
  useEffect(() => {
    if (!canSearch && searchQ) setSearchQ('')
  }, [canSearch, searchQ])
  // The graphs to search: what the filters show. A changed map is searched again.
  const searchIds = useMemo(() => (searchQ ? shownRows(rows, eff).map((r) => r.id).join(',') : ''), [searchQ, rows, eff])
  useEffect(() => {
    setSearchErr('')
    if (!searchQ) {
      setFound(null)
      setSearchBusy(false)
      return
    }
    const ids = searchIds ? searchIds.split(',') : []
    if (!ids.length) {
      setFound({ q: searchQ, ids: new Set(), nodes: new Map(), of: 0, partial: false, suggestions: [], suggestionNote: null })
      setSearchBusy(false)
      return
    }
    let stale = false
    setSearchBusy(true)
    searchText(user, scope, searchQ, ids)
      .then((a) => {
        if (stale) return
        const nodes = new Map<string, Set<string>>()
        for (const m of a.matched) nodes.set(m.graphId, new Set(m.nodeIds))
        setFound({ q: a.query, ids: new Set(a.matched.map((m) => m.graphId)), nodes, of: ids.length, partial: a.partial, suggestions: a.suggestions || [], suggestionNote: a.suggestionNote ?? null })
        setSearchBusy(false)
      })
      .catch((e) => {
        if (stale) return
        setFound(null)
        setSearchBusy(false)
        setSearchErr('The search did not go through: ' + ((e as Error)?.message || 'unknown error'))
      })
    return () => {
      stale = true
    }
  }, [searchQ, searchIds, user, scope])
  useEffect(() => {
    engine?.setFound(found ? found.nodes : null)
  }, [engine, found])

  // The graphs the map draws now, for the pulse layer (the drawing effect below works out its own).
  const pulseOn = pulseMode !== 'off'
  // eslint-disable-next-line react-hooks/exhaustive-deps -- shownFor reads found through a ref
  const shownNow = useMemo(() => (pulseOn ? shownFor(rows, eff) : NO_ROWS), [pulseOn, rows, eff, found])
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const userRef = useRef(user)
  userRef.current = user
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  const onSignOutRef = useRef(onSignOut)
  onSignOutRef.current = onSignOut

  /* ---------- the canvas ---------- */
  useEffect(() => {
    const e = new Engine(cvRef.current!, {
      onSnapshot: setSnap,
      onSelect: (d, byUser) => {
        setSelected(d)
        setFlowClosed(null)
        setMenu(null)
        // A clicked diagram node opens in the whole window; a restored view only selects it.
        const view = byUser && d?.kind === 'n' ? nodeView(d.type) : null
        // The whole window: a diagram in the diagram view (zoom and pan), any other type by its renderer.
        const asDiagram = view === 'full' && d?.kind === 'n' && d.type === 'mermaid-diagram'
        setDiagram(asDiagram && d?.kind === 'n' ? { graphId: d.parent.id, nodeId: d.nid, title: d.label } : null)
        // A clicked node of a type with a rule opens by its own renderer; any other choice closes it.
        setPreview(view && !asDiagram && d?.kind === 'n' ? { graphId: d.parent.id, nodeId: d.nid, world: d.parent.world, title: d.label, type: d.type, full: view === 'full' } : null)
      },
      onContext: (g, x, y) => setMenu({ g, x, y }),
      onZoom: setZoomZ,
      onFocus: (focus) => storeView({ f: effRef.current, focus }),
      onUserMove: () => (focusWant.current = null),
    })
    setEngine(e)
    if (import.meta.env.DEV) (window as unknown as { __garnet: Engine }).__garnet = e // for inspection while developing
    return () => e.destroy()
  }, [])
  useEffect(() => {
    if (!engine) return
    engine.showMeta = sw.meta
    engine.showSem = sw.sem
  }, [engine, sw])
  useEffect(() => {
    if (engine) engine.speed = +speed || 8
  }, [engine, speed])
  const pulse = usePulse(engine, user, shownNow, pulseMode)

  /* ---------- reading the graphs ---------- */
  const loadToken = useRef(0)
  const refresh = useCallback(async () => {
    const u = userRef.current
    const sc = scopeRef.current
    setNote('')
    clearCaches()
    const mine = ++loadToken.current
    const had = rowsRef.current.length > 0
    setRefreshing(true)
    if (!had) setProgress('Loading graphs from VEGR.AI…')
    try {
      const { rows: got, worlds: ws } = await loadIndex(u, sc)
      if (mine !== loadToken.current) return
      writeCache(sc, u, got)
      writeWorlds(u, ws)
      setWorlds(ws)
      setFreshness('read ' + stamp(Date.now()))
      keep.current = true
      setRows(got)
      setLoaded(true)
    } catch (e) {
      if (mine !== loadToken.current) return
      if ((e as McpError)?.status === 401) return onSignOutRef.current()
      const msg = (e as Error)?.message
      setNote('VEGR.AI could not be reached' + (msg ? ' (' + msg + ')' : '') + '. ' + (had ? 'Showing the copy saved in this browser.' : 'Showing only the largest meta areas from 13 Nov 2026.'))
    } finally {
      if (mine === loadToken.current) {
        setRefreshing(false)
        setProgress('')
      }
    }
  }, [])

  // On start, and whenever the scope or the signed-in person changes: the saved copy first, then the live list.
  useEffect(() => {
    const c = readCache(scope, user)
    keep.current = true
    if (c) {
      setRows(c.rows)
      setLoaded(true)
      setFreshness('saved ' + stamp(c.at))
    } else {
      setRows([])
      setLoaded(false)
      setFreshness('')
    }
    refresh()
  }, [scope, user, refresh])

  /* ---------- drawing what the filters choose ---------- */
  const renderToken = useRef(0)
  const effKey = JSON.stringify({ ...eff, find: '' })
  useEffect(() => {
    if (!engine) return
    const f = effRef.current
    const keepView = keep.current
    keep.current = false
    const mine = ++renderToken.current
    const ty = f.type === '*' ? '' : f.type
    setNodeNote('')
    const shown = shownFor(rows, f)
    engine.build(shown, null, f.type, f.only, !loaded)
    const wantNodes = !!(shown.length && (f.tags.length || ty))
    placeRestore(engine, restoreWant, shown, !wantNodes)
    if (!shown.length) return
    // Back to the remembered place, or keep the picture where it is, or frame the result.
    const settle = () => {
      if (keepView && focusWant.current) {
        engine.restoreFocus(focusWant.current, () => (focusWant.current = null))
        return
      }
      if (ty && !(keepView && engine.viewSet)) engine.fitView()
    }
    settle()
    if (!f.tags.length && !ty) return
    // One request per chosen meta area (a graph under two of them is fetched twice). With only a
    // node type chosen: one request for every graph that holds that type, in any meta area.
    setNodeNote('loading nodes…')
    const u = userRef.current
    const sc = scopeRef.current
    const asks = f.tags.length ? f.tags : ['']
    Promise.all(asks.map((tag) => loadNodes(u, sc, tag, ty)))
      .then((parts) => {
        if (mine !== renderToken.current) return
        const detail = Object.assign({}, ...parts)
        setNodeNote('')
        engine.build(shown, detail, f.type, f.only, !loaded)
        placeRestore(engine, restoreWant, shown, true)
        settle()
        // Task colours: read each graph with tasks once (kept for the session).
        for (const id of engine.graphsWithTasks())
          loadGraph(u, id)
            .then((g) => {
              if (mine !== renderToken.current) return
              const by: Record<string, unknown> = {}
              for (const n of g.nodes) if (n.metadata && n.metadata.status != null) by[n.id] = n.metadata.status
              engine.setTaskStatus(id, by)
            })
            .catch(() => {})
      })
      .catch((e) => {
        if (mine !== renderToken.current) return
        restoreWant.current = null
        setNodeNote('')
        const msg = (e as Error)?.message || 'unknown error'
        setNote(
          'The nodes inside the graphs could not be loaded (' + msg + '). ' +
            (/more than \d+ graphs/.test(msg) ? (f.tags.length ? 'This meta area has' : 'This node type is in') + ' more graphs than the node view can load at once' + (f.tags.length ? '.' : '; choose a meta area as well.') + ' ' : '') +
            'Showing the graphs only.',
        )
      })
  }, [engine, rows, loaded, effKey, found])

  /* ---------- a chat question's view, set back on the map ---------- */
  function restoreView(st: MapState) {
    engine?.pause()
    // A view to go back to has no text search in it; one that is on would hide graphs of that view.
    if (searchQ) setSearchQ('')
    const next: Filters = { ...DEFAULT_FILTERS, ...st.filters, find: '' }
    const same = st.scope === scope && JSON.stringify({ ...next, find: '' }) === effKey
    restoreWant.current = st
    keep.current = false
    focusWant.current = null
    storeView({ f: next, focus: null })
    if (st.scope !== scope) {
      try {
        localStorage.setItem(SCOPE_KEY, st.scope)
      } catch {
        /* storage blocked */
      }
      setScope(st.scope)
    }
    setFilters(next)
    // Nothing to redraw: set the slider and the click on what is there now.
    if (same && engine) placeRestore(engine, restoreWant, shownRows(rows, eff), true)
  }

  // Show on the map, for a graph a chat answer made or changed: kept in view if it is already
  // there, otherwise the filters show its World and its meta areas. Then it is selected and the map moves to it.
  function showGraph(id: string): boolean {
    const row = rows.find((r) => r.id === id)
    if (!row || !engine) return false
    const { find: _find, ...current } = eff
    void _find
    const visible = shownRows(rows, eff).some((r) => r.id === id)
    restoreView({
      scope,
      // Hidden by the filters: its World and its own meta areas, so the map shows the graph among its
      // own topics (architect's choice 2026-11-17), not the whole World.
      filters: visible ? current : { ...current, ...DEFAULT_FILTERS, world: row.world, tags: row.tags, only: current.only },
      sel: { kind: 'g', id },
      zoom: true,
    })
    return true
  }

  /* ---------- filters changed by hand ---------- */
  function changeFilters(p: Partial<Filters>) {
    engine?.pause()
    const next = { ...filters, ...p }
    // Choosing a node type shows only nodes of that type inside each graph; the box can still be unticked.
    if (p.type && p.type !== '*' && p.type !== filters.type && p.only === undefined) next.only = true
    keep.current = false
    focusWant.current = null
    storeView({ f: next, focus: null })
    setFilters(next)
  }
  const wr = useMemo(() => worldRows(rows, eff.world), [rows, eff.world])
  const types = useMemo(() => typeList(wr, eff.find), [wr, eff.find])
  // Typing narrows the list. When exactly one type is left, it is chosen.
  function onFind(text: string) {
    const names = typeList(wr, text).names
    if (names.length === 1 && text.trim() && eff.type !== names[0]) changeFilters({ find: text, type: names[0] })
    else {
      const next = { ...filters, find: text }
      storeView({ f: next, focus: focusWant.current })
      setFilters(next)
    }
  }
  const typeOptions: Option[] = useMemo(() => {
    const count = new Map(types.all)
    const q = eff.find.trim()
    const first: Option = {
      value: '*',
      label: types.all.length ? (q ? `Any (${types.names.length} of ${types.all.length} types match)` : 'Any') : 'Any (not loaded)',
    }
    // The chosen type stays in the list even when the text no longer matches it.
    const shown = q && eff.type !== '*' && count.has(eff.type) && !types.names.includes(eff.type) ? [eff.type, ...types.names] : types.names
    return [first, ...shown.map((t) => ({ value: t, label: `${t} (${count.get(t)})` }))]
  }, [types, eff.find, eff.type])
  const tags = useMemo(() => tagCounts(wr), [wr])
  const tagLabel = !eff.tags.length ? 'All' : eff.tags.length === 1 ? eff.tags[0] : eff.tags.length + ' chosen'

  // "Play from": the first graph, or the first graph of each later year.
  const fromOptions: Option[] = useMemo(() => {
    const out: Option[] = [{ value: '0', label: 'the first graph' }]
    if (!engine || !snap.dated) return out
    const seen = new Set<number>()
    for (const g of engine.graphs) {
      if (!g.t) continue
      const y = new Date(g.t).getFullYear()
      if (seen.has(y)) continue
      seen.add(y)
      if (g.order === 0) continue
      out.push({ value: String(y), label: String(y) })
    }
    return out
  }, [engine, snap.N, snap.dated, rows, effKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const fromValue = fromOptions.some((o) => o.value === from) ? from : '0'
  function fromK(v: string) {
    if (!engine || v === '0') return 0
    const g = engine.graphs.find((x) => x.t && String(new Date(x.t).getFullYear()) === v)
    return g ? g.order : 0
  }

  /* ---------- actions on a graph ---------- */
  function askRename(g: GraphItem) {
    setMenu(null)
    setDialog({
      title: 'Rename graph',
      text: `New title for “${g.title}”:`,
      input: g.title,
      ok: 'Rename',
      run: async (raw) => {
        const v = raw.trim()
        if (!v) throw plain('The title cannot be empty.')
        if (v !== g.title) {
          const row = rowsRef.current.find((r) => r.id === g.id)
          await renameGraph(user, g.id, v)
          g.title = v
          if (row) row.title = v
          writeCache(scope, user, rowsRef.current)
          bump((n) => n + 1)
        }
        setDialog(null)
      },
    })
  }
  // A graph moves into another World's own storage, from the shared storage or from the World it is in.
  // Id and links stay; the original goes to the trash of the store it came from for 30 days.
  function askMove(g: GraphItem) {
    setMenu(null)
    const here = g.world || SHARED
    setDialog({
      title: 'Move to World',
      text: `Move “${g.title}” from ${here} into the World’s own storage below? Its id, links and version history stay; the copy in ${here} goes to the trash there for 30 days.`,
      choices: worlds.filter((w) => w !== g.world).map((w) => ({ value: w, label: w })),
      ok: 'Move',
      run: async (to) => {
        if (!to) throw plain('Choose a World.')
        const world = await moveGraphToWorld(user, g.id, to)
        const next = rowsRef.current.map((r) => (r.id === g.id ? { ...r, world } : r))
        writeCache(scope, user, next)
        keep.current = true
        setRows(next)
        setDialog(null)
        setNote(`“${g.title}” is now in ${world}.`)
      },
    })
  }
  function askDelete(g: GraphItem) {
    setMenu(null)
    setDialog({
      title: 'Delete graph',
      text: `Delete “${g.title}” with its ${g.n || 0} nodes? It goes to the trash and can be brought back for 30 days. After that it is gone.`,
      ok: 'Delete',
      danger: true,
      run: async () => {
        await deleteGraph(user, g.id)
        const title = g.title
        if (selected && (selected === g || (selected.kind === 'n' && selected.parent === g))) engine?.select(null)
        const left = rowsRef.current.filter((r) => r.id !== g.id)
        writeCache(scope, user, left)
        keep.current = true
        setRows(left)
        setDialog({
          title: 'Deleted',
          text: `“${title}” is in the trash for 30 days.`,
          ok: 'Undo',
          cancel: 'Close',
          run: async () => {
            await restoreGraph(user, g.id)
            setDialog(null)
            refresh()
          },
        })
      },
    })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null)
    }
    const onDown = (e: PointerEvent) => {
      if (!(e.target as Element)?.closest?.('.ctx')) setMenu(null)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown)
    }
  }, [])

  /* ---------- what the head says ---------- */
  let stat: string
  if (progress && !rows.length) stat = progress
  else if (snap.skeleton) stat = `${snap.hubCount} largest meta areas · waiting for graphs`
  else if (!snap.N) stat = rows.length ? 'No graphs match these filters' : 'No graphs to show'
  else
    stat =
      (snap.dated && snap.cur?.t ? monthOf(snap.cur.t) + ' · ' : '') +
      `${snap.kk} of ${snap.N} graphs · ${snap.nodesShown.toLocaleString()} of ${snap.nodesTotal.toLocaleString()} nodes · ${snap.hubsShown} meta areas` +
      (nodeNote ? ' · ' + nodeNote : freshness ? ' · ' + freshness : '')

  return (
    <>
      <canvas ref={cvRef} className="net" aria-label="Network of knowledge graphs and meta areas" />

      <div className="head">
        <Brand />
        <div className="stat">{stat}</div>
        {canSearch && (
          <SearchBar active={searchQ} busy={searchBusy} found={found} error={searchErr} onSearch={setSearchQ} onClear={() => setSearchQ('')} />
        )}
        {sw.rate && <RateChart engine={engine} snap={snap} />}
        <PulseBar mode={pulseMode} sum={pulse} onShow={showGraph} />
        {note && (
          <div className="note">
            <span>{note}</span>{' '}
            <button className="ghost" type="button" onClick={() => setNote('')}>
              Close
            </button>{' '}
            <button className="ghost" type="button" onClick={() => refresh()}>
              Try again
            </button>
          </div>
        )}
      </div>

      <div className="authbar">
        <button className="ghost" type="button" aria-pressed={chat === 'open'} onClick={() => setChat(chat === 'open' ? 'closed' : 'open')}>
          Chat
        </button>
        {isImpersonating() ? (
          <ImpersonationBar user={user} />
        ) : (
          <>
            <ImpersonationBar user={user} />
            <span className="who" title={user.role || ''}>
              {user.email}
            </span>
            <button className="ghost" type="button" onClick={onSignOut}>
              Sign out
            </button>
          </>
        )}
      </div>


      {menu && (
        <ContextMenu
          graph={menu.g}
          x={menu.x}
          y={menu.y}
          onRename={() => askRename(menu.g)}
          onDelete={() => askDelete(menu.g)}
          onMove={isSuperadmin(user) && worlds.some((w) => w !== menu.g.world) ? () => askMove(menu.g) : undefined}
        />
      )}
      {dialog && <Dialog spec={dialog} why={why} onClose={() => setDialog(null)} />}
      {bulkOpen && (
        <BulkTag
          user={user}
          rows={shownFor(rows, eff)}
          tags={tags.map((t) => t[0])}
          why={why}
          onClose={() => setBulkOpen(false)}
          onChanged={(changes) => {
            // New meta areas from the server's answers: the picture and the saved copy follow.
            const by = new Map(changes.map((c) => [c.id, c.metaArea]))
            const next = rowsRef.current.map((r) => (by.has(r.id) ? { ...r, tags: parseTags(by.get(r.id)) } : r))
            writeCache(scope, user, next)
            keep.current = true
            setRows(next)
          }}
        />
      )}
      {chat !== 'never' && (
        <ChatPanel
          user={user}
          hidden={chat !== 'open'}
          graph={flowGraph ? { id: flowGraph.id, title: flowGraph.title } : null}
          view={() => {
            const v = { scope, filters: eff, shown: shownFor(rows, eff), kk: snap.kk, selected }
            return { text: viewContext(v), line: viewLine(v), state: mapState(v) }
          }}
          onRestore={restoreView}
          graphTitle={(id) => rows.find((r) => r.id === id)?.title || null}
          onShowGraph={showGraph}
          shownCount={snap.kk}
          onClose={() => setChat('closed')}
          onWrote={() => refresh()}
        />
      )}
      {flowOf && (
        <Suspense fallback={null}>
          <FlowPanel
            user={user}
            graphId={flowOf.graph.id}
            world={flowOf.graph.world}
            title={flowOf.graph.title}
            focus={flowOf.step}
            onClose={() => setFlowClosed(flowOf.graph.id)}
          />
        </Suspense>
      )}
      {diagram && (
        <Suspense fallback={null}>
          <DiagramModal user={user} graphId={diagram.graphId} nodeId={diagram.nodeId} title={diagram.title} onClose={closeDiagram} />
        </Suspense>
      )}
      {preview && (
        <Suspense fallback={null}>
          <NodePreview user={user} graphId={preview.graphId} nodeId={preview.nodeId} world={preview.world} title={preview.title} type={preview.type} full={preview.full} onClose={closePreview} />
        </Suspense>
      )}
      {tagOpen && (
        <TagPanel
          counts={tags}
          chosen={eff.tags}
          onCancel={() => setTagOpen(false)}
          onDone={(t) => {
            setTagOpen(false)
            setNote('')
            changeFilters({ tags: t })
          }}
        />
      )}

      <div className="bottom">
        <div className="above">
          <Card
            item={selected}
            user={user}
            N={snap.N}
            skeleton={snap.skeleton}
            scopeAll={scope === 'all'}
            onClose={() => engine?.select(null)}
            onDiagram={(n) => setDiagram({ graphId: n.parent.id, nodeId: n.nid, title: n.label })}
          />
          <div className="switches">
            <div className="switch static">Zoom {zoomZ < 10 ? zoomZ.toFixed(1) : Math.round(zoomZ)}×</div>
            <label className="switch">
              <input type="checkbox" checked={sw.rate} onChange={(e) => setSw({ ...sw, rate: e.target.checked })} /> Growth curve
            </label>
            <label className="switch">
              <input type="checkbox" checked={sw.meta} onChange={(e) => setSw({ ...sw, meta: e.target.checked })} /> Meta area links
            </label>
            <label className="switch">
              <input type="checkbox" checked={sw.sem} onChange={(e) => setSw({ ...sw, sem: e.target.checked })} /> Semantic links
            </label>
            <label className="switch" title="Rings on the graphs changed in the last 7 days, by how many saved changes each got">
              Pulse
              <select
                value={pulseMode}
                onChange={(e) => {
                  const m = e.target.value as PulseMode
                  try {
                    localStorage.setItem(PULSE_KEY, m)
                  } catch {
                    /* storage blocked */
                  }
                  setPulseMode(m)
                }}
              >
                {PULSE_MODES.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
        <Dock
          snap={snap}
          filters={eff}
          onFilter={changeFilters}
          onFind={onFind}
          scope={scope}
          onScope={(s) => {
            engine?.pause()
            try {
              localStorage.setItem(SCOPE_KEY, s)
            } catch {
              /* storage blocked */
            }
            setScope(s)
          }}
          speed={speed}
          onSpeed={setSpeed}
          from={fromValue}
          fromOptions={fromOptions}
          onFrom={(v) => {
            engine?.pause()
            setFrom(v)
            engine?.setK(fromK(v))
          }}
          worldOptions={worldOptions(rows, worlds)}
          yearOptions={yearOptions(wr)}
          sinceOptions={sinceOptions(wr)}
          typeOptions={typeOptions}
          tagLabel={tagLabel}
          onTags={() => setTagOpen(true)}
          onBulkTag={() => setBulkOpen(true)}
          onPlay={() => {
            if (!engine) return
            if (engine.playing) engine.pause()
            else engine.play(fromK(fromValue))
          }}
          onSlide={(v) => {
            engine?.pause()
            engine?.setK(v)
          }}
          onRefresh={() => refresh()}
          refreshing={refreshing}
        />
      </div>
    </>
  )
}
