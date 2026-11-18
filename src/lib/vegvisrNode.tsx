import { createElement, useEffect, useRef } from 'react'
import type { KgNode } from './types'

// The rendering engine for registered node types, the same one Knowledge Editor uses
// (knowledge-editor src/lib/vegvisrNode.tsx). A node whose type has an APPROVED renderer is shown
// by the <vegvisr-node> element, which runs that renderer in an isolated iframe (no cookies,
// storage, parent access or network). The element is served from api.vegvisr.org and loaded once,
// on first need.
const SCRIPT_URL = 'https://api.vegvisr.org/components/vegvisr-node.js'

type VegvisrNodeCtor = { approvedTypes: (api?: string, world?: string) => Promise<Set<string>> }
let loading: Promise<void> | null = null
const approved = new Map<string, Promise<Set<string>>>() // world ('' = platform) -> types

function loadEngine(): Promise<void> {
  if (!loading) {
    loading = new Promise<void>((resolve, reject) => {
      if (customElements.get('vegvisr-node')) return resolve()
      const s = document.createElement('script')
      s.src = SCRIPT_URL
      s.async = true
      s.onload = () => resolve()
      s.onerror = () => reject(new Error('vegvisr-node.js failed to load'))
      document.head.appendChild(s)
    })
      .then(() => customElements.whenDefined('vegvisr-node'))
      .then(() => undefined)
    loading.catch(() => (loading = null))
  }
  return loading
}

/** Types with an approved renderer: the platform's, plus `world`'s own. Empty if the engine cannot load. */
export function loadApprovedTypes(world: string | null = null): Promise<Set<string>> {
  const key = world || ''
  if (!approved.has(key)) {
    const p = loadEngine()
      .then(() => (window as unknown as { VegvisrNode: VegvisrNodeCtor }).VegvisrNode.approvedTypes(undefined, key))
      .catch(() => {
        approved.delete(key)
        return new Set<string>()
      })
    approved.set(key, p)
  }
  return approved.get(key)!
}

/** One node drawn by its registered renderer. `node` is set as a property; `world` before it. */
export function RegisteredTypeNode({ node, world = null }: { node: KgNode; world?: string | null }) {
  const ref = useRef<HTMLElement & { node?: unknown; theme?: string; world?: string }>(null)
  useEffect(() => {
    if (!ref.current) return
    ref.current.world = world || ''
    ref.current.theme = 'dark'
    ref.current.node = node
  }, [node, world])
  return createElement('vegvisr-node', { ref, style: { display: 'block' } })
}
