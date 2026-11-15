import type { Lang } from '../lib/lang'
import type { User } from '../lib/types'

// Magic-link login, the same flow as the Contacts app:
//   1. POST cookie.vegvisr.org/login/magic/send { email, redirectUrl } — the email worker picks the
//      email template from the domain of redirectUrl.
//   2. The link comes back as ?magic=<token>; GET /login/magic/verify answers { email, apiToken }.
//   3. The role is read by email from the dashboard worker.
// The person is kept in this browser's localStorage under `vegvisr_user` as { email, role, token }.
const AUTH = 'https://cookie.vegvisr.org'
const DASH = 'https://dashboard.vegvisr.org'
const STORE_KEY = 'vegvisr_user'

export function readUser(): User | null {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return null
    const u = JSON.parse(raw)
    if (u && typeof u.email === 'string' && u.email && typeof u.token === 'string' && u.token) {
      return { email: u.email, role: u.role || null, token: u.token }
    }
  } catch {
    /* storage blocked or bad JSON: signed out */
  }
  return null
}

function writeUser(u: User) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(u))
  } catch {
    /* storage blocked: the session lasts until reload */
  }
}

export function clearUser() {
  try {
    localStorage.removeItem(STORE_KEY)
  } catch {
    /* storage blocked */
  }
}

export function isSuperadmin(u: User | null): boolean {
  return !!u && String(u.role || '').toLowerCase() === 'superadmin'
}

// The page to come back to: this one, without any old ?magic.
function returnUrl() {
  const u = new URL(window.location.href)
  u.searchParams.delete('magic')
  return u.toString()
}

export async function sendMagicLink(email: string, lang: Lang): Promise<void> {
  const r = await fetch(`${AUTH}/login/magic/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email.trim(), redirectUrl: returnUrl(), lang }),
  })
  const d = await r.json().catch(() => ({}))
  if (!r.ok || !d.success) throw new Error(d.error || 'The sign-in link could not be sent.')
}

// The ?magic= token in the address, if this page was opened from a sign-in link.
export function magicInUrl(): string | null {
  try {
    return new URL(window.location.href).searchParams.get('magic')
  } catch {
    return null
  }
}

export async function completeMagicLink(magic: string): Promise<User> {
  const r = await fetch(`${AUTH}/login/magic/verify?token=${encodeURIComponent(magic)}`, { headers: { Accept: 'application/json' } })
  const d = await r.json().catch(() => ({}))
  if (!r.ok || !d.success || !d.email) throw new Error(d.error || 'The sign-in link is invalid or has expired.')
  if (!d.apiToken) throw new Error('The sign-in link was accepted, but no login token came back. Ask for a new link.')
  let role: string | null = null
  try {
    const rr = await fetch(`${DASH}/get-role?email=${encodeURIComponent(d.email)}`, { headers: { Accept: 'application/json' } })
    if (rr.ok) role = (await rr.json())?.role || null
  } catch {
    /* role is only shown, never trusted: the server decides */
  }
  const user: User = { email: d.email, role, token: d.apiToken }
  writeUser(user)
  window.history.replaceState({}, '', returnUrl())
  return user
}
