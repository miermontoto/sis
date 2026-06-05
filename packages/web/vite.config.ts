// config de vite delegada al preset compartido de @platform/config
import { createPwaOptions, createWebConfig } from '@platform/config/vite';

export default createWebConfig({
  proxy: ['/api', '/auth'],
  pwa: createPwaOptions({
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
  }),
});
