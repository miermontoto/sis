// capa SWR. Se enchufa debajo de apiFetch en api.ts.
//
// flujo:
//   1. L1 hit + fresh           → return inmediato, no fetch
//   2. L1 hit + stale-aceptable → return inmediato, revalida en background
//   3. L1 miss → consulta L2 (IDB)
//      a. L2 hit + aceptable     → promueve a L1, return; revalida si stale
//      b. L2 miss o expirado     → fetch bloqueante, escribe ambas capas
//
// dedup de requests en vuelo se hereda de api.ts (caller pasa inflightMap).

import * as store from './store';
import { getConfig, isNoCache } from './config';
import { refreshing } from '../stores/refreshing.svelte';

export interface L1Entry {
  data: unknown;
  ts: number;
}

export type Fetcher = () => Promise<unknown>;

export interface CacheDeps {
  l1: Map<string, L1Entry>;
  inflight: Map<string, Promise<unknown>>;
}

// epoch de invalidación. Una respuesta que arrancó ANTES de una invalidación
// lleva datos pre-mutación, así que no puede repoblar el cache: writeBoth la
// descarta comparando el epoch capturado al lanzar el fetch con el actual.
let epoch = 0;

export function currentEpoch(): number {
  return epoch;
}

// resuelve la lookup en cache para una llamada GET.
// devuelve { data, fresh } si hay algo servible; null si hay miss total.
// dispara revalidación en background si está stale.
export async function lookup<T>(
  path: string,
  cacheKey: string,
  fetcher: Fetcher,
  deps: CacheDeps,
): Promise<{ data: T; fresh: boolean } | null> {
  if (isNoCache(path)) return null;

  const cfg = getConfig(path);
  const now = Date.now();

  // L1
  const l1 = deps.l1.get(cacheKey);
  if (l1) {
    const age = now - l1.ts;
    if (age < cfg.ttl) {
      return { data: l1.data as T, fresh: true };
    }
    if (age < cfg.maxStale) {
      revalidate(path, cacheKey, fetcher, deps);
      return { data: l1.data as T, fresh: false };
    }
    deps.l1.delete(cacheKey);
  }

  // L2
  const l2 = await store.get(cacheKey);
  if (l2) {
    const age = now - l2.ts;
    if (age < cfg.maxStale) {
      // promueve a L1
      deps.l1.set(cacheKey, { data: l2.data, ts: l2.ts });
      if (age >= cfg.ttl) {
        revalidate(path, cacheKey, fetcher, deps);
      }
      return { data: l2.data as T, fresh: age < cfg.ttl };
    }
    // expirado más allá de maxStale: borrar
    store.del(cacheKey);
  }

  return null;
}

// dispara una revalidación en background sin bloquear al caller.
// dedup contra inflight; marca el path como refreshing mientras corra.
export function revalidate(
  path: string,
  cacheKey: string,
  fetcher: Fetcher,
  deps: CacheDeps,
): void {
  if (deps.inflight.has(cacheKey)) return;
  const gen = epoch;
  refreshing.add(path);
  const p = (async () => {
    try {
      const data = await fetcher();
      await writeBoth(cacheKey, data, deps, gen);
      return data;
    } finally {
      deps.inflight.delete(cacheKey);
      refreshing.remove(path);
    }
  })();
  deps.inflight.set(cacheKey, p);
}

// fetch bloqueante (cuando no hay nada servible). Escribe en ambas capas al éxito.
export async function fetchAndStore<T>(
  path: string,
  cacheKey: string,
  fetcher: Fetcher,
  deps: CacheDeps,
): Promise<T> {
  if (isNoCache(path)) {
    return await fetcher() as T;
  }
  const existing = deps.inflight.get(cacheKey);
  if (existing) return await existing as T;

  const gen = epoch;
  const p = (async () => {
    const data = await fetcher();
    await writeBoth(cacheKey, data, deps, gen);
    return data;
  })();
  deps.inflight.set(cacheKey, p);
  try {
    return await p as T;
  } finally {
    deps.inflight.delete(cacheKey);
  }
}

async function writeBoth(cacheKey: string, data: unknown, deps: CacheDeps, gen: number): Promise<void> {
  // la respuesta salió antes de la última invalidación: escribirla resucitaría
  // el estado pre-mutación que se acaba de purgar
  if (gen !== epoch) return;
  const ts = Date.now();
  deps.l1.set(cacheKey, { data, ts });
  const size = store.estimateSize(data);
  await store.set(cacheKey, { data, ts, size });
}

// expuesto para callers que hacen fetch fuera del SWR (p.ej. requests con
// signal propio) y quieren poblar el cache para hits futuros.
// `gen` es el epoch capturado por el caller ANTES de lanzar su fetch.
export function writeCache(cacheKey: string, data: unknown, deps: CacheDeps, gen: number): void {
  // fire-and-forget: el caller ya tiene su data, no esperamos a IDB.
  writeBoth(cacheKey, data, deps, gen).catch(() => {});
}

// invalida por prefijos de path (no por URL completa). Limpia L1 y L2 en una
// sola pasada de claves.
//
// EL AWAIT DEL CALLER ES PARTE DEL CONTRATO: el purgado de L2 es asíncrono y
// empieza por enumerar claves, así que un refetch lanzado sin esperarlo abría su
// transacción de lectura antes de que existiera la de borrado y volvía a leer la
// entrada pre-mutación (que además, dentro de su ttl, cuenta como fresca y ni
// siquiera revalida). Era el "unmerge que no cambia nada hasta recargar".
export async function invalidateByPaths(pathPrefixes: string[], deps: CacheDeps): Promise<void> {
  if (pathPrefixes.length === 0) return;
  epoch++;
  for (const key of deps.l1.keys()) {
    if (pathPrefixes.some(p => matches(key, p))) deps.l1.delete(key);
  }
  await store.delByPathPrefixes(pathPrefixes);
}

export function invalidateByPath(pathPrefix: string, deps: CacheDeps): Promise<void> {
  return invalidateByPaths([pathPrefix], deps);
}

export function clearL1(deps: CacheDeps): void {
  deps.l1.clear();
}

// match contra la url completa o el path (acepta ambos).
function matches(cacheKey: string, pathPrefix: string): boolean {
  try {
    const u = new URL(cacheKey);
    return u.pathname.startsWith('/api' + pathPrefix) || u.pathname.startsWith(pathPrefix);
  } catch {
    return cacheKey.includes(pathPrefix);
  }
}

// invocar al boot. Limpia cache foreign (otro user / versión vieja) y aplica LRU.
export async function bootCleanup(): Promise<void> {
  await store.pruneForeign();
  await store.evictIfOverCap();
}
