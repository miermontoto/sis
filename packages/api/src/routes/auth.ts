import { Hono, type Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { SPOTIFY_AUTH_URL, SPOTIFY_TOKEN_URL, SPOTIFY_API_BASE, SPOTIFY_SCOPES, LASTFM_AUTH_URL, LASTFM_ID_PREFIX, MIERID_ID_PREFIX } from '../constants.js';
import { storeTokens } from '../services/token-manager.js';
import { restartPolling } from '../services/polling.js';
import { markRateLimited } from '../services/spotify-client.js';
import { createSession, deleteSession, validateSession, type Session } from '../services/session.js';
import { createOneTimeCodeStore } from '@platform/auth';
import { findOrCreateUser, findUserBySpotifyId, getUserById, hasAnyUsers, isAllowedUser, migrateExistingData, updateUser } from '../services/user-manager.js';
import { isLastfmConfigured, getAuthSession } from '../services/lastfm-client.js';
import { findLastfmAccountByUsername, upsertLastfmAccount } from '../services/lastfm-sync.js';
import { isMieridConfigured, createPkcePair, buildAuthorizeUrl, exchangeCode, fetchIdentity, findMieridAccountBySub, upsertMieridAccount, type MieridIdentity } from '../services/mierid-client.js';
import type { SpotifyTokenResponse } from '../types/spotify.js';
import { MOBILE_SCHEME, DEFAULT_SPOTIFY_REDIRECT_URI } from '../constants.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('auth');
const auth = new Hono();

// vida de un login oauth en vuelo (spotify / last.fm / mier.info)
const LOGIN_STATE_TTL_MS = 10 * 60_000;

// solo rutas relativas del propio sitio, para evitar open redirect: "//host" y
// "/\host" también empiezan por "/" y el browser los trata como otro origen
const SAFE_RETURN_TO = /^\/(?![/\\])/;

// un login oauth en vuelo. viaja en el payload del state (server-side, de un solo
// uso, previene CSRF) y NO en cookies: el callback cae siempre en el host de
// SPOTIFY_REDIRECT_URI (sis.fm) pero el login puede empezar en el alias
// (sis.mier.info), y una cookie puesta al empezar no llega al callback (se perdían
// returnTo y el flag móvil de los apks que apuntan al alias)
interface LoginFlow {
  returnTo: string;
  // flujo móvil (apk): el callback redirige al deep link de la app en vez de a la spa
  mobile: boolean;
  // vincular la cuenta externa a la sesión actual en vez de entrar con ella. se
  // DECLARA (link=1, sólo el Connect de settings) en vez de deducirse de que haya
  // sesión en el host del callback: con sesión en sis.fm, un login empezado en el
  // alias acababa en /settings?mierid=linked (2026-09-30)
  link: boolean;
  // verifier pkce de mier.info: emitir y canjear el state recupera el verifier y
  // valida csrf en un único movimiento
  verifier?: string;
}

const loginStates = createOneTimeCodeStore<LoginFlow>({ ttlMs: LOGIN_STATE_TTL_MS });

// oauth móvil: el callback emite un código de un solo uso que viaja en el deep
// link; la app lo canjea por la cookie de sesión en POST /auth/mobile/exchange
const mobileAuthCodes = createOneTimeCodeStore<string>({ ttlMs: 60_000 });

// state del redirect de autorización, con la intención del login leída de su query
// (returnTo, mobile, link)
function issueLoginState(c: Context, verifier?: string): string {
  const returnTo = c.req.query('returnTo') || '/';
  return loginStates.issue({
    returnTo: SAFE_RETURN_TO.test(returnTo) ? returnTo : '/',
    mobile: c.req.query('mobile') === '1',
    link: c.req.query('link') === '1',
    verifier,
  });
}

// sesión sis a la que VINCULAR la cuenta externa (last.fm / mier.info), sólo si el
// login lo pidió. la sesión sale de la cookie del callback, no del inicio, para que
// un link iniciado por otro no acabe en tu cuenta. en el flujo móvil nunca: el
// custom tab comparte las cookies de chrome, así que una sesión web previa en el
// móvil convertía el login de la app en "vincular a ese usuario" y el callback
// acababa en /settings dentro del browser en vez de entregar el código a la app
// (2026-09-21)
function linkingSession(c: Context, flow: LoginFlow): Session | null {
  if (!flow.link || flow.mobile) return null;
  const sessionCookie = getCookie(c, 'sis_session');
  return sessionCookie ? validateSession(sessionCookie) : null;
}

// tramo final común de los callbacks: sesión + cookie, polling y redirect
// (deep link móvil o returnTo web)
function finishLogin(c: Context, userId: number, flow: LoginFlow): Response {
  const sessionToken = createSession(userId, c.req.header('user-agent'));
  const isSecure = (process.env.SPOTIFY_REDIRECT_URI || '').startsWith('https');
  setCookie(c, 'sis_session', sessionToken, {
    httpOnly: true,
    secure: isSecure,
    sameSite: 'Lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60,
  });

  // reiniciar polling para incluir al nuevo usuario
  restartPolling();

  // flujo móvil: entregar un código de un solo uso a la app via deep link; la
  // sesión ya existe — la app la canjea por su cookie en /auth/mobile/exchange
  if (flow.mobile) {
    const code = mobileAuthCodes.issue(sessionToken);
    log.info('login completado, entregando código a la app');
    return c.redirect(`${MOBILE_SCHEME}://auth/callback?code=${code}`);
  }

  log.info('login completado exitosamente');
  return c.redirect(flow.returnTo);
}

auth.get('/login', (c) => {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return c.json({ error: 'faltan variables de entorno SPOTIFY_CLIENT_ID o SPOTIFY_REDIRECT_URI' }, 500);
  }

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope: SPOTIFY_SCOPES,
    redirect_uri: redirectUri,
    state: issueLoginState(c),
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

  const flow = loginStates.redeem(state);
  if (!flow) {
    return c.json({ error: 'state inválido, posible CSRF' }, 403);
  }

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
    log.error(`error al intercambiar code: ${res.status} ${text}`);
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
    log.error(`spotify rate limited ${retryAfter}s`);
    return c.redirect(`/login?error=rate_limited&retryAfter=${retryAfter}`);
  }
  if (!meRes.ok) {
    const meText = await meRes.text();
    log.error(`error al obtener perfil de spotify: ${meRes.status} ${meText}`);
    return c.json({ error: 'error al verificar identidad' }, 500);
  }
  const me: { id: string; display_name: string; images?: { url: string }[] } = await meRes.json();

  // verificar si el usuario está permitido
  if (!isAllowedUser(me.id)) {
    log.warn(`usuario ${me.id} no está autorizado`);
    return c.json({ error: 'usuario no autorizado' }, 403);
  }

  // crear o recuperar usuario en la DB
  const user = findOrCreateUser(me.id, me.display_name, me.images?.[0]?.url ?? null);

  if (!user.isActive) {
    log.warn(`usuario ${me.id} está desactivado`);
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
  log.info(`sesión creada para usuario ${me.id} (id: ${user.id})`);
  return finishLogin(c, user.id, flow);
});

