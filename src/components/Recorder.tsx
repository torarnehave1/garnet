import { useCallback, useEffect, useRef, useState } from 'react'
import type { User } from '../lib/types'

// The screen recorder of vegvisr-ui-kit (src/components/ScreenRecorder.jsx, 1.5.0), brought into
// Garnet as its own component (Tor Arne, 2026-11-19: "a record function … add this to the garnet
// app, nothing else, no other menu elements"). Same behaviour: a microphone switch and a Rec
// button; after Stop, a dialog to download the recording or save it to one of the person's photo
// albums. Two things differ from the kit, because of where Garnet stands:
//   - the kit is styled with Tailwind classes, which Garnet does not have, so this uses Garnet's CSS;
//   - the kit reads the login from localStorage `user`; Garnet keeps its own (`vegvisr_user`), so
//     the signed-in person is passed in.
const ALBUMS_API = 'https://albums.vegvisr.org'
const PHOTOS_API = 'https://photos-api.vegvisr.org'
const PHOTOS_APP = 'https://photos.vegvisr.org'
const LAST_ALBUM_KEY = 'vegvisr.recorder.album'
const NEW_ALBUM = '__new__'

interface Album {
  name: string
  createdBy?: string | null
}

// The owner rule photos-worker /upload enforces: a Superadmin writes anywhere; others write to
// their own albums and to albums from before ownership was kept (createdBy empty).
function canWrite(a: Album, user: User) {
  return String(user.role || '').toLowerCase() === 'superadmin' || !a.createdBy || a.createdBy === user.email
}

