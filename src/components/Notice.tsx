import type { ReactNode } from 'react'

// A message to the person, as one recognisable box (architect 2026-11-21): a bold headline that
// says what happened, then at most a sentence or two on why or what to do. Not an error dump.
// kind "problem" for something that did not work, "info" for a plain message or a confirmation.
export function Notice({ head, body, kind = 'info', children }: { head: string; body?: string; kind?: 'info' | 'problem'; children?: ReactNode }) {
  return (
    <div className={'notice ' + kind} role={kind === 'problem' ? 'alert' : 'status'}>
      <span className="notice-icon" aria-hidden="true">
        {kind === 'problem' ? '!' : 'i'}
      </span>
      <div className="notice-text">
        <strong>{head}</strong>
        {body && <p>{body}</p>}
        {children}
      </div>
    </div>
  )
}
