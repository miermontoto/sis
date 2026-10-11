// Pool de workers para queries de lectura SQLite concurrentes
// En dev (tsx): ejecuta directamente en el main thread
// En prod (bundled): pool de N workers, cada uno con su propia conexión SQLite (WAL)
// Auto-registra funciones — no requiere dispatch map manual
import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import type { Db } from './queries/helpers.js';
import { withSpan } from '@platform/observability';
import { createLogger } from '../services/logger.js';

const logWorker = createLogger('worker');
const logPool = createLogger('pool');
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

// Scheduler: cada worker ejecuta UN job a la vez y los libres tiran de colas compartidas
// en el main thread. Antes cada dbRead iba directo a la cola FIFO del worker con menos
// mensajes pendientes, y un getRecords de 17s contaba igual que un lookup de 1ms: el
// fan-out de un detalle se repartía entre los cuatro, ~3/4 de sus queries esperaban
// detrás de los escaneos largos y el Promise.all del handler con ellas (medido sobre el
// pool real: el DTO del artista llegaba el último de su propia página, 3.7s contra 0.8s
// con esta cola). Tres clases:
// - light: interactivo y corto (media medida < HEAVY_JOB_MS). Siempre primero.
// - heavy: interactivo largo. Mientras haya actividad light (en curso, o hace menos de
//   LIGHT_RESERVE_WINDOW_MS) el último worker queda reservado para ella; fuera de esa
//   ventana los heavy pueden ocuparlo. Una reserva fija daba el DTO del detalle en
//   0.5s en vez de 3.1s, pero dejaba un worker parado al terminarlo y las gráficas de
//   la misma página acababan ~1s más tarde (medido sobre el pool real).
// - background: horneados que nadie está esperando (dbReadBackground). De uno en uno y
//   sólo sin interactivos en cola, salvo que lleven BACKGROUND_MAX_WAIT_MS esperando.
//   Nunca ocupan el último worker.
//   Si alguien acaba esperándolos, promoteBackground los sube a heavy.
// Ojo: con un job por worker, un main thread bloqueado deja a los workers sin trabajo
// nuevo (antes seguían con su cola), así que nada pesado debe correr en el main thread.
const HEAVY_JOB_MS = 250;
// cubre el hueco entre tandas de un mismo handler: el DTO del detalle encadena varias
// rondas de dbRead light, y sin ventana un heavy en cola se metía en el hueco y la ronda
// siguiente esperaba segundos
const LIGHT_RESERVE_WINDOW_MS = 100;
const BACKGROUND_CONCURRENCY = 1;
const BACKGROUND_MAX_WAIT_MS = 60_000;
// peso de la última medición en la media móvil de duración por función
const DURATION_EWMA_ALPHA = 0.3;
// escaneos del historial completo: heavy desde la primera llamada, sin esperar a medirlos
const HEAVY_SEED = new Set<string>([
  'computeRankings', 'computeRankingsBatch', 'getRankingHistoryWithCrossovers',
  'getEntityChartHistory', 'getTopEntities', 'getRecords', 'getReport',
  'getRecentRankChanges', 'getProfileSummary', 'getUserStreaks', 'scanProjectionBase',
]);

type JobClass = 'light' | 'heavy' | 'background';

interface Job {
  id: number;
  fn: string;
  args: unknown[];
  cls: JobClass;
  // agrupa los jobs de un mismo horneado para poder promoverlos juntos
  tag?: string;
  enqueuedAt: number;
  startedAt: number;
  // registro heterogéneo: cada job resuelve el tipo de su propia query, así que aquí
  // el valor no puede ser más concreto que `any` sin romper la varianza del resolver
  resolve: (v: any) => void;
  reject: (e: Error) => void;
}

interface PoolWorker {
  worker: Worker;
  job: Job | null;
}

let pool: PoolWorker[] = [];
let directFns: Record<string, (args: any[]) => any> | null = null;
let msgId = 0;
const queues: Record<JobClass, Job[]> = { light: [], heavy: [], background: [] };
const running: Record<JobClass, number> = { light: 0, heavy: 0, background: 0 };
const avgDurationMs = new Map<string, number>();
let lastLightAt = -Infinity;
let reserveTimer: ReturnType<typeof setTimeout> | null = null;

function classify(fn: string): JobClass {
  const avg = avgDurationMs.get(fn);
  if (avg === undefined) return HEAVY_SEED.has(fn) ? 'heavy' : 'light';
  return avg >= HEAVY_JOB_MS ? 'heavy' : 'light';
}

function recordDuration(fn: string, ms: number) {
  const prev = avgDurationMs.get(fn);
  avgDurationMs.set(fn, prev === undefined ? ms : prev + DURATION_EWMA_ALPHA * (ms - prev));
}

const lightActive = (now: number) => running.light > 0 || now - lastLightAt < LIGHT_RESERVE_WINDOW_MS;

function nextJob(now: number): Job | undefined {
  if (queues.light.length > 0) return queues.light.shift();
  const long = running.heavy + running.background;
  // con un pool de 1 no hay último worker que reservar
  const reserved = Math.max(1, pool.length - 1);
  const bg = queues.background[0];
  const bgAllowed = bg !== undefined && running.background < BACKGROUND_CONCURRENCY && long < reserved;
  if (bgAllowed && now - bg.enqueuedAt >= BACKGROUND_MAX_WAIT_MS) return queues.background.shift();
  if (queues.heavy.length > 0 && long < (lightActive(now) ? reserved : pool.length)) return queues.heavy.shift();
  if (bgAllowed && queues.heavy.length === 0) return queues.background.shift();
  return undefined;
}