// --- last.fm: sso + vinculación de cuenta ---

// url del callback: derivada del redirect de spotify (mismo host), overridable
function lastfmCallbackUrl(): string {
  if (process.env.LASTFM_REDIRECT_URI) return process.env.LASTFM_REDIRECT_URI;
  const spotifyCb = process.env.SPOTIFY_REDIRECT_URI || DEFAULT_SPOTIFY_REDIRECT_URI;
  return new URL('/auth/lastfm/callback', spotifyCb).toString();
}

// público (fuera del gate /api/*): el login decide si mostrar el botón
auth.get('/lastfm/enabled', (c) => c.json({ enabled: isLastfmConfigured() }));

auth.get('/lastfm/login', (c) => {
  if (!isLastfmConfigured()) {
    return c.json({ error: 'faltan variables de entorno LASTFM_API_KEY o LASTFM_API_SECRET' }, 503);
  }

  // last.fm no soporta state propio: viaja como query param del callback
  const cb = new URL(lastfmCallbackUrl());
  cb.searchParams.set('state', issueLoginState(c));

  const params = new URLSearchParams({
    api_key: process.env.LASTFM_API_KEY!,
    cb: cb.toString(),
  });
  return c.redirect(`${LASTFM_AUTH_URL}?${params.toString()}`);
});

auth.get('/lastfm/callback', async (c) => {
  const token = c.req.query('token');
  const state = c.req.query('state');

  if (!token) return c.json({ error: 'falta parámetro token de last.fm' }, 400);
  const flow = state ? loginStates.redeem(state) : null;
  if (!flow) {
    return c.json({ error: 'state inválido, posible CSRF' }, 403);
  }

  let lfm: { name: string; key: string };
  try {
    lfm = await getAuthSession(token);
  } catch (err) {
    log.error('error en auth.getSession de last.fm:', err);
    return c.json({ error: 'error al verificar identidad con last.fm' }, 500);
  }

  // modo vinculación: pedido desde settings y con sesión sis activa, conectar la
  // cuenta al usuario actual. sin sesión, un login normal
  const current = linkingSession(c, flow);
  if (current) {
    const owner = findLastfmAccountByUsername(lfm.name);
    if (owner && owner.userId !== current.userId) {
      log.warn(`last.fm ${lfm.name} ya vinculado al usuario ${owner.userId}`);
      return c.redirect('/settings?lastfm=already_linked');
    }
    upsertLastfmAccount(current.userId, lfm.name, lfm.key);
    restartPolling();
    return c.redirect('/settings?lastfm=linked');
  }

  // modo login: cuenta ya vinculada, placeholder pre-creado por un admin
  // (spotify_id sintético lastfm:<username>) o bootstrap del primer usuario
  const linked = findLastfmAccountByUsername(lfm.name);
  let user = linked ? getUserById(linked.userId) : findUserBySpotifyId(LASTFM_ID_PREFIX + lfm.name);
  if (!user && !hasAnyUsers()) {
    user = findOrCreateUser(LASTFM_ID_PREFIX + lfm.name, lfm.name, null);
  }

  if (!user) {
    log.warn(`usuario last.fm ${lfm.name} no está autorizado`);
    return c.json({ error: 'usuario no autorizado' }, 403);
  }
  if (!user.isActive) {
    log.warn(`usuario last.fm ${lfm.name} está desactivado`);
    return c.json({ error: 'usuario desactivado' }, 403);
  }

  // placeholders pre-creados no tienen displayName hasta el primer login
  if (!user.displayName) updateUser(user.id, { displayName: lfm.name });
  upsertLastfmAccount(user.id, lfm.name, lfm.key);

  log.info(`sesión creada para usuario last.fm ${lfm.name} (id: ${user.id})`);
  return finishLogin(c, user.id, flow);
});

