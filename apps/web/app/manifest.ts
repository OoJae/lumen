import type { MetadataRoute } from 'next';

/**
 * The installable manifest.
 *
 * This used to declare `display: 'standalone'` with no `icons` at all, and
 * there was no `public/` directory to serve any from — so the install
 * affordance never fired on any platform. Chrome requires at least one icon of
 * 192px or larger before it will offer "Install"; iOS needs its own
 * apple-touch-icon, which is declared in the document head, not here.
 *
 * There is still no service worker, so Lumen is installable but not offline —
 * which is honest, given every reflection needs the network anyway. The journal
 * itself is already local: it lives in IndexedDB, encrypted.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Lumen — private AI journaling',
    short_name: 'Lumen',
    description:
      'A private, user-owned AI journaling companion built on 0G. Your reflections run inside a hardware TEE — provably unreadable.',
    start_url: '/',
    display: 'standalone',
    background_color: '#f7f3ea',
    theme_color: '#b45309',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // Cropped to whatever shape the launcher wants; the mark sits inside the
      // safe zone so a circular mask does not clip it.
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
