import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// config mínima para testear módulos .svelte.ts (runes) sin arrancar sveltekit:
// el plugin de svelte compila los runes y los alias replican los de kit
export default defineConfig({
  plugins: [svelte({ configFile: false })],
  resolve: {
    alias: {
      $lib: fileURLToPath(new URL('./src/lib', import.meta.url)),
      '@sis/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
  },
});
