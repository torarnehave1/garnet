import type { ReactNode } from 'react'

// The little Markdown chat models write: **bold**, *italic*, `code`, [text](https://…), bare https://
// links; and as blocks: # headings, - and 1. lists, --- rules and pipe tables. Built as React nodes, never as HTML, so a model's text cannot inject markup.
const TOKEN =
  /(\*\*[^*\n]+\*\*|\*[^*\s](?:[^*\n]*[^*\s])?\*|`[^`\n]+`|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\)|https?:\/\/[^\s)<]*[^\s)<.,;:!?'"])/g

export function inlineMd(text: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let k = 0
  for (const m of text.matchAll(TOKEN)) {
    const t = m[0]
    const at = m.index ?? 0
    if (at > last) out.push(text.slice(last, at))
    if (t.startsWith('**')) out.push(<strong key={k++}>{inlineMd(t.slice(2, -2))}</strong>)
    else if (t.startsWith('*')) out.push(<em key={k++}>{inlineMd(t.slice(1, -1))}</em>)
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

const HEAD = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/
const BULLET = /^\s*[-*•]\s+(.*)$/
const NUMBER = /^\s*(\d+)[.)]\s+(.*)$/
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/

// Text with its blocks drawn (headings, lists, rules, tables); the rest goes through inlineMd.
export function chatMd(text: string): ReactNode[] {
  const lines = text.split('\n')
  const out: ReactNode[] = []
  let buf: string[] = []
  let k = 0
  const flush = () => {
    // Blank lines at a block's edge would stack on the block's own margin.
    while (buf.length && !buf[0].trim()) buf.shift()
    while (buf.length && !buf[buf.length - 1].trim()) buf.pop()
    if (buf.length)
      out.push(
        <p key={k++} className="cpara">
          {inlineMd(buf.join('\n'))}
        </p>,
      )
    buf = []
  }
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (isRow(l) && i + 1 < lines.length && isRule(lines[i + 1])) {
      flush()
      const head = cells(l)
      const body: string[][] = []
      i += 2
      while (i < lines.length && isRow(lines[i])) body.push(cells(lines[i++]))
      i--
      out.push(
        <table key={k++} className="ctable">
          <thead>
            <tr>
              {head.map((c, j) => (
                <th key={j}>{inlineMd(c)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((r, n) => (
              <tr key={n}>
                {r.map((c, j) => (
                  <td key={j}>{inlineMd(c)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>,
      )
      continue
    }
    const h = l.match(HEAD)
    if (h) {
      flush()
      out.push(
        <div
          key={k++}
          className={'chead h' + Math.min(h[1].length, 3)}
          role="heading"
          aria-level={Math.min(h[1].length + 2, 6)}
        >
          {inlineMd(h[2])}
        </div>,
      )
      continue
    }
    if (RULE.test(l)) {
      flush()
      out.push(<hr key={k++} className="crule" />)
      continue
    }
    const numbered = NUMBER.test(l)
    if (numbered || BULLET.test(l)) {
      flush()
      const items: string[] = []
      const re = numbered ? NUMBER : BULLET
      const first = numbered ? Number(l.match(NUMBER)![1]) : 1
      // A list runs over its items; an indented line continues the item above it.
      while (i < lines.length) {
        const m = lines[i].match(re)
        if (m) items.push(numbered ? m[2] : m[1])
        else if (items.length && /^\s{2,}\S/.test(lines[i]) && !BULLET.test(lines[i]) && !NUMBER.test(lines[i]))
          items[items.length - 1] += '\n' + lines[i].trim()
        else break
        i++
      }
      i--
      const lis = items.map((t, j) => <li key={j}>{inlineMd(t)}</li>)
      out.push(
        numbered ? (
          <ol key={k++} className="clist" start={first}>
            {lis}
          </ol>
        ) : (
          <ul key={k++} className="clist">
            {lis}
          </ul>
        ),
      )
      continue
    }
    buf.push(l)
  }
  flush()
  return out
}
