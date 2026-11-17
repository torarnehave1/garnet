import { useEffect, useRef, useState } from 'react'
import { sendChat, type ChatTurn } from '../api/agentChat'
import {
  addMessage,
  createSession,
  deleteSession,
  listSessions,
  loadMessages,
  touchSession,
  type ChatSession,
} from '../api/chatHistory'
import {
  AUDIO_ACCEPT,
  describe,
  FILE_ACCEPT,
  IMAGE_ACCEPT,
  isClaude,
  readFile,
  toContent,
  transcribe,
  uploadImage,
  type Attachment,
} from '../lib/attachments'
import { CHAT_MODELS, chatModelName, DEFAULT_CHAT_MODEL } from '../lib/chatModels'
import { chatMd, inlineMd } from '../lib/inlineMd'
import type { User } from '../lib/types'

// A chat on the left, with any Agent-Builder chat model. Its tools are the VEGR.AI MCP server's,
// as the signed-in person (agentChat.ts). The selected graph is passed along as "this graph".
// Each question and its answer are kept in Agent-Builder's chat history, marked "garnet"
// (chatHistory.ts); History reopens an earlier chat. Images, PDFs and text files go with a message;
// an audio file is transcribed into the chat (attachments.ts).
interface Step {
  callId: string
  name: string
  ok: boolean | null
  summary: string
  note?: boolean // text the model wrote before a tool call, shown dim among the steps
}
interface Msg {
  role: 'user' | 'assistant'
  text: string
  model?: string
  steps?: Step[]
  error?: string
  files?: Attachment[] // what went with a question (not kept in the saved history)
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
  const [sessions, setSessions] = useState<ChatSession[] | null>(null) // the History list, when open
  const [histErr, setHistErr] = useState('')
  const sessionId = useRef<string | null>(null)
  const saving = useRef<Promise<void>>(Promise.resolve())
  const [openId, setOpenId] = useState<string | null>(null) // the same id, for drawing the list
  const abort = useRef<AbortController | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  const [pending, setPending] = useState<Attachment[]>([]) // files waiting to go with the next message
  const [uploading, setUploading] = useState(0)
  const [fileErr, setFileErr] = useState('')
  const imageIn = useRef<HTMLInputElement>(null)
  const fileIn = useRef<HTMLInputElement>(null)
  const audioIn = useRef<HTMLInputElement>(null)

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

  function newChat() {
    setMsgs([])
    sessionId.current = null
    setOpenId(null)
    setSessions(null)
    setHistErr('')
  }

  async function openHistory() {
    if (sessions) return setSessions(null)
    setHistErr('')
    try {
      setSessions(await listSessions(user))
    } catch (err) {
      setHistErr(err instanceof Error ? err.message : String(err))
    }
  }

  async function openSession(s: ChatSession) {
    setHistErr('')
    try {
      const saved = await loadMessages(user, s.id)
      setMsgs(saved.map((m) => ({ role: m.role, text: m.content, model: m.model })))
      sessionId.current = s.id
      setOpenId(s.id)
      setSessions(null)
    } catch (err) {
      setHistErr(err instanceof Error ? err.message : String(err))
    }
  }

  async function removeSession(s: ChatSession) {
    if (!window.confirm(`Delete the chat “${s.title}”? It cannot be brought back.`)) return
    try {
      await deleteSession(user, s.id)
      if (sessionId.current === s.id) newChat()
      setSessions((ss) => (ss || []).filter((x) => x.id !== s.id))
    } catch (err) {
      setHistErr(err instanceof Error ? err.message : String(err))
    }
  }

