import type { MetadataRoute } from 'next';

// Typed web app manifest (App Router convention). Served at /manifest.webmanifest.
// Keep icon entries in sync with scripts/generate-icons.mjs output.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Ledger — AI Financial OS',
    short_name: 'Ledger',
    description: 'A personal AI-powered financial operating system.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0b1220',
    theme_color: '#0b1220',
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-maskable-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
