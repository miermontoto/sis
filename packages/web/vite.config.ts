// config de vite delegada al preset compartido de @platform/config
import { createPwaOptions, createWebConfig } from '@platform/config/vite';

// createPwaOptions devuelve una union (generateSW | injectManifest); en la rama
// generateSW (la nuestra) existe `workbox`. se tipa laxo para poder aumentarlo.
const pwa: Record<string, any> = createPwaOptions({
  name: 'SIS — Spotify Stats',
  shortName: 'SIS',
  description: 'Personal Spotify listening statistics',
  themeColor: '#080a0c',
  shortcuts: [
    { name: 'Dashboard', url: '/' },
    { name: 'History', url: '/history' },
    { name: 'Rankings', url: '/top' },
    { name: 'Insights', url: '/insights' },
  ],
});

// inyecta los handlers de push en el sw generado por workbox sin sustituirlo:
// importScripts carga static/push-sw.js (copiado tal cual al build) dentro del
// sw autogenerado, añadiendo los listeners 'push'/'notificationclick' sobre el
// precache existente. es la vía menos invasiva — mantiene strategies:'generateSW'
// del preset compartido y no obliga a escribir el sw a mano (que rompería otras
// apps de la plataforma que reusan createPwaOptions).
pwa.workbox = { ...pwa.workbox, importScripts: ['push-sw.js'] };

export default createWebConfig({
  proxy: ['/api', '/auth'],
  pwa,
});
