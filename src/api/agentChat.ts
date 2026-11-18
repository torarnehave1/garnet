import type { User } from '../lib/types'

// The chat runs on agent.vegvisr.org/chat (Agent-Builder's agent-worker) in its locked work context
// "VEGR.AI MCP Server": the model's only tool is mcp_call, which reaches knowledge.vegvisr.org/mcp
// as the signed-in person, with the same tools and scopes as their own Claude connection.
const CHAT_URL = 'https://agent.vegvisr.org/chat'

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string | unknown[] // blocks (image, document, text) when files are attached (attachments.ts)
}

export type ChatEvent =
  | { type: 'text'; content: string }
  | { type: 'model'; model: string }
  | { type: 'tool_call'; callId: string; tool: string; name: string; args: Record<string, unknown> }
  | { type: 'tool_result'; callId: string; ok: boolean; summary: string }
  | { type: 'error'; error: string }
  | { type: 'done' }

// Garnet's own rule, carried into the chat: nothing changes without a yes.
const RULE =
  'Chat beside Garnet, the network map of the person’s knowledge graphs. Reading is free. Before any tool that creates, changes, moves, deletes, publishes or sends anything, say exactly what will change (name the graph) and wait for the person’s yes in a new message.'
// agent-worker's lock prompt was written for the Cloudflare context: it says graphs and the rest
// of the toolbox "cannot be called" and that reading a graph is out of scope. Here both go through
// mcp_call, and a model that believed the prompt sent the person away to another work context
// (2026-11-18: asked for an OpenAI image as a graph's header). This says what is true here.
const REACH =
  'What you can do here: everything the VEGR.AI MCP server offers, through mcp_call with server "vegr". That includes reading, creating and changing graphs and their nodes and metadata, making images (among them generate_image_openai for the OpenAI image model, and generate_node_image, which can also place the image as a node’s header), chat, contacts, e-mail and SMS. Agent-Builder’s own tools (generate_image, patch_node, delegate_to_kg, read_graph and the like) are not loaded here; that is no reason to decline, because the VEGR.AI MCP server has its own tools for the same work. Before you say something cannot be done here, list the tools (mcp_call with only server "vegr") and look for one that fits. Tell the person to choose another work context only when that list has no tool for the job.'
const CAPABILITIES = [
  {
    name: 'mcp_call',
    summary:
      'Every tool of the VEGR.AI MCP server (server "vegr"), as the signed-in person: read and change graphs and nodes, make images, chat, contacts, e-mail and SMS.',
  },
]

export async function sendChat(
  user: User,
  model: string,
  messages: ChatTurn[],
  graphId: string | null,
  view: string, // what the map shows now (chatContext.ts)
  onEvent: (e: ChatEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  if (!user.token) throw new Error('Sign in to chat.')
  const r = await fetch(CHAT_URL, {
    method: 'POST',
    // garnet.vegr.ai is not a vegvisr.org origin, so no cookie: the login token goes in the body.
    credentials: 'omit',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: user.email,
      authToken: user.token,
      model,
      // No exactModel: agent-worker then treats the model as a ceiling and chooses per message,
      // Haiku 5.5 for a simple message and this model for a complex one (model-router.js).
      messages,
      graphId: graphId || undefined,
      workContext: { title: 'VEGR.AI MCP Server', description: RULE + '\n\n' + REACH + '\n\n' + view, capabilities: CAPABILITIES },
    }),
    signal,
  })
  if (!r.ok || !r.body) {
    let msg = `The chat answered HTTP ${r.status}.`
    try {
      const j = await r.json()
      if (j?.error) msg = typeof j.error === 'string' ? j.error : JSON.stringify(j.error)
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
      else if (name === 'model_choice' && typeof d.model === 'string') onEvent({ type: 'model', model: d.model })
      else if (name === 'tool_call') {
        const input = (d.input || {}) as Record<string, unknown>
        // mcp_call names the MCP tool it runs; without one it lists the tools.
        const name =
          d.tool === 'mcp_call' ? String(input.tool_name || input.describe_tool || 'list tools') : String(d.tool)
        // For mcp_call, the MCP tool's own arguments (where a graphId shows which graph it touches).
        const args = (d.tool === 'mcp_call' ? input.arguments : input) as Record<string, unknown> | undefined
        onEvent({
          type: 'tool_call',
          callId: String(d.callId),
          tool: String(d.tool),
          name,
          args: args && typeof args === 'object' ? args : {},
        })
      } else if (name === 'tool_result')
        onEvent({
          type: 'tool_result',
          callId: String(d.callId),
          ok: d.success !== false,
          summary: String(d.summary || d.error || ''),
        })
      else if (name === 'error') onEvent({ type: 'error', error: String(d.error || 'The chat stopped with an error.') })
      else if (name === 'done') onEvent({ type: 'done' })
    }
  }
}
