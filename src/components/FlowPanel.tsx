import { useEffect, useState } from 'react'
import { Background, Controls, Handle, Position, ReactFlow, useNodesState, type Edge, type Node, type NodeProps } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { loadGraph } from '../api/kg'
import { EditorLink, useEditorBase } from '../lib/editorLink'
import { kindOf, readFlow, ROUTE_COLORS, stepSub, type FlowBox } from '../lib/flow'
import type { User } from '../lib/types'


// The flow of one graph, drawn in a panel on the right. Read-only: nothing here saves or runs a
// flow. It is drawn with React Flow so that editing can be added later on the same canvas.
type BoxNode = Node<{ box: FlowBox }, 'box'>

function Box({ data, selected }: NodeProps<BoxNode>) {
  const b = data.box
  const k = b.head ? { name: 'VEGR Flow', hex: '#a78bfa' } : kindOf(b.kind)
  const sub = stepSub(b)
  const each = b.meta.forEach ? `for each ${b.meta.forEach}${b.meta.maxItems ? ` (max ${b.meta.maxItems})` : ''}` : ''
  return (
    <div className={'fbox' + (b.head ? ' fhead' : '') + (selected ? ' on' : '')} style={{ ['--k' as string]: k.hex }}>
      {!b.head && <Handle type="target" position={Position.Top} />}
      <div className="fkind">
        {k.name}
        {b.head && typeof b.meta.status === 'string' && <span className="fstatus">{b.meta.status}</span>}
      </div>
      <div className="fname">{b.label}</div>
      {sub && <div className="fsub">{sub}</div>}
      {each && <div className="fsub">{each}</div>}
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}
const nodeTypes = { box: Box }

function Block({ title, value }: { title: string; value: unknown }) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value === 'object' && !Object.keys(value as object).length) return null
  return (
    <div className="fblock">
      <div className="fblockT">{title}</div>
      <pre>{typeof value === 'string' ? value : JSON.stringify(value, null, 2)}</pre>
    </div>
  )
}

function Details({ box }: { box: FlowBox | null }) {
  if (!box) return <p className="muted">Click a step to see what it does.</p>
  const m = box.meta
  return (
    <div>
      <div className="fkind" style={{ color: box.head ? '#a78bfa' : kindOf(box.kind).hex }}>
        {box.head ? 'VEGR Flow' : kindOf(box.kind).name}
      </div>
      <h3>{box.label}</h3>
      {box.info && <p className="finfo">{box.info}</p>}
      {box.head ? (
        <>
          <Block title="Inputs" value={m.inputs} />
          <Block title="Limits" value={m.limits} />
          <Block title="Triggers" value={m.triggers} />
        </>
      ) : (
        <>
          <Block title="Tool" value={m.toolName} />
          <Block title="Model" value={m.model} />
          <Block title="For each" value={m.forEach ? `${m.forEach}${m.maxItems ? ` (max ${m.maxItems})` : ''}` : ''} />
          <Block title="Instructions" value={m.instructions} />
          <Block title="Input" value={m.input} />
          <Block title="Params" value={m.params} />
          <Block title="Payload" value={m.payload} />
          <Block title="Output" value={m.outputSchema} />
        </>
      )}
    </div>
  )
}

// The canvas keeps its nodes in React Flow's own state, so sizes it measures are kept (and so
// editing can be added here later).
function Canvas({ boxes, edges, pick, onPick }: { boxes: FlowBox[]; edges: Edge[]; pick: string | null; onPick: (id: string | null) => void }) {
  const [nodes, setNodes, onNodesChange] = useNodesState<BoxNode>(
    boxes.map((b) => ({ id: b.id, type: 'box', position: { x: b.x, y: b.y }, data: { box: b }, selected: b.id === pick })),
  )
  const [seen, setSeen] = useState(pick)
  if (seen !== pick) {
    setSeen(pick)
    setNodes((ns) => ns.map((n) => (n.selected === (n.id === pick) ? n : { ...n, selected: n.id === pick })))
  }
  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      nodeTypes={nodeTypes}
      colorMode="dark"
      fitView
      fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
      minZoom={0.2}
      nodesDraggable={false}
      nodesConnectable={false}
      edgesFocusable={false}
      onNodeClick={(_, n) => onPick(n.id)}
      onPaneClick={() => onPick(null)}
    >
      <Background gap={24} size={1} color="rgba(232,238,247,0.06)" />
      <Controls showInteractive={false} />
    </ReactFlow>
  )
}

export default function FlowPanel({ user, graphId, world, title, focus, onClose }: { user: User; graphId: string; world: string; title: string; focus: string | null; onClose: () => void }) {
  const editor = useEditorBase(world)
  const [state, setState] = useState<{ id: string; boxes: FlowBox[]; edges: Edge[] } | { id: string; error: string } | null>(null)
  const [pick, setPick] = useState<string | null>(focus)

  // A click on another node of the same graph in the network picks that step here.
  const [seenFocus, setSeenFocus] = useState(focus)
  if (seenFocus !== focus) {
    setSeenFocus(focus)
    setPick(focus)
  }
  useEffect(() => {
    let live = true
    loadGraph(user, graphId)
      .then((g) => {
        const { boxes, lines } = readFlow(g)
        if (!boxes.some((b) => b.head)) throw new Error('this graph has no flow node')
        const edges: Edge[] = lines.map((l) => {
          const only = l.labels.length === 1 ? l.labels[0] : null
          const stroke = (only && ROUTE_COLORS[only]) || 'rgba(148,163,184,0.55)'
          return {
            id: l.id,
            source: l.source,
            target: l.target,
            label: only === 'next' ? undefined : l.labels.join(' · '),
            style: { stroke, strokeWidth: 1.5 },
            labelStyle: { fill: '#e8eef7', fontSize: 10 },
            labelBgStyle: { fill: '#0b1220' },
          }
        })
        if (live) setState({ id: graphId, boxes, edges })
      })
      .catch((e) => live && setState({ id: graphId, error: String(e?.message || 'unknown error') }))
    return () => {
      live = false
    }
  }, [graphId, user])

  const ready = state && state.id === graphId && 'boxes' in state ? state : null
  const box = ready?.boxes.find((b) => b.id === pick) || null

  return (
    <aside className="flowpanel" aria-label={'Flow: ' + title} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="panelhead">
        <strong title={title}>{title}</strong>
        <button className="x" type="button" aria-label="Close the flow" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="flowcanvas">
        {!state || state.id !== graphId ? (
          <p className="muted">Loading the flow…</p>
        ) : 'error' in state ? (
          <p className="muted">Could not draw the flow ({state.error}).</p>
        ) : (
          <Canvas key={graphId} boxes={ready!.boxes} edges={ready!.edges} pick={pick} onPick={setPick} />
        )}
      </div>
      <div className="flowdetails">
        <Details box={box} />
        <div className="flowfoot">
          Read-only. A flow is run over the MCP tool run_flow.{' '}
          <EditorLink editor={editor} graphId={graphId} />
        </div>
      </div>
    </aside>
  )
}
