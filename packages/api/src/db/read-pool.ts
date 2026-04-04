// Pool de workers para queries de lectura SQLite concurrentes
// En dev (tsx): ejecuta directamente en el main thread
// En prod (bundled): pool de N workers, cada uno con su propia conexión SQLite (WAL)
// Auto-registra funciones — no requiere dispatch map manual
import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const POOL_SIZE = 4;

interface PoolWorker {
  worker: Worker;
  busy: number;
}

let pool: PoolWorker[] = [];
let directFns: Record<string, (args: any[]) => any> | null = null;
let msgId = 0;
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
export function dbRead<T>(fn: string, ...args: any[]): Promise<T> {
  // modo directo (dev)
  if (directFns) {
    try {
      const handler = directFns[fn];
      if (!handler) throw new Error(`unknown function: ${fn}`);
      return Promise.resolve(handler(args));
    } catch (err: any) {
      return Promise.reject(err);
    }
  }

  // modo pool (prod)
  if (pool.length === 0) throw new Error('read pool not initialized');
  const pw = pickWorker();
  pw.busy++;
  const id = ++msgId;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject });
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
