import type { DateRangeParams } from '@sis/shared';

// cache layer: L1 (memoria, ms) + L2 (IndexedDB, persistente) con SWR.
// se enchufa vía lookup()/fetchAndStore(); ttls por endpoint en cache/config.ts.
import * as cache from '../cache/cache';
import { isNoCache } from '../cache/config';

// VITE_API_BASE: vacía en web (same-origin); dominio público en builds móviles
const API_ORIGIN = import.meta.env.VITE_API_BASE ?? '';
const BASE = `${API_ORIGIN}/api`;

const responseCache = new Map<string, cache.L1Entry>();
const inflightRequests = new Map<string, Promise<unknown>>();
const cacheDeps: cache.CacheDeps = { l1: responseCache, inflight: inflightRequests };

// construye una cache key canónica (path + query ordenado).
// independiente del origin para que sobreviva entre dominios.
function buildKey(path: string, params?: Record<string, string>): string {
  if (!params) return path;
  const keys = Object.keys(params).sort();
  const qs = keys.map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`).join('&');
  return qs ? `${path}?${qs}` : path;
}

function buildUrl(path: string, params?: Record<string, string>): string {
  const url = new URL(`${BASE}${path}`, window.location.origin);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return url.toString();
}

// las portadas locales (álbumes sin spotify, subidas o sacadas de musicbrainz)
// se sirven como rutas relativas `/api/covers/...`. En web resuelven same-origin,
// pero en el apk el webview corre en https://localhost y resolverían contra ese
// origen → 404 → se ve el alt en vez de la imagen. Reescribimos esas rutas al
// dominio público (API_ORIGIN). En web API_ORIGIN es '' → no-op.
const COVERS_PREFIX = '/api/covers/';
function resolveAssets<T>(data: T): T {
  if (API_ORIGIN) walkAssets(data);
  return data;
}

// muta en sitio el JSON ya parseado (lo poseemos): prefija las rutas de portada.
function walkAssets(value: unknown): void {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const v = value[i];
      if (typeof v === 'string') {
        if (v.startsWith(COVERS_PREFIX)) value[i] = API_ORIGIN + v;
      } else walkAssets(v);
    }
  } else if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const k in obj) {
      const v = obj[k];
      if (typeof v === 'string') {
        if (v.startsWith(COVERS_PREFIX)) obj[k] = API_ORIGIN + v;
      } else walkAssets(v);
    }
  }
}

// fetch crudo (sin cache). Maneja 401 → redirect a login.
async function rawFetch<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, signal ? { signal } : undefined);
  if (res.status === 401) {
    window.location.href = '/login?returnTo=' + encodeURIComponent(window.location.pathname + window.location.search);
    throw new Error('No autorizado');
  }
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return resolveAssets(await res.json());
}

// wrapper genérico para llamadas GET. SWR por defecto.
//
// con signal (AbortController): se omite el cache read (el caller quiere data
// fresca y poder abortarla), pero la respuesta exitosa SÍ pobla el cache para
// que navegaciones posteriores sin signal hagan hit.
export async function apiFetch<T>(path: string, params?: Record<string, string>, signal?: AbortSignal): Promise<T> {
  const url = buildUrl(path, params);

  if (isNoCache(path)) {
    return rawFetch<T>(url, signal);
  }

  const cacheKey = buildKey(path, params);
  const fetcher = () => rawFetch<unknown>(url, signal);

  if (signal) {
    // bypass del cache read + dedup (la dedup compartiría signal entre callers).
    const data = await rawFetch<T>(url, signal);
    cache.writeCache(cacheKey, data, cacheDeps);
    return data;
  }

  // 1) intenta servir desde cache (L1 → L2, con SWR).
  const hit = await cache.lookup<T>(path, cacheKey, fetcher, cacheDeps);
  if (hit) return hit.data;

  // 2) miss: fetch bloqueante con dedup + escritura en ambas capas.
  return cache.fetchAndStore<T>(path, cacheKey, fetcher, cacheDeps);
}

// error tipado para rutas públicas: distingue 404 (no existe) de 410 (revocado)
export class PublicShareError extends Error {
  status: number;
  constructor(status: number) {
    super(`share link error: ${status}`);
    this.status = status;
  }
}

// fetch para rutas públicas (/public/*, sin sesión): nunca redirige a /login
// y no toca el cache namespaced por usuario. El HTTP cache del navegador basta.
export async function publicFetch<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${API_ORIGIN}/public${path}`, window.location.origin);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString());
  if (res.status === 404 || res.status === 410) throw new PublicShareError(res.status);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return resolveAssets(await res.json());
}

