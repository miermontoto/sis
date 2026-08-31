// composición de la api de sis sobre el hono base de @platform/core-api:
// gate de sesión spotify, rutas de dominio, portadas, og html y spa estática.
import { getCookie } from 'hono/cookie';
import { createPlatformApp, mountSpa, sessionGate } from '@platform/core-api';
import fs from 'fs';
import path from 'path';
import auth from './routes/auth.js';
import stats from './routes/stats.js';
import nowPlaying from './routes/now-playing.js';
import exportRoute from './routes/export.js';
import importRoute from './routes/import.js';
import admin from './routes/admin.js';
import settingsRoute from './routes/settings.js';
import ratings from './routes/ratings.js';
import playlists from './routes/playlists.js';
import social from './routes/social.js';
import deviceTokens from './routes/device-tokens.js';
import push from './routes/push.js';
import lastfm from './routes/lastfm.js';
import mierid from './routes/mierid.js';
import { listenbrainzApi, listenTokenRoutes } from './routes/listens.js';
import publicRoutes from './routes/public.js';
import { renderOgHtml } from './services/og-html.js';
import { getDb } from './db/connection.js';
import { getStoredTokens, getStoredScopes } from './services/token-manager.js';
import { validateSession, type Session } from './services/session.js';
import { hasAnyUsers, getUserById } from './services/user-manager.js';
import { getLastfmAccount } from './services/lastfm-sync.js';
import { triggerDeferredStartup } from './services/deferred-startup.js';
import { sql } from 'drizzle-orm';
import { VERSION, UPLOAD_MAX_BYTES } from './constants.js';

export type AppVariables = {
  userId: number;
  spotifyId: string;
  isAdmin: boolean;
};

type SisEnv = { Variables: AppVariables };

const app = createPlatformApp<SisEnv>();

// servir portadas descargadas desde data/covers/. va ANTES del gate: son assets
// públicos (album art, ya visibles en share links) y las <img> del webview móvil
// no las proxia CapacitorHttp → cruzan de origen sin cookie → 401 → se vería el
// alt en vez de la imagen. registrada antes, el handler responde y el gate no
// llega a correr para esta ruta. las mutaciones (POST/PUT) sí van tras el gate.
const coversDir = path.resolve(process.env.DATABASE_PATH || './data/sis.db', '..', 'covers');
fs.mkdirSync(coversDir, { recursive: true });

