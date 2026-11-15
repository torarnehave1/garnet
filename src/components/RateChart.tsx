import { useEffect, useRef } from 'react'
import type { Engine, Snapshot } from '../engine/Engine'
import { monthOf } from '../lib/rows'

// New graphs and new nodes per month. Dragging in it moves the playhead.
export function RateChart({ engine, snap }: { engine: Engine | null; snap: Snapshot }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const scrubbing = useRef(false)
  const M = engine?.months || null
  const on = !!M && !snap.skeleton && snap.N > 0

  // Where the playhead is: the month of the newest graph shown, plus how far into that month.
  let cur: { t: number } | null = null
  let f = 0
  let ix = 0
  if (on && engine && M) {
    for (let i = snap.kk - 1; i >= 0; i--)
      if (engine.graphs[i]?.t) {
        cur = engine.graphs[i]
        break
      }
    if (cur) {
      const d = new Date(cur.t)
      const dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
      ix = d.getFullYear() * 12 + d.getMonth() - M.base
      f = ix + (d.getDate() - 0.5) / dim
    }
  }

  useEffect(() => {
    const cv = ref.current
    if (!cv || !M || !on) return
    const w = cv.clientWidth
    const h = cv.clientHeight
    const r = Math.min(2, window.devicePixelRatio || 1)
    if (!w || !h) return
    if (cv.width !== Math.round(w * r) || cv.height !== Math.round(h * r)) {
      cv.width = Math.round(w * r)
      cv.height = Math.round(h * r)
    }
    const c = cv.getContext('2d')!
    const Lp = 4
    const Rp = 4
    const Tp = 6
    const B = 14
    const pw = w - Lp - Rp
    const ph = h - Tp - B
    c.setTransform(r, 0, 0, r, 0, 0)
    c.clearRect(0, 0, w, h)
    const X = (v: number) => Lp + (v / M.n) * pw
    const curve = (arr: number[], max: number, color: string, alpha: number, fill: boolean) => {
      c.beginPath()
      arr.forEach((v, i) => {
        const x = X(i + 0.5)
        const y = Tp + ph - (v / max) * ph
        if (i) c.lineTo(x, y)
        else c.moveTo(x, y)
      })
      c.globalAlpha = alpha
      c.strokeStyle = color
      c.lineWidth = 1.8
      c.lineJoin = 'round'
      c.stroke()
      if (fill) {
        c.lineTo(X(arr.length - 0.5), Tp + ph)
        c.lineTo(X(0.5), Tp + ph)
        c.closePath()
        c.globalAlpha = alpha * 0.16
        c.fillStyle = color
        c.fill()
      }
      c.globalAlpha = 1
    }
    c.strokeStyle = '#27385a'
    c.lineWidth = 1
    c.beginPath()
    c.moveTo(Lp, Tp + ph + 0.5)
    c.lineTo(Lp + pw, Tp + ph + 0.5)
    c.stroke()
    c.fillStyle = '#8fa0b8'
    c.font = "10px 'IBM Plex Sans',system-ui,sans-serif"
    c.textBaseline = 'alphabetic'
    for (let m = 0; m < M.n; m++) {
      const mo = (M.base + m) % 12
      const yr = Math.floor((M.base + m) / 12)
      if (m === 0 || mo === 0) {
        c.beginPath()
        c.moveTo(X(m) + 0.5, Tp)
        c.lineTo(X(m) + 0.5, Tp + ph)
        c.globalAlpha = 0.5
        c.stroke()
        c.globalAlpha = 1
        c.textAlign = m === 0 ? 'left' : 'center'
        c.fillText(m === 0 ? new Date(yr, mo, 1).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : String(yr), m === 0 ? Lp : X(m), h - 2)
      }
    }
    curve(M.np, M.nmax, '#6fd3c7', 0.28, false)
    curve(M.gp, M.gmax, '#f2b45a', 0.28, false)
    if (cur) {
      c.save()
      c.beginPath()
      c.rect(0, 0, X(f), h)
      c.clip()
      curve(M.np, M.nmax, '#6fd3c7', 1, true)
      curve(M.gp, M.gmax, '#f2b45a', 1, true)
      c.restore()
      c.strokeStyle = '#e8eef7'
      c.lineWidth = 1
      c.beginPath()
      c.moveTo(X(f), Tp - 2)
      c.lineTo(X(f), Tp + ph)
      c.stroke()
    }
  })

  if (!on || !M || !engine) return null

  function scrub(ev: React.PointerEvent<HTMLCanvasElement>) {
    if (!engine || !M || !engine.N) return
    const box = ev.currentTarget.getBoundingClientRect()
    const pw = box.width - 8
    const fx = Math.max(0, Math.min(M.n, ((ev.clientX - box.left - 4) / pw) * M.n))
    const i = Math.min(M.n - 1, Math.floor(fx))
    const yr = Math.floor((M.base + i) / 12)
    const mo = (M.base + i) % 12
    const dim = new Date(yr, mo + 1, 0).getDate()
    const t = new Date(yr, mo, 1).getTime() + (fx - i) * dim * 86400000
    engine.pause()
    engine.setK(fx >= M.n ? engine.N : engine.kAtTime(t))
  }

  return (
    <div className="rate">
      <canvas
        ref={ref}
        id="rate"
        aria-label="Speed of growth per month: new graphs and new nodes"
        onPointerDown={(e) => {
          scrubbing.current = true
          try {
            e.currentTarget.setPointerCapture(e.pointerId)
          } catch {
            /* capture not available */
          }
          scrub(e)
          e.preventDefault()
        }}
        onPointerMove={(e) => scrubbing.current && scrub(e)}
        onPointerUp={() => (scrubbing.current = false)}
        onPointerCancel={() => (scrubbing.current = false)}
      />
      <div className="rateText">
        {cur ? (
          <>
            {monthOf(cur.t)}: <span className="g">{M.gp[ix].toLocaleString()} new graphs</span> · <span className="n">{M.np[ix].toLocaleString()} new nodes</span> in the month
          </>
        ) : (
          <>
            Per month: <span className="g">new graphs</span> (peak {M.gmax.toLocaleString()}) · <span className="n">new nodes</span> (peak {M.nmax.toLocaleString()})
          </>
        )}
      </div>
    </div>
  )
}
