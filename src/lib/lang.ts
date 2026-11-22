// The sign-in page speaks Norwegian or English. The choice also decides the language of the
// sign-in email (sent as `lang` to /login/magic/send). Remembered in this browser; the first
// guess comes from the browser's own language.
export type Lang = 'no' | 'en'
const KEY = 'garnet-lang'

export function readLang(): Lang {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'no' || v === 'en') return v
  } catch {
    /* storage blocked */
  }
  const nav = (navigator.languages || [navigator.language || '']).join(',').toLowerCase()
  return /(^|,)(nb|nn|no)\b/.test(nav) ? 'no' : 'en'
}

export function saveLang(l: Lang) {
  try {
    localStorage.setItem(KEY, l)
  } catch {
    /* storage blocked */
  }
}

// Fixed texts on the sign-in page. The lead, button, title and footer can be overridden per language
// in the brand graph (metadata.login.no / metadata.login.en).
export const T = {
  no: {
    partOf: 'Del av VEGR.AI',
    email: 'E-postadresse',
    sending: 'Sender lenke…',
    sentBody: (e: string) => `En innloggingslenke er på vei til ${e}. Åpne den på denne enheten, så kommer du hit innlogget.`,
    another: 'Bruk en annen e-post',
    signingIn: 'Logger deg inn…',
    badLink: (m: string) => `Denne innloggingslenken virket ikke (${m}). Be om en ny under.`,
  },
  en: {
    partOf: 'Part of VEGR.AI',
    email: 'Email address',
    sending: 'Sending link…',
    sentBody: (e: string) => `A sign-in link is on its way to ${e}. Open it on this device to come back here signed in.`,
    another: 'Use another email',
    signingIn: 'Signing you in…',
    badLink: (m: string) => `This sign-in link did not work (${m}). Ask for a new one below.`,
  },
}
