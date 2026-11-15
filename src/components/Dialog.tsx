import { useEffect, useRef, useState } from 'react'

export interface DialogSpec {
  title: string
  text: string
  input?: string
  ok?: string
  cancel?: string
  danger?: boolean
  run: (value: string) => Promise<void>
}

// Garnet changes nothing by itself: each action names the graph, says what will happen and waits for a yes.
export function Dialog({ spec, onClose, why }: { spec: DialogSpec; onClose: () => void; why: (e: unknown) => string }) {
  const [value, setValue] = useState(spec.input ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    setValue(spec.input ?? '')
    setErr('')
    setBusy(false)
    if (spec.input != null) {
      inputRef.current?.focus()
      inputRef.current?.select()
    } else cancelRef.current?.focus()
  }, [spec])

  async function run() {
    if (busy) return
    setBusy(true)
    setErr('')
    try {
      await spec.run(value)
    } catch (e) {
      setErr(why(e))
      setBusy(false)
    }
  }

  return (
    <div className="veil" role="dialog" aria-modal="true" aria-labelledby="dlgTitle" onKeyDown={(e) => e.key === 'Escape' && !busy && onClose()}>
      <div className="dlgbox">
        <h2 id="dlgTitle">{spec.title}</h2>
        <p>{spec.text}</p>
        {spec.input != null && (
          <input
            ref={inputRef}
            type="text"
            className="dlgInput"
            autoComplete="off"
            aria-label="New title"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                run()
              }
            }}
          />
        )}
        {err && (
          <p className="dlgerr" role="alert">
            {err}
          </p>
        )}
        <div className="dlgrow">
          <button ref={cancelRef} className="ghost" type="button" onClick={() => !busy && onClose()}>
            {spec.cancel || 'Cancel'}
          </button>{' '}
          <button type="button" className={spec.danger ? 'danger' : ''} disabled={busy} onClick={run}>
            {busy ? 'Working…' : spec.ok || 'OK'}
          </button>
        </div>
      </div>
    </div>
  )
}
