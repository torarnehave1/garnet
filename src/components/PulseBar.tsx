import { beatsPerMinute, PULSE_CAP, RIPPLE_SECONDS, PULSE_DAYS, PULSE_STEPS, pulseText, type PulseMode } from '../lib/pulse'
import type { PulseSummary } from '../lib/usePulse'

// What the pulse layer shows, in words: how many graphs changed in the week and how often, how to
// read the rings, and the three graphs with the most changes (a press shows one on the map).
export function PulseBar({ mode, sum, onShow }: { mode: PulseMode; sum: PulseSummary | null; onShow: (id: string) => void }) {
  if (mode === 'off' || !sum) return null
  const reading = !sum.done && sum.toRead > 0
  return (
    <div className="pulse" role="status">
      <div className="pulseHead">
        Pulse, last {PULSE_DAYS} days:{' '}
        {sum.changed ? (
          <>
            <b>{sum.changed.toLocaleString()}</b> {sum.changed === 1 ? 'graph' : 'graphs'} · <b>{sum.changes.toLocaleString()}</b> saved{' '}
            {sum.changes === 1 ? 'change' : 'changes'}
            {reading && (
              <>
                {' '}
                · reading {sum.read} of {sum.toRead}…
              </>
            )}
          </>
        ) : (
          'no graph on the map was changed'
        )}
      </div>
      {sum.changed > 0 && mode === 'color' && (
        <div className="pulseKey" aria-label="Ring colour by number of saved changes">
          {PULSE_STEPS.map((s) => (
            <span key={s.from} className="pulseStep">
              <i style={{ borderColor: s.color, background: s.color + '2e' }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
      {sum.changed > 0 && mode === 'count' && (
        <div className="pulseNote">
          The label is the graph’s version number, for example V. 12. It appears as each graph’s history is read. Zoom in to see them
          all.
        </div>
      )}
      {sum.changed > 0 && mode === 'beat' && (
        <div className="pulseNote">
          A faster beat means more changes: 1 beats about {Math.round(beatsPerMinute(1))} times a minute, {PULSE_CAP}+ about{' '}
          {Math.round(beatsPerMinute(PULSE_CAP))}.
        </div>
      )}
      {sum.changed > 0 && mode === 'ripple' && (
        <div className="pulseNote">
          One ring for each change, sent out like ripples in water: 2 is a small stir, 12 a wide wave. Each ring takes{' '}
          {RIPPLE_SECONDS} seconds to fade. Colour as in Colour.
        </div>
      )}
      {sum.top.length > 0 && (
        <div className="pulseTop">
          Most changed:{' '}
          {sum.top.map((t) => (
            <button key={t.id} type="button" className="ghost" onClick={() => onShow(t.id)} title="Show on the map">
              {t.title.length > 22 ? t.title.slice(0, 21) + '…' : t.title} ({pulseText(t.n)})
            </button>
          ))}
        </div>
      )}
      {(sum.capped > 0 || sum.failed > 0 || sum.skipped > 0) && (
        <div className="pulseNote">
          {sum.capped > 0 && `${PULSE_CAP}+ on ${sum.capped}: the store keeps ${PULSE_CAP} versions, so the true number may be higher. `}
          {sum.failed > 0 && `History not read for ${sum.failed}: shown as one change. `}
          {sum.skipped > 0 && `Counted: the ${sum.toRead} most recently changed. The other ${sum.skipped} are shown as one change.`}
        </div>
      )}
    </div>
  )
}
