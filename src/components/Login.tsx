import { useEffect, useState } from 'react'
import { sendMagicLink } from '../api/auth'
import { DEFAULT_BRAND, loadBrand, type Brand as BrandData } from '../api/brand'
import { Brand } from './Brand'

// Garnet's own sign-in page: one email field, a magic link by email. Same flow as Contacts.
export function Login({ error }: { error?: string }) {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(error || '')
  const [b, setB] = useState<BrandData>(DEFAULT_BRAND)
  useEffect(() => {
    loadBrand().then(setB)
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim() || busy) return
    setBusy(true)
    setErr('')
    try {
      await sendMagicLink(email)
      setSent(true)
    } catch (x) {
      setErr((x as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="login">
      <div className="loginNet" aria-hidden="true" />
      <section className="loginCard" aria-labelledby="loginTitle">
        <Brand big name={b.name} slogan={b.slogan} logoUrl={b.logoUrl} />
        <p className="loginLead" id="loginTitle">
          {b.login.lead}
        </p>
        {sent ? (
          <div className="loginSent" role="status">
            <h2>{b.login.sentTitle}</h2>
            <p>
              A sign-in link is on its way to <b>{email}</b>. Open it on this device to come back here signed in.
            </p>
            <button
              className="ghost"
              type="button"
              onClick={() => {
                setSent(false)
                setEmail('')
              }}
            >
              Use another email
            </button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <label htmlFor="loginEmail">Email address</label>
            <input
              id="loginEmail"
              type="email"
              required
              autoComplete="email"
              placeholder="name@example.com"
              value={email}
              disabled={busy}
              onChange={(e) => setEmail(e.target.value)}
            />
            {err && (
              <p className="loginErr" role="alert">
                {err}
              </p>
            )}
            <button type="submit" disabled={busy || !email.trim()} style={{ background: b.accent }}>
              {busy ? 'Sending link…' : b.login.button}
            </button>
          </form>
        )}
        <p className="loginFoot">{b.login.footer}</p>
      </section>
    </main>
  )
}
