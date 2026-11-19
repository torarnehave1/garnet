import { useEffect, useState } from 'react'

// Where a graph opens. A graph on the platform opens in editor.vegvisr.org. A graph stored in a
// World opens in that World's own editor (editor.<domain>, the address the MCP server also gives),
// but only when that address answers: a World whose editor is not set up yet keeps the platform
// editor. The check is one request per World per page load. The browser does not let Garnet read
// the answer from another site, only whether one came, so "answers" means the host is there.
const PLATFORM = 'https://editor.vegvisr.org'
const checked = new Map<string, Promise<boolean>>()
const known = new Map<string, boolean>()

const plainHost = (v: string) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(v)

function worldEditorAnswers(world: string): Promise<boolean> {
  let p = checked.get(world)
  if (!p) {
    const stop = new AbortController()
    const timer = setTimeout(() => stop.abort(), 6000)
    p = fetch(`https://editor.${world}/`, { mode: 'no-cors', cache: 'no-store', signal: stop.signal })
      .then(() => true)
      .catch(() => false)
      .then((ok) => {
        clearTimeout(timer)
        known.set(world, ok)
        return ok
      })
    checked.set(world, p)
  }
  return p
}

/** The editor address for a graph in `world` ('' = the platform), without a trailing slash. */
export function useEditorBase(world: string | null | undefined): string {
  const w = String(world || '').trim().toLowerCase()
  const usable = w !== '' && plainHost(w)
  const [, bump] = useState(0)
  useEffect(() => {
    if (!usable || known.has(w)) return
    let live = true
    worldEditorAnswers(w).then(() => {
      if (live) bump((n) => n + 1)
    })
    return () => {
      live = false
    }
  }, [w, usable])
  return usable && known.get(w) ? `https://editor.${w}` : PLATFORM
}

export const viewLink = (base: string, graphId: string) => `${base}/view?graphId=${encodeURIComponent(graphId)}`
