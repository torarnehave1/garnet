import type { User } from './types'

// Live dictation with gpt-live-transcribe, through openai-worker /live-transcribe (which holds the
// OpenAI key and checks the login token). The text arrives while the person speaks.
//
//   microphone → AudioWorklet (taps raw samples) → resampled to 24 kHz mono PCM16 → WebSocket
//
// The model has no pause detection of its own, so this side commits a "turn" at every pause
// (or every TURN_MAX_MS of unbroken speech); each turn comes back as deltas and then a final text.
// Everything is also kept here as audio, so if the live line fails the recording can still be
// written down whole with gpt-transcribe (attachments.ts) — nothing said is lost.

const LIVE_URL = 'wss://openai.vegvisr.org/live-transcribe'
const RATE = 24000
const FLUSH_MS = 100
const SPEECH_RMS = 0.012 // above this a 100 ms piece counts as speech
const PAUSE_MS = 700 // this much quiet after speech ends a turn
const TURN_MAX_MS = 8000 // a turn is committed at the latest after this much speech
const MIN_TURN_MS = 200 // OpenAI refuses to commit less than ~100 ms of audio
const FINISH_WAIT_MS = 8000 // how long ✓ waits for the last turns' text

// Kept apart from the audio code so it can be tested: the turns in the order they were committed,
// each with its text so far and whether it is final.
export class LiveText {
  private order: string[] = []
  private parts = new Map<string, { text: string; done: boolean }>()

  private part(id: string) {
    let p = this.parts.get(id)
    if (!p) {
      p = { text: '', done: false }
      this.parts.set(id, p)
      this.order.push(id)
    }
    return p
  }
  /** Feeds one OpenAI event. Returns true when the text changed. */
  event(ev: { type?: string; item_id?: string; delta?: string; transcript?: string }): boolean {
    if (!ev.item_id) return false
    switch (ev.type) {
      case 'input_audio_buffer.committed':
        this.part(ev.item_id)
        return false
      case 'conversation.item.input_audio_transcription.delta': {
        const p = this.part(ev.item_id)
        if (p.done) return false
        p.text += ev.delta || ''
        return true
      }
      case 'conversation.item.input_audio_transcription.completed': {
        const p = this.part(ev.item_id)
        p.text = (ev.transcript ?? p.text).trim()
        p.done = true
        return true
      }
      case 'conversation.item.input_audio_transcription.failed': {
        this.part(ev.item_id).done = true
        return true
      }
    }
    return false
  }
  get turns() {
    return this.order.length
  }
  get settled() {
    return this.order.every((id) => this.parts.get(id)!.done)
  }
  /** Final text (settled turns, up to the first unsettled one) and the interim text after it. */
  view(): { final: string; interim: string } {
    const fin: string[] = []
    const rest: string[] = []
    let open = false
    for (const id of this.order) {
      const p = this.parts.get(id)!
      if (!open && p.done) fin.push(p.text)
      else {
        open = true
        rest.push(p.text)
      }
    }
    const join = (a: string[]) => a.map((s) => s.trim()).filter(Boolean).join(' ')
    return { final: join(fin), interim: join(rest) }
  }
  text() {
    const v = this.view()
    return [v.final, v.interim].filter(Boolean).join(' ')
  }
}

export interface LiveSession {
  /** Microphone loudness 0–1, for the waveform. */
  level: () => number
  /** Ends the turn, waits for the text, lets go of the microphone. `audio` is the whole recording (WAV) for the fallback. */
  finish: () => Promise<{ text: string; failed: string; audio: File | null }>
  /** Throws everything away. */
  cancel: () => void
}

export const canLive = () =>
  typeof WebSocket !== 'undefined' &&
  typeof AudioWorkletNode !== 'undefined' &&
  !!navigator.mediaDevices?.getUserMedia

