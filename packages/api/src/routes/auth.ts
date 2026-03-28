import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { SPOTIFY_AUTH_URL, SPOTIFY_TOKEN_URL, SPOTIFY_API_BASE, SPOTIFY_SCOPES } from '../constants.js';
import { storeTokens } from '../services/token-manager.js';
import { restartPolling } from '../services/polling.js';
import { createSession, deleteSession } from '../services/session.js';
import type { SpotifyTokenResponse } from '../types/spotify.js';
import crypto from 'crypto';

function getAllowedUsers(): string[] | null {
  const raw = process.env.ALLOWED_SPOTIFY_USERS;
  if (!raw || raw.trim() === '') return null;
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

const auth = new Hono();

// almacenar state para prevenir CSRF
const pendingStates = new Set<string>();

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

  // verificar usuario contra allowlist
  const allowed = getAllowedUsers();
  if (allowed) {
    const meRes = await fetch(`${SPOTIFY_API_BASE}/me`, {
      headers: { Authorization: `Bearer ${data.access_token}` },
    });
    if (!meRes.ok) {
      console.error('[auth] error al obtener perfil de spotify');
      return c.json({ error: 'error al verificar identidad' }, 500);
    }
    const me: { id: string } = await meRes.json();
    if (!allowed.includes(me.id)) {
      console.warn(`[auth] usuario ${me.id} no está en la lista de permitidos`);
      return c.json({ error: 'usuario no autorizado' }, 403);
    }

    // crear sesión y setear cookie
    const sessionToken = createSession(me.id);
    const isSecure = (process.env.SPOTIFY_REDIRECT_URI || '').startsWith('https');
    setCookie(c, 'sis_session', sessionToken, {
      httpOnly: true,
      secure: isSecure,
      sameSite: 'Lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60,
    });
    console.log(`[auth] sesión creada para usuario ${me.id}`);
  }

  storeTokens({
    accessToken: data.access_token,
    refreshToken: data.refresh_token!,
    expiresIn: data.expires_in,
    scope: data.scope,
  });

  // iniciar polling ahora que tenemos tokens
  restartPolling();

  // recuperar returnTo y limpiar cookie
  const returnTo = getCookie(c, 'sis_return_to') || '/';
  deleteCookie(c, 'sis_return_to', { path: '/' });

  // solo permitir rutas relativas para evitar open redirect
  const safePath = returnTo.startsWith('/') ? returnTo : '/';

  console.log('[auth] OAuth completado exitosamente');
  return c.redirect(safePath);
});

auth.get('/logout', (c) => {
  const token = getCookie(c, 'sis_session');
  if (token) deleteSession(token);
  deleteCookie(c, 'sis_session', { path: '/' });
  return c.redirect('/login');
});

export default auth;
