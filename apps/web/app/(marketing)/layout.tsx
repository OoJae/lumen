import type { Viewport } from 'next';
import { Instrument_Serif } from 'next/font/google';

/**
 * These pages are night whatever the reader's theme is, so the browser chrome
 * has to be too. The root layout exports a media-keyed pair that resolves to
 * cream for a light-mode visitor, which painted a cream status bar over a black
 * page. A child segment's viewport overrides it for this subtree only.
 */
export const viewport: Viewport = {
  themeColor: '#100f0c',
  colorScheme: 'dark',
};

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
 * rather than a headline.
 *
 * There was a second face here — IBM Plex Mono, as an "evidence voice" for the
 * ciphertext. It was 35 KB that rendered ZERO glyphs. `@theme inline` in
 * globals.css inlines the literal system mono stack into `.font-mono`, so a
 * `--font-mono` override on this wrapper could never reach the utility class,
 * and every mono character on the site was already being drawn in the system
 * face. Which means the design signed off in review WAS the system face. Two
 * preloaded woff2 files for a typeface nobody ever saw.
 */
const display = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  variable: '--font-instrument',
  display: 'swap',
});

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`dark lumen-night min-h-dvh bg-canvas ${display.variable}`}>{children}</div>
  );
}
