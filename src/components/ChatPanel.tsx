import { useEffect, useRef, useState } from 'react'
import { sendChat, type ChatTurn } from '../api/agentChat'
import { CHAT_MODELS, chatModelName, DEFAULT_CHAT_MODEL } from '../lib/chatModels'
import { inlineMd } from '../lib/inlineMd'
import type { User } from '../lib/types'

// A chat on the left, with any Agent-Builder chat model. Its tools are the VEGR.AI MCP server's,
// as the signed-in person (agentChat.ts). The selected graph is passed along as "this graph".
interface Step {
  callId: string
  name: string
  ok: boolean | null
  summary: string
}
interface Msg {
  role: 'user' | 'assistant'
  text: string
  model?: string
  steps?: Step[]
  error?: string
}

const MODEL_KEY = 'garnet-chat-model-v1'
function readModel() {
  try {
    const m = localStorage.getItem(MODEL_KEY)
    return m && CHAT_MODELS.some((c) => c.id === m) ? m : DEFAULT_CHAT_MODEL
  } catch {
    return DEFAULT_CHAT_MODEL
  }
}

export function ChatPanel({
  user,
  hidden,
  graph,
  view,
  onClose,
  onWrote,
  shownCount,
}: {
  user: User
  hidden: boolean
  graph: { id: string; title: string } | null
  view: () => string // read at send time, so each message carries what the map shows then
  onClose: () => void
  onWrote: () => void
  shownCount: number
}) {
  const context = `Sees the ${shownCount} graphs on the map` + (graph ? ` · selected: ${graph.title}` : '')
  const [model, setModel] = useState(readModel)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const abort = useRef<AbortController | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight })
  }, [msgs])
  useEffect(() => {
    if (!hidden) box.current?.focus()
  }, [hidden])
  useEffect(() => () => abort.current?.abort(), [])

  function pickModel(id: string) {
    setModel(id)
    try {
      localStorage.setItem(MODEL_KEY, id)
    } catch {
      /* storage blocked */
    }
  }

  // Patch the answer being written (always the last message).
  const patchLast = (f: (m: Msg) => Msg) => setMsgs((ms) => ms.map((m, i) => (i === ms.length - 1 ? f(m) : m)))

  async function send() {
    const text = draft.trim()
    if (!text || busy) return
    const history: ChatTurn[] = [
      ...msgs.filter((m) => m.text).map((m) => ({ role: m.role, content: m.text })),
      { role: 'user', content: text },
    ]
    setDraft('')
    setMsgs((ms) => [...ms, { role: 'user', text }, { role: 'assistant', text: '', model, steps: [] }])
    setBusy(true)
    const ctl = new AbortController()
    abort.current = ctl
    let wrote = false
    try {
      await sendChat(
        user,
        model,
        history,
        graph?.id || null,
        view(),
        (e) => {
          if (e.type === 'text') patchLast((m) => ({ ...m, text: m.text ? m.text + '\n\n' + e.content : e.content }))
          else if (e.type === 'model') patchLast((m) => ({ ...m, model: e.model }))
          else if (e.type === 'tool_call') {
            if (!/(^|_)(list|get|search|read|query|preview)/.test(e.name) && e.name !== 'list tools') wrote = true
            patchLast((m) => ({ ...m, steps: [...(m.steps || []), { callId: e.callId, name: e.name, ok: null, summary: '' }] }))
          } else if (e.type === 'tool_result')
            patchLast((m) => ({
              ...m,
              steps: (m.steps || []).map((s) => (s.callId === e.callId ? { ...s, ok: e.ok, summary: e.summary } : s)),
            }))
          else if (e.type === 'error') patchLast((m) => ({ ...m, error: e.error }))
        },
        ctl.signal,
      )
    } catch (err) {
      if (!ctl.signal.aborted) patchLast((m) => ({ ...m, error: err instanceof Error ? err.message : String(err) }))
      else patchLast((m) => ({ ...m, error: 'Stopped.' }))
    } finally {
      setBusy(false)
      abort.current = null
      // A tool that may have changed something: the map reads the graphs again.
      if (wrote) onWrote()
    }
  }

  return (
    <aside className="chatpanel" hidden={hidden} aria-label="Chat">
      <div className="panelhead">
        <strong>Chat</strong>
        <button className="x" type="button" aria-label="Close the chat" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="chatbar">
        <select aria-label="Model" value={model} onChange={(e) => pickModel(e.target.value)} disabled={busy}>
          {['Anthropic', 'OpenAI', 'Grok', 'Gemini', 'Kimi'].map((g) => (
            <optgroup key={g} label={g}>
              {CHAT_MODELS.filter((m) => m.group === g).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {msgs.length > 0 && (
          <button className="ghost" type="button" disabled={busy} onClick={() => setMsgs([])}>
            New chat
          </button>
        )}
      </div>
      <div className="chatlist" ref={list}>
        {!msgs.length && (
          <p className="muted">
            Ask about your graphs. The chat uses the VEGR.AI MCP tools as {user.email}; it asks before it changes anything.
          </p>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={'cmsg ' + m.role}>
            {m.role === 'assistant' && <div className="cwho">{chatModelName(m.model || '')}</div>}
            {m.steps && m.steps.length > 0 && (
              <ul className="csteps">
                {m.steps.map((s) => (
                  <li key={s.callId} className={s.ok === null ? 'run' : s.ok ? 'ok' : 'bad'} title={s.summary}>
                    {s.ok === null ? '…' : s.ok ? '✓' : '✗'} {s.name}
                  </li>
                ))}
              </ul>
            )}
            {m.text && <div className="ctext">{m.role === 'assistant' ? inlineMd(m.text) : m.text}</div>}
            {m.role === 'assistant' && !m.text && !m.error && busy && i === msgs.length - 1 && <div className="muted">Working…</div>}
            {m.error && <div className="cerr">{m.error}</div>}
          </div>
        ))}
      </div>
      <form
        className="chatform"
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
      >
        <div className="cctx">{context}</div>
        <textarea
          ref={box}
          rows={3}
          value={draft}
          placeholder="Message…"
          aria-label="Message"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              send()
            }
          }}
        />
        {busy ? (
          <button type="button" onClick={() => abort.current?.abort()}>
            Stop
          </button>
        ) : (
          <button type="submit" disabled={!draft.trim()}>
            Send
          </button>
        )}
      </form>
    </aside>
  )
}
