// One graph as Garnet keeps it, read from /getknowgraphsummaries.
export interface Row {
  id: string
  title: string
  n: number
  status: string
  tags: string[]
  live: string
  created: string
  updated: string
  world: string
  types: string[]
  // The graph's card image (its first portfolio-image node), or ''.
  image: string
  // The address of the graph's header image, '' when it has none.
  header: string
  createdBy: string
  version: number | null
  // Sharing between Worlds (graph_shares, dev-worker 2026-11-19). Absent in an older cache.
  sharedVia?: string // reached only because it is shared with this World of mine
  sharedMode?: ShareMode // with sharedVia: may I change it
  sharedWith?: { world: string; mode: ShareMode }[] // every World it is shared with
  // A member of a Virtual World (lib/virtual.ts): not a graph on the server. It is read from a
  // virtual-world node in the graph `graphId`; `nodeId` is the member's own node there.
  // `members` is a simulated member number the Virtual World gives this member: an invented
  // number, never a real one. It sets the circle's size and is written after the name.
  // `links` are this member's connections to other members of the same World (the other member's
  // row id, and how many exchanges a week the connection carries): a line with a pulse on the map.
  // `pulse` is a simulated pulse (changes in the week, as the pulse layer counts them): it feeds
  // the map's own Pulse menu, so Colour, Beat and Ripple show it as they show a real graph's.
  virtual?: { graphId: string; nodeId: string; members?: number; pulse?: number; links?: { to: string; perWeek: number }[] }
}
export type ShareMode = 'read' | 'write'

// A node and its edges as /getknowgraph returns them.
export interface KgNode {
  id: string
  label?: string
  type?: string
  info?: string
  // A media node's address (a youtube-video node: the video).
  path?: string | null
  metadata?: Record<string, unknown> & { status?: unknown }
  // When the node's content last changed, as the index gives it (the node's metadata.updatedAt).
  updatedAt?: string | null
}
export interface KgEdge {
  id?: string
  source: string
  target: string
  label?: string
}
export interface KgGraph {
  metadata?: Record<string, unknown> & { version?: number; title?: string }
  nodes: KgNode[]
  edges: KgEdge[]
}

export interface Filters {
  tags: string[]
  type: string
  find: string
  only: boolean
  pub: string
  year: string
  since: string
  dateFrom: string // created on or after this day (YYYY-MM-DD, UTC), '' for no lower bound
  dateTo: string // created on or before this day, '' for no upper bound
  updFrom: string // last updated on or after this day (YYYY-MM-DD, UTC), '' for no lower bound
  updTo: string // last updated on or before this day, '' for no upper bound
  world: string
}

export interface User {
  email: string
  role: string | null
  token: string | null
}

export type Scope = 'mine' | 'all'
