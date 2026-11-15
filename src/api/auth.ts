import type { User } from '../lib/types'

// The <vegvisr-auth> bar keeps the signed-in person in localStorage under `vegvisr_user`
// as { email, role, token }, and sends `vegvisr-auth-changed` on login and logout.
const STORE_KEY = 'vegvisr_user'
export const AUTH_CHANGED = 'vegvisr-auth-changed'
export const AUTH_SCRIPT = 'https://api.vegvisr.org/components/vegvisr-auth.js'

export function readUser(): User | null {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return null
    const u = JSON.parse(raw)
    if (u && typeof u.email === 'string' && u.email) {
      return { email: u.email, role: u.role || null, token: u.token || null }
    }
  } catch {
    /* storage blocked or bad JSON: treat as signed out */
  }
  return null
}

export function isSuperadmin(u: User | null): boolean {
  return !!u && String(u.role || '').toLowerCase() === 'superadmin'
}

let loading: Promise<void> | null = null
export function loadAuthScript(): Promise<void> {
  if (loading) return loading
  loading = new Promise((resolve, reject) => {
    if (customElements.get('vegvisr-auth')) return resolve()
    const s = document.createElement('script')
    s.src = AUTH_SCRIPT
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('The login bar could not be loaded'))
    document.head.append(s)
  })
  return loading
}
