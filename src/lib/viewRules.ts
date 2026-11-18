// Where a clicked node of a given type is shown in Garnet (architect's choice 2026-11-18).
// 'full': the whole window (a diagram). 'right': a panel at the right, drawn by the type's own
// approved renderer, the way Knowledge Editor shows it. A type without a rule is shown in the card
// with its text, as before.
//
// The rules are in code for now. The plan discussed is a graph that holds them, one node per node
// type, which Garnet reads at start; this table is what that graph would replace.
export type NodeView = 'full' | 'right'
const NODE_VIEWS: Record<string, NodeView> = {
  'mermaid-diagram': 'full',
  'sanskrit-ord': 'right',
}
export const nodeView = (type: string | undefined): NodeView | null => (type && NODE_VIEWS[type]) || null
