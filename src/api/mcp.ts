import type { User } from '../lib/types'

// The VEGR.AI MCP server (KG Manager). Garnet calls it with the visitor's own login token as a
// Bearer token: the server resolves it to that person and gives the same scopes as the person's
// own Claude connection. Every call is that person's — never a shared account's.
export const MCP_URL = 'https://knowledge.vegvisr.org/mcp'

export class McpError extends Error {
  status: number
  code: string
  constructor(message: string, status: number, code = '') {
    super(message)
    this.status = status
    this.code = code
  }
}

const CODES = /\b(FORBIDDEN_GRAPH|INSUFFICIENT_SCOPE|VERSION_CONFLICT|GRAPH_NOT_FOUND|NOT_FOUND|INVALID_INPUT)\b/

let nextId = 1

// One tools/call. Returns structuredContent, or throws McpError with the server's own words.
export async function mcpCall<T = Record<string, unknown>>(user: User | null, tool: string, args: Record<string, unknown>): Promise<T> {
  if (!user?.token) throw new McpError('Sign in to read graphs.', 401)
  const r = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + user.token,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name: tool, arguments: args } }),
  })
  if (r.status === 401) throw new McpError('Your login is no longer valid. Sign in again.', 401)
  const raw = await r.text()
  if (!r.ok) throw new McpError(raw.slice(0, 200) || 'HTTP ' + r.status, r.status)
  // The server answers plain JSON; an event stream is read as its data lines.
  const text = raw.trimStart().startsWith('{')
    ? raw
    : raw
        .split(/\r?\n/)
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5))
        .join('')
  let msg: { result?: { isError?: boolean; structuredContent?: unknown; content?: { text?: string }[] }; error?: { message?: string; code?: number } }
  try {
    msg = JSON.parse(text)
  } catch {
    throw new McpError('The MCP server sent an answer Garnet could not read.', 502)
  }
  if (msg.error) throw new McpError(msg.error.message || 'MCP error', 400)
  const res = msg.result || {}
  const words = (res.content || []).map((c) => c.text || '').join('\n')
  if (res.isError) {
    const code = CODES.exec(words)?.[1] || ''
    throw new McpError(words || 'The tool reported an error.', 400, code)
  }
  const sc = res.structuredContent as (T & { success?: boolean; error?: string }) | undefined
  if (!sc) throw new McpError(words || 'The tool returned no data.', 502)
  if (sc.success === false) throw new McpError(String(sc.error || words || 'The tool reported an error.'), 400, CODES.exec(String(sc.error || words))?.[1] || '')
  return sc
}