  // The question and its answer go to the chat history; the first one opens the session.
  async function keep(question: string, answer: string, ran: string) {
    try {
      const title = question.replace(/\s+/g, ' ').slice(0, 60)
      // Saves run one after another, so a quick second question cannot open a second session.
      await saving.current
      if (!sessionId.current) {
        sessionId.current = await createSession(user, title, graph?.id || null)
        setOpenId(sessionId.current)
      } else
        await touchSession(
          user,
          sessionId.current,
          msgs.find((m) => m.role === 'user')?.text.slice(0, 60) || title,
          graph?.id || null,
        )
      await addMessage(user, sessionId.current, { role: 'user', content: question })
      await addMessage(user, sessionId.current, { role: 'assistant', content: answer, model: ran })
    } catch (err) {
      setHistErr('Not saved to history: ' + (err instanceof Error ? err.message : String(err)))
    }
  }

  // Images are uploaded to the person's photos at once; PDFs and text files are read in the browser.
  async function attach(files: File[]) {
    setFileErr('')
    for (const f of files) {
      if (f.type.startsWith('audio/') || /\.(wav|mp3|m4a|aac|ogg|opus)$/i.test(f.name)) {
        void listen(f)
        continue
      }
      const image = f.type.startsWith('image/')
      if (image) setUploading((n) => n + 1)
      try {
        const a = image ? await uploadImage(user, f) : await readFile(f)
        setPending((p) => [...p, a])
      } catch (err) {
        setFileErr(err instanceof Error ? err.message : String(err))
      } finally {
        if (image) setUploading((n) => n - 1)
      }
    }
  }

  // An audio file becomes a transcript in the chat, which later questions can use.
  async function listen(file: File) {
    if (busy) return
    const question = `Transkriber lyd: «${file.name}»`
    setSessions(null)
    setHistErr('')
    setMsgs((ms) => [
      ...ms,
      { role: 'user', text: question },
      { role: 'assistant', text: '', model: 'whisper-1', steps: [] },
    ])
    setBusy(true)
    const ctl = new AbortController()
    abort.current = ctl
    try {
      const text = await transcribe(
        file,
        '',
        (status) => patchLast((m) => ({ ...m, steps: [{ callId: 'audio', name: status, ok: null, summary: '' }] })),
        ctl.signal,
      )
      const answer = `**Transkripsjon av «${file.name}»**\n\n${text || '(Ingen tale funnet)'}`
      patchLast((m) => ({
        ...m,
        text: answer,
        steps: [{ callId: 'audio', name: 'transcribe', ok: true, summary: '' }],
      }))
      saving.current = keep(question, answer, 'whisper-1')
    } catch (err) {
      patchLast((m) => ({
        ...m,
        steps: [],
        error: ctl.signal.aborted ? 'Stopped.' : err instanceof Error ? err.message : String(err),
      }))
    } finally {
      setBusy(false)
      abort.current = null
    }
  }

  // Patch the answer being written (always the last message).
  const patchLast = (f: (m: Msg) => Msg) => setMsgs((ms) => ms.map((m, i) => (i === ms.length - 1 ? f(m) : m)))