const TAP = `class GarnetTap extends AudioWorkletProcessor {
  process(inputs) { const ch = inputs[0] && inputs[0][0]; if (ch && ch.length) this.port.postMessage(ch.slice(0)); return true }
}
registerProcessor('garnet-tap', GarnetTap)`

function wav(pcm: Int16Array[], rate: number): File | null {
  const n = pcm.reduce((a, c) => a + c.length, 0)
  if (!n) return null
  const out = new DataView(new ArrayBuffer(44 + n * 2))
  const str = (o: number, s: string) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)))
  str(0, 'RIFF')
  out.setUint32(4, 36 + n * 2, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  out.setUint32(16, 16, true)
  out.setUint16(20, 1, true)
  out.setUint16(22, 1, true)
  out.setUint32(24, rate, true)
  out.setUint32(28, rate * 2, true)
  out.setUint16(32, 2, true)
  out.setUint16(34, 16, true)
  str(36, 'data')
  out.setUint32(40, n * 2, true)
  let o = 44
  for (const c of pcm)
    for (const v of c) {
      out.setInt16(o, v, true)
      o += 2
    }
  return new File([out.buffer], 'dictation.wav', { type: 'audio/wav' })
}

/**
 * Starts live dictation. Called from the Mic press (that is what lets iOS Safari start audio).
 * onText gets the running text; onNote a short line when the live line fails (the recording goes on).
 */