// crea un AbortController vinculado a un entity ID; aborta el anterior al cambiar
export function createFetchController() {
  let controller: AbortController | null = null;
  return {
    get signal() {
      return controller?.signal;
    },
    reset() {
      controller?.abort();
      controller = new AbortController();
      return controller.signal;
    },
    abort() {
      controller?.abort();
      controller = null;
    },
  };
}

// invalidar cache (tras mutaciones o cuando se necesite data fresca).
// limpia L1 + L2 por prefijo de path; sin prefijo → limpia todo L1 y dispara
// purga de L2 a un prefijo amplio.
export function invalidateCache(pathPrefix?: string): void {
  if (!pathPrefix) {
    cache.clearL1(cacheDeps);
    cache.invalidateByPath('/', cacheDeps);
    return;
  }
  cache.invalidateByPath(pathPrefix, cacheDeps);
}

// mapeo de mutaciones → prefijos a invalidar. Match por método+prefijo de path.
// orden importa: el primer match aplica. La lista es deliberadamente concisa;
// `/` (último fallback para POST/PUT/DELETE desconocidos) limpia todo.
const MUTATION_INVALIDATIONS: Array<{ method: string; prefix: string; clear: string[] }> = [
  { method: 'POST',   prefix: '/import',                    clear: ['/stats/', '/now-playing/friends'] },
  { method: 'POST',   prefix: '/stats/history',             clear: ['/stats/', '/now-playing/friends'] },
  { method: 'DELETE', prefix: '/stats/history',             clear: ['/stats/'] },
  // '/admin/merge' cubre las vistas de merges (lista, sugerencias y previews): sin ella
  // seguían sirviéndose del cache tras aplicar y el rescan parecía no hacer nada. Se
  // invalidan en vez de marcarlas no-cacheables: son consultas de 70-260 ms y quitarles
  // el cache dejaba el modal esperando a la red en cada apertura.
  { method: 'POST',   prefix: '/admin/merge-album',         clear: ['/stats/', '/playlists/', '/admin/merge', '/admin/album-', '/admin/bulk-'] },
  { method: 'POST',   prefix: '/admin/batch-merge-tracks',  clear: ['/stats/', '/playlists/', '/admin/merge', '/admin/album-', '/admin/bulk-'] },
  { method: 'POST',   prefix: '/admin/merge',               clear: ['/stats/', '/playlists/', '/admin/merge', '/admin/album-', '/admin/bulk-'] },
  { method: 'DELETE', prefix: '/admin/merge/',              clear: ['/stats/', '/playlists/', '/admin/merge', '/admin/album-', '/admin/bulk-'] },
  // las relaciones soft no cambian ninguna agregación: basta con refrescar el detalle
  // de artista (donde se pintan) y la lista de relaciones de settings
  { method: 'POST',   prefix: '/admin/artist-relation',     clear: ['/stats/artist/', '/admin/artist-relations'] },
  { method: 'DELETE', prefix: '/admin/artist-relation/',    clear: ['/stats/artist/', '/admin/artist-relations'] },
  { method: 'PATCH',  prefix: '/admin/track/',              clear: ['/stats/'] },
  { method: 'POST',   prefix: '/admin/track/',              clear: ['/stats/'] },
  { method: 'POST',   prefix: '/admin/users',               clear: ['/admin/users'] },
  { method: 'PUT',    prefix: '/admin/users/',              clear: ['/admin/users'] },
  { method: 'DELETE', prefix: '/admin/users/',              clear: ['/admin/users'] },
  { method: 'PUT',    prefix: '/covers/album/',             clear: ['/stats/album/', '/stats/top-albums', '/covers/'] },
  { method: 'POST',   prefix: '/covers/',                   clear: ['/stats/album/', '/stats/top-albums', '/covers/'] },
  { method: 'PUT',    prefix: '/now-playing/like/',         clear: ['/now-playing/like/'] },
  { method: 'DELETE', prefix: '/now-playing/like/',         clear: ['/now-playing/like/'] },
  { method: 'POST',   prefix: '/now-playing/queue',         clear: [] },
  { method: 'PUT',    prefix: '/now-playing/',              clear: [] },
  { method: 'POST',   prefix: '/now-playing/',              clear: [] },
  { method: 'POST',   prefix: '/playlists/library/sync',    clear: ['/playlists/library'] },
  { method: 'POST',   prefix: '/playlists/library/',        clear: ['/playlists/library', '/now-playing/playlists/'] },
  { method: 'DELETE', prefix: '/playlists/library/',        clear: ['/playlists/library', '/now-playing/playlists/'] },
  { method: 'POST',   prefix: '/playlists/generate',        clear: ['/playlists'] },
  { method: 'POST',   prefix: '/playlists/',                clear: ['/playlists'] },
  { method: 'DELETE', prefix: '/playlists/',                clear: ['/playlists'] },
  { method: 'POST',   prefix: '/social/follows/',           clear: ['/social/'] },
  { method: 'DELETE', prefix: '/social/follows/',           clear: ['/social/'] },
  { method: 'POST',   prefix: '/social/share-links',        clear: ['/social/share-links'] },
  { method: 'DELETE', prefix: '/social/share-links/',       clear: ['/social/share-links'] },
  { method: 'POST',   prefix: '/lastfm',                    clear: ['/me'] },
  { method: 'DELETE', prefix: '/lastfm',                    clear: ['/me'] },
  // /mierid es no-cache y no afecta a /me: nada que invalidar (sin esta regla
  // el fallback conservador limpiaría todo el cache al desvincular)
  { method: 'DELETE', prefix: '/mierid',                    clear: [] },
  // /listen-token es no-cache y no toca nada más: nada que invalidar
  { method: 'POST',   prefix: '/listen-token',              clear: [] },
  { method: 'DELETE', prefix: '/listen-token',              clear: [] },
];

