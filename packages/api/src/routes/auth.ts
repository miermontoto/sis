import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { SPOTIFY_AUTH_URL, SPOTIFY_TOKEN_URL, SPOTIFY_API_BASE, SPOTIFY_SCOPES } from '../constants.js';
import { storeTokens } from '../services/token-manager.js';
import { restartPolling } from '../services/polling.js';
import { markRateLimited } from '../services/spotify-client.js';
import { createSession, deleteSession } from '../services/session.js';
import { createOneTimeCodeStore } from '@platform/auth';
import { findOrCreateUser, isAllowedUser, migrateExistingData } from '../services/user-manager.js';
import type { SpotifyTokenResponse } from '../types/spotify.js';
import crypto from 'crypto';
import { MOBILE_SCHEME } from '../constants.js';

const auth = new Hono();

// almacenar state para prevenir CSRF
const pendingStates = new Set<string>();

// oauth móvil: el callback emite un código de un solo uso que viaja en el deep
// link; la app lo canjea por la cookie de sesión en POST /auth/mobile/exchange
const mobileAuthCodes = createOneTimeCodeStore<string>({ ttlMs: 60_000 });

auth.get('/login', (c) => {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return c.json({ error: 'faltan variables de entorno SPOTIFY_CLIENT_ID o SPOTIFY_REDIRECT_URI' }, 500);
  }

  // guardar returnTo en cookie para recuperar después del callback
  const returnTo = c.req.query('returnTo') || '/';
  setCookie(c, 'sis_return_to', returnTo, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: 10 * 60, // 10 min, mismo que el state
  });

  // flag de flujo móvil (apk): el callback redirige al deep link de la app en
  // vez de a la spa. cookie del browser del sistema, misma vida que el state.
  if (c.req.query('mobile') === '1') {
    setCookie(c, 'sis_mobile', '1', {
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: 10 * 60,
    });
  }

  const state = crypto.randomBytes(16).toString('hex');
  pendingStates.add(state);

  // limpiar states viejos después de 10 min
  setTimeout(() => pendingStates.delete(state), 10 * 60_000);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope: SPOTIFY_SCOPES,
    redirect_uri: redirectUri,
    state,
  });

  return c.redirect(`${SPOTIFY_AUTH_URL}?${params.toString()}`);
});

auth.get('/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  const error = c.req.query('error');

  if (error) {
    return c.json({ error: `spotify rechazó la autorización: ${error}` }, 400);
  }

  if (!code || !state) {
    return c.json({ error: 'faltan parámetros code o state' }, 400);
  }

  if (!pendingStates.has(state)) {
    return c.json({ error: 'state inválido, posible CSRF' }, 403);
  }
  pendingStates.delete(state);

  const clientId = process.env.SPOTIFY_CLIENT_ID!;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET!;
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI!;

  const res = await fetch(SPOTIFY_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`[auth] error al intercambiar code: ${res.status} ${text}`);
    return c.json({ error: 'error al obtener tokens de spotify' }, 500);
  }

  const data: SpotifyTokenResponse = await res.json();

  // obtener perfil del usuario
  const meRes = await fetch(`${SPOTIFY_API_BASE}/me`, {
    headers: { Authorization: `Bearer ${data.access_token}` },
  });
  if (meRes.status === 429) {
    const retryAfter = parseInt(meRes.headers.get('Retry-After') || '60', 10);
    markRateLimited(retryAfter);
    console.error(`[auth] spotify rate limited ${retryAfter}s`);
    return c.redirect(`/login?error=rate_limited&retryAfter=${retryAfter}`);
  }
  if (!meRes.ok) {
    const meText = await meRes.text();
    console.error(`[auth] error al obtener perfil de spotify: ${meRes.status} ${meText}`);
    return c.json({ error: 'error al verificar identidad' }, 500);
  }
  const me: { id: string; display_name: string; images?: { url: string }[] } = await meRes.json();

  // verificar si el usuario está permitido
  if (!isAllowedUser(me.id)) {
    console.warn(`[auth] usuario ${me.id} no está autorizado`);
    return c.json({ error: 'usuario no autorizado' }, 403);
  }

  // crear o recuperar usuario en la DB
  const user = findOrCreateUser(me.id, me.display_name, me.images?.[0]?.url ?? null);

  if (!user.isActive) {
    console.warn(`[auth] usuario ${me.id} está desactivado`);
    return c.json({ error: 'usuario desactivado' }, 403);
  }

  // almacenar tokens para este usuario
  storeTokens(user.id, {
    accessToken: data.access_token,
    refreshToken: data.refresh_token!,
    expiresIn: data.expires_in,
    scope: data.scope,
  });

  // migrar datos existentes huérfanos al primer usuario
  migrateExistingData(user.id);

  // crear sesión (spotifyId/isAdmin se resuelven desde users al validar)
  const sessionToken = createSession(user.id, c.req.header('user-agent'));
  const isSecure = (process.env.SPOTIFY_REDIRECT_URI || '').startsWith('https');
  setCookie(c, 'sis_session', sessionToken, {
    httpOnly: true,
    secure: isSecure,
    sameSite: 'Lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60,
  });
  console.log(`[auth] sesi��n creada para usuario ${me.id} (id: ${user.id})`);

  // reiniciar polling para incluir al nuevo usuario
  restartPolling();

  // recuperar returnTo y limpiar cookie
  const returnTo = getCookie(c, 'sis_return_to') || '/';
  deleteCookie(c, 'sis_return_to', { path: '/' });

  // flujo móvil: entregar un código de un solo uso a la app via deep link; la
  // sesión ya existe — la app la canjea por su cookie en /auth/mobile/exchange
  if (getCookie(c, 'sis_mobile') === '1') {
    deleteCookie(c, 'sis_mobile', { path: '/' });
    const code = mobileAuthCodes.issue(sessionToken);
    console.log('[auth] OAuth móvil completado, entregando código a la app');
    return c.redirect(`${MOBILE_SCHEME}://auth/callback?code=${code}`);
  }

  // solo permitir rutas relativas para evitar open redirect
  const safePath = returnTo.startsWith('/') ? returnTo : '/';

  console.log('[auth] OAuth completado exitosamente');
  return c.redirect(safePath);
});

// canje del código del deep link por la cookie de sesión (apk). la llamada
// llega por CapacitorHttp (capa nativa): la cookie queda en el jar nativo.
auth.post('/mobile/exchange', async (c) => {
  const body = await c.req.json<{ code?: string }>().catch(() => null);
  if (!body?.code) return c.json({ error: 'code requerido' }, 400);
  const sessionToken = mobileAuthCodes.redeem(body.code);
  if (!sessionToken) return c.json({ error: 'código inválido o caducado' }, 400);
  const isSecure = (process.env.SPOTIFY_REDIRECT_URI || '').startsWith('https');
  setCookie(c, 'sis_session', sessionToken, {
    httpOnly: true,
    secure: isSecure,
    sameSite: 'Lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60,
  });
  return c.json({ ok: true });
});

auth.get('/logout', (c) => {
  const token = getCookie(c, 'sis_session');
  if (token) deleteSession(token);
  deleteCookie(c, 'sis_session', { path: '/' });
  return c.redirect('/login');
});

export default auth;
