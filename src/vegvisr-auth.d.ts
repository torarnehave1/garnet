import type { DetailedHTMLProps, HTMLAttributes } from 'react'

// The standard Vegvisr login bar, loaded from api.vegvisr.org at run time.
declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'vegvisr-auth': DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & { lang?: string; 'register-mode'?: string }
    }
  }
}
