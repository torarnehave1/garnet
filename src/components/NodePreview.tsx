import { useEffect, useState } from 'react'
import { loadGraph } from '../api/kg'
import { EditorLink, useEditorBase } from '../lib/editorLink'
import { albumVideoUrl, audioUrl, courseVideoUrl, textHtml, youtubeId } from '../lib/graphRules'
import type { KgNode, User } from '../lib/types'
import { loadApprovedTypes, RegisteredTypeNode } from '../lib/vegvisrNode'


// A node shown by its type's own approved renderer, the same picture Knowledge Editor gives: in a
// panel at the right, or over the whole window (`full`), as the rules graph says (viewRules.ts).
// A type without an approved renderer is shown with the node's text.
export default function NodePreview({ user, graphId, nodeId, world, title, type, full = false, onClose }: { user: User; graphId: string; nodeId: string; world: string; title: string; type: string; full?: boolean; onClose: () => void }) {
  const editor = useEditorBase(world)
  const [node, setNode] = useState<KgNode | null>(null)
  const [rendered, setRendered] = useState<boolean | null>(null) // null: not known yet
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    setNode(null)
    setRendered(null)
    setError('')
    Promise.all([loadGraph(user, graphId), loadApprovedTypes(world || null)])
      .then(([g, types]) => {
        if (!live) return
        const n = g.nodes.find((x) => x.id === nodeId)
        if (!n) return setError('The node was not found in the graph.')
        setNode(n)
        setRendered(types.has(type))
      })
      .catch((e) => {
        if (live) setError('Could not load the node from the graph (' + String((e as Error)?.message || 'unknown error') + ').')
      })
    return () => {
      live = false
    }
  }, [user, graphId, nodeId, world, type])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // A YouTube node has no renderer of its own: the panel plays the video.
  const video = node && (type === 'youtube-video' || type === 'youtube-live') ? youtubeId(node) : null
  // An album-video node has none either: the panel plays the file from the Photos album.
  // A course step (kurs-steg) with a video is the same: a file in a Photos album (2026-11-19).
  const file = !node ? null : type === 'album-video' ? albumVideoUrl(node) : type === 'kurs-steg' ? courseVideoUrl(node) : null
  // Nor has an audio node: the panel plays the sound file, as Knowledge Editor does.
  const sound = node && type === 'audio' ? audioUrl(node) : null

  return (
    <aside className={'preview' + (full ? ' full' : '')} aria-label={'Node ' + title}>
      <div className="previewHead">
        <strong>{title}</strong>
        <button type="button" className="ghost" aria-label="Close the preview" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="previewBody">
        {error && <p className="previewNote">{error}</p>}
        {!error && !node && <p className="previewNote">Loading the node…</p>}
        {node && rendered && <RegisteredTypeNode node={node} world={world || null} />}
        {node && rendered === false && video && (
          <>
            {/* The video itself, played here. youtube-nocookie: no cookie is set before play. */}
            <div className="previewVideo">
              <iframe
                src={'https://www.youtube-nocookie.com/embed/' + video}
                title={title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                referrerPolicy="strict-origin-when-cross-origin"
              />
            </div>
            <div className="cardBody" dangerouslySetInnerHTML={{ __html: textHtml(node) }} />
          </>
        )}
        {node && rendered === false && file && (
          <>
            <div className="previewVideo">
              <video src={file} title={title} controls playsInline preload="metadata" />
            </div>
            <div className="cardBody" dangerouslySetInnerHTML={{ __html: textHtml(node) }} />
          </>
        )}
        {node && rendered === false && sound && (
          <>
            <div className="previewAudio">
              <audio src={sound} title={title} controls preload="metadata" />
            </div>
            <div className="cardBody" dangerouslySetInnerHTML={{ __html: textHtml(node) }} />
          </>
        )}
        {node && rendered === false && !video && !file && !sound && (
          <>
            <p className="previewNote">The node type {type} has no approved view to draw it with, so the node’s text is shown.</p>
            {/* textHtml escapes everything it takes from the graph before adding its own tags. */}
            <div className="cardBody" dangerouslySetInnerHTML={{ __html: textHtml(node) }} />
          </>
        )}
      </div>
      <div className="previewFoot">
        <EditorLink editor={editor} graphId={graphId} />
      </div>
    </aside>
  )
}
