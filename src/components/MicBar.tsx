import { useEffect, useRef } from 'react'

// The listening bar, after Claude's own dictation: while the Mic records, the message box gives
// way to "Listening…", a waveform that follows the voice, ✕ (throw it away) and ✓ (put what was
// said in the message box). Enter = ✓, Escape = ✕. With live dictation the words appear in the bar
// while they are spoken: final text plain, the newest (still changing) text dimmed. The waveform is drawn on a canvas outside
// React state, the same principle as the Engine: one bar per ~70 ms, newest on the right.

const STEP_MS = 70
const BAR = 2 // px wide
const GAP = 4 // px between bars

interface Props {
  state: 'on' | 'busy'
  lang: 'no' | 'en'
  /** Live text while speaking (gpt-live-transcribe): final part, then the interim part shown dimmed. */
  text?: { final: string; interim: string } | null
  /** A short line when the live text fails; the recording goes on and is written down at ✓. */
  note?: string
  level: () => number
  onCancel: () => void
  onAccept: () => void
}

export function MicBar({ state, lang, text, note, level, onCancel, onAccept }: Props) {
  const words = useRef<HTMLSpanElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const bar = useRef<HTMLDivElement>(null)
  const listening = state === 'on'

  useEffect(() => {
    bar.current?.focus()
  }, [])

  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const g = c.getContext('2d')
    if (!g) return
    const levels: number[] = []
    let raf = 0
    let last = 0
    const colour = getComputedStyle(c).color || '#8fa0b8'
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw)
      const dpr = window.devicePixelRatio || 1
      const w = c.clientWidth
      const h = c.clientHeight
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
        c.width = Math.round(w * dpr)
        c.height = Math.round(h * dpr)
      }
      const fits = Math.max(1, Math.floor(w / (BAR + GAP)))
      if (t - last >= STEP_MS) {
        last = t
        levels.push(listening ? level() : 0)
        while (levels.length > fits) levels.shift()
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, w, h)
      g.fillStyle = colour
      const mid = h / 2
      // Right-aligned: the newest bar sits at the right edge, silence shows as small dots.
      for (let i = 0; i < levels.length; i++) {
        const x = w - (levels.length - i) * (BAR + GAP)
        const bh = Math.max(BAR, levels[i] * (h - 2))
        g.globalAlpha = listening ? 0.9 : 0.35
        g.fillRect(x, mid - bh / 2, BAR, bh)
      }
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [level, listening])

  useEffect(() => {
    const w = words.current
    if (w) w.scrollTop = w.scrollHeight // keep the newest words in sight
  }, [text])

  // With words, the text gets the whole width and the waveform with ✕ ✓ goes on a line under it.
  const hasText = !!text && !!(text.final || text.interim)

  const label = listening
    ? lang === 'no' ? 'Lytter…' : 'Listening…'
    : lang === 'no' ? 'Skriver ned…' : 'Transcribing…'

  return (
    <div
      ref={bar}
      className={'micbar' + (listening ? '' : ' busy') + (hasText ? ' hastext' : '')}
      tabIndex={-1}
      role="group"
      aria-label={label}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          onCancel()
        } else if (e.key === 'Enter' && listening) {
          e.preventDefault()
          onAccept()
        }
      }}
    >
      {hasText ? (
        <span ref={words} className="mictext" aria-live="polite">
          {text.final}
          {text.final && text.interim ? ' ' : ''}
          {text.interim && <span className="micinterim">{text.interim}</span>}
          {!listening && <span className="miclabel"> · {label}</span>}
        </span>
      ) : (
        <span className="miclabel" aria-live="polite">
          {label}
          {note && <span className="micnote"> · {note}</span>}
        </span>
      )}
      <div className="microw">
      <canvas ref={canvas} className="micwave" aria-hidden="true" />
      <button
        type="button"
        className="micbtn"
        onClick={onCancel}
        title={lang === 'no' ? 'Forkast (Esc)' : 'Discard (Esc)'}
        aria-label={lang === 'no' ? 'Forkast' : 'Discard'}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
      <button
        type="button"
        className="micbtn"
        onClick={onAccept}
        disabled={!listening}
        title={lang === 'no' ? 'Bruk teksten (Enter)' : 'Use the text (Enter)'}
        aria-label={lang === 'no' ? 'Bruk teksten' : 'Use the text'}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path d="M3 8.5l3.2 3.2L13 4.8" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      </div>
    </div>
  )
}