export function applyMutationInvalidation(method: string, path: string): void {
  for (const rule of MUTATION_INVALIDATIONS) {
    if (rule.method !== method) continue;
    if (path === rule.prefix || path.startsWith(rule.prefix)) {
      for (const p of rule.clear) cache.invalidateByPath(p, cacheDeps);
      return;
    }
  }
  // fallback: si no hay regla, conservador → limpia todo el cache.
  cache.clearL1(cacheDeps);
  cache.invalidateByPath('/', cacheDeps);
}

// POST/PUT/DELETE/PATCH helper para mutaciones.
// `opts.invalidate: false` para endpoints POST que en realidad LEEN (el cuerpo es la
// consulta, no una mutación): sin esto invalidarían el cache de /stats/ en cada llamada
export async function apiMutate<T>(method: string, path: string, body?: unknown, opts?: { invalidate?: boolean }): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    window.location.href = '/login?returnTo=' + encodeURIComponent(window.location.pathname + window.location.search);
    throw new Error('No autorizado');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `API error: ${res.status}`);
  }
  if (opts?.invalidate !== false) applyMutationInvalidation(method, path);
  // 204 No Content: sin cuerpo que parsear
  if (res.status === 204) return undefined as T;
  return res.json();
}

// formatea range/dates para query params: si hay rango personalizado usa startDate+endDate,
// si no usa el alias del rango (week/month/...)
export function rangeParams(range: string, dates?: DateRangeParams): Record<string, string> {
  if (dates) return { startDate: dates.startDate, endDate: dates.endDate };
  return { range };
}

// `BASE` y otros helpers usados por endpoints que hacen fetch directo (FormData).
export const API_BASE = BASE;
