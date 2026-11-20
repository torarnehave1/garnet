import type { KgGraph, Row, Scope, ShareMode, User } from '../lib/types'
import { utcMs } from '../lib/pulse'
import { parseTags } from '../lib/rows'
import { VIRTUAL_TYPE, virtualRows } from '../lib/virtual'
import { mcpCall } from './mcp'

// Every read and write goes through the MCP server as the signed-in person. The server decides
// what that person may see and change (owner checks on rename and delete included).

interface IndexRow {
  graphId: string
  title?: string
  metaArea?: string | null
  publicationState?: string
  nodeCount?: number
  // The graph's version number (graph_index, dev-worker e62f20a). Absent from an older server.
  version?: number | null
  createdAt?: string
  updatedAt?: string
  world?: string | null
  nodeTypes?: string[]
  image?: string | null
  // The graph's header image (graph_index, dev-worker 2026-11-19). Absent from an older server.
  headerImage?: string | null
  sharedVia?: string
  sharedMode?: ShareMode
  sharedWith?: { world: string; mode: ShareMode }[]
  publishedDomains?: string[]
  nodes?: { id: string; label?: string; type?: string }[]
  edges?: { source: string; target: string }[]
}
interface IndexAnswer {
  total?: number
  worlds?: string[]
  graphs: IndexRow[]
}

function toRow(g: IndexRow): Row {
  return {
    id: g.graphId,
    title: g.title || '(untitled)',
    n: g.nodeCount || 0,
    status: g.publicationState || 'private',
    tags: parseTags(g.metaArea),
    live: (g.publishedDomains || []).join(', '),
    created: g.createdAt || '',
    updated: g.updatedAt || '',
    world: g.world || '',
    types: g.nodeTypes || [],
    image: g.image || '',
    header: g.headerImage || '',
    createdBy: '',
    version: typeof g.version === 'number' && g.version > 0 ? g.version : null,
    ...(g.sharedVia ? { sharedVia: g.sharedVia, sharedMode: g.sharedMode === 'write' ? 'write' : 'read' } : {}),
    ...(g.sharedWith?.length ? { sharedWith: g.sharedWith } : {}),
  }
}

// All graphs in one request: "mine", or everything the person can see across all Worlds.
// Also every World the person can use, the empty ones too (graph_index `worlds`, dev-worker 98c030b).
export async function loadIndex(user: User, scope: Scope): Promise<{ rows: Row[]; worlds: string[] }> {
  const a = await mcpCall<IndexAnswer>(user, 'graph_index', { scope })
  return { rows: (a.graphs || []).filter((g) => g && g.graphId).map(toRow), worlds: Array.isArray(a.worlds) ? a.worlds.map(String) : [] }
}

// Which of the named graphs contain the text, and in which nodes (search_text, dev-worker 1ea30de).
// A whole word, or * for part of one; the server reads every text field of every searched node type.
export interface TextSearch {
  query: string
  total: number
  partial: boolean
  suggestions: string[]
  suggestionNote: string | null
  matched: { graphId: string; inTitle: boolean; nodeIds: string[] }[]
}
export function searchText(user: User, scope: Scope, query: string, graphIds: string[]): Promise<TextSearch> {
  return mcpCall<TextSearch>(user, 'search_text', { query, scope, graphIds })
}

// Share a World's graph with another World, or stop (dev-worker 4c75ed8). The server checks that the
// person is a member of the graph's own World. Answers every World it is shared with afterwards.
type Shares = { world: string; mode: ShareMode }[]
export async function shareGraph(user: User, id: string, world: string, mode: ShareMode): Promise<Shares> {
  const a = await mcpCall<{ shares?: Shares }>(user, 'share_graph_with_world', { graphId: id, world, mode })
  clearCaches()
  return (a.shares || []).map((s) => ({ world: s.world, mode: s.mode }))
}
export async function unshareGraph(user: User, id: string, world: string): Promise<Shares> {
  const a = await mcpCall<{ shares?: Shares }>(user, 'unshare_graph_from_world', { graphId: id, world })
  clearCaches()
  return (a.shares || []).map((s) => ({ world: s.world, mode: s.mode }))
}

