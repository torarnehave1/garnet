import { useEffect, useState } from 'react'
import { loadHistory, loadVersionNodes } from '../api/kg'
import type { Engine } from '../engine/Engine'
import { changedNodes, NODE_TIME_SINCE, pickVersions } from './nodePulse'
import { dayStart, updatedMs, when } from './rows'
import type { Row, User } from './types'

// Days from NODE_TIME_SINCE on need nothing from here: the map reads each node's own time.
// For earlier days, two saved versions are compared. Up to three requests a graph (its history and two saved versions), so the nodes are worked out
// only for a map of at most MOST graphs, a few at a time, the most recently changed first.
const AT_ONCE = 4
export const NODE_PULSE_MOST = 60

export interface NodePulseSummary {
  compared: boolean // false: only each node's own time is used, nothing is counted here
  nodes: number // nodes found changed so far
  graphs: number // graphs holding them
  read: number
  toRead: number
  skipped: number // graphs beyond NODE_PULSE_MOST: their nodes are not worked out
  capped: number // graphs whose kept versions do not reach back to the first day
  failed: number
  done: boolean
}

/**
 * With the pulse layer on and an "Updated from" day chosen: the nodes changed in those days, by
 * graph, given to the map so each one pulses. `on` is false when the map draws no nodes.
 */
export function useNodePulse(engine: Engine | null, user: User, shown: Row[], updFrom: string, updTo: string, on: boolean): NodePulseSummary | null {
  const [sum, setSum] = useState<NodePulseSummary | null>(null)
  const active = on && !!updFrom

  useEffect(() => {
    if (!engine) return
    const by = new Map<string, Set<string>>()
    engine.setNodePulse(by)
    engine.setNodeWindow(null)
    if (!active) return
    const from = dayStart(updFrom)
    const to = updTo ? dayStart(updTo) + 86400000 - 1 : Infinity
    engine.setNodeWindow({ from, to })
    if (from >= NODE_TIME_SINCE) {
      void Promise.resolve().then(() => setSum({ compared: false, nodes: 0, graphs: 0, read: 0, toRead: 0, skipped: 0, capped: 0, failed: 0, done: true }))
      return
    }
    const all = shown.filter((r) => !r.virtual && updatedMs(r) >= from).sort((a, b) => updatedMs(b) - updatedMs(a))
    const todo = all.slice(0, NODE_PULSE_MOST)
    let read = 0
    let capped = 0
    let failed = 0
    let stopped = false
    const report = (done: boolean) => {
      if (stopped) return
      let nodes = 0
      by.forEach((s) => (nodes += s.size))
      setSum({ compared: true, nodes, graphs: by.size, read, toRead: todo.length, skipped: all.length - todo.length, capped, failed, done })
    }
    void Promise.resolve().then(() => report(!todo.length))
    let next = 0
    const worker = async () => {
      while (!stopped && next < todo.length) {
        const r = todo[next++]
        try {
          const h = await loadHistory(user, r.id, r.updated)
          const pick = pickVersions(h.versions, from, to, when(r))
          if (pick) {
            const [base, now] = await Promise.all([pick.base == null ? null : loadVersionNodes(user, r.id, pick.base), loadVersionNodes(user, r.id, pick.now)])
            if (stopped) return
            if (pick.capped) capped++
            const ids = changedNodes(base, now)
            if (ids.length) by.set(r.id, new Set(ids))
          }
        } catch {
          failed++
        }
        read++
        report(false)
      }
    }
    Promise.all(Array.from({ length: Math.min(AT_ONCE, todo.length) }, worker)).then(() => report(true))
    return () => {
      stopped = true
    }
  }, [engine, user, shown, updFrom, updTo, active])

  return active ? sum : null
}
