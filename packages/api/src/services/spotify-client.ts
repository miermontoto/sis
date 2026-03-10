import { SPOTIFY_API_BASE } from '../constants.js';
import { getValidAccessToken, refreshAccessToken } from './token-manager.js';

interface SpotifyRequestOptions {
  params?: Record<string, string>;
}

// cliente HTTP para spotify con auto-refresh y manejo de rate limits
export async function spotifyFetch<T>(endpoint: string, options: SpotifyRequestOptions = {}): Promise<T | null> {
  const url = new URL(`${SPOTIFY_API_BASE}${endpoint}`);
  if (options.params) {
    Object.entries(options.params).forEach(([k, v]) => url.searchParams.set(k, v));
  }

  let accessToken = await getValidAccessToken();

  let res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  // si 401, refrescar token y reintentar una vez
  if (res.status === 401) {
    console.log('[spotify] token expirado, refrescando...');
    accessToken = await refreshAccessToken();
    res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  }

  // respetar rate limit
  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get('Retry-After') || '5', 10);
    console.log(`[spotify] rate limited, esperando ${retryAfter}s`);
    await new Promise(r => setTimeout(r, retryAfter * 1000));
    return spotifyFetch(endpoint, options);
  }

  // 204 = sin contenido (nada reproduciendo)
  if (res.status === 204) return null;

  if (!res.ok) {
    console.error(`[spotify] error ${res.status}: ${await res.text()}`);
    return null;
  }

  return res.json();
}
