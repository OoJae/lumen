import { Instrument_Serif, IBM_Plex_Mono } from 'next/font/google';

/**
 * Everything a stranger can read without connecting anything.
 *
 * No providers by design — see app/(app)/layout.tsx. The landing page and the
 * public companion proof page both promise you need no wallet, and this group
 * is what makes that promise true in bytes rather than only in copy.
 *
 * Any component rendered here must not import ConnectWallet or AppHeader, which
 * pull RainbowKit back in and would silently undo the split. There is a test.
 */

/**
 * The two faces the app itself does not pay for.
 *
 * `next/font` self-hosts and subsets at build time, so this costs no third-party
 * request and cannot shift layout. Both are scoped to this subtree via CSS
 * variables — the journal keeps its zero-webfont system stacks.
 *
 * Instrument Serif is the display voice: high contrast, tight-set, a title page
 * rather than a headline. IBM Plex Mono is the evidence voice — humanist enough
 * to sit beside an old-style serif without arguing, and the correct register for
 * a hash you are being invited to check.
 */
const display = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  variable: '--font-instrument',
  display: 'swap',
});

const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-plex-mono',
  display: 'swap',
});

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={`dark lumen-night min-h-dvh bg-canvas ${display.variable} ${mono.variable}`}
      style={{ '--font-mono': 'var(--font-plex-mono)' } as React.CSSProperties}
    >
      {children}
    </div>
  );
}
