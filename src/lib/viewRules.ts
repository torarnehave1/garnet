import type { KgNode } from './types'

// Where a clicked node of a given type is shown in Garnet (architect's choice 2026-11-18).
//   'full'  the whole window (a diagram gets zoom and pan)
//   'right' a panel at the right, drawn by the type's own approved renderer, as Knowledge Editor does
//   'card'  the card at the left with the node's text: what a type without a rule gets
//
// The rules live in a graph, "Garnet – visningsregler", read at start and at every refresh. One
// node is one rule: its label is the node type, and its text has a line "Visning: høyre",
// "Visning: fullt vindu" or "Visning: kort". The table below is the reserve, used until the graph
// is read and when it cannot be read (it is private, so another user gets the reserve).
export type NodeView = 'full' | 'right' | 'card'
export const RULES_GRAPH_ID = '750e31d1-bf3d-4e29-a019-85a37aec82d7'

const RESERVE: Record<string, NodeView> = {
  'mermaid-diagram': 'full',
  'sanskrit-ord': 'right',
  'youtube-video': 'right',
}
let rules: Record<string, NodeView> = RESERVE

const WORDS: Record<string, NodeView> = {
  høyre: 'right',
  hoyre: 'right',
  right: 'right',
  'fullt vindu': 'full',
  full: 'full',
  'full window': 'full',
  kort: 'card',
  card: 'card',
}

/**
 * The rules a graph holds. A node is a rule when its label is a node type (one word, no spaces)
 * and its text has a line that starts with "Visning:" (or "View:") and one of the known words.
 * Anything else in the graph, such as the node that explains it, is passed over.
 */
export function readRules(nodes: KgNode[]): Record<string, NodeView> {
  const out: Record<string, NodeView> = {}
  for (const n of nodes) {
    const type = (n.label || '').trim()
    if (!type || /\s/.test(type)) continue
    const m = /^\s*(?:visning|view)\s*:\s*(.+?)\s*$/im.exec(n.info || '')
    const view = m && WORDS[m[1].toLowerCase().replace(/[.*_`]/g, '').trim()]
    if (view) out[type] = view
  }
  return out
}

/** Take the graph's rules into use, on top of the reserve. null: back to the reserve alone. */
export function applyRules(fromGraph: Record<string, NodeView> | null) {
  rules = fromGraph ? { ...RESERVE, ...fromGraph } : RESERVE
}

/** Where a node of this type opens: 'full', 'right', or null for the card alone. */
export function nodeView(type: string | undefined): 'full' | 'right' | null {
  const v = type ? rules[type] : undefined
  return v === 'full' || v === 'right' ? v : null
}
