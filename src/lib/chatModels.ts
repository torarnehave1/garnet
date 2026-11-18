// Garnet has no model picker (2026-11-18): the chat always sends DEFAULT_CHAT_MODEL. The list is
// kept to give the name of the model that answered, also on messages from earlier chats.
// The chat models Agent-Builder offers that agent.vegvisr.org/chat can run (Agent-Builder
// src/components/ModelSettings.tsx MODELS). Left out: Workers AI (@cf/…, only on Agent-Builder's
// WebSocket agent), Ollama (runs in the browser against a local server) and the image models.
export interface ChatModel {
  id: string
  name: string
  group: string
}

export const CHAT_MODELS: ChatModel[] = [
  { id: 'auto', name: 'Auto (Haiku 5.5 or Sonnet 5.5 per message)', group: 'Anthropic' },
  { id: 'claude-haiku-5-5', name: 'Haiku 5.5', group: 'Anthropic' },
  { id: 'claude-sonnet-5-5', name: 'Sonnet 5.5', group: 'Anthropic' },
  { id: 'claude-opus-5-5', name: 'Opus 5.5', group: 'Anthropic' },
  { id: 'claude-haiku-4-5-20251001', name: 'Haiku 4.5', group: 'Anthropic' },
  { id: 'claude-sonnet-4-6', name: 'Sonnet 4.6', group: 'Anthropic' },
  { id: 'claude-opus-4-6', name: 'Opus 4.6', group: 'Anthropic' },
  { id: 'openai/gpt-5.6-sol', name: 'GPT-5.6 Sol', group: 'OpenAI' },
  { id: 'openai/gpt-5.6-terra', name: 'GPT-5.6 Terra', group: 'OpenAI' },
  { id: 'openai/gpt-5.6-luna', name: 'GPT-5.6 Luna', group: 'OpenAI' },
  { id: 'grok/grok-4.5', name: 'Grok 4.5', group: 'Grok' },
  { id: 'grok/grok-4.3', name: 'Grok 4.3', group: 'Grok' },
  { id: 'gemini/gemini-2.5-flash', name: 'Gemini 2.5 Flash (your own key)', group: 'Gemini' },
  { id: 'gemini/gemini-2.5-pro', name: 'Gemini 2.5 Pro (your own key)', group: 'Gemini' },
  { id: 'kimi/kimi-k3.1-pro', name: 'Kimi K3.1 Pro', group: 'Kimi' },
]

export const DEFAULT_CHAT_MODEL = 'auto'
export const chatModelName = (id: string) => CHAT_MODELS.find((m) => m.id === id)?.name || id
