import { useEffect, useRef, useState } from 'react'
import { loadGraph } from '../api/kg'
import { usePanZoom } from '../lib/usePanZoom'
import type { User } from '../lib/types'

// Mermaid is large, so it is fetched the first time a diagram is opened. `strict`: the diagram
// text comes from a graph, and nothing in it may run as markup.
let mermaidReady: Promise<(typeof import('mermaid'))['default']> | null = null
function getMermaid() {
  if (!mermaidReady)
    mermaidReady = import('mermaid').then((m) => {
      m.default.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'strict', logLevel: 'error' })
      return m.default
    })
  return mermaidReady
}
let seq = 0

// A Gantt chart is laid out to the width it is drawn in, so on a phone its labels collide. Here
// it is laid out wide and scaled to fit, and zooming brings the labels up.
const wideGantt = (code: string) => (/^\s*gantt\b/.test(code) && !code.includes('%%{') ? `%%{init: {"gantt": {"useWidth": 1600}}}%%\n${code}` : code)

// A mermaid-diagram node in the whole window, with zoom and pan. Read-only.
export default function DiagramModal({ user, graphId, nodeId, title, onClose }: { user: User; graphId: string; nodeId: string; title: string; onClose: () => void }) {
  const [svg, setSvg] = useState('')
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [why, setWhy] = useState('')
  const [code, setCode] = useState('')
  const { t, zoomBy, reset, handlers } = usePanZoom()
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    let live = true
    setState('loading')
    setSvg('')
    setWhy('')
    reset()
    loadGraph(user, graphId)
      .then(async (g) => {
        const node = g.nodes.find((n) => n.id === nodeId)
        const text = String(node?.info || '').trim()
        if (!node) throw new Error('The node was not found in the graph.')
        if (!text) throw new Error('This diagram node has no diagram text.')
        if (live) setCode(text)
        const mermaid = await getMermaid()
        const out = await mermaid.render('garnet-diagram-' + ++seq, wideGantt(text))
        if (!live) return
        setSvg(out.svg)
        setState('ready')
      })
      .catch((e) => {
        if (!live) return
        setWhy(String(e?.message || 'unknown error'))
        setState('error')
      })
    return () => {
      live = false
    }
  }, [user, graphId, nodeId, reset])

  useEffect(() => {
    closeRef.current?.focus()
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === '+' || e.key === '=') zoomBy(1.25)
      else if (e.key === '-') zoomBy(1 / 1.25)
      else if (e.key === '0') reset()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose, zoomBy, reset])

  return (
    <div className="diagram" role="dialog" aria-modal="true" aria-label={'Diagram: ' + title}>
      <div className="diagramHead">
        <strong>{title}</strong>
        <div className="diagramTools">
          <button type="button" className="ghost" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.25)}>
            −
          </button>
          <span className="diagramPct" aria-live="polite">
            {Math.round(t.z * 100)}%
          </span>
          <button type="button" className="ghost" aria-label="Zoom in" onClick={() => zoomBy(1.25)}>
            +
          </button>
          <button type="button" className="ghost" onClick={reset}>
            Fit
          </button>
          <button ref={closeRef} type="button" className="ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
      <div className="diagramStage" {...handlers}>
        {state === 'loading' && <p className="diagramNote">Loading the diagram…</p>}
        {state === 'error' && (
          <div className="diagramNote">
            <p>Could not draw the diagram ({why}).</p>
            {code && <pre>{code}</pre>}
          </div>
        )}
        {state === 'ready' && (
          // The SVG comes from mermaid in strict mode, which escapes the text it is given.
          <div className="diagramSheet" style={{ transform: `translate(${t.x}px, ${t.y}px) scale(${t.z})` }} dangerouslySetInnerHTML={{ __html: svg }} />
        )}
      </div>
    </div>
  )
}
