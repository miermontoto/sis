import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { getCookie } from 'hono/cookie';
import { serveStatic } from '@hono/node-server/serve-static';
import fs from 'fs';
import path from 'path';
import auth from './routes/auth.js';
import stats from './routes/stats.js';
import nowPlaying from './routes/now-playing.js';
import exportRoute from './routes/export.js';
import importRoute from './routes/import.js';
import admin from './routes/admin.js';
import { getDb } from './db/connection.js';
import { getStoredTokens } from './services/token-manager.js';
import { validateSession } from './services/session.js';
import { sql } from 'drizzle-orm';

const app = new Hono();

app.use('*', logger());
app.use('/api/*', cors());

// auth gate: proteger rutas si ALLOWED_SPOTIFY_USERS está configurado
app.use('/api/*', async (c, next) => {
  const allowed = process.env.ALLOWED_SPOTIFY_USERS;
  if (!allowed || allowed.trim() === '') return next();

  const token = getCookie(c, 'sis_session');
  if (!token || !validateSession(token)) {
    return c.json({ error: 'no autorizado' }, 401);
  }
  return next();
});

// rutas
app.route('/auth', auth);
app.route('/api/stats', stats);
app.route('/api/now-playing', nowPlaying);
app.route('/api/export', exportRoute);
app.route('/api/import', importRoute);
app.route('/api/admin', admin);

// servir portadas descargadas desde data/covers/
const coversDir = path.resolve(process.env.DATABASE_PATH || './data/sis.db', '..', 'covers');
app.get('/api/covers/:filename', (c) => {
  const filename = c.req.param('filename');
  // solo permitir nombres seguros
  if (!/^[\w:.%-]+\.(jpg|png)$/.test(filename)) return c.notFound();
  const filePath = path.join(coversDir, filename);
  if (!fs.existsSync(filePath)) return c.notFound();
  const ext = path.extname(filename).slice(1);
  const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
  return c.body(fs.readFileSync(filePath), 200, {
    'Content-Type': mime,
    'Cache-Control': 'public, max-age=604800, immutable',
  });
});

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
