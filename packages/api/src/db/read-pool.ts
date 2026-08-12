// Pool de workers para queries de lectura SQLite concurrentes
// En dev (tsx): ejecuta directamente en el main thread
// En prod (bundled): pool de N workers, cada uno con su propia conexión SQLite (WAL)
// Auto-registra funciones — no requiere dispatch map manual
import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import type { Db } from './queries/helpers.js';

const POOL_SIZE = 4;

// El contrato de dbRead se deriva del propio módulo de queries en vez de repetirse a
// mano: tanto el worker como el modo directo auto-registran por reflexión sobre
// queries/index.js, así que `typeof import(...)` describe exactamente lo que hay al
// otro lado del canal. Es una referencia solo de tipos —no genera import en runtime,
// por tanto no introduce ciclo— y convierte renombrar una query o cambiarle la firma
// en un error de compilación en lugar de un `unknown function` en producción.
type QueryModule = typeof import('./queries/index.js');

// El barrel también exporta helpers puros (getRangeStart, albumIdIn...) que no reciben
// `db` y nunca fueron destinos válidos de dbRead. Filtrar por "primer parámetro Db" los
// deja fuera del union por contravarianza, sin necesidad de listarlos.
type QueryName = {
  [K in keyof QueryModule]: QueryModule[K] extends (db: Db, ...args: never[]) => unknown ? K : never;
}[keyof QueryModule];

// Los args del call site son los de la query menos `db`, que inyecta el worker.
type QueryArgs<K extends QueryName> =
  QueryModule[K] extends (db: Db, ...args: infer A) => unknown ? A : never;

// Awaited por robustez: hoy todas las queries son síncronas (better-sqlite3 lo es),
// pero el canal las devuelve envueltas en promesa igualmente.
type QueryResult<K extends QueryName> =
  QueryModule[K] extends (db: Db, ...args: never[]) => infer R ? Awaited<R> : never;

interface PoolWorker {
  worker: Worker;
  busy: number;
}

let pool: PoolWorker[] = [];
let directFns: Record<string, (args: any[]) => any> | null = null;
let msgId = 0;
// registro heterogéneo: cada entrada resuelve el tipo de su propia query, así que aquí
// el valor no puede ser más concreto que `any` sin romper la varianza del resolver
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();

function setupWorker(w: PoolWorker) {
  w.worker.on('message', (msg: { id: number; result?: any; error?: string }) => {
    w.busy--;
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error));
    else p.resolve(msg.result);
  });

  w.worker.on('error', (err) => console.error('[worker] error:', err));
  w.worker.on('exit', (code) => {
    if (code !== 0) console.error(`[worker] terminó con código ${code}`);
    pool = pool.filter(pw => pw !== w);
  });
}

function pickWorker(): PoolWorker {
  let best = pool[0];
  for (let i = 1; i < pool.length; i++) {
    if (pool[i].busy < best.busy) best = pool[i];
  }
  return best;
}

export async function initReadWorker() {
  const __filename = fileURLToPath(import.meta.url);
  const isTS = __filename.endsWith('.ts');

  if (isTS) {
    // dev: auto-registrar desde módulos de queries
    const { getDb } = await import('./connection.js');
    const queries = await import('./queries/index.js');
    const db = getDb();
    directFns = {};
    for (const [name, fn] of Object.entries(queries)) {
      if (typeof fn === 'function') {
        directFns[name] = (args: any[]) => (fn as any)(db, ...args);
      }
    }
    console.log(`[pool] modo directo (dev, ${Object.keys(directFns).length} funciones)`);
    return;
  }

  // prod: crear pool de workers
  const workerPath = resolve(dirname(__filename), 'db', 'worker.js');
  for (let i = 0; i < POOL_SIZE; i++) {
    const pw: PoolWorker = { worker: new Worker(workerPath), busy: 0 };
    setupWorker(pw);
    pool.push(pw);
  }
  console.log(`[pool] ${POOL_SIZE} read workers iniciados`);
}

/**
 * Ejecutar una función de query en un worker del pool (prod) o directamente (dev).
 * Los args no deben incluir `db` — el worker/dispatch inyecta su propia conexión.
 */
export function dbRead<K extends QueryName>(fn: K, ...args: QueryArgs<K>): Promise<QueryResult<K>> {
  // modo directo (dev)
  if (directFns) {
    try {
      const handler = directFns[fn];
      if (!handler) throw new Error(`unknown function: ${fn}`);
      return Promise.resolve(handler(args));
    } catch (err) {
      return Promise.reject(err);
    }
  }

  // modo pool (prod)
  if (pool.length === 0) throw new Error('read pool not initialized');
  const pw = pickWorker();
  pw.busy++;
  const id = ++msgId;
  // no usar `resolve`/`reject` a secas: `resolve` es el import de 'path' de arriba
  return new Promise<QueryResult<K>>((onResult, onError) => {
    pending.set(id, { resolve: onResult, reject: onError });
    pw.worker.postMessage({ id, fn, args });
  });
}

export function closeReadWorker() {
  for (const pw of pool) pw.worker.terminate();
  pool = [];
  for (const [, p] of pending) p.reject(new Error('pool terminated'));
  pending.clear();
  directFns = null;
}
