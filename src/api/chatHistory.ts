import type { MapState } from '../lib/chatContext'
import type { User } from '../lib/types'

// Garnet's chats are kept in the same store as Agent-Builder's (chat-history-worker), marked
// provider "garnet". That provider is protected: the store only reads or changes these sessions for
// the owner's login token (X-API-Token), never on a bare user id.
const API = 'https://api.vegvisr.org/chat-history'
export const PROVIDER = 'garnet'

export interface ChatSession {
  id: string
  title: string
  graphId: string | null
  updatedAt: string
}
/** What the map showed when a question was asked (chatContext.ts): one line and the model's full view. */
export interface ViewNote {
  line: string
  text: string
  state?: MapState // to set the map back (absent on questions saved before 2026-11-17 evening)
}
export interface SavedMessage {
  role: 'user' | 'assistant'
  content: string
  model?: string
  context?: ViewNote
}

async function call<T>(user: User, path: string, init: RequestInit = {}): Promise<T> {
  if (!user.token) throw new Error('Sign in to keep chats.')
  const r = await fetch(API + path, {
    ...init,
    credentials: 'omit',
    headers: { 'Content-Type': 'application/json', 'X-API-Token': user.token },
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j?.error || `Chat history answered HTTP ${r.status}.`)
  return j as T
}

export async function listSessions(user: User): Promise<ChatSession[]> {
  const j = await call<{ sessions?: ChatSession[] }>(user, `/sessions?provider=${PROVIDER}`)
  return (j.sessions || []).map((s) => ({ id: s.id, title: s.title, graphId: s.graphId, updatedAt: s.updatedAt }))
}

export async function createSession(user: User, title: string, graphId: string | null): Promise<string> {
  const j = await call<{ session?: { id: string } }>(user, '/sessions', {
    method: 'POST',
    body: JSON.stringify({ provider: PROVIDER, title, graphId }),
  })
  if (!j.session?.id) throw new Error('Chat history made no session.')
  return j.session.id
}

export async function touchSession(user: User, id: string, title: string, graphId: string | null): Promise<void> {
  // The same upsert bumps updated_at, so the session moves to the top of the list.
  await call(user, '/sessions', {
    method: 'POST',
    body: JSON.stringify({ sessionId: id, provider: PROVIDER, title, graphId }),
  })
}

export async function addMessage(user: User, sessionId: string, m: SavedMessage): Promise<void> {
  await call(user, '/messages', {
    method: 'POST',
    body: JSON.stringify({
      sessionId,
      role: m.role,
      content: m.content,
      // selection_meta holds Garnet's notes on a message: the model that answered, the map's view.
      selectionMeta: m.model || m.context ? { model: m.model, context: m.context } : null,
    }),
  })
}

export async function loadMessages(user: User, sessionId: string): Promise<SavedMessage[]> {
  const j = await call<{
    messages?: { role: string; content?: string; selectionMeta?: { model?: string; context?: ViewNote } | null }[]
  }>(user, `/messages?sessionId=${encodeURIComponent(sessionId)}&decrypt=1&limit=200`)
  // Newest first from the store; the chat reads oldest first.
  return (j.messages || [])
    .slice()
    .reverse()
    .filter((m) => m.content)
    .map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content || '',
      model: m.selectionMeta?.model,
      context: m.selectionMeta?.context?.line ? m.selectionMeta.context : undefined,
    }))
}

export async function deleteSession(user: User, id: string): Promise<void> {
  await call(user, `/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' })
}
