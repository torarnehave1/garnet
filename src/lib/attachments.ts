import type { User } from './types'

// Files in Garnet's chat, the way Agent-Builder's chat takes them (AgentChat.tsx):
//   image  uploaded to the person's photos (agent-worker /upload-image, their login token) and sent
//          as an image block plus its address, so it can also go into a graph node
//   pdf    sent as a document block (only Claude models read it; the others get its name)
//   text   .txt .md .csv .json .xml .html .css .js .ts .vcf, put into the message as text
//   audio  not an attachment: transcribed with gpt-transcribe (openai-worker /audio) in 2-minute
//          pieces, and the transcript becomes part of the chat
//   mic    spoken into the microphone (record), transcribed the same way, and put in the message box
//
// whisper-1 shuts down 26 Feb 2027; gpt-transcribe replaced it here on 18 Nov 2026. openai-worker
// turns `language` into the model's `languages[]` and keeps the answer's `text` as before.

const AGENT_API = 'https://agent.vegvisr.org'
const AUDIO_ENDPOINT = 'https://openai.vegvisr.org/audio'
const CHUNK_SECONDS = 120
export const TRANSCRIBE_MODEL = 'gpt-transcribe'
// Names and terms the model should spell right. No < > or line breaks (the API refuses the request).
const KEYWORDS = ['VEGR.AI', 'Vegvisr', 'Garnet', 'Enkel endring', 'AlivenessLAB', 'Claude']
const MAX_PDF = 20 * 1024 * 1024
const MAX_TEXT = 1024 * 1024

export type Attachment =
  | { kind: 'image'; name: string; url: string }
  | { kind: 'pdf'; name: string; size: number; data: string }
  | { kind: 'text'; name: string; size: number; text: string }

export const IMAGE_ACCEPT = 'image/*'
export const FILE_ACCEPT = '.pdf,.txt,.md,.csv,.json,.xml,.html,.css,.js,.ts,.vcf,.vcard,text/vcard'
export const AUDIO_ACCEPT = '.wav,.mp3,.m4a,.aac,.ogg,.opus,.mp4,.webm,audio/*'

const TEXT_EXT = /\.(txt|md|csv|json|xml|html?|css|js|ts|vcf|vcard)$/i

const base64Of = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] || '')
    r.onerror = () => reject(new Error(`Could not read ${file.name}.`))
    r.readAsDataURL(file)
  })

/** Uploads an image to the person's photos; returns its imgix address. */
export async function uploadImage(user: User, file: File): Promise<Attachment> {
  if (!user.token) throw new Error('Sign in to attach images.')
  const r = await fetch(`${AGENT_API}/upload-image`, {
    method: 'POST',
    credentials: 'omit',
    headers: { 'Content-Type': 'application/json', 'X-API-Token': user.token },
    body: JSON.stringify({ base64: await base64Of(file), mediaType: file.type || 'image/png', filename: file.name }),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || !j.url) throw new Error(j.error || `Image upload answered HTTP ${r.status}.`)
  return { kind: 'image', name: file.name, url: j.url }
}

/** A PDF or text file, read in the browser. */
export async function readFile(file: File): Promise<Attachment> {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    if (file.size > MAX_PDF) throw new Error(`${file.name} is over 20 MB.`)
    return { kind: 'pdf', name: file.name, size: file.size, data: await base64Of(file) }
  }
  if (file.type.startsWith('text/') || TEXT_EXT.test(file.name)) {
    if (file.size > MAX_TEXT) throw new Error(`${file.name} is over 1 MB.`)
    return { kind: 'text', name: file.name, size: file.size, text: await file.text() }
  }
  throw new Error(`${file.name}: not a PDF or text file.`)
}

export const isClaude = (model: string) => model === 'auto' || model.startsWith('claude-')

/** The message content agent-worker /chat takes: plain text, or blocks when files are attached. */
export function toContent(text: string, files: Attachment[] | undefined): string | unknown[] {
  if (!files?.length) return text
  const blocks: unknown[] = []
  for (const f of files) {
    if (f.kind === 'image') blocks.push({ type: 'image', source: { type: 'url', url: f.url } })
    else if (f.kind === 'pdf')
      blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: f.data } })
    else blocks.push({ type: 'text', text: `--- File: ${f.name} ---\n${f.text}\n--- End of ${f.name} ---` })
  }
  const meta = describe(files)
  const ask =
    text ||
    (files.some((f) => f.kind === 'image') ? 'What do you see in this image?' : 'Please analyze the attached file(s).')
  blocks.push({ type: 'text', text: `${meta}\n\n${ask}` })
  return blocks
}

/** One line per file, for the model and for the saved history. */
export function describe(files: Attachment[]): string {
  return files
    .map((f, i) =>
      f.kind === 'image'
        ? `[Image ${i + 1}: ${f.url} — use this URL for graph nodes (type: markdown-image, path: "${f.url}")]`
        : `[File ${i + 1}: ${f.name} (${(f.size / 1024).toFixed(1)} KB)]`,
    )
    .join('\n')
}

// ── Audio ────────────────────────────────────────────────────────────────

