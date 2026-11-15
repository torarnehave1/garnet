import { useEffect, useState } from 'react'
import type { User } from '../lib/types'

// System Owner "Login as…", the same as Contacts and Agent-Builder: api.vegvisr.org/realtime/admin/*
// answers only a System Owner (403 for everyone else, and then this renders nothing).
// Logging in as someone swaps the stored login for theirs and keeps the real one under BACKUP_KEY,
// so every MCP call afterwards is made as that person — Garnet then shows exactly their view.
const API = 'https://api.vegvisr.org/realtime'
const STORE_KEY = 'vegvisr_user'
const BACKUP_KEY = 'garnet_original_user'

interface AdminUser {
  email: string
  role: string | null
  displayName: string | null
  isSystemOwner: boolean
}

export function isImpersonating(): boolean {
  try {
    return !!localStorage.getItem(BACKUP_KEY)
  } catch {
    return false
  }
}

// Back to the real login. Also used on sign-out, so a sign-out never leaves the borrowed login behind.
export function returnToOwnLogin(): boolean {
  try {
    const orig = localStorage.getItem(BACKUP_KEY)
    if (!orig) return false
    localStorage.setItem(STORE_KEY, orig)
    localStorage.removeItem(BACKUP_KEY)
    return true
  } catch {
    return false
  }
}

export function ImpersonationBar({ user }: { user: User }) {
  const impersonating = isImpersonating()
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [open, setOpen] = useState(false)
  const [pick, setPick] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  // Only a System Owner gets the list; anyone else gets 403 and sees nothing.
  useEffect(() => {
    if (impersonating || !user.token) return
    let live = true
    fetch(`${API}/admin/users`, { headers: { 'X-API-Token': user.token } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (live && d?.success) setUsers((d.users || []).filter((u: AdminUser) => u.email !== user.email))
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [user.token, user.email, impersonating])

  async function go() {
    const email = pick.trim()
    if (!email || busy) return
    setBusy(true)
    setErr('')
    try {
      const r = await fetch(`${API}/admin/impersonate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Token': user.token || '' },
        body: JSON.stringify({ email }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok || !d.success || !d.user?.emailVerificationToken) throw new Error(d.error || `Login as failed (HTTP ${r.status})`)
      // Keep the TRUE original login; never overwrite an existing backup.
      if (!localStorage.getItem(BACKUP_KEY)) localStorage.setItem(BACKUP_KEY, localStorage.getItem(STORE_KEY) || '')
      localStorage.setItem(STORE_KEY, JSON.stringify({ email: d.user.email, role: d.user.role || null, token: d.user.emailVerificationToken }))
      window.location.reload()
    } catch (e) {
      setErr((e as Error).message)
      setBusy(false)
    }
  }

  if (impersonating)
    return (
      <div className="impersonating" role="status">
        <span>
          Viewing as <b>{user.email}</b>
          {user.role ? ` (${user.role})` : ''} — Login as by System Owner
        </span>
        <button
          type="button"
          onClick={() => {
            returnToOwnLogin()
            window.location.reload()
          }}
        >
          Return to my account
        </button>
      </div>
    )

  if (!users || !users.length) return null

  return open ? (
    <div className="loginAs">
      <input
        list="garnet-users"
        placeholder="Login as… (email)"
        aria-label="Login as user"
        value={pick}
        autoFocus
        onChange={(e) => setPick(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') go()
          if (e.key === 'Escape') setOpen(false)
        }}
      />
      <datalist id="garnet-users">
        {users.map((u) => (
          <option key={u.email} value={u.email}>
            {(u.displayName ? u.displayName + ' · ' : '') + (u.role || 'no role') + (u.isSystemOwner ? ' ★' : '')}
          </option>
        ))}
      </datalist>
      <button type="button" disabled={!pick.trim() || busy} onClick={go}>
        {busy ? 'Switching…' : 'Go'}
      </button>
      <button type="button" className="ghost" onClick={() => setOpen(false)}>
        Cancel
      </button>
      {err && <span className="loginAsErr">{err}</span>}
    </div>
  ) : (
    <button type="button" className="ghost" onClick={() => setOpen(true)}>
      Login as…
    </button>
  )
}