function dispatch() {
  const now = performance.now();
  for (const w of pool) {
    if (w.job) continue;
    const job = nextJob(now);
    if (!job) break;
    w.job = job;
    job.startedAt = now;
    running[job.cls]++;
    w.worker.postMessage({ id: job.id, fn: job.fn, args: job.args });
  }
  // un heavy esperando sólo por la ventana light: nada más despertaría al dispatcher
  // cuando la ventana caduca, así que se programa ese momento
  if (queues.heavy.length > 0 && running.light === 0 && lightActive(now) && pool.some(w => !w.job) && !reserveTimer) {
    reserveTimer = setTimeout(() => { reserveTimer = null; dispatch(); }, LIGHT_RESERVE_WINDOW_MS - (now - lastLightAt) + 1);
  }
}

function finishJob(w: PoolWorker): Job | null {
  const job = w.job;
  if (!job) return null;
  w.job = null;
  running[job.cls]--;
  if (job.cls === 'light') lastLightAt = performance.now();
  return job;
}

function setupWorker(w: PoolWorker) {
  w.worker.on('message', (msg: { id: number; result?: any; error?: string }) => {
    const job = finishJob(w);
    if (job && job.id === msg.id) {
      recordDuration(job.fn, performance.now() - job.startedAt);
      if (msg.error) job.reject(new Error(msg.error));
      else job.resolve(msg.result);
    }
    dispatch();
  });

  w.worker.on('error', (err) => logWorker.error('error:', err));
  w.worker.on('exit', (code) => {
    if (code !== 0) logWorker.error(`terminó con código ${code}`);
    pool = pool.filter(pw => pw !== w);
    finishJob(w)?.reject(new Error(`read worker terminó con código ${code}`));
    dispatch();
  });
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
    logPool.info(`modo directo (dev, ${Object.keys(directFns).length} funciones)`);
    return;
  }

  // prod: crear pool de workers
  const workerPath = resolve(dirname(__filename), 'db', 'worker.js');
  for (let i = 0; i < POOL_SIZE; i++) {
    const pw: PoolWorker = { worker: new Worker(workerPath), job: null };
    setupWorker(pw);
    pool.push(pw);
  }
  logPool.info(`${POOL_SIZE} read workers iniciados`);
}

/**
 * Ejecutar una función de query en un worker del pool (prod) o directamente (dev).
 * Los args no deben incluir `db` — el worker/dispatch inyecta su propia conexión.
 */
export function dbRead<K extends QueryName>(fn: K, ...args: QueryArgs<K>): Promise<QueryResult<K>> {
  return submit(fn, args, null);
}

/**
 * Como dbRead, pero en la clase background: para horneados que nadie está esperando
 * (timers, warmups). `tag` agrupa los jobs de un mismo horneado; si un request acaba
 * esperándolo, promoteBackground(tag) los pasa a la clase heavy.
 */
export function dbReadBackground<K extends QueryName>(tag: string, fn: K, ...args: QueryArgs<K>): Promise<QueryResult<K>> {
  return submit(fn, args, tag);
}

/** Pasa a heavy los jobs background aún en cola de un horneado que alguien espera. */
export function promoteBackground(tag: string) {
  const promoted = queues.background.filter(j => j.tag === tag);
  if (promoted.length === 0) return;
  queues.background = queues.background.filter(j => j.tag !== tag);
  for (const j of promoted) j.cls = 'heavy';
  queues.heavy.push(...promoted);
  dispatch();
}

function submit<K extends QueryName>(fn: K, args: unknown[], backgroundTag: string | null): Promise<QueryResult<K>> {
  // span por lectura dentro de la traza activa: en prod mide cola + ejecución en el worker
  // (sus statements no se trazan, el worker no comparte el contexto); en dev las queries
  // cuelgan de él. fuera de una traza no abre nada.
  return withSpan(`dbRead ${fn}`, () => {
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
    const cls: JobClass = backgroundTag === null ? classify(fn) : 'background';
    if (cls === 'light') lastLightAt = performance.now();
    // no usar `resolve`/`reject` a secas: `resolve` es el import de 'path' de arriba
    return new Promise<QueryResult<K>>((onResult, onError) => {
      queues[cls].push({
        id: ++msgId, fn, args, cls, tag: backgroundTag ?? undefined,
        enqueuedAt: performance.now(), startedAt: 0, resolve: onResult, reject: onError,
      });
      dispatch();
    });
  });
}

export function closeReadWorker() {
  const terminated = new Error('pool terminated');
  for (const pw of pool) {
    finishJob(pw)?.reject(terminated);
    pw.worker.terminate();
  }
  pool = [];
  if (reserveTimer) clearTimeout(reserveTimer);
  reserveTimer = null;
  for (const cls of Object.keys(queues) as JobClass[]) {
    for (const job of queues[cls]) job.reject(terminated);
    queues[cls] = [];
  }
  directFns = null;
}
