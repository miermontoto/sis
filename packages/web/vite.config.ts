import { sveltekit } from '@sveltejs/kit/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd() + '/../..', '');
  const apiUrl = `http://localhost:${env.PORT || 3000}`;

  return {
    plugins: [
      sveltekit(),
      SvelteKitPWA({
        registerType: 'autoUpdate',
        strategies: 'generateSW',
        scope: '/',
        base: '/',
        manifest: {
          name: 'SIS — Spotify Stats',
          short_name: 'SIS',
          description: 'Personal Spotify listening statistics',
          theme_color: '#080a0c',
          background_color: '#080a0c',
          display: 'standalone',
          scope: '/',
          start_url: '/',
          icons: [
            {
              src: 'pwa-192.png',
              sizes: '192x192',
              type: 'image/png',
            },
            {
              src: 'pwa-512.png',
              sizes: '512x512',
              type: 'image/png',
            },
            {
              src: 'pwa-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
          shortcuts: [
            { name: 'Dashboard', url: '/', icons: [{ src: 'pwa-192.png', sizes: '192x192' }] },
            { name: 'History', url: '/history', icons: [{ src: 'pwa-192.png', sizes: '192x192' }] },
            { name: 'Rankings', url: '/top', icons: [{ src: 'pwa-192.png', sizes: '192x192' }] },
            { name: 'Insights', url: '/insights', icons: [{ src: 'pwa-192.png', sizes: '192x192' }] },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,png,svg,woff,woff2}'],
          navigateFallback: '200.html',
          navigateFallbackDenylist: [/^\/api\//, /^\/auth\//],
          runtimeCaching: [
            {
              urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
              handler: 'NetworkOnly' as const,
            },
            {
              urlPattern: ({ url }) => url.pathname.startsWith('/auth/'),
              handler: 'NetworkOnly' as const,
            },
          ],
        },
        devOptions: {
          enabled: false,
        },
      }),
    ],
    server: {
      host: '127.0.0.1',
      proxy: {
        '/api': apiUrl,
        '/auth': apiUrl,
      },
    },
  };
});
