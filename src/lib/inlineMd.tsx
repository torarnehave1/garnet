import type { ReactNode } from 'react'

// The little Markdown chat models write inside a line: **bold**, `code`, [text](https://…) and bare
// https:// links. Built as React nodes, never as HTML, so a model's text cannot inject markup.
const TOKEN = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\)|https?:\/\/[^\s)<]*[^\s)<.,;:!?'"])/g

export function inlineMd(text: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let k = 0
  for (const m of text.matchAll(TOKEN)) {
    const t = m[0]
    const at = m.index ?? 0
    if (at > last) out.push(text.slice(last, at))
    if (t.startsWith('**')) out.push(<strong key={k++}>{t.slice(2, -2)}</strong>)
    else if (t.startsWith('`')) out.push(<code key={k++}>{t.slice(1, -1)}</code>)
    else if (t.startsWith('[')) {
      const cut = t.indexOf('](')
      out.push(
        <a key={k++} href={t.slice(cut + 2, -1)} target="_blank" rel="noreferrer">
          {t.slice(1, cut)}
        </a>,
      )
    } else
      out.push(
        <a key={k++} href={t} target="_blank" rel="noreferrer">
          {t}
        </a>,
      )
    last = at + t.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}
