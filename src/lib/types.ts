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
  createdBy: string
  version: number | null
}

// A node and its edges as /getknowgraph returns them.
export interface KgNode {
  id: string
  label?: string
  type?: string
  info?: string
  metadata?: Record<string, unknown> & { status?: unknown }
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
  world: string
}

export interface User {
  email: string
  role: string | null
  token: string | null
}

export type Scope = 'mine' | 'all'
