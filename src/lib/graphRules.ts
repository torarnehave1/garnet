import type { KgEdge, KgNode } from './types'

// The name to show for a node. A YouTube node keeps its video in the name itself, as
// ![YOUTUBE src=URL]Title[END YOUTUBE]; Garnet shows only the title. The graph is never
// changed for this: views that play the video read the address from that same name.
export function nodeName(label: unknown): string {
  let t = String(label || '').trim()
  const m = /!\[YOUTUBE\s+src=[^\]]*\]([\s\S]*?)(?:\[END\s+YOUTUBE\]|$)/.exec(t)
  if (m) t = m[1].trim() || 'YouTube video'
  return t || '(no label)'
}

// The id of the video a YouTube node plays: from the address in its name
// (![YOUTUBE src=URL]…), else from its path. null when neither holds a YouTube address.
export function youtubeId(node: Pick<KgNode, 'label' | 'path'>): string | null {
  const inName = /!\[YOUTUBE\s+src=([^\]\s]+)/.exec(String(node.label || ''))
  for (const raw of [inName?.[1], node.path]) {
    const url = String(raw || '').trim().replace(/^["']|["']$/g, '')
    const m = /(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/.exec(url)
    if (m) return m[1]
  }
  return null
}

// The address of the file an album-video node plays: its path, when that is an https address.
// null otherwise, so nothing else is ever put into the player.
export function albumVideoUrl(node: Pick<KgNode, 'path'>): string | null {
  const url = String(node.path || '').trim()
  return /^https:\/\/[^\s"'<>]+$/.test(url) ? url : null
}

// The address of the video a course step (kurs-steg) plays: its path, when that is an https
// address of a video file. The file lies in a Photos album, as an album-video's does. A step
// without a video — the one with the pattern as a PDF — gives null, and is shown with its text.
export function courseVideoUrl(node: Pick<KgNode, 'path'>): string | null {
  const url = albumVideoUrl(node)
  return url && /\.(mp4|m4v|mov|webm)(?:[?#].*)?$/i.test(url) ? url : null
}

// Which icon a node gets on the map: its type, except a course step (kurs-steg), which is told
// apart by what it holds: a video ("kurs-steg/video"), a PDF to download ("kurs-steg/pdf"), or
// text only (the plain type). Read from the node as it is; nothing is changed.
export function iconKey(node: Pick<KgNode, 'type' | 'path' | 'info' | 'metadata'>): string {
  const type = node.type || ''
  if (type !== 'kurs-steg') return type
  if (courseVideoUrl(node)) return type + '/video'
  const lesson = (node.metadata as { lesson?: { pdf?: unknown } } | undefined)?.lesson
  if (lesson?.pdf || /\]\(https?:\/\/[^)\s]+\.pdf(?:[?#][^)\s]*)?\)/i.test(String(node.info || ''))) return type + '/pdf'
  return type
}

// The address of the sound file an audio node plays: its path, when that is an https address,
// the same field Knowledge Editor plays it from. null otherwise.
export function audioUrl(node: Pick<KgNode, 'path'>): string | null {
  return albumVideoUrl(node)
}

// A flow graph (nodes of type flow-step): the order of its steps, read from the edges.
// Starts at the node of type "flow", or at the steps nothing points to. [] when not a flow.
export function flowOrder(ns: KgNode[], es: KgEdge[]): string[] {
  const steps = ns.filter((n) => n.type === 'flow-step')
  if (steps.length < 2) return []
  const typ: Record<string, string> = {}
  const out: Record<string, string[]> = {}
  const inc: Record<string, number> = {}
  ns.forEach((n) => {
    typ[n.id] = n.type || ''
    out[n.id] = []
    inc[n.id] = 0
  })
  es.forEach((e) => {
    if (out[e.source] && out[e.target] && e.source !== e.target) {
      out[e.source].push(e.target)
      inc[e.target]++
    }
  })
  let stack = ns.filter((n) => n.type === 'flow').map((n) => n.id)
  if (!stack.length) stack = steps.filter((n) => !inc[n.id]).map((n) => n.id)
  stack.reverse()
  const seen = new Set<string>()
  const seq: string[] = []
  while (stack.length) {
    const id = stack.pop()!
    if (seen.has(id)) continue
    seen.add(id)
    if (typ[id] === 'flow' || typ[id] === 'flow-step') seq.push(id)
    for (let j = out[id].length - 1; j >= 0; j--) if (!seen.has(out[id][j])) stack.push(out[id][j])
  }
  steps.forEach((n) => {
    if (!seen.has(n.id)) seq.push(n.id)
  })
  return seq
}

// A course graph (nodes of type kurs-steg): its steps in the order of the course, read from the
// edges. The steps are not tied to each other directly — a step's summary and transcript stand
// between them — so the walk passes through every node and keeps only the steps. It starts at the
// course description (type kursbeskrivelse), which then stands first, or else at the nodes nothing
// points to. [] when the graph has fewer than two steps.
export function courseOrder(ns: KgNode[], es: KgEdge[]): string[] {
  const steps = ns.filter((n) => n.type === 'kurs-steg')
  if (steps.length < 2) return []
  const typ: Record<string, string> = {}
  const out: Record<string, string[]> = {}
  const inc: Record<string, number> = {}
  ns.forEach((n) => {
    typ[n.id] = n.type || ''
    out[n.id] = []
    inc[n.id] = 0
  })
  es.forEach((e) => {
    if (out[e.source] && out[e.target] && e.source !== e.target) {
      out[e.source].push(e.target)
      inc[e.target]++
    }
  })
  let stack = ns.filter((n) => n.type === 'kursbeskrivelse').map((n) => n.id)
  if (!stack.length) stack = ns.filter((n) => !inc[n.id]).map((n) => n.id)
  stack.reverse()
  const seen = new Set<string>()
  const seq: string[] = []
  while (stack.length) {
    const id = stack.pop()!
    if (seen.has(id)) continue
    seen.add(id)
    if (typ[id] === 'kursbeskrivelse' || typ[id] === 'kurs-steg') seq.push(id)
    for (let j = out[id].length - 1; j >= 0; j--) if (!seen.has(out[id][j])) stack.push(out[id][j])
  }
  steps.forEach((n) => {
    if (!seen.has(n.id)) seq.push(n.id)
  })
  return seq
}

// A graph with tasks (type oppgave) and no flow: the tasks stand in the same kind of column.
// No order between tasks, no numbers. The node that points to most tasks stands first.
export function taskOrder(ns: KgNode[], es: KgEdge[]): string[] {
  const tasks = ns.filter((n) => n.type === 'oppgave')
  if (tasks.length < 2) return []
  const isTask = new Set(tasks.map((n) => n.id))
  const points: Record<string, number> = {}
  es.forEach((e) => {
    if (isTask.has(e.target) && !isTask.has(e.source)) points[e.source] = (points[e.source] || 0) + 1
  })
  let head = ''
  let best = 1
  ns.forEach((n) => {
    if ((points[n.id] || 0) > best) {
      best = points[n.id]
      head = n.id
    }
  })
  return [...(head ? [head] : []), ...tasks.map((n) => n.id)]
}

export type StatusKind = '' | 'open' | 'doing' | 'done'
export const STATUS_COLOR: Record<string, string> = { open: '#f85149', doing: '#e3a008', done: '#3fb950' }
export function statusKind(s: unknown): StatusKind {
  const v = String(s || '').toLowerCase().trim()
  if (/^(utført|utfort|ferdig|done|fullført)$/.test(v)) return 'done'
  if (/^(pågår|pagar|in progress|doing)$/.test(v)) return 'doing'
  if (/^(åpen|apen|open)$/.test(v)) return 'open'
  return ''
}

function esc(t: unknown) {
  return String(t == null ? '' : t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
}

interface Explanation {
  by?: string
  reviewed?: boolean
  reviewedBy?: string
}
interface Reference {
  author?: string
  year?: string | number
  title?: string
  checked?: boolean
}

// The node's own text, as plain paragraphs (escaped HTML). Keyword nodes also show who
// explained them and the references.
export function textHtml(node: KgNode): string {
  const m = (node.metadata || {}) as { explanation?: Explanation; references?: Reference[] }
  const ex = m.explanation || {}
  const refs = Array.isArray(m.references) ? m.references : []
  const type = node.type || 'fulltext'
  const info = String(node.info || '')
  if (type === 'html-node' || /^\s*<(!doctype|html)/i.test(info)) return '<p>This node is a web page. Open the graph to see it.</p>'
  if (type === 'mermaid-diagram') return '<p>This node is a diagram.</p>'
  let h = ''
  if (!info.trim()) h += '<p>This node has no text.</p>'
  const cut = info.length > 2400
  ;(cut ? info.slice(0, 2400) : info).split(/\n\s*\n/).forEach((par) => {
    const p = esc(par.trim().replace(/^#{1,6}\s*/gm, ''))
    if (!p) return
    // A Markdown link [text](https://…) becomes a link that opens in a new tab. The text is escaped
    // above, so the address cannot break out of its attribute; only http(s) addresses are taken.
    const linked = p.replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    h += '<p>' + linked.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\*([^*\n]+)\*/g, '<i>$1</i>').replace(/\n/g, '<br>') + '</p>'
  })
  if (cut) h += '<p>… The text continues in the graph.</p>'
  if (ex.by)
    h +=
      '<span class="mark">' +
      (ex.by === 'ai' ? 'Explained with AI' : 'Explained by ' + esc(ex.reviewedBy || ex.by)) +
      ' · ' +
      (ex.reviewed ? 'reviewed' + (ex.reviewedBy ? ' by ' + esc(ex.reviewedBy) : '') : 'not reviewed by a person yet') +
      '</span>'
  if (refs.length)
    h +=
      '<div class="refs">References: ' +
      refs.map((r) => esc(r.author || '') + (r.year ? ' (' + esc(r.year) + ')' : '') + (r.title ? ', ' + esc(r.title) : '') + (r.checked ? '' : ' – not checked')).join('; ') +
      '</div>'
  return h
}