// --- id.mier.info: sso propio + vinculación de cuenta ---

// url del callback: derivada del redirect de spotify (mismo host), overridable
function mieridCallbackUrl(): string {
  if (process.env.MIERID_REDIRECT_URI) return process.env.MIERID_REDIRECT_URI;
  const spotifyCb = process.env.SPOTIFY_REDIRECT_URI || DEFAULT_SPOTIFY_REDIRECT_URI;
  return new URL('/auth/mierid/callback', spotifyCb).toString();
}

// público (fuera del gate /api/*): el login decide si mostrar el botón
auth.get('/mierid/enabled', (c) => c.json({ enabled: isMieridConfigured() }));

auth.get('/mierid/login', (c) => {
  if (!isMieridConfigured()) {
    return c.json({ error: 'faltan variables de entorno MIERID_CLIENT_ID o MIERID_CLIENT_SECRET' }, 503);
  }

  const { verifier, challenge } = createPkcePair();
  return c.redirect(buildAuthorizeUrl(mieridCallbackUrl(), issueLoginState(c, verifier), challenge));
});

auth.get('/mierid/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  const error = c.req.query('error');

  if (error) {
    return c.json({ error: `id.mier.info rechazó la autorización: ${error}` }, 400);
  }
  if (!code || !state) {
    return c.json({ error: 'faltan parámetros code o state' }, 400);
  }

  // un state sin verifier es de otro proveedor: tampoco vale aquí
  const flow = loginStates.redeem(state);
  if (!flow?.verifier) {
    return c.json({ error: 'state inválido, posible CSRF' }, 403);
  }

  let identity: MieridIdentity;
  try {
    identity = await fetchIdentity(await exchangeCode(code, flow.verifier, mieridCallbackUrl()));
  } catch (err) {
    log.error('error al verificar identidad con id.mier.info:', err);
    return c.json({ error: 'error al verificar identidad con id.mier.info' }, 500);
  }

  // handle legible para placeholders y logs; el vínculo real siempre es el sub
  const handle = identity.username ?? identity.sub;

  // modo vinculación: pedido desde settings y con sesión sis activa, conectar la
  // cuenta al usuario actual. sin sesión, un login normal
  const current = linkingSession(c, flow);
  if (current) {
    const owner = findMieridAccountBySub(identity.sub);
    if (owner && owner.userId !== current.userId) {
      log.warn(`cuenta mier.info ${handle} ya vinculada al usuario ${owner.userId}`);
      return c.redirect('/settings?mierid=already_linked');
    }
    upsertMieridAccount(current.userId, identity.sub, identity.username);
    return c.redirect('/settings?mierid=linked');
  }

  // modo login: cuenta ya vinculada, placeholder pre-creado por un admin
  // (spotify_id sintético mierid:<username>) o bootstrap del primer usuario
  const linked = findMieridAccountBySub(identity.sub);
  let user = linked ? getUserById(linked.userId) : findUserBySpotifyId(MIERID_ID_PREFIX + handle);
  if (!user && !hasAnyUsers()) {
    user = findOrCreateUser(MIERID_ID_PREFIX + handle, identity.name ?? handle, identity.picture);
  }

  if (!user) {
    log.warn(`usuario mier.info ${handle} no está autorizado`);
    return c.json({ error: 'usuario no autorizado' }, 403);
  }
  if (!user.isActive) {
    log.warn(`usuario mier.info ${handle} está desactivado`);
    return c.json({ error: 'usuario desactivado' }, 403);
  }

  // placeholders pre-creados no tienen displayName hasta el primer login
  if (!user.displayName) updateUser(user.id, { displayName: identity.name ?? handle });
  upsertMieridAccount(user.id, identity.sub, identity.username);

  log.info(`sesión creada para usuario mier.info ${handle} (id: ${user.id})`);
  return finishLogin(c, user.id, flow);
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
