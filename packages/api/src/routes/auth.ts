import { Hono } from 'hono';
import { SPOTIFY_AUTH_URL, SPOTIFY_TOKEN_URL, SPOTIFY_SCOPES } from '../constants.js';
import { storeTokens } from '../services/token-manager.js';
import { restartPolling } from '../services/polling.js';
import type { SpotifyTokenResponse } from '../types/spotify.js';
import crypto from 'crypto';

const auth = new Hono();

// almacenar state para prevenir CSRF
const pendingStates = new Set<string>();

auth.get('/login', (c) => {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return c.json({ error: 'faltan variables de entorno SPOTIFY_CLIENT_ID o SPOTIFY_REDIRECT_URI' }, 500);
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

  storeTokens({
    accessToken: data.access_token,
    refreshToken: data.refresh_token!,
    expiresIn: data.expires_in,
    scope: data.scope,
  });

  // iniciar polling ahora que tenemos tokens
  restartPolling();

  console.log('[auth] OAuth completado exitosamente');
  return c.redirect('/');
});

export default auth;
