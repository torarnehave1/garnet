import { useEffect, useState } from 'react'
import { sendMagicLink } from '../api/auth'
import { DEFAULT_BRAND, loadBrand, type Brand as BrandData } from '../api/brand'
import { readLang, saveLang, T, type Lang } from '../lib/lang'
import { Brand } from './Brand'

// Garnet's own sign-in page: one email field, a magic link by email. Same flow as Contacts.
// Norsk / English: the choice sets the page text and the language of the sign-in email.
export function Login({ error }: { error?: string }) {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(error || '')
  const [b, setB] = useState<BrandData>(DEFAULT_BRAND)
  const [lang, setLang] = useState<Lang>(readLang)
  useEffect(() => {
    loadBrand().then(setB)
  }, [])
  const t = T[lang]
  const l = b.login[lang]

  function choose(next: Lang) {
    setLang(next)
    saveLang(next)
    document.documentElement.lang = next === 'no' ? 'nb' : 'en'
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim() || busy) return
    setBusy(true)
    setErr('')
    try {
      await sendMagicLink(email, lang)
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
        <div className="langSwitch" role="group" aria-label="Language / Språk">
          <button type="button" className={lang === 'no' ? 'on' : ''} aria-pressed={lang === 'no'} onClick={() => choose('no')}>
            Norsk
          </button>
          <button type="button" className={lang === 'en' ? 'on' : ''} aria-pressed={lang === 'en'} onClick={() => choose('en')}>
            English
          </button>
        </div>
        <Brand big name={b.name} slogan={b.slogan} logoUrl={b.logoUrl} lang={lang} />
        <p className="loginLead" id="loginTitle">
          {l.lead}
        </p>
        {sent ? (
          <div className="loginSent" role="status">
            <h2>{l.sentTitle}</h2>
            <p>{t.sentBody(email)}</p>
            <button
              className="ghost"
              type="button"
              onClick={() => {
                setSent(false)
                setEmail('')
              }}
            >
              {t.another}
            </button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <label htmlFor="loginEmail">{t.email}</label>
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
              {busy ? t.sending : l.button}
            </button>
          </form>
        )}
        <p className="loginFoot">{l.footer}</p>
      </section>
    </main>
  )
}
