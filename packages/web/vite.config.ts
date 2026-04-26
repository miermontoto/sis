import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd() + '/../..', '');
  const apiUrl = `http://localhost:${env.PORT || 3000}`;

  return {
    plugins: [sveltekit()],
    server: {
      host: '127.0.0.1',
      proxy: {
        '/api': apiUrl,
        '/auth': apiUrl,
      },
    },
  };
});