app.get('/api/covers/:filename', (c) => {
  const filename = c.req.param('filename');
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

// auth gate: proteger todas las rutas /api/* excepto health y version
app.use(
  '/api/*',
  sessionGate<SisEnv, Session>({
    cookieName: 'sis_session',
    validate: validateSession,
    // health check y versión públicos (el frontend los usa para verificar auth)
    isPreAuth: (p) => p === '/api/health' || p === '/api/version',
    // si no hay usuarios, permitir acceso sin auth (bootstrap)
    bypass: () => !hasAnyUsers(),
    hydrate: (c, session, next) => {
      c.set('userId', session.userId);
      c.set('spotifyId', session.spotifyId);
      c.set('isAdmin', session.isAdmin);
      // startup diferido: playlist sync + records cache al primer request del usuario
      triggerDeferredStartup(session.userId);
      return next();
    },
  }),
);

// rutas
app.route('/auth', auth);
app.route('/api/stats', stats);
app.route('/api/now-playing', nowPlaying);
app.route('/api/export', exportRoute);
app.route('/api/import', importRoute);
app.route('/api/admin', admin);
app.route('/api/settings', settingsRoute);
app.route('/api/ratings', ratings);
app.route('/api/playlists', playlists);
app.route('/api/social', social);
app.route('/api/device-tokens', deviceTokens);
app.route('/api/push', push);
app.route('/api/lastfm', lastfm);
app.route('/api/mierid', mierid);
app.route('/api/listen-token', listenTokenRoutes);

// API de scrobbling compatible listenbrainz — fuera de /api/* a propósito: los
// clientes (pano scrobbler, web scrobbler…) apuntan su base URL al origen y
// añaden /1/...; autentica por token de scrobbling, no por sesión
app.route('/1', listenbrainzApi);

// rutas públicas (share links) — fuera de /api/* para quedar estructuralmente
// exentas del auth gate; nunca devuelven 401
app.route('/public', publicRoutes);

// guarda una imagen subida en data/covers/ y devuelve su ruta pública. la comparten
// portadas de álbum y fotos de artista: mismo asset, mismos límites, mismo directorio.
// devuelve el error en vez de lanzarlo para que cada ruta responda su propio 400
async function storeUploadedImage(file: string | File | undefined, entityId: string): Promise<{ imageUrl: string } | { error: string }> {
  if (!file || typeof file === 'string') return { error: 'file required' };

  const arrayBuf = await file.arrayBuffer();
  if (arrayBuf.byteLength > UPLOAD_MAX_BYTES) return { error: 'max 10MB' };

  const contentType = file.type || 'image/jpeg';
  if (!contentType.startsWith('image/')) return { error: 'must be an image' };
  const ext = contentType.includes('png') ? 'png' : 'jpg';

  const safeId = entityId.replace(/[^a-zA-Z0-9_:-]/g, '_');
  const filename = `${safeId}_custom_${Date.now()}.${ext}`;
  fs.writeFileSync(path.join(coversDir, filename), Buffer.from(arrayBuf));

  return { imageUrl: `/api/covers/${filename}` };
}

// seleccionar portada activa
app.put('/api/covers/album/:albumId', async (c) => {
  const albumId = c.req.param('albumId');
  const { imageUrl } = await c.req.json<{ imageUrl: string }>();
  if (!imageUrl) return c.json({ error: 'imageUrl required' }, 400);
  const db = getDb();
  db.run(sql`UPDATE albums SET image_url = ${imageUrl}, updated_at = datetime('now') WHERE spotify_id = ${albumId}`);
  return c.json({ ok: true });
});

// seleccionar foto de artista activa. image_pinned marca la elección como manual: sin
// esa marca el barrido periódico de /v1/artists la revertiría al tocarle turno
app.put('/api/covers/artist/:artistId', async (c) => {
  const artistId = c.req.param('artistId');
  const { imageUrl } = await c.req.json<{ imageUrl: string }>();
  if (!imageUrl) return c.json({ error: 'imageUrl required' }, 400);
  const db = getDb();
  db.run(sql`UPDATE artists SET image_url = ${imageUrl}, image_pinned = 1, updated_at = datetime('now') WHERE spotify_id = ${artistId}`);
  return c.json({ ok: true });
});

// elegir imagen de fondo del detalle de artista. no toca image_url ni image_pinned: el
// fondo es un pick aparte sobre el mismo pool de fotos. imageUrl null la desactiva y el
// fondo vuelve a caer en la foto activa
app.put('/api/covers/artist/:artistId/background', async (c) => {
  const artistId = c.req.param('artistId');
  const { imageUrl } = await c.req.json<{ imageUrl: string | null }>();
  const db = getDb();
  db.run(sql`UPDATE artists SET background_url = ${imageUrl || null}, updated_at = datetime('now') WHERE spotify_id = ${artistId}`);
  return c.json({ ok: true });
});

// subir imagen de fondo personalizada. entra al historial como cualquier otra foto
// (queda disponible también para el picker de la foto redonda)
app.post('/api/covers/artist/:artistId/background', async (c) => {
  const artistId = c.req.param('artistId');
  const body = await c.req.parseBody();
  const stored = await storeUploadedImage(body['file'], artistId);
  if ('error' in stored) return c.json(stored, 400);

  const db = getDb();
  db.run(sql`INSERT OR IGNORE INTO artist_images (artist_id, image_url, source) VALUES (${artistId}, ${stored.imageUrl}, 'upload')`);
  db.run(sql`UPDATE artists SET background_url = ${stored.imageUrl}, updated_at = datetime('now') WHERE spotify_id = ${artistId}`);

  return c.json(stored);
});

// subir portada personalizada
app.post('/api/covers/:albumId', async (c) => {
  const albumId = c.req.param('albumId');
  const body = await c.req.parseBody();
  const stored = await storeUploadedImage(body['file'], albumId);
  if ('error' in stored) return c.json(stored, 400);

  const db = getDb();
  db.run(sql`INSERT OR IGNORE INTO album_covers (album_id, image_url, source) VALUES (${albumId}, ${stored.imageUrl}, 'upload')`);
  db.run(sql`UPDATE albums SET image_url = ${stored.imageUrl}, updated_at = datetime('now') WHERE spotify_id = ${albumId}`);

  return c.json(stored);
});

// subir foto de artista personalizada
app.post('/api/covers/artist/:artistId', async (c) => {
  const artistId = c.req.param('artistId');
  const body = await c.req.parseBody();
  const stored = await storeUploadedImage(body['file'], artistId);
  if ('error' in stored) return c.json(stored, 400);

  const db = getDb();
  db.run(sql`INSERT OR IGNORE INTO artist_images (artist_id, image_url, source) VALUES (${artistId}, ${stored.imageUrl}, 'upload')`);
  db.run(sql`UPDATE artists SET image_url = ${stored.imageUrl}, image_pinned = 1, updated_at = datetime('now') WHERE spotify_id = ${artistId}`);

  return c.json(stored);
});

// versión — público
app.get('/api/version', (c) => c.json({ version: VERSION }));

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
    version: VERSION,
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
  const user = getUserById(userId);
  return c.json({
    authenticated: true,
    userId,
    spotifyId: c.get('spotifyId'),
    displayName: user?.displayName ?? null,
    imageUrl: user?.imageUrl ?? null,
    isAdmin: c.get('isAdmin'),
    scopes: getStoredScopes(userId),
    lastfmUsername: getLastfmAccount(userId)?.username ?? null,
  });
});

// OG meta para crawlers en rutas públicas (share / perfil).
// DEBE registrarse antes de la spa para ganar el match de esas rutas;
// para navegadores el HTML inyectado sigue arrancando el SPA igual que 200.html.
app.get('/s/:token', (c) => renderOgHtml(c, { kind: 'share', token: c.req.param('token') }));
app.get('/u/:spotifyId', (c) => renderOgHtml(c, { kind: 'profile', spotifyId: c.req.param('spotifyId') }));

// spa estática del build de sveltekit con fallback a 200.html
mountSpa(app);

export default app;
