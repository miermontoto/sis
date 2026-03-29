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
import settingsRoute from './routes/settings.js';
import { getDb } from './db/connection.js';
import { getStoredTokens } from './services/token-manager.js';
import { validateSession } from './services/session.js';
import { hasAnyUsers } from './services/user-manager.js';
import { sql } from 'drizzle-orm';

export type AppVariables = {
  userId: number;
  spotifyId: string;
  isAdmin: boolean;
};

const app = new Hono<{ Variables: AppVariables }>();

app.use('*', logger());
app.use('/api/*', cors());

// auth gate: proteger todas las rutas /api/* excepto health
app.use('/api/*', async (c, next) => {
  // health check público (usado por el frontend para verificar auth)
  if (c.req.path === '/api/health') return next();

  // si no hay usuarios, permitir acceso sin auth (bootstrap)
  if (!hasAnyUsers()) return next();

  const token = getCookie(c, 'sis_session');
  if (!token) {
    return c.json({ error: 'no autorizado' }, 401);
  }

  const session = validateSession(token);
  if (!session) {
    return c.json({ error: 'sesión expirada' }, 401);
  }

  c.set('userId', session.userId);
  c.set('spotifyId', session.spotifyId);
  c.set('isAdmin', session.isAdmin);
  return next();
});

// rutas
app.route('/auth', auth);
app.route('/api/stats', stats);
app.route('/api/now-playing', nowPlaying);
app.route('/api/export', exportRoute);
app.route('/api/import', importRoute);
app.route('/api/admin', admin);
app.route('/api/settings', settingsRoute);

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

// health check — público pero retorna 401 si hay usuarios y no hay sesión válida
app.get('/api/health', (c) => {
  if (hasAnyUsers()) {
    const token = getCookie(c, 'sis_session');
    if (!token || !validateSession(token)) {
      return c.json({ error: 'no autorizado' }, 401);
    }
  }

  const db = getDb();
  const userId = (() => {
    const token = getCookie(c, 'sis_session');
    if (token) {
      const session = validateSession(token);
      if (session) return session.userId;
    }
    return undefined;
  })();
  const tokens = getStoredTokens(userId);
  const historyCount = userId
    ? db.all(sql`SELECT count(*) as count FROM listening_history WHERE user_id = ${userId}`)[0] as { count: number }
    : db.all(sql`SELECT count(*) as count FROM listening_history`)[0] as { count: number };

  return c.json({
    status: 'ok',
    database: 'connected',
    authenticated: !!tokens,
    totalPlays: historyCount.count,
    timestamp: new Date().toISOString(),
  });
});

// endpoint para info del usuario actual
app.get('/api/me', (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ authenticated: false });
  return c.json({
    authenticated: true,
    userId: c.get('userId'),
    spotifyId: c.get('spotifyId'),
    isAdmin: c.get('isAdmin'),
  });
});

// servir archivos estáticos del build de SvelteKit
app.use('/*', serveStatic({ root: './static' }));

// SPA fallback: cualquier ruta no encontrada → 200.html
app.use('/*', serveStatic({ root: './static', path: '200.html' }));

export default app;
