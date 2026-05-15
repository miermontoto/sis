import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/db/worker.ts'],
  format: ['esm'],
  dts: true,
  noExternal: ['@sis/shared'],
});