  async function send() {
    const text = draft.trim()
    const files = pending
    if ((!text && !files.length) || busy || uploading) return
    // Earlier questions go with their files again, so a follow-up still sees the PDF or image.
    const history: ChatTurn[] = [
      ...msgs
        .filter((m) => m.text || m.files?.length)
        .map((m) => ({ role: m.role, content: m.role === 'user' ? toContent(m.text, m.files) : m.text })),
      { role: 'user', content: toContent(text, files) },
    ]
    setDraft('')
    setPending([])
    setSessions(null)
    setHistErr('')
    setMsgs((ms) => [
      ...ms,
      { role: 'user', text, files: files.length ? files : undefined },
      { role: 'assistant', text: '', model, steps: [] },
    ])
    setBusy(true)
    const ctl = new AbortController()
    abort.current = ctl
    let wrote = false
    // Mirrors of what the handlers build in state, for saving once the answer is done.
    let answer = ''
    let lastNote = ''
    let ran = model
    try {
      await sendChat(
        user,
        model,
        history,
        graph?.id || null,
        view(),
        (e) => {
          // Text written before a tool call is a working note ("96 graphs; fetching the newest…"),
          // which the final answer usually repeats. It moves among the steps, dim, so the answer is
          // the text after the last tool call and nothing reads twice.
          if (e.type === 'text') {
            answer = answer ? answer + '\n\n' + e.content : e.content
            patchLast((m) => ({
              ...m,
              text: m.text ? m.text + '\n\n' + e.content : e.content,
            }))
          } else if (e.type === 'model') {
            ran = e.model
            patchLast((m) => ({ ...m, model: e.model }))
          } else if (e.type === 'tool_call') {
            if (answer.trim()) lastNote = answer.trim()
            answer = ''
            if (!/(^|_)(list|get|search|read|query|preview)/.test(e.name) && e.name !== 'list tools') wrote = true
            patchLast((m) => ({
              ...m,
              text: '',
              steps: [
                ...(m.steps || []),
                ...(m.text.trim()
                  ? [
                      {
                        callId: 'note-' + e.callId,
                        name: m.text.trim(),
                        ok: true,
                        summary: '',
                        note: true,
                      },
                    ]
                  : []),
                { callId: e.callId, name: e.name, ok: null, summary: '' },
              ],
            }))
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
      if (!ctl.signal.aborted)
        patchLast((m) => ({
          ...m,
          error: err instanceof Error ? err.message : String(err),
        }))
      else patchLast((m) => ({ ...m, error: 'Stopped.' }))
    } finally {
      setBusy(false)
      abort.current = null
      // No text after the last tool call: the last note was the answer after all.
      if (!answer.trim() && lastNote) {
        answer = lastNote
        patchLast((m) => {
          if (m.text) return m
          const steps = m.steps || []
          const at = steps.map((x) => x.note).lastIndexOf(true)
          return { ...m, text: lastNote, steps: steps.filter((_, j) => j !== at) }
        })
      }
      // The saved question names its files (an image by its address); the file content is not kept.
      const asked = [text, files.length ? describe(files) : ''].filter(Boolean).join('\n\n')
      if (answer.trim() && !ctl.signal.aborted) saving.current = keep(asked, answer.trim(), ran)
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
        <button className="ghost" type="button" disabled={busy} onClick={openHistory} aria-expanded={!!sessions}>
          History
        </button>
        {msgs.length > 0 && (
          <button className="ghost" type="button" disabled={busy} onClick={newChat}>
            New chat
          </button>
        )}
      </div>
      {histErr && <div className="cerr chist-err">{histErr}</div>}
      {sessions && (
        <ul className="chist" aria-label="Earlier chats">
          {!sessions.length && <li className="muted">No saved chats yet.</li>}
          {sessions.map((s) => (
            <li key={s.id} className={s.id === openId ? 'on' : ''}>
              <button type="button" className="chist-open" onClick={() => openSession(s)} title={s.title}>
                <span>{s.title}</span>
                <small>{(s.updatedAt || '').slice(0, 16).replace('T', ' ')}</small>
              </button>
              <button
                type="button"
                className="x"
                aria-label={`Delete the chat ${s.title}`}
                onClick={() => removeSession(s)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="chatlist" ref={list}>
        {!msgs.length && (
          <p className="muted">
            Ask about your graphs. The chat uses the VEGR.AI MCP tools as {user.email}; it asks before it changes
            anything.
          </p>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={'cmsg ' + m.role}>
            {m.role === 'assistant' && <div className="cwho">{chatModelName(m.model || '')}</div>}
            {m.steps && m.steps.length > 0 && (
              <ul className="csteps">
                {m.steps.map((s) =>
                  s.note ? (
                    <li key={s.callId} className="cnote">
                      {inlineMd(s.name)}
                    </li>
                  ) : (
                    <li key={s.callId} className={s.ok === null ? 'run' : s.ok ? 'ok' : 'bad'} title={s.summary}>
                      {s.ok === null ? '…' : s.ok ? '✓' : '✗'} {s.name}
                    </li>
                  ),
                )}
              </ul>
            )}
            {m.files && m.files.length > 0 && <Chips files={m.files} />}
            {m.text && <div className="ctext">{m.role === 'assistant' ? chatMd(m.text) : m.text}</div>}
            {m.role === 'assistant' && !m.text && !m.error && busy && i === msgs.length - 1 && (
              <div className="muted">Working…</div>
            )}
            {m.error && <div className="cerr">{m.error}</div>}
          </div>
        ))}
      </div>
      <form
        className="chatform"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          if (!busy) void attach(Array.from(e.dataTransfer.files || []))
        }}
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
      >
        <div className="cctx">{context}</div>
        {(pending.length > 0 || uploading > 0) && (
          <Chips
            files={pending}
            uploading={uploading}
            onRemove={(i) => setPending((p) => p.filter((_, j) => j !== i))}
          />
        )}
        {pending.some((f) => f.kind === 'pdf') && !isClaude(model) && (
          <div className="muted cfilehint">
            Only Claude models read a PDF; {chatModelName(model)} gets its name only.
          </div>
        )}
        {fileErr && <div className="cerr">{fileErr}</div>}
        <textarea
          ref={box}
          rows={3}
          value={draft}
          placeholder="Message…"
          aria-label="Message"
          onChange={(e) => setDraft(e.target.value)}
          onPaste={(e) => {
            const imgs = Array.from(e.clipboardData?.files || []).filter((f) => f.type.startsWith('image/'))
            if (imgs.length) {
              e.preventDefault()
              void attach(imgs)
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              send()
            }
          }}
        />
        <div className="chatactions">
          <button
            type="button"
            className="ghost"
            disabled={busy}
            onClick={() => imageIn.current?.click()}
            title="Attach images (uploaded to your photos)"
          >
            Image
          </button>
          <button
            type="button"
            className="ghost"
            disabled={busy}
            onClick={() => fileIn.current?.click()}
            title="Attach a PDF or text file"
          >
            File
          </button>
          <button
            type="button"
            className="ghost"
            disabled={busy}
            onClick={() => audioIn.current?.click()}
            title="Transcribe an audio file"
          >
            Audio
          </button>
          {busy ? (
            <button type="button" onClick={() => abort.current?.abort()}>
              Stop
            </button>
          ) : (
            <button type="submit" disabled={(!draft.trim() && !pending.length) || uploading > 0}>
              Send
            </button>
          )}
        </div>
        <input
          ref={imageIn}
          type="file"
          accept={IMAGE_ACCEPT}
          multiple
          hidden
          onChange={(e) => {
            void attach(Array.from(e.target.files || []))
            e.target.value = ''
          }}
        />
        <input
          ref={fileIn}
          type="file"
          accept={FILE_ACCEPT}
          multiple
          hidden
          onChange={(e) => {
            void attach(Array.from(e.target.files || []))
            e.target.value = ''
          }}
        />
        <input
          ref={audioIn}
          type="file"
          accept={AUDIO_ACCEPT}
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) void listen(f)
          }}
        />
      </form>
    </aside>
  )
}

// Files with a message: images as small pictures, other files by name.
function Chips({
  files,
  uploading = 0,
  onRemove,
}: {
  files: Attachment[]
  uploading?: number
  onRemove?: (i: number) => void
}) {
  return (
    <ul className="cchips">
      {files.map((f, i) => (
        <li key={i} title={f.name}>
          {f.kind === 'image' ? (
            <a href={f.url} target="_blank" rel="noreferrer">
              <img src={f.url + (f.url.includes('?') ? '&' : '?') + 'w=96&h=96&fit=crop'} alt={f.name} />
            </a>
          ) : (
            <span className="cfile">{(f.kind === 'pdf' ? 'PDF · ' : '') + f.name}</span>
          )}
          {onRemove && (
            <button type="button" className="x" aria-label={`Remove ${f.name}`} onClick={() => onRemove(i)}>
              ×
            </button>
          )}
        </li>
      ))}
      {uploading > 0 && <li className="muted">Uploading {uploading}…</li>}
    </ul>
  )
}
