import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Lumen — Own your mind. Prove your privacy.',
  description:
    'A private, user-owned AI journaling companion built on 0G. Every reflection runs inside a hardware TEE — the provider cannot read your words, and you can verify it.',
  applicationName: 'Lumen',
  // iOS ignores the manifest's icons entirely and reads this link instead;
  // without it, "Add to Home Screen" renders a screenshot of the page.
  icons: {
    icon: [
      // The SVG stays first: it is the crisp one at favicon sizes, and setting
      // `icons` here would otherwise displace the app/icon.svg file convention.
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  appleWebApp: { capable: true, title: 'Lumen', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f7f3ea' },
    { media: '(prefers-color-scheme: dark)', color: '#100f0c' },
  ],
};

/**
 * The root layout deliberately holds NO providers.
 *
 * `<Providers>` is wagmi + RainbowKit + TanStack + the memory-key context. Having
 * it here meant every route paid for the wallet stack: the public companion proof
 * page — whose own doc comment promises "no wallet, no extension, no account,
 * nothing to install" — was downloading 366 KB of wallet code to render a
 * read-only page. (Next's build output reports that route at 108 KB, which is
 * misleading: it does not attribute root-layout client chunks to the route. The
 * live page tells the truth.)
 *
 * Providers now live in app/(app)/layout.tsx, so only routes that can actually
 * connect a wallet load one.
 */

// Set the theme class before paint to avoid a flash of the wrong theme.
const themeInit = `(function(){try{var t=localStorage.getItem('lumen-theme');var dark=t?t==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;if(dark)document.documentElement.classList.add('dark');}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
