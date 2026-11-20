# Garnet — Claude working notes

Garnet maps the VEGR.AI knowledge graphs as one growing network. React 19 + TypeScript + Vite.
Source of the design: graph `1959d5a5-a291-4916-bac1-63aa2cead59c` (handover nodes + the HTML prototype).

## Read first
`_project/lessons_learned.md` · `_project/STATUS.md` · `_project/TODO.md` · `_project/TEST_PLAN.md`

## Layout
- `src/engine/Engine.ts` — canvas, d3-force simulation, zoom, picking, drawing. No React.
- `src/lib/` — pure rules: filters and options (`rows.ts`), flow/task order, YouTube names, task status, node text (`graphRules.ts`), the pulse layer's window, colour steps and beat (`pulse.ts`; `usePulse.ts` reads the version history for it).
- `src/lib/virtual.ts` — Virtual Worlds: a `virtual-world` node in a graph is one World that is not real; the nodes it has an edge to are its members, shown as circles in a World of their own. They are not graphs on the server: no menu, search, pulse or bulk tagging for them.
- `src/api/` — `auth.ts` (`<vegvisr-auth>`, localStorage `vegvisr_user`), `kg.ts` (knowledge.vegvisr.org calls).
- `src/components/` — UI around the canvas. `src/App.tsx` wires state, filters, view memory and actions.

## Commands
| Command | Purpose |
|---|---|
| `npm run dev -- --port 5180` | Dev server (launch config "garnet") |
| `npm run build` | Type-check + production build to `dist/` |
| `npx oxlint src` | Lint |

## Rules specific to Garnet
- Never change a YouTube node's label: other views read the video address from it.
- Garnet changes nothing by itself: every write names the graph and waits for a yes.
- The T7 drive writes `._*` resource forks; they are git-ignored and lint-ignored.