function clock(ms: number) {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
const megabytes = (b: Blob | null) => (b ? (b.size / 1048576).toFixed(1) : '0')
const stamp = () => new Date().toISOString().slice(0, 19).replace(/:/g, '-')

export function Recorder({ user }: { user: User }) {
  const [recording, setRecording] = useState(false)
  const [mic, setMic] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [open, setOpen] = useState(false)
  const [preview, setPreview] = useState('')
  const [albums, setAlbums] = useState<string[]>([])
  const [albumsBusy, setAlbumsBusy] = useState(false)
  const [albumsErr, setAlbumsErr] = useState('')
  const [album, setAlbum] = useState('')
  const [newAlbum, setNewAlbum] = useState('')
  const [uploading, setUploading] = useState(false)
  const [done, setDone] = useState(false)
  const [status, setStatus] = useState('')
  const [failed, setFailed] = useState(false)
  const [startErr, setStartErr] = useState('')
  const [size, setSize] = useState('0') // megabytes, as shown
  const [sound, setSound] = useState(false) // the recording holds the microphone

  const recorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const blob = useRef<Blob | null>(null)
  const micStream = useRef<MediaStream | null>(null)
  const timer = useRef<number>(0)
  const started = useRef(0)
  const withMic = useRef(false)

  const stop = useCallback(() => {
    const r = recorder.current
    if (r && r.state !== 'inactive') {
      r.stop()
      r.stream.getTracks().forEach((t) => t.stop())
    }
    micStream.current?.getTracks().forEach((t) => t.stop())
    micStream.current = null
    window.clearInterval(timer.current)
    setRecording(false)
  }, [])

  const start = useCallback(async () => {
    setStartErr('')
    if (!navigator.mediaDevices?.getDisplayMedia || typeof MediaRecorder === 'undefined') {
      setStartErr('This browser cannot record the screen.')
      return
    }
    let screen: MediaStream
    try {
      // The browser asks what to share: the tab, a window or the whole screen.
      screen = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false })
    } catch {
      return // the person closed the browser's own question: nothing to record
    }
    const all = new MediaStream()
    screen.getVideoTracks().forEach((t) => all.addTrack(t))
    withMic.current = false
    if (mic) {
      try {
        const voice = await navigator.mediaDevices.getUserMedia({ audio: true })
        micStream.current = voice
        voice.getAudioTracks().forEach((t) => all.addTrack(t))
        withMic.current = true
      } catch {
        /* no microphone, or not allowed: record without sound */
      }
    }
    const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) || 'video/webm'
    const r = new MediaRecorder(all, { mimeType })
    chunks.current = []
    r.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.current.push(e.data)
    }
    r.onstop = () => {
      blob.current = new Blob(chunks.current, { type: chunks.current[0]?.type || 'video/webm' })
      setElapsed(Date.now() - started.current)
      setSize(megabytes(blob.current))
      setSound(withMic.current)
      setPreview(URL.createObjectURL(blob.current))
      setStatus('')
      setFailed(false)
      setDone(false)
      setOpen(true)
    }
    // "Stop sharing" in the browser's own bar ends the recording the same way as the Stop button.
    screen.getVideoTracks()[0]?.addEventListener('ended', stop)
    r.start(100)
    recorder.current = r
    started.current = Date.now()
    setElapsed(0)
    setRecording(true)
    timer.current = window.setInterval(() => setElapsed(Date.now() - started.current), 200)
  }, [mic, stop])

  // Leaving Garnet (sign out) while recording: let go of the screen and the microphone.
  useEffect(
    () => () => {
      window.clearInterval(timer.current)
      const r = recorder.current
      if (r && r.state !== 'inactive') {
        r.onstop = null
        r.stop()
        r.stream.getTracks().forEach((t) => t.stop())
      }
      micStream.current?.getTracks().forEach((t) => t.stop())
    },
    [],
  )

  // The albums the person may write to, read each time the dialog opens, so an album made in the
  // Photos app since the last recording is there.
  useEffect(() => {
    if (!open) return
    let gone = false
    setAlbumsBusy(true)
    setAlbumsErr('')
    fetch(`${ALBUMS_API}/photo-albums?includeMeta=1`, { headers: { 'X-API-Token': user.token || '' } })
      .then(async (res) => {
        const body = await res.json().catch(() => null)
        if (!res.ok) throw new Error((body && body.error) || `HTTP ${res.status}`)
        return body as { albums?: (string | Album)[] }
      })
      .then((body) => {
        if (gone) return
        const names = (body?.albums || [])
          .map((a) => (typeof a === 'string' ? { name: a, createdBy: null } : a))
          .filter((a) => a && a.name && canWrite(a, user))
          .map((a) => a.name)
          .sort((x, y) => x.localeCompare(y))
        setAlbums(names)
        let last = ''
        try {
          last = localStorage.getItem(LAST_ALBUM_KEY) || ''
        } catch {
          /* storage blocked */
        }
        setAlbum(names.includes(last) ? last : names[0] || NEW_ALBUM)
      })
      .catch((e: unknown) => {
        if (gone) return
        setAlbums([])
        setAlbum(NEW_ALBUM)
        setAlbumsErr(`Could not load albums: ${e instanceof Error ? e.message : String(e)}`)
      })
      .finally(() => {
        if (!gone) setAlbumsBusy(false)
      })
    return () => {
      gone = true
    }
  }, [open, user])

  const target = (album === NEW_ALBUM ? newAlbum : album).trim()

  function download() {
    if (!blob.current) return
    const a = document.createElement('a')
    a.href = preview || URL.createObjectURL(blob.current)
    a.download = `recording-${stamp()}.webm`
    a.click()
  }

  async function upload() {
    if (!blob.current || !target || uploading) return
    setUploading(true)
    setFailed(false)
    setStatus(`Uploading ${megabytes(blob.current)} MB to "${target}"…`)
    try {
      const s = stamp()
      const form = new FormData()
      form.append('file', blob.current, `screen-recording-${s}.webm`)
      form.append('filename', `screen-recording-${s}`)
      form.append('album', target)
      form.append('displayName', `Screen recording ${s.replace('T', ' ')}`)
      form.append('tagsCsv', 'screen-recording')
      const res = await fetch(`${PHOTOS_API}/upload`, { method: 'POST', headers: { 'X-API-Token': user.token || '' }, body: form })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error((body && body.error) || `HTTP ${res.status}`)
      try {
        localStorage.setItem(LAST_ALBUM_KEY, target)
      } catch {
        /* storage blocked */
      }
      setStatus(`Saved to album "${body?.album || target}".`)
      setDone(true)
    } catch (e) {
      setFailed(true)
      setStatus(`Upload failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setUploading(false)
    }
  }

  function close() {
    if (uploading) return
    if (preview) URL.revokeObjectURL(preview)
    blob.current = null
    chunks.current = []
    setPreview('')
    setOpen(false)
    setStatus('')
    setDone(false)
    setNewAlbum('')
  }

  return (
    <>
      <span className="recorder">
        <button
          className={'ghost recmic' + (mic ? ' on' : '')}
          type="button"
          aria-pressed={mic}
          disabled={recording}
          aria-label="Record with microphone"
          title={mic ? 'Microphone on: your voice is recorded too' : 'Microphone off: the recording has no sound'}
          onClick={() => setMic(!mic)}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <rect x="5.5" y="1.5" width="5" height="8.5" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <path d="M3 7.5a5 5 0 0 0 10 0M8 12.5v2.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            {!mic && <path d="M2.5 2.5l11 11" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />}
          </svg>
        </button>
        <button
          className={'ghost recbtn' + (recording ? ' on' : '')}
          type="button"
          title={recording ? 'Stop recording' : 'Record the screen'}
          onClick={recording ? stop : start}
        >
          <span className="recdot" aria-hidden="true" />
          {recording ? `Stop ${clock(elapsed)}` : 'Rec'}
        </button>
        {startErr && (
          <span className="recerr" role="alert">
            {startErr}
          </span>
        )}
      </span>

      {open && (
        <div className="veil" role="dialog" aria-modal="true" aria-labelledby="recTitle" onKeyDown={(e) => e.key === 'Escape' && close()}>
          <div className="dlgbox recbox">
            <h2 id="recTitle">Recording complete</h2>
            <p>
              {clock(elapsed)} · {size} MB
            </p>
            {/* Without the microphone there is no sound to play. */}
            <video className="recvideo" src={preview} controls muted={!sound} />
            <label className="reclabel" htmlFor="recAlbum">
              Save to album
            </label>
            <select id="recAlbum" className="dlgInput" value={album} disabled={albumsBusy || uploading || done} onChange={(e) => setAlbum(e.target.value)}>
              {albumsBusy && <option value="">Loading albums…</option>}
              {!albumsBusy &&
                albums.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              {!albumsBusy && <option value={NEW_ALBUM}>+ New album…</option>}
            </select>
            {album === NEW_ALBUM && !albumsBusy && (
              <input
                type="text"
                className="dlgInput"
                aria-label="New album name"
                placeholder="New album name"
                autoComplete="off"
                value={newAlbum}
                disabled={uploading || done}
                onChange={(e) => setNewAlbum(e.target.value)}
              />
            )}
            {albumsErr && (
              <p className="dlgerr" role="alert">
                {albumsErr}
              </p>
            )}
            {status && (
              <p className={failed ? 'dlgerr' : 'recstatus'} role={failed ? 'alert' : 'status'}>
                {status}{' '}
                {done && (
                  <a href={PHOTOS_APP} target="_blank" rel="noreferrer">
                    Open Photos
                  </a>
                )}
              </p>
            )}
            <div className="dlgrow">
              <button className="ghost" type="button" disabled={uploading} onClick={close}>
                {done ? 'Close' : 'Discard'}
              </button>{' '}
              <button className="ghost" type="button" onClick={download}>
                Download
              </button>{' '}
              <button type="button" disabled={uploading || done || !target} onClick={upload}>
                {uploading ? 'Uploading…' : done ? 'Saved' : 'Upload'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
