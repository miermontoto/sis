import { SPOTIFY_API_BASE } from '../constants.js';
import { getValidAccessToken, refreshAccessToken } from './token-manager.js';

interface SpotifyRequestOptions {
  params?: Record<string, string>;
  method?: 'GET' | 'PUT' | 'POST' | 'DELETE';
  body?: unknown;
}

// cliente HTTP para spotify con auto-refresh y manejo de rate limits
export async function spotifyFetch<T>(endpoint: string, options: SpotifyRequestOptions = {}): Promise<T | null> {
  const url = new URL(`${SPOTIFY_API_BASE}${endpoint}`);
  if (options.params) {
    Object.entries(options.params).forEach(([k, v]) => url.searchParams.set(k, v));
  }

  const method = options.method ?? 'GET';
  let accessToken = await getValidAccessToken();

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
    console.log('[spotify] token expirado, refrescando...');
    accessToken = await refreshAccessToken();
    res = await fetch(url.toString(), buildInit(accessToken));
  }

  // respetar rate limit (máximo 30s de espera, si no devolver null)
  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get('Retry-After') || '5', 10);
    if (retryAfter > 30) {
      console.log(`[spotify] rate limited ${retryAfter}s, saltando`);
      return null;
    }
    console.log(`[spotify] rate limited, esperando ${retryAfter}s`);
    await new Promise(r => setTimeout(r, retryAfter * 1000));
    return spotifyFetch(endpoint, options);
  }

  // 204 = sin contenido (éxito sin body, o nada reproduciendo)
  if (res.status === 204) return null;

  if (!res.ok) {
    console.error(`[spotify] error ${res.status}: ${await res.text()}`);
    return null;
  }

  // algunos endpoints devuelven body vacío con 200
  const text = await res.text();
  if (!text) return null;
  return JSON.parse(text);
}
