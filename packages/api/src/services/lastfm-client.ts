// cliente http para la api de last.fm (ws.audioscrobbler.com). las llamadas
// de auth van firmadas con api_sig = md5(params ordenados + secret). si faltan
// credenciales (LASTFM_API_KEY/SECRET) el cliente informa como no configurado
// y los flujos que dependen de él hacen no-op — mismo patrón que push.
import { createHash } from 'crypto';
import { LASTFM_API_BASE, LASTFM_PAGE_LIMIT, LASTFM_REQUEST_SPACING_MS } from '../constants.js';

export function isLastfmConfigured(): boolean {
  return !!(process.env.LASTFM_API_KEY && process.env.LASTFM_API_SECRET);
}

// espaciado mínimo entre requests: last.fm pide no superar ~5 req/s por cliente
let lastRequestAt = 0;
async function throttle(): Promise<void> {
  const wait = lastRequestAt + LASTFM_REQUEST_SPACING_MS - Date.now();
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastRequestAt = Date.now();
}

// firma: md5 de los pares clave+valor ordenados alfabéticamente + secret.
// format y callback quedan fuera de la firma según la spec de last.fm
function sign(params: Record<string, string>): string {
  const base = Object.keys(params)
    .filter(k => k !== 'format' && k !== 'callback')
    .sort()
    .map(k => `${k}${params[k]}`)
    .join('') + process.env.LASTFM_API_SECRET;
  return createHash('md5').update(base, 'utf8').digest('hex');
}

async function lastfmRequest<T>(method: string, params: Record<string, string> = {}, opts: { signed?: boolean } = {}): Promise<T> {
  if (!isLastfmConfigured()) throw new Error('last.fm no configurado (LASTFM_API_KEY/LASTFM_API_SECRET)');
  await throttle();

  const all: Record<string, string> = { method, api_key: process.env.LASTFM_API_KEY!, ...params };
  if (opts.signed) all.api_sig = sign(all);
  all.format = 'json';

  const url = new URL(LASTFM_API_BASE);
  Object.entries(all).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url.toString());
  // last.fm devuelve los errores como json { error, message } con varios status
  const data = await res.json().catch(() => null) as (T & { error?: number; message?: string }) | null;
  if (!data) throw new Error(`last.fm ${method}: respuesta no-JSON (http ${res.status})`);
  if (data.error) throw new Error(`last.fm ${method} error ${data.error}: ${data.message}`);
  if (!res.ok) throw new Error(`last.fm ${method}: http ${res.status}`);
  return data;
}

export interface LastfmSession {
  name: string;
  key: string;
}

// canjea el token del callback de autorización web por una sesión (username + key)
export async function getAuthSession(token: string): Promise<LastfmSession> {
  const data = await lastfmRequest<{ session: LastfmSession }>('auth.getSession', { token }, { signed: true });
  return data.session;
}

// track del feed recenttracks — mismo shape que acepta history-import
export interface LastfmRecentTrack {
  name: string;
  artist: { '#text': string; mbid?: string };
  album: { '#text': string; mbid?: string };
  date?: { uts: string };
  '@attr'?: { nowplaying: string };
}

export interface RecentTracksPage {
  tracks: LastfmRecentTrack[];
  page: number;
  totalPages: number;
  total: number;
}

export async function getRecentTracks(username: string, opts: { from?: number; to?: number; page?: number; limit?: number } = {}): Promise<RecentTracksPage> {
  const params: Record<string, string> = {
    user: username,
    limit: String(opts.limit ?? LASTFM_PAGE_LIMIT),
  };
  if (opts.from) params.from = String(opts.from);
  if (opts.to) params.to = String(opts.to);
  if (opts.page) params.page = String(opts.page);

  const data = await lastfmRequest<{
    recenttracks?: {
      track?: LastfmRecentTrack | LastfmRecentTrack[];
      '@attr'?: { page: string; totalPages: string; total: string };
    };
  }>('user.getRecentTracks', params);

  // con un solo resultado last.fm devuelve el objeto suelto en vez de array
  const raw = data.recenttracks?.track ?? [];
  const attr = data.recenttracks?.['@attr'];
  return {
    tracks: Array.isArray(raw) ? raw : [raw],
    page: parseInt(attr?.page ?? '1', 10),
    totalPages: parseInt(attr?.totalPages ?? '1', 10),
    total: parseInt(attr?.total ?? '0', 10),
  };
}
