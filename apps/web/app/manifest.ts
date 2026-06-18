import type { MetadataRoute } from 'next';

// Minimal installable PWA manifest. Service worker / offline polish is a later
// wave; this makes Lumen "add to home screen"-capable now.
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
  };
}
