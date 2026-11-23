import { city } from '../../city.config';

const shortcut = (name: string, url: string) => ({ name, url, icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }] });

export const GET = () => new Response(JSON.stringify({
  id: '/',
  name: city.siteName,
  short_name: city.siteName,
  description: `Vozni red autobusa: ${city.name}`,
  lang: 'hr',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  background_color: '#f5f6f7',
  theme_color: '#1f4fd0',
  categories: ['travel', 'navigation'],
  icons: [
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
  shortcuts: [shortcut('Linije', '/linije'), shortcut('Stanice', '/stanice'), shortcut('Put', '/put')],
}), { headers: { 'content-type': 'application/manifest+json; charset=utf-8' } });
