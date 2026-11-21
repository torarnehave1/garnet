import type { User } from '../lib/types'

// The chat runs on the VEGR.AI MCP server itself: POST knowledge.vegvisr.org/mcp/chat, with the
// same login token as every other call Garnet makes to the server (mcp.ts). The server holds the
// model choice and runs the same tools as the person's own Claude connection.
//
// Architect's decision 2026-11-18 / 21: Garnet talks to the MCP server directly and does not depend
// on Agent-Builder. Until 21 Nov this file called agent.vegvisr.org/chat (agent-worker).
//
// YES BEFORE CHANGE is the server's rule, in code: a tool that changes something stops the turn
// with an `approval` event. The panel shows Yes / No and calls sendChat again with `resume`.
const CHAT_URL = 'https://knowledge.vegvisr.org/mcp/chat'

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string | unknown[] // blocks (image, document, text) when files are attached (attachments.ts)
}

export interface PendingCall {
  callId: string
  name: string
  args: Record<string, unknown>
}
// The paused turns: kept by the panel and sent back unchanged with the person's answer.
export type PausedState = Record<string, unknown>

export type ChatEvent =
  | { type: 'text'; content: string }
  | { type: 'model'; model: string }
  | { type: 'tool_call'; callId: string; name: string; args: Record<string, unknown>; write: boolean }
  | { type: 'tool_result'; callId: string; ok: boolean; summary: string }
  | { type: 'approval'; calls: PendingCall[]; state: PausedState }
  | { type: 'error'; error: string }
  | { type: 'done' }

export async function sendChat(
  user: User,
  messages: ChatTurn[],
  graphId: string | null,
  view: string, // what the map shows now (chatContext.ts)
  onEvent: (e: ChatEvent) => void,
  signal: AbortSignal,
  resume?: { state: PausedState; decisions: Record<string, boolean> },
): Promise<void> {
  if (!user.token) throw new Error('Sign in to chat.')
  const r = await fetch(CHAT_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + user.token, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ messages, graphId: graphId || undefined, view, ...(resume ? { resume } : {}) }),
    signal,
  })
  if (r.status === 401) throw new Error('Your login is no longer valid. Sign in again.')
  if (!r.ok || !r.body) {
    let msg = `The chat answered HTTP ${r.status}.`
    try {
      const j = await r.json()
      if (j?.error) msg = typeof j.error === 'string' ? j.error : j.error.message || JSON.stringify(j.error)
    } catch {
      /* keep the status */
    }
    throw new Error(msg)
  }

  const reader = r.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let cut: number
    while ((cut = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, cut)
      buf = buf.slice(cut + 2)
      let name = 'message'
      let data = ''
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) name = line.slice(6).trim()
        else if (line.startsWith('data:')) data += line.slice(5).trim()
      }
      let d: Record<string, unknown> = {}
      try {
        d = data ? JSON.parse(data) : {}
      } catch {
        continue
      }
      if (name === 'text' && typeof d.content === 'string') onEvent({ type: 'text', content: d.content })
      else if (name === 'model' && typeof d.model === 'string') onEvent({ type: 'model', model: d.model })
      else if (name === 'tool_call')
        onEvent({
          type: 'tool_call',
          callId: String(d.callId),
          name: String(d.name || '?'),
          args: d.args && typeof d.args === 'object' ? (d.args as Record<string, unknown>) : {},
          write: d.write === true,
        })
      else if (name === 'tool_result')
        onEvent({ type: 'tool_result', callId: String(d.callId), ok: d.ok !== false, summary: String(d.summary || '') })
      else if (name === 'approval' && Array.isArray(d.calls))
        onEvent({ type: 'approval', calls: d.calls as PendingCall[], state: (d.state || {}) as PausedState })
      else if (name === 'error') onEvent({ type: 'error', error: String(d.error || 'The chat stopped with an error.') })
      else if (name === 'done') onEvent({ type: 'done' })
    }
  }
}