export async function startLive(
  user: User,
  languages: string[],
  keywords: string[],
  onText: (v: { final: string; interim: string }) => void,
  onNote: (s: string) => void,
  endpoint = LIVE_URL,
): Promise<LiveSession> {
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
  } catch {
    throw new Error('No access to the microphone. Allow it for this page in the browser and try again.')
  }
  const Ctx =
    window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const ctx = new Ctx()
  void ctx.resume().catch(() => {})
  const src = ctx.createMediaStreamSource(stream)
  const an = ctx.createAnalyser()
  an.fftSize = 512
  src.connect(an)
  const meter = new Uint8Array(new ArrayBuffer(an.fftSize))
  const url = URL.createObjectURL(new Blob([TAP], { type: 'application/javascript' }))
  try {
    await ctx.audioWorklet.addModule(url)
  } finally {
    URL.revokeObjectURL(url)
  }
  const tap = new AudioWorkletNode(ctx, 'garnet-tap')
  const mute = ctx.createGain()
  mute.gain.value = 0
  src.connect(tap)
  tap.connect(mute).connect(ctx.destination) // keeps the tap running in every browser, silently

  const live = new LiveText()
  const recorded: Int16Array[] = []
  let failed = ''
  let ended = false

  // ── the line to openai-worker ──
  const ws = new WebSocket(endpoint)
  ws.binaryType = 'arraybuffer'
  let open = false
  const early: ArrayBuffer[] = [] // audio from before the socket opened
  const fail = (why: string) => {
    if (failed || ended) return
    failed = why
    onNote(why)
  }
  ws.onopen = () => {
    open = true
    ws.send(JSON.stringify({ type: 'start', token: user.token, languages, keywords }))
    for (const b of early.splice(0)) ws.send(b)
  }
  ws.onmessage = (e) => {
    let ev: { type?: string; message?: string; error?: { message?: string } } & Record<string, unknown>
    try {
      ev = JSON.parse(typeof e.data === 'string' ? e.data : new TextDecoder().decode(e.data))
    } catch {
      return
    }
    if (ev.type === 'live.error') fail(ev.message || 'Live transcription failed.')
    else if (ev.type === 'error') {
      const m = ev.error?.message || 'Live transcription failed.'
      // A commit with too little audio is harmless; anything else ends the live line.
      if (!/buffer too small|empty/i.test(m)) fail(m)
    } else if (live.event(ev as Parameters<LiveText['event']>[0])) onText(live.view())
  }
  ws.onerror = () => fail('The live line could not be opened.')
  ws.onclose = (e) => {
    if (!ended && !failed) fail(e.reason || 'The live line closed.')
  }

  // ── audio: collect, resample to 24 kHz, send every 100 ms, commit at pauses ──
  const ratio = ctx.sampleRate / RATE
  let pending: Float32Array[] = []
  let carry = new Float32Array(0)
  let pos = 0
  let sinceCommitMs = 0
  let spokeMs = 0
  let quietMs = 0
  tap.port.onmessage = (e: MessageEvent<Float32Array>) => pending.push(e.data)

  const commit = () => {
    if (spokeMs >= MIN_TURN_MS && sinceCommitMs >= MIN_TURN_MS && open && !failed && ws.readyState === WebSocket.OPEN)
      ws.send(JSON.stringify({ type: 'commit' }))
    sinceCommitMs = 0
    spokeMs = 0
    quietMs = 0
  }

  const flush = () => {
    if (!pending.length) return
    const total = carry.length + pending.reduce((a, c) => a + c.length, 0)
    const all = new Float32Array(total)
    all.set(carry, 0)
    let o = carry.length
    for (const c of pending) {
      all.set(c, o)
      o += c.length
    }
    pending = []
    const out: number[] = []
    while (pos + 1 < all.length) {
      const i = Math.floor(pos)
      const f = pos - i
      out.push(all[i] * (1 - f) + all[i + 1] * f)
      pos += ratio
    }
    const used = Math.floor(pos)
    carry = all.slice(used)
    pos -= used
    if (!out.length) return
    const pcm = new Int16Array(out.length)
    let sum = 0
    for (let k = 0; k < out.length; k++) {
      const v = Math.max(-1, Math.min(1, out[k]))
      sum += v * v
      pcm[k] = v * 0x7fff
    }
    recorded.push(pcm)
    if (!failed) {
      if (open && ws.readyState === WebSocket.OPEN) ws.send(pcm.buffer)
      else if (ws.readyState === WebSocket.CONNECTING && early.length < 300) early.push(pcm.buffer)
    }
    const ms = (out.length / RATE) * 1000
    sinceCommitMs += ms
    if (Math.sqrt(sum / out.length) > SPEECH_RMS) {
      spokeMs += ms
      quietMs = 0
    } else if (spokeMs) quietMs += ms
    if ((spokeMs && quietMs >= PAUSE_MS) || spokeMs >= TURN_MAX_MS) commit()
  }
  const timer = window.setInterval(flush, FLUSH_MS)

  const release = () => {
    ended = true
    window.clearInterval(timer)
    tap.port.onmessage = null
    stream.getTracks().forEach((t) => t.stop())
    void ctx.close().catch(() => {})
  }
  const closeWs = () => {
    try {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'stop' }))
      ws.close()
    } catch {
      /* already gone */
    }
  }

  return {
    level: () => {
      if (ended) return 0
      an.getByteTimeDomainData(meter)
      let s = 0
      for (const v of meter) s += (v - 128) * (v - 128)
      return Math.min(1, (Math.sqrt(s / meter.length) / 128) * 4)
    },
    finish: async () => {
      flush()
      // The last words: commit what is left even if it was short, then wait for the text.
      if (open && !failed && ws.readyState === WebSocket.OPEN && sinceCommitMs >= 100 && spokeMs > 0)
        ws.send(JSON.stringify({ type: 'commit' }))
      release()
      const t0 = Date.now()
      await new Promise<void>((resolve) => {
        const check = () => {
          const waited = Date.now() - t0
          // Wait for every committed turn to settle (and give the last commit a moment to register).
          if (failed || waited >= FINISH_WAIT_MS || (waited >= 400 && live.settled)) resolve()
          else setTimeout(check, 100)
        }
        check()
      })
      closeWs()
      return { text: live.text(), failed, audio: wav(recorded, RATE) }
    },
    cancel: () => {
      release()
      closeWs()
    },
  }
}
