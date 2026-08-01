// entrypoint de la api: carga env, inicializa db + read worker y arranca el
// servidor http con shutdown graceful (boilerplate en @platform/core-api).
import { loadAppEnv, startApiServer } from '@platform/core-api';
import app from './app.js';
import { getDb, closeDb } from './db/connection.js';
import { initReadWorker, closeReadWorker } from './db/read-pool.js';
import { startPolling, stopPolling } from './services/polling.js';
import { cleanupExpiredSessions } from './services/session.js';
import { VERSION } from './constants.js';

// .env desde raíz de la app (dev en monorepo) o cwd (docker); .env.local sobrescribe
loadAppEnv(import.meta.url);

// inicializar db (ejecuta migraciones) y worker de lectura
getDb();
cleanupExpiredSessions();
await initReadWorker();

// iniciar polling en background (DISABLE_POLLING=1 para dev local con snapshot de prod)
if (process.env.DISABLE_POLLING === '1') {
  console.log('[sis] polling deshabilitado (DISABLE_POLLING=1)');
} else {
  startPolling();
}

// servidor http con shutdown graceful (SIGINT/SIGTERM)
startApiServer(app, {
  name: 'sis',
  version: VERSION,
  onShutdown: () => {
    stopPolling();
    closeReadWorker();
  },
  afterClose: () => closeDb(),
});
