import { useEffect, useState } from 'react'
import { Notice } from '../components/Notice'

// Where a graph opens. A graph on the platform opens in editor.vegvisr.org. A graph stored in a
// World opens in that World's own editor (editor.<domain>, the address the MCP server also gives).
// When that editor is not set up, there is NO link — not to editor.vegvisr.org either — but a
// note that the editor must be set up for that World (architect 2026-11-21; before that day Garnet
// fell back to the platform editor). The check is one request per World per page load. The
// browser does not let Garnet read the answer from another site, only whether one came, so
// "answers" means the host is there.
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

/** Where a graph in `world` ('' = the platform) opens: base null when that World's editor is not set up. */
export interface EditorBase {
  base: string | null
  world: string
}

export function useEditorBase(world: string | null | undefined): EditorBase {
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
  if (!usable) return { base: PLATFORM, world: '' }
  // Not checked yet: the World's own address (the check takes a moment); checked and missing: none.
  return { base: known.get(w) === false ? null : `https://editor.${w}`, world: w }
}

export const viewLink = (base: string, graphId: string) => `${base}/view?graphId=${encodeURIComponent(graphId)}`

/** "Open Knowledge Graph", or the note that the World's editor must be set up first. */
export function EditorLink({ editor, graphId, text = 'Open Knowledge Graph' }: { editor: EditorBase; graphId: string; text?: string }) {
  if (!editor.base)
    return (
      <Notice head={`The editor for the World ${editor.world} is not set up.`} body="It must be set up before this graph can be opened, so there is no link." />
    )
  return (
    <a href={viewLink(editor.base, graphId)} target="_blank" rel="noopener">
      {text}
    </a>
  )
}
