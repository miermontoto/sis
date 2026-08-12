import { SPOTIFY_API_BASE } from '../constants.js';
import { getValidAccessToken, refreshAccessToken } from './token-manager.js';
import { createLogger } from './logger.js';

const log = createLogger('spotify');
interface SpotifyRequestOptions {
  userId: number;
  params?: Record<string, string>;
  method?: 'GET' | 'PUT' | 'POST' | 'DELETE';
  body?: unknown;
}

// Rate-limit global en memoria. Spotify aplica el throttle por app-client, así que
// basta una variable de proceso: si el API devuelve un 429 con Retry-After largo,
// evitamos más llamadas hasta que expire el castigo (en vez de seguir pegándole y
// potencialmente extendiéndolo).
let rateLimitedUntilMs = 0;
let lastRateLimitLogMs = 0;

export function isRateLimited(): boolean {
  return Date.now() < rateLimitedUntilMs;
}

export function rateLimitedRemainingMs(): number {
  return Math.max(0, rateLimitedUntilMs - Date.now());
}

export function markRateLimited(retryAfterSeconds: number) {
  rateLimitedUntilMs = Math.max(rateLimitedUntilMs, Date.now() + retryAfterSeconds * 1000);
}

function logRateLimitSkipOccasionally(endpoint: string) {
  const now = Date.now();
  if (now - lastRateLimitLogMs < 60_000) return;
  lastRateLimitLogMs = now;
  const remainingS = Math.ceil(rateLimitedRemainingMs() / 1000);
  log.info(`rate limited ${remainingS}s, saltando (ej. ${endpoint})`);
}

// versión raw que devuelve el Response para inspección de status/body
export async function spotifyFetchRaw(endpoint: string, options: SpotifyRequestOptions): Promise<Response | null> {
  if (isRateLimited()) {
    logRateLimitSkipOccasionally(endpoint);
    return null;
  }

  const { userId } = options;
  const url = new URL(`${SPOTIFY_API_BASE}${endpoint}`);
  if (options.params) {
    Object.entries(options.params).forEach(([k, v]) => url.searchParams.set(k, v));
  }

  const method = options.method ?? 'GET';
  let accessToken = await getValidAccessToken(userId);

  const buildInit = (token: string): RequestInit => ({
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });

  let res = await fetch(url.toString(), buildInit(accessToken));

  if (res.status === 401) {
    accessToken = await refreshAccessToken(userId);
    res = await fetch(url.toString(), buildInit(accessToken));
  }

  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get('Retry-After') || '5', 10);
    if (retryAfter > 30) {
      markRateLimited(retryAfter);
      return null;
    }
    await new Promise(r => setTimeout(r, retryAfter * 1000));
    return spotifyFetchRaw(endpoint, options);
  }

  return res;
}

// cliente HTTP para spotify con auto-refresh y manejo de rate limits
export async function spotifyFetch<T>(endpoint: string, options: SpotifyRequestOptions): Promise<T | null> {
  // si estamos en castigo global, saltar llamadas de fondo para no extenderlo
  if (isRateLimited()) {
    logRateLimitSkipOccasionally(endpoint);
    return null;
  }

  const { userId } = options;
  const url = new URL(`${SPOTIFY_API_BASE}${endpoint}`);
  if (options.params) {
    Object.entries(options.params).forEach(([k, v]) => url.searchParams.set(k, v));
  }

  const method = options.method ?? 'GET';
  let accessToken = await getValidAccessToken(userId);

  const buildInit = (token: string): RequestInit => ({
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });

  let res = await fetch(url.toString(), buildInit(accessToken));

  // si 401, refrescar token y reintentar una vez
  if (res.status === 401) {
    log.info(`token expirado para usuario ${userId}, refrescando...`);
    accessToken = await refreshAccessToken(userId);
    res = await fetch(url.toString(), buildInit(accessToken));
  }

  // respetar rate limit (máximo 30s de espera, si no marcar lockout global)
  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get('Retry-After') || '5', 10);
    if (retryAfter > 30) {
      markRateLimited(retryAfter);
      log.info(`rate limited ${retryAfter}s, marcando lockout global`);
      return null;
    }
    log.info(`rate limited, esperando ${retryAfter}s`);
    await new Promise(r => setTimeout(r, retryAfter * 1000));
    return spotifyFetch(endpoint, options);
  }

  // 204 = sin contenido (éxito sin body, o nada reproduciendo)
  if (res.status === 204) return null;

  if (!res.ok) {
    log.error(`error ${res.status}: ${await res.text()}`);
    return null;
  }

  // algunos endpoints devuelven body vacío con 200
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    log.error(`respuesta no-JSON de ${endpoint}: ${text.slice(0, 80)}`);
    return null;
  }
}
