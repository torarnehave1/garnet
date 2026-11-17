import type { ReactNode } from 'react'

// The little Markdown chat models write: **bold**, `code`, [text](https://…), bare https:// links,
// and pipe tables. Built as React nodes, never as HTML, so a model's text cannot inject markup.
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

const isRow = (l: string) => /^\s*\|.*\|\s*$/.test(l)
const isRule = (l: string) => /^\s*\|[\s:|-]+\|\s*$/.test(l) && l.includes('-')
// A cell may hold an escaped pipe ("torarnehave.no \\| Hjemmeside"): split only on bare pipes.
const cells = (l: string) =>
  l
    .trim()
    .replace(/^\|/, '')
    .replace(/(?<!\\)\|$/, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.replace(/\\\|/g, '|').trim())

// Text with pipe tables drawn as tables; everything else goes through inlineMd.
export function chatMd(text: string): ReactNode[] {
  const lines = text.split('\n')
  const out: ReactNode[] = []
  let buf: string[] = []
  let k = 0
  const flush = () => {
    if (buf.length) out.push(<span key={k++}>{inlineMd(buf.join('\n') + '\n')}</span>)
    buf = []
  }
  for (let i = 0; i < lines.length; i++) {
    if (isRow(lines[i]) && i + 1 < lines.length && isRule(lines[i + 1])) {
      flush()
      const head = cells(lines[i])
      const body: string[][] = []
      i += 2
      while (i < lines.length && isRow(lines[i])) body.push(cells(lines[i++]))
      i--
      out.push(
        <table key={k++} className="ctable">
          <thead>
            <tr>{head.map((c, j) => <th key={j}>{inlineMd(c)}</th>)}</tr>
          </thead>
          <tbody>
            {body.map((r, n) => (
              <tr key={n}>{r.map((c, j) => <td key={j}>{inlineMd(c)}</td>)}</tr>
            ))}
          </tbody>
        </table>,
      )
    } else buf.push(lines[i])
  }
  flush()
  return out
}
