// wrapper sobre idb-keyval con namespacing por user + schema version.
// fallos de IDB son silenciosos (private browsing, cuota llena, etc.):
// el cache se vuelve no-op y la app sigue funcionando contra red.

import { get as idbGet, set as idbSet, del as idbDel, keys as idbKeys, createStore, type UseStore } from 'idb-keyval';
import { SCHEMA_VERSION, STORAGE_SOFT_CAP } from './config';

export interface CacheEntry {
  data: unknown;
  ts: number;
  // tamaño aproximado en bytes (para LRU eviction). 0 si desconocido.
  size: number;
}

let store: UseStore | null = null;
let currentUserId: string | null = null;

const LAST_USER_KEY = 'sis:cache:lastUser';

function ensureStore(): UseStore {
  if (!store) store = createStore('sis-cache', 'kv');
  return store;
}

function prefix(): string {
  return `v${SCHEMA_VERSION}:u${currentUserId ?? 'anon'}:`;
}

// hidrata el userId desde localStorage para que el prefijo del cache esté
// estable desde el primer apiFetch del page-load (antes de que /me responda).
export function hydrateUser(): void {
  if (currentUserId != null) return;
  if (typeof localStorage === 'undefined') return;
  try {
    const v = localStorage.getItem(LAST_USER_KEY);
    if (v) currentUserId = v;
  } catch {
    // noop
  }
}

export function setUser(userId: string | number | null): void {
  const next = userId == null ? null : String(userId);
  if (next === currentUserId) return;
  currentUserId = next;
  try {
    if (next == null) localStorage.removeItem(LAST_USER_KEY);
    else localStorage.setItem(LAST_USER_KEY, next);
  } catch {
    // noop
  }
}

export async function get(key: string): Promise<CacheEntry | undefined> {
  try {
    return (await idbGet(prefix() + key, ensureStore())) as CacheEntry | undefined;
  } catch {
    return undefined;
  }
}

export async function set(key: string, entry: CacheEntry): Promise<void> {
  try {
    await idbSet(prefix() + key, entry, ensureStore());
  } catch {
    // ignorar quota errors, IDB deshabilitado, etc.
  }
}

export async function del(key: string): Promise<void> {
  try {
    await idbDel(prefix() + key, ensureStore());
  } catch {
    // noop
  }
}

// borra todas las entradas cuya clave (sin prefijo) empieza por pathPrefix.
export async function delByPathPrefix(pathPrefix: string): Promise<void> {
  try {
    const p = prefix();
    const all = (await idbKeys(ensureStore())) as string[];
    const toDel = all.filter(k => typeof k === 'string' && k.startsWith(p) && k.slice(p.length).startsWith(pathPrefix));
    await Promise.all(toDel.map(k => idbDel(k, ensureStore())));
  } catch {
    // noop
  }
}

// borra TODO el cache (todos los users, todas las versiones).
export async function clearAll(): Promise<void> {
  try {
    const all = (await idbKeys(ensureStore())) as string[];
    await Promise.all(all.map(k => idbDel(k, ensureStore())));
  } catch {
    // noop
  }
}

// borra todas las claves que no pertenecen al schema actual + user actual.
// se llama en boot para limpieza de versiones antiguas y de otros users.
export async function pruneForeign(): Promise<void> {
  try {
    const p = prefix();
    const all = (await idbKeys(ensureStore())) as string[];
    const foreign = all.filter(k => typeof k === 'string' && !k.startsWith(p));
    await Promise.all(foreign.map(k => idbDel(k, ensureStore())));
  } catch {
    // noop
  }
}

// LRU eviction si el cache excede el cap blando.
// usa el campo size (estimación) sumado; elimina las entradas más antiguas
// hasta bajar del cap.
export async function evictIfOverCap(): Promise<void> {
  try {
    const p = prefix();
    const allKeys = (await idbKeys(ensureStore())) as string[];
    const mine = allKeys.filter(k => typeof k === 'string' && k.startsWith(p));
    if (mine.length === 0) return;

    const entries: Array<{ key: string; ts: number; size: number }> = [];
    let total = 0;
    for (const k of mine) {
      const e = (await idbGet(k, ensureStore())) as CacheEntry | undefined;
      if (!e) continue;
      const size = e.size || 0;
      total += size;
      entries.push({ key: k, ts: e.ts, size });
    }
    if (total <= STORAGE_SOFT_CAP) return;

    entries.sort((a, b) => a.ts - b.ts);
    let freed = 0;
    const target = total - STORAGE_SOFT_CAP;
    for (const e of entries) {
      if (freed >= target) break;
      await idbDel(e.key, ensureStore());
      freed += e.size;
    }
  } catch {
    // noop
  }
}

// estima el tamaño de un valor JSON serializable.
export function estimateSize(data: unknown): number {
  try {
    return JSON.stringify(data).length * 2; // UTF-16 worst-case
  } catch {
    return 0;
  }
}
