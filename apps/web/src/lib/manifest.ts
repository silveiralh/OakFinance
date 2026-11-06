// Manifest do PWA, usado pelo vite-plugin-pwa no build. O teste compara com o trecho da UX §4.11.5.
/** Manifest (UX §4.8 e §4.11.5). `id` e `scope` explícitos: o check-build exige. */
export const MANIFEST = {
  id: '/',
  name: 'OakFinance',
  short_name: 'OakFinance',
  lang: 'pt-BR',
  start_url: '/?origem=pwa',
  scope: '/',
  display: 'standalone' as const,
  orientation: 'any' as const,
  theme_color: '#4FB6EC',
  background_color: '#E8F7FF',
  icons: [
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
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
    { src: '/icons/icon-mono-512.png', sizes: '512x512', type: 'image/png', purpose: 'monochrome' },
  ],
};
