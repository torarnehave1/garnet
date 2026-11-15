import type { Lang } from '../lib/lang'

// Garnet's look and sign-in text live in a published graph owned by post@vegr.ai, tagged
// #BRAND-garnet.vegr.ai. Its id is derived from the host (sha256 "world-brand:<host>", UUID v4
// shaped — the same rule as Agent-Builder's World brand graphs), so no lookup table is needed.
// Published, because the sign-in page reads it before anyone is signed in.
export const BRAND_GRAPH_ID = 'dedeaf23-c319-45a3-8d47-c9134c65ed85'

export interface LoginText {
  lead: string
  button: string
  sentTitle: string
  footer: string
}
export interface Brand {
  name: string
  slogan: string
  logoUrl: string
  accent: string
  login: Record<Lang, LoginText>
}

export const DEFAULT_BRAND: Brand = {
  name: 'Garnet',
  slogan: 'De som bøter garnet',
  logoUrl: '',
  accent: '#f2b45a',
  login: {
    en: {
      lead: 'The VEGR.AI knowledge graphs as one growing network. Sign in with your VEGR.AI email.',
      button: 'Send sign-in link',
      sentTitle: 'Check your inbox',
      footer: 'Garnet reads and changes graphs only as you, with your own VEGR.AI access.',
    },
    no: {
      lead: 'Kunnskapsgrafene i VEGR.AI som ett voksende nettverk. Logg inn med e-postadressen din i VEGR.AI.',
      button: 'Send innloggingslenke',
      sentTitle: 'Sjekk innboksen',
      footer: 'Garnet leser og endrer grafer bare som deg, med din egen tilgang i VEGR.AI.',
    },
  },
}

const str = (v: unknown, d: string) => (typeof v === 'string' && v.trim() ? v.trim() : d)
const https = (v: unknown) => (typeof v === 'string' && /^https:\/\/\S+$/.test(v) ? v : '')
const hex = (v: unknown, d: string) => (typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v) ? v : d)

function text(src: Record<string, unknown> | undefined, d: LoginText): LoginText {
  const l = src || {}
  return { lead: str(l.lead, d.lead), button: str(l.button, d.button), sentTitle: str(l.sentTitle, d.sentTitle), footer: str(l.footer, d.footer) }
}

// The brand graph, or the built-in values when it cannot be read (not created yet, offline).
// metadata.login is { en: {...}, no: {...} }; an older flat login block counts as English.
export async function loadBrand(): Promise<Brand> {
  try {
    const r = await fetch(`https://knowledge.vegvisr.org/getknowgraph?id=${BRAND_GRAPH_ID}`, { headers: { Accept: 'application/json' } })
    if (!r.ok) return DEFAULT_BRAND
    const g = await r.json()
    const m = (g?.nodes || []).find((n: { type?: string }) => n.type === 'world-brand')?.metadata
    if (!m) return DEFAULT_BRAND
    const l = m.login || {}
    const perLang = l.en || l.no
    return {
      name: str(m.name, DEFAULT_BRAND.name),
      slogan: str(m.slogan, DEFAULT_BRAND.slogan),
      logoUrl: https(m.logoUrl),
      accent: hex(m.colors?.accent, DEFAULT_BRAND.accent),
      login: {
        en: text(perLang ? l.en : l, DEFAULT_BRAND.login.en),
        no: text(perLang ? l.no : undefined, DEFAULT_BRAND.login.no),
      },
    }
  } catch {
    return DEFAULT_BRAND
  }
}
