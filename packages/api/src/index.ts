import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// cargar .env desde la raíz del monorepo (dev) o cwd (docker)
const monorepoEnv = resolve(__dirname, '../../../.env');
const cwdEnv = resolve(process.cwd(), '.env');
const envPath = existsSync(monorepoEnv) ? monorepoEnv : cwdEnv;
if (existsSync(envPath)) {
  dotenv.config({ path: envPath });
}
import { serve } from '@hono/node-server';
import app from './app.js';
import { getDb, closeDb } from './db/connection.js';
import { initReadWorker, closeReadWorker } from './db/read-pool.js';
import { startPolling, stopPolling } from './services/polling.js';

const PORT = parseInt(process.env.PORT || '3000');

// inicializar db (ejecuta migraciones) y worker de lectura
getDb();
await initReadWorker();

// iniciar servidor
const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`[sis] servidor escuchando en http://localhost:${info.port}`);
});

// iniciar polling en background
startPolling();

// shutdown graceful
const shutdown = () => {
  console.log('\n[sis] cerrando...');
  stopPolling();
  closeReadWorker();
  closeDb();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