function wavOf(buf: AudioBuffer): Blob {
  const ch = buf.numberOfChannels
  const len = buf.length
  const out = new DataView(new ArrayBuffer(44 + len * ch * 2))
  const str = (o: number, s: string) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)))
  str(0, 'RIFF')
  out.setUint32(4, 36 + len * ch * 2, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  out.setUint32(16, 16, true)
  out.setUint16(20, 1, true)
  out.setUint16(22, ch, true)
  out.setUint32(24, buf.sampleRate, true)
  out.setUint32(28, buf.sampleRate * ch * 2, true)
  out.setUint16(32, ch * 2, true)
  out.setUint16(34, 16, true)
  str(36, 'data')
  out.setUint32(40, len * ch * 2, true)
  const data = Array.from({ length: ch }, (_, c) => buf.getChannelData(c))
  let o = 44
  for (let i = 0; i < len; i++)
    for (let c = 0; c < ch; c++) {
      out.setInt16(o, Math.max(-1, Math.min(1, data[c][i])) * 0x7fff, true)
      o += 2
    }
  return new Blob([out.buffer], { type: 'audio/wav' })
}

const clock = (s: number) => {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  const mm = String(m).padStart(2, '0')
  const ss = String(sec).padStart(2, '0')
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

async function sendAudio(blob: Blob, name: string, language: string, signal?: AbortSignal): Promise<string> {
  const form = new FormData()
  form.append('file', blob, name)
  form.append('model', TRANSCRIBE_MODEL)
  if (language) form.append('language', language)
  for (const k of KEYWORDS) form.append('keywords[]', k)
  const r = await fetch(AUDIO_ENDPOINT, { method: 'POST', body: form, signal })
  const t = await r.text()
  let j: { text?: string; error?: string; message?: string } | null = null
  try {
    j = JSON.parse(t)
  } catch {
    /* plain text */
  }
  if (!r.ok) throw new Error(j?.error || j?.message || t || 'Transcription failed.')
  return ((j ? j.text : t) || '').trim()
}

/**
 * Transcribes an audio file. Longer than two minutes (or over 8 MB without a readable length):
 * decoded in the browser and sent in two-minute WAV pieces, each marked with its time.
 * language: '' lets the model detect it; dictation passes the sign-in language (no / en).
 * plain: running text without the time marks (dictation); a piece that fails then stops the whole.
 */
export async function transcribe(
  file: File,
  language: string,
  onStatus: (s: string) => void,
  signal?: AbortSignal,
  plain = false,
): Promise<string> {
  const Ctx =
    window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  if (!Ctx) {
    onStatus('Transcribing…')
    return sendAudio(file, file.name, language, signal)
  }
  const ctx = new Ctx()
  try {
    let buf: AudioBuffer | null = null
    try {
      buf = await ctx.decodeAudioData(await file.arrayBuffer())
    } catch {
      buf = null // a format the browser cannot decode: the model may still read it whole
    }
    if (!buf || buf.duration <= CHUNK_SECONDS) {
      if (!buf && file.size > 25 * 1024 * 1024)
        throw new Error('The browser cannot read this audio, and it is too large to send whole (25 MB).')
      onStatus('Transcribing…')
      return sendAudio(file, file.name, language, signal)
    }
    const per = CHUNK_SECONDS * buf.sampleRate
    const total = Math.ceil(buf.length / per)
    const base = file.name.replace(/\.[^.]+$/, '') || 'audio'
    const parts: string[] = []
    for (let i = 0; i < total; i++) {
      if (signal?.aborted) throw new Error('Stopped.')
      const start = i * per
      const end = Math.min(start + per, buf.length)
      const piece = ctx.createBuffer(buf.numberOfChannels, end - start, buf.sampleRate)
      for (let c = 0; c < buf.numberOfChannels; c++)
        piece.getChannelData(c).set(buf.getChannelData(c).subarray(start, end))
      onStatus(`Transcribing part ${i + 1} of ${total}…`)
      const label = `[${clock(start / buf.sampleRate)} - ${clock(end / buf.sampleRate)}]`
      try {
        const t = await sendAudio(wavOf(piece), `${base}_part_${i + 1}.wav`, language, signal)
        if (t) parts.push(plain ? t : `${label} ${t}`)
      } catch (err) {
        if (signal?.aborted || plain) throw err
        parts.push(`${label} [Error: ${err instanceof Error ? err.message : String(err)}]`)
      }
    }
    return parts.join(plain ? ' ' : '\n\n')
  } finally {
    await ctx.close().catch(() => {})
  }
}

// ── Microphone ───────────────────────────────────────────────────────────

export const canRecord = () =>
  typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia

export interface Recording {
  /** Ends the recording, lets go of the microphone and gives what was said as a file. */
  stop: () => Promise<File>
  /** Ends the recording and throws it away. */
  cancel: () => void
}

/** Starts recording from the microphone (the browser asks the person first). */
export async function record(): Promise<Recording> {
  if (!canRecord()) throw new Error('This browser cannot record from the microphone.')
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  } catch {
    throw new Error('No access to the microphone. Allow it for this page in the browser and try again.')
  }
  const rec = new MediaRecorder(stream)
  const chunks: Blob[] = []
  rec.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data)
  }
  const release = () => stream.getTracks().forEach((t) => t.stop())
  rec.start()
  return {
    stop: () =>
      new Promise<File>((resolve, reject) => {
        rec.onstop = () => {
          release()
          const type = rec.mimeType || chunks[0]?.type || 'audio/webm'
          // The model goes by the file name: Safari records mp4, the others webm or ogg.
          const ext = /mp4|m4a|aac/.test(type) ? 'm4a' : /ogg/.test(type) ? 'ogg' : 'webm'
          resolve(new File(chunks, `dictation.${ext}`, { type }))
        }
        rec.onerror = () => {
          release()
          reject(new Error('The recording failed.'))
        }
        if (rec.state === 'inactive') rec.onstop?.(new Event('stop'))
        else rec.stop()
      }),
    cancel: () => {
      rec.onstop = null
      if (rec.state !== 'inactive') rec.stop()
      release()
    },
  }
}