// Move a graph into a World's own storage (Superadmin only; the server checks). Id and links stay.
export async function moveGraphToWorld(user: User, id: string, world: string): Promise<string> {
  const a = await mcpCall<{ world?: string }>(user, 'move_graph_to_world', { graphId: id, world })
  clearCaches()
  return a.world || world
}

// Nodes (id, label, type) and edges of every graph under one meta area or holding one node type,
// in one request. Kept for the session, so choosing the same filter again draws at once.
//
// `ids` are the graphs the map is showing (at most NODE_IDS_MAX). The server narrows to them before
// it counts against its 600-graph limit — without them "created today, with a fulltext node" (five
// graphs) was refused because fulltext alone is in 1,792 (2026-11-19). An older server ignores them.
export const NODE_IDS_MAX = 600
const nodeCache = new Map<string, Promise<Record<string, KgGraph>>>()
const idsKey = (ids: string[]) => {
  let h = 5381
  for (const id of ids) for (let i = 0; i < id.length; i++) h = ((h << 5) + h + id.charCodeAt(i)) | 0
  return `${ids.length}:${h}`
}
export function loadNodes(user: User, scope: Scope, tag: string, type: string, ids?: string[]): Promise<Record<string, KgGraph>> {
  const picked = ids && ids.length && ids.length <= NODE_IDS_MAX ? [...ids].sort() : null
  const key = `${scope}|${tag}|${type}|${picked ? idsKey(picked) : '*'}`
  let p = nodeCache.get(key)
  if (!p) {
    const args: Record<string, unknown> = { scope, includeNodes: true }
    if (tag) args.metaArea = tag
    if (type) args.nodeType = type
    if (picked) args.graphIds = picked
    p = mcpCall<IndexAnswer>(user, 'graph_index', args).then((a) => {
      const by: Record<string, KgGraph> = {}
      for (const g of a.graphs || []) by[g.graphId] = { nodes: g.nodes || [], edges: g.edges || [] }
      return by
    })
    p.catch(() => nodeCache.delete(key))
    nodeCache.set(key, p)
  }
  return p
}

// One whole graph: node text, and task status (metadata.status), which the index does not carry.
const graphCache = new Map<string, Promise<KgGraph>>()
export function loadGraph(user: User, id: string): Promise<KgGraph> {
  let p = graphCache.get(id)
  if (!p) {
    p = mcpCall<{ nodes?: KgGraph['nodes']; edges?: KgGraph['edges']; version?: number }>(user, 'get_graph', { graphId: id }).then((g) => ({
      metadata: { version: g.version },
      nodes: Array.isArray(g.nodes) ? g.nodes : [],
      edges: Array.isArray(g.edges) ? g.edges : [],
    }))
    p.catch(() => graphCache.delete(id))
    graphCache.set(id, p)
  }
  return p
}

// When each saved version of a graph was written (ms, newest first), and the graph's current
// version number (null when the history holds no version). The store keeps the 20 newest. Kept
// for as long as the graph's own "updated" time stays the same, so a refresh reads again only the
// graphs that changed since. Not cleared by clearCaches for that reason.
export interface GraphHistory {
  stamps: number[]
  version: number | null
  // Each kept version with the time it was written, for comparing two of them (lib/nodePulse.ts).
  versions: { v: number; t: number }[]
}
const historyCache = new Map<string, { updated: string; stamps: Promise<GraphHistory> }>()
export function loadHistory(user: User, id: string, updated: string): Promise<GraphHistory> {
  // Per person: what one login may read is not shown to the next one in the same browser.
  const key = user.email + '|' + id
  const had = historyCache.get(key)
  if (had && had.updated === updated) return had.stamps
  const stamps = mcpCall<{ currentVersion?: number | null; versions?: { version: number; timestamp: string | null }[] }>(user, 'get_graph_history', {
    graphId: id,
  }).then((h) => {
    const versions = h.versions || []
    const version = h.currentVersion ?? versions[0]?.version ?? null
    return {
      stamps: versions.map((v) => utcMs(v.timestamp)).filter((t) => t > 0),
      version: typeof version === 'number' ? version : null,
      versions: versions.map((v) => ({ v: v.version, t: utcMs(v.timestamp) })),
    }
  })
  stamps.catch(() => {
    if (historyCache.get(key)?.stamps === stamps) historyCache.delete(key)
  })
  historyCache.set(key, { updated, stamps })
  return stamps
}

