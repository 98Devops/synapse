import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Synapse — your second brain',
    short_name: 'Synapse',
    description: 'Speak a thought. Synapse connects it, learns your patterns, and shows you how you are changing.',
    start_url: '/?source=pwa',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0b0d12',
    theme_color: '#0b0d12',
    categories: ['productivity', 'lifestyle', 'health'],
    icons: [
      { src: '/pwa-icon/192', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/pwa-icon/512', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/pwa-icon/maskable', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Capture a thought', url: '/?tab=capture' },
      { name: 'Log training', url: '/training' },
      { name: 'Ask your brain', url: '/?tab=agent' },
    ],
  };
}
