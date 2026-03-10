import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serveStatic } from '@hono/node-server/serve-static';
import auth from './routes/auth.js';
import stats from './routes/stats.js';
import nowPlaying from './routes/now-playing.js';
import exportRoute from './routes/export.js';
import importRoute from './routes/import.js';
import { getDb } from './db/connection.js';
import { getStoredTokens } from './services/token-manager.js';
import { sql } from 'drizzle-orm';

const app = new Hono();

app.use('*', logger());
app.use('/api/*', cors());

// rutas
app.route('/auth', auth);
app.route('/api/stats', stats);
app.route('/api/now-playing', nowPlaying);
app.route('/api/export', exportRoute);
app.route('/api/import', importRoute);

// health check
app.get('/api/health', (c) => {
  const db = getDb();
  const tokens = getStoredTokens();
  const historyCount = db.all(sql`SELECT count(*) as count FROM listening_history`)[0] as { count: number };

  return c.json({
    status: 'ok',
    database: 'connected',
    authenticated: !!tokens,
    totalPlays: historyCount.count,
    timestamp: new Date().toISOString(),
  });
});

// servir archivos estáticos del build de SvelteKit
app.use('/*', serveStatic({ root: './static' }));

// SPA fallback: cualquier ruta no encontrada → 200.html
app.use('/*', serveStatic({ root: './static', path: '200.html' }));

export default app;
