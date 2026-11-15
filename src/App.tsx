import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AUTH_CHANGED, isSuperadmin, loadAuthScript, readUser } from './api/auth'
import { clearGraphCache, deleteGraph, KgError, loadGraphs, loadSummaries, renameGraph, restoreGraph } from './api/kg'
import { Brand } from './components/Brand'
import { Card } from './components/Card'
import { ContextMenu } from './components/ContextMenu'
import { Dialog, type DialogSpec } from './components/Dialog'
import { Dock } from './components/Dock'
import { RateChart } from './components/RateChart'
import { TagPanel } from './components/TagPanel'
import { Engine, type Focus, type GraphItem, type Item, type Snapshot } from './engine/Engine'
import {
  DEFAULT_FILTERS,
  monthOf,
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

/* ---------- what is kept in this browser ---------- */
const VIEW_KEY = 'garnet-view-v1'
const SCOPE_KEY = 'garnet-scope'
const NODE_LIMIT = 150 // The node view reads one graph per request; past this many, ask for a narrower filter.

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
function writeCache(scope: Scope, user: User | null, rows: Row[]) {
  try {
    localStorage.setItem(rowsKey(scope, user), JSON.stringify({ at: Date.now(), rows }))
  } catch {
    /* storage full or blocked */
  }
}

// Filters that name something no longer in the list fall back to "any". The stored choice is
// kept, so it comes back when the graphs that carry it come back.
function reconcile(f: Filters, rows: Row[]): Filters {
  if (!rows.length) return f
  const out = { ...f }
  if (out.world !== '*' && (worldOptions(rows).length < 2 || !rows.some((r) => (r.world || '') === out.world))) out.world = '*'
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
  const err = e as KgError & { plain?: boolean }
  const msg = String(err?.message || '')
  if (err?.plain) return msg
  if (err?.status === 403 && /graph:delete/.test(msg)) return 'Your login is not allowed to delete graphs.'
  if (err?.status === 403 && /graph:write/.test(msg)) return 'Your login is not allowed to change graphs.'
  if (err?.status === 401) return 'Your login has run out. Sign in again and try once more.'
  if (err?.status === 409 || /version/i.test(msg)) return 'The graph was changed a moment ago. Try again.'
  if (err?.status === 404) return 'VEGR.AI could not find it. It may already be gone; press Refresh.'
  if (/live page/.test(msg)) return 'This graph serves a live page, so it was not deleted. Take the page down first.'
  return 'It did not work' + (msg ? ' (' + msg + ')' : '') + '.'
}
function plain(message: string) {
  return Object.assign(new Error(message), { plain: true })
}

const EMPTY: Snapshot = { kk: 0, N: 0, skeleton: true, dated: false, hubCount: 0, hubsShown: 0, nodesShown: 0, nodesTotal: 0, cur: null, playing: false }

export default function App() {
  const cvRef = useRef<HTMLCanvasElement>(null)
  const [engine, setEngine] = useState<Engine | null>(null)
  const [user, setUser] = useState<User | null>(readUser)
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
  const [freshness, setFreshness] = useState('')
  const [progress, setProgress] = useState('')
  const [note, setNote] = useState('')
  const [nodeNote, setNodeNote] = useState('')
  const [snap, setSnap] = useState<Snapshot>(EMPTY)
  const [selected, setSelected] = useState<Item | null>(null)
  const [, bump] = useState(0)
  const [zoomZ, setZoomZ] = useState(1)
  const [sw, setSw] = useState({ rate: true, meta: true, sem: true })
  const [speed, setSpeed] = useState('8')
  const [from, setFrom] = useState('0')
  const [tagOpen, setTagOpen] = useState(false)
  const [menu, setMenu] = useState<{ g: GraphItem; x: number; y: number } | null>(null)
  const [dialog, setDialog] = useState<DialogSpec | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const eff = useMemo(() => reconcile(filters, rows), [filters, rows])
  const effRef = useRef(eff)
  effRef.current = eff
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const userRef = useRef(user)
  userRef.current = user
  const scopeRef = useRef(scope)
  scopeRef.current = scope

  /* ---------- the canvas ---------- */
  useEffect(() => {
    const e = new Engine(cvRef.current!, {
      onSnapshot: setSnap,
      onSelect: (d) => {
        setSelected(d)
        setMenu(null)
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

  /* ---------- the login ---------- */
  useEffect(() => {
    loadAuthScript().catch((e) => setNote(e.message))
    const update = () =>
      setUser((old) => {
        const u = readUser()
        return old && u && old.email === u.email && old.token === u.token && old.role === u.role ? old : u
      })
    window.addEventListener(AUTH_CHANGED, update)
    window.addEventListener('storage', update)
    return () => {
      window.removeEventListener(AUTH_CHANGED, update)
      window.removeEventListener('storage', update)
    }
  }, [])

  /* ---------- reading the graphs ---------- */
  const loadToken = useRef(0)
  const refresh = useCallback(async () => {
    const u = userRef.current
    const sc = scopeRef.current
    setNote('')
    clearGraphCache()
    const mine = ++loadToken.current
    const had = rowsRef.current.length > 0
    if (sc === 'mine' && !u) {
      keep.current = true
      setRows([])
      setLoaded(true)
      setFreshness('')
      setNote('Sign in with the bar at the top right to see your own graphs, or choose “Everything I can see” to see the published ones.')
      return
    }
    setRefreshing(true)
    try {
      const got = await loadSummaries(u, sc === 'mine', (n, total) => {
        if (mine === loadToken.current && !had) setProgress(`Loading graphs from VEGR.AI… ${n}${isFinite(total) ? ' of ' + total : ''}`)
      })
      if (mine !== loadToken.current) return
      writeCache(sc, u, got)
      setFreshness('read ' + stamp(Date.now()))
      keep.current = true
      setRows(got)
      setLoaded(true)
      if (!u) setNote('Not signed in: showing published graphs only. Sign in to see everything you can open.')
    } catch (e) {
      if (mine !== loadToken.current) return
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
    const shown = shownRows(rows, f)
    engine.build(shown, null, f.type, f.only, !loaded)
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
    if (shown.length > NODE_LIMIT) {
      setNote(`These filters leave ${shown.length} graphs. The nodes inside graphs are shown for at most ${NODE_LIMIT} at a time; choose a meta area or a narrower filter. Showing the graphs only.`)
      return
    }
    setNodeNote('loading nodes…')
    loadGraphs(
      userRef.current,
      shown.map((r) => r.id),
      (done, total) => mine === renderToken.current && setNodeNote(`loading nodes ${done} of ${total}`),
      () => mine === renderToken.current,
    )
      .then((detail) => {
        if (mine !== renderToken.current) return
        setNodeNote('')
        engine.build(shown, detail, f.type, f.only, !loaded)
        settle()
      })
      .catch((e) => {
        if (mine !== renderToken.current) return
        setNodeNote('')
        setNote('The nodes inside the graphs could not be loaded (' + ((e as Error)?.message || 'unknown error') + '). Showing the graphs only.')
      })
  }, [engine, rows, loaded, effKey])

  /* ---------- filters changed by hand ---------- */
  function changeFilters(p: Partial<Filters>) {
    engine?.pause()
    const next = { ...filters, ...p }
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
  function canChange(g: GraphItem) {
    return !!user?.token && (isSuperadmin(user) || g.createdBy.toLowerCase() === user.email.toLowerCase())
  }
  const changeReason = !user ? 'Sign in to rename or delete graphs.' : 'Only the person who created this graph can rename or delete it.'

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
          await renameGraph(user!, g.id, v, row?.version ?? null)
          g.title = v
          if (row) {
            row.title = v
            row.version = null // Read again before the next rename.
          }
          writeCache(scope, user, rowsRef.current)
          bump((n) => n + 1)
        }
        setDialog(null)
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
        await deleteGraph(user!, g.id)
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
            await restoreGraph(user!, g.id)
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
        {sw.rate && <RateChart engine={engine} snap={snap} />}
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
        <vegvisr-auth lang="en"></vegvisr-auth>
      </div>


      {menu && (
        <ContextMenu graph={menu.g} x={menu.x} y={menu.y} canChange={canChange(menu.g)} reason={changeReason} onRename={() => askRename(menu.g)} onDelete={() => askDelete(menu.g)} />
      )}
      {dialog && <Dialog spec={dialog} why={why} onClose={() => setDialog(null)} />}
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
          <Card item={selected} user={user} N={snap.N} skeleton={snap.skeleton} scopeAll={scope === 'all'} onClose={() => engine?.select(null)} />
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
          worldOptions={worldOptions(rows)}
          yearOptions={yearOptions(wr)}
          sinceOptions={sinceOptions(wr)}
          typeOptions={typeOptions}
          tagLabel={tagLabel}
          onTags={() => setTagOpen(true)}
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
