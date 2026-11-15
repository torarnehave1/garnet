import type { KgGraph, Row, User } from '../lib/types'
import { parseTags } from '../lib/rows'

// Garnet asks https://knowledge.vegvisr.org directly, with the signed-in person's token.
export const KG = 'https://knowledge.vegvisr.org'

export class KgError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

function readHeaders(user: User | null): HeadersInit {
  const h: Record<string, string> = { Accept: 'application/json' }
  if (user?.token) h['X-API-Token'] = user.token
  return h
}
function writeHeaders(user: User): HeadersInit {
  if (!user.token) throw new KgError('Sign in to change graphs.', 401)
  return {
    'Content-Type': 'application/json',
    'X-API-Token': user.token,
    'X-Session-Token': user.token,
    'x-user-email': user.email,
    'x-user-role': user.role || 'User',
  }
}

async function json<T>(r: Response): Promise<T> {
  let body: unknown = null
  try {
    body = await r.json()
  } catch {
    /* no JSON body */
  }
  if (!r.ok) {
    const e = body && typeof body === 'object' ? (body as { error?: unknown }).error : undefined
    const msg = e ? String(e) : r.statusText
    throw new KgError(msg || 'HTTP ' + r.status, r.status)
  }
  return body as T
}

interface SummaryResult {
  id: string
  title?: string
  createdAt?: string
  updatedAt?: string
  nodeCount?: number
  nodeTypes?: string[]
  publishedDomains?: string[]
  world?: string
  metadata?: { metaArea?: string; publicationState?: string; createdBy?: string; version?: number }
}
interface SummaryPage {
  results: SummaryResult[]
  total: number
  hasMore?: boolean
}

function toRow(g: SummaryResult): Row {
  const m = g.metadata || {}
  return {
    id: g.id,
    title: g.title || '(untitled)',
    n: g.nodeCount || 0,
    status: m.publicationState || 'private',
    tags: parseTags(m.metaArea),
    live: (g.publishedDomains || []).join(', '),
    created: g.createdAt || '',
    updated: g.updatedAt || '',
    world: g.world || '',
    types: g.nodeTypes || [],
    createdBy: m.createdBy || '',
    version: typeof m.version === 'number' ? m.version : null,
  }
}

// Every graph the person can see, 250 a page. "Mine" is worked out here: the endpoint
// has no filter for the person's own graphs, so createdBy is compared with the email.
export async function loadSummaries(
  user: User | null,
  mine: boolean,
  onProgress: (n: number, total: number) => void,
): Promise<Row[]> {
  const out: Row[] = []
  const seen = new Set<string>()
  const step = 250
  let offset = 0
  let total = Infinity
  while (offset < total && offset < 20000) {
    const r = await fetch(`${KG}/getknowgraphsummaries?limit=${step}&offset=${offset}`, { headers: readHeaders(user) })
    const page = await json<SummaryPage>(r)
    if (typeof page.total === 'number') total = page.total
    const rows = page.results || []
    for (const g of rows) {
      if (!g || !g.id || seen.has(g.id)) continue
      seen.add(g.id)
      out.push(toRow(g))
    }
    offset += step
    onProgress(out.length, total)
    if (!rows.length || page.hasMore === false) break
  }
  if (!mine || !user) return out
  const me = user.email.toLowerCase()
  return out.filter((r) => r.createdBy.toLowerCase() === me)
}

// Whole graphs, kept for the session. Nodes, edges, task status and node text all come from here.
const graphCache = new Map<string, Promise<KgGraph>>()
export function clearGraphCache() {
  graphCache.clear()
}
export function loadGraph(user: User | null, id: string): Promise<KgGraph> {
  let p = graphCache.get(id)
  if (!p) {
    p = fetch(`${KG}/getknowgraph?id=${encodeURIComponent(id)}`, { headers: readHeaders(user) })
      .then((r) => json<KgGraph>(r))
      .then((g) => ({ metadata: g.metadata || {}, nodes: Array.isArray(g.nodes) ? g.nodes : [], edges: Array.isArray(g.edges) ? g.edges : [] }))
    p.catch(() => graphCache.delete(id))
    graphCache.set(id, p)
  }
  return p
}

// Several graphs at once, a few requests at a time. There is no endpoint that returns
// the nodes of many graphs in one request.
export async function loadGraphs(
  user: User | null,
  ids: string[],
  onProgress: (done: number, total: number) => void,
  isCurrent: () => boolean,
): Promise<Record<string, KgGraph>> {
  const out: Record<string, KgGraph> = {}
  let next = 0
  let done = 0
  let failed = 0
  async function worker() {
    while (next < ids.length && isCurrent()) {
      const id = ids[next++]
      try {
        out[id] = await loadGraph(user, id)
      } catch {
        failed++
      }
      done++
      onProgress(done, ids.length)
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker))
  if (failed && failed === ids.length) throw new Error('none of the graphs could be read')
  return out
}

export async function renameGraph(user: User, id: string, title: string, version: number | null): Promise<void> {
  let v = version
  if (v == null) v = Number((await loadGraph(user, id)).metadata?.version) || 0
  const r = await fetch(`${KG}/patchGraphMetadata`, {
    method: 'POST',
    headers: writeHeaders(user),
    body: JSON.stringify({ graphId: id, fields: { title }, expectedVersion: v }),
  })
  await json(r)
  graphCache.delete(id)
}

export async function deleteGraph(user: User, id: string): Promise<void> {
  const r = await fetch(`${KG}/deleteknowgraph`, { method: 'POST', headers: writeHeaders(user), body: JSON.stringify({ id }) })
  await json(r)
  graphCache.delete(id)
}

// /deleteknowgraph answers without the trash entry, so Undo finds it in /getTrash by graph id.
interface TrashEntry {
  id: string
  graph_id: string
  expires_at?: string
  deleted_at?: string
}
export async function findTrash(user: User, graphId: string): Promise<TrashEntry | null> {
  const r = await fetch(`${KG}/getTrash`, { headers: writeHeaders(user) })
  const body = await json<{ results?: TrashEntry[] }>(r)
  const hits = (body.results || []).filter((e) => e.graph_id === graphId)
  hits.sort((a, b) => String(b.deleted_at || '').localeCompare(String(a.deleted_at || '')))
  return hits[0] || null
}

export async function restoreGraph(user: User, graphId: string): Promise<void> {
  const entry = await findTrash(user, graphId)
  if (!entry) throw new KgError('The graph was not found in the trash.', 404)
  const r = await fetch(`${KG}/restoreGraph`, { method: 'POST', headers: writeHeaders(user), body: JSON.stringify({ trashId: entry.id }) })
  await json(r)
}