// The nodes of one saved version of a graph. A saved version never changes, so it is kept for the
// session; per person, as the history is.
const versionCache = new Map<string, Promise<KgGraph['nodes']>>()
export function loadVersionNodes(user: User, id: string, version: number): Promise<KgGraph['nodes']> {
  const key = user.email + '|' + id + '|' + version
  let p = versionCache.get(key)
  if (!p) {
    p = mcpCall<{ nodes?: KgGraph['nodes'] }>(user, 'get_graph_version', { graphId: id, version }).then((g) => (Array.isArray(g.nodes) ? g.nodes : []))
    p.catch(() => versionCache.delete(key))
    versionCache.set(key, p)
  }
  return p
}

// History lines (graph type history-line, registered 2026-11-20): the graphs that hold a
// history-line header node. Their events are drawn on a time axis (Engine.setHistory).
export const HISTORY_TYPE = 'history-line'
export async function loadHistoryGraphIds(user: User, scope: Scope): Promise<string[]> {
  const a = await mcpCall<IndexAnswer>(user, 'graph_index', { scope, nodeType: HISTORY_TYPE })
  return (a.graphs || []).filter((g) => g && g.graphId).map((g) => g.graphId)
}

// Virtual Worlds (architect 2026-11-20): Worlds that are defined in a knowledge graph and have no
// Cloudflare account. Every graph the person can see that holds a virtual-world node is read once;
// each such node is one World, and the nodes it has an edge to are its members (lib/virtual.ts).
export async function loadVirtualWorlds(user: User, scope: Scope): Promise<{ rows: Row[]; worlds: string[] }> {
  const a = await mcpCall<IndexAnswer>(user, 'graph_index', { scope, nodeType: VIRTUAL_TYPE })
  const out: { rows: Row[]; worlds: string[] } = { rows: [], worlds: [] }
  const parts = await Promise.all(
    (a.graphs || [])
      .filter((g) => g && g.graphId)
      .map(async (g) => {
        try {
          return virtualRows(g.graphId, { created: g.createdAt || '', updated: g.updatedAt || '' }, await loadGraph(user, g.graphId))
        } catch {
          return null // one unreadable definition does not hide the others
        }
      }),
  )
  for (const p of parts) {
    if (!p) continue
    for (const w of p.worlds) if (!out.worlds.includes(w)) out.worlds.push(w)
    out.rows.push(...p.rows)
  }
  return out
}

export function clearCaches() {
  nodeCache.clear()
  graphCache.clear()
}

export async function renameGraph(user: User, id: string, title: string): Promise<void> {
  await mcpCall(user, 'update_graph_metadata', { graphId: id, fields: { title } })
  graphCache.delete(id)
  nodeCache.clear()
}

export async function deleteGraph(user: User, id: string): Promise<void> {
  await mcpCall(user, 'delete_graph', { graphId: id })
  graphCache.delete(id)
  nodeCache.clear()
}

// Brings back the newest trash entry of this graph.
export async function restoreGraph(user: User, id: string): Promise<void> {
  await mcpCall(user, 'restore_graph', { graphId: id })
  nodeCache.clear()
}

// The meta-area string as stored right now (not the index copy, which may be minutes old).
export async function readMetaArea(user: User, id: string): Promise<string> {
  const g = await mcpCall<{ metaArea?: string | null }>(user, 'get_graph', { graphId: id })
  return g.metaArea || ''
}

// Writes the COMPLETE meta-area string (the server replaces the old one) and answers what it stored.
export async function writeMetaArea(user: User, id: string, metaArea: string): Promise<string> {
  const a = await mcpCall<{ metaArea?: string | null }>(user, 'update_graph_metadata', { graphId: id, fields: { metaArea } })
  graphCache.delete(id)
  nodeCache.clear()
  return a.metaArea ?? metaArea
}
