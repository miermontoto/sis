import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/db/worker.ts'],
  format: ['esm'],
  dts: true,
  // @sis/shared y los paquetes @platform/* se publican como fuente ts → bundlearlos
  noExternal: ['@sis/shared', /^@platform\//],
});
