import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventEmitter } from 'node:events';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import { InMemorySpanExporter, NodeTracerProvider, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { withSpan } from '@platform/observability';

// doble de un worker del pool: guarda lo que se le manda y contesta cuando el test quiere
interface FakeWorker extends EventEmitter {
  posted: { id: number; fn: string }[];
}
const spawned = vi.hoisted(() => {
  // el worker caído se loguea como error: fuera de la salida del test
  process.env.LOG_LEVEL = 'silent';
  return [] as FakeWorker[];
});

vi.mock('worker_threads', async (importOriginal) => {
  const { EventEmitter } = await import('node:events');
  class Worker extends EventEmitter {
    posted: { id: number; fn: string }[] = [];
    constructor() {
      super();
      spawned.push(this);
    }
    postMessage(msg: { id: number; fn: string }) {
      this.posted.push(msg);
    }
    terminate() {
      return Promise.resolve(0);
    }
  }
  return { ...await importOriginal<typeof import('worker_threads')>(), Worker };
});

// la cola sólo existe en el build: desde un .ts el pool corre en modo directo, sin cola
// ni cancelación, así que read-pool se hace pasar por compilado
vi.mock('url', async (importOriginal) => {
  const actual = await importOriginal<typeof import('url')>();
  const fileURLToPath = (url: string | URL) => actual.fileURLToPath(url).replace(/read-pool\.ts$/, 'read-pool.js');
  return { ...actual, fileURLToPath, default: { ...actual, fileURLToPath } };
});

import { closeReadWorker, dbRead, dbReadCancellable, initReadWorker, RequestAbortedError, REQUEST_ABORTED_ATTR } from './read-pool.js';

// los workers son dobles: el nombre de la query y sus args no llegan a ejecutarse.
// CHART_FN es una de las lecturas que se cancelaban en producción (heavy desde el arranque)
const read = dbRead as unknown as (fn: string) => Promise<unknown>;
const readCancellable = dbReadCancellable as unknown as (signal: AbortSignal, fn: string) => Promise<unknown>;
const CHART_FN = 'getEntityChartHistory';
const BUSY_FN = 'busyRead';

// el worker contesta su job en curso, con la misma forma que worker.ts
const reply = (w: FakeWorker, payload: { result?: unknown; error?: string }) => w.emit('message', { id: w.posted.at(-1)!.id, ...payload });
// las lecturas cuelgan de una request, como en producción: fuera de una traza no hay span
const inRequest = <T>(fn: () => T) => withSpan('GET /stats/test', fn, { root: true });

const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
const readSpan = (fn: string) => exporter.getFinishedSpans().find(s => s.name === `dbRead ${fn}`)!;
const exceptions = (fn: string) => readSpan(fn).events.filter(e => e.name === 'exception');

beforeAll(() => provider.register());
afterAll(async () => {
  await provider.shutdown();
  trace.disable();
});

beforeEach(async () => {
  spawned.length = 0;
  exporter.reset();
  await initReadWorker();
});
afterEach(() => closeReadWorker());

describe('span dbRead de una lectura que el cliente cancela', () => {
  it('descartada en cola: UNSET, sin exception, con el atributo, y la promesa rechaza igual', async () => {
    const ctrl = new AbortController();
    const { busy, cancelled } = inRequest(() => ({
      // los workers ocupados: la lectura del request espera en cola
      busy: spawned.map(() => read(BUSY_FN)),
      cancelled: readCancellable(ctrl.signal, CHART_FN),
    }));
    ctrl.abort();
    // al liberarse un worker la cola descarta el job en vez de lanzarlo
    spawned.forEach(w => reply(w, { result: null }));

    await expect(cancelled).rejects.toBeInstanceOf(RequestAbortedError);
    await Promise.all(busy);
    expect(spawned.flatMap(w => w.posted.map(m => m.fn))).not.toContain(CHART_FN);
    expect(readSpan(CHART_FN).status.code).toBe(SpanStatusCode.UNSET);
    expect(exceptions(CHART_FN)).toEqual([]);
    expect(readSpan(CHART_FN).attributes[REQUEST_ABORTED_ATTR]).toBe(true);
  });

  it('ya cancelada al pedirla: tampoco marca el span', async () => {
    const ctrl = new AbortController();
    ctrl.abort();

    await expect(inRequest(() => readCancellable(ctrl.signal, CHART_FN))).rejects.toBeInstanceOf(RequestAbortedError);
    expect(readSpan(CHART_FN).status.code).toBe(SpanStatusCode.UNSET);
    expect(exceptions(CHART_FN)).toEqual([]);
    expect(readSpan(CHART_FN).attributes[REQUEST_ABORTED_ATTR]).toBe(true);
  });
});

describe('span dbRead de una lectura que falla de verdad', () => {
  it('un error de sqlite en el worker sigue siendo ERROR con su exception', async () => {
    const failed = inRequest(() => read(CHART_FN));
    reply(spawned[0], { error: 'SQLITE_ERROR: no such table: listening_history' });

    await expect(failed).rejects.toThrow('no such table');
    expect(readSpan(CHART_FN).status.code).toBe(SpanStatusCode.ERROR);
    expect(exceptions(CHART_FN)).toHaveLength(1);
    expect(readSpan(CHART_FN).attributes[REQUEST_ABORTED_ATTR]).toBeUndefined();
  });

  it('un worker que muere a mitad de lectura sigue siendo ERROR', async () => {
    const failed = inRequest(() => read(CHART_FN));
    spawned[0].emit('exit', 1);

    await expect(failed).rejects.toThrow('terminó con código 1');
    expect(readSpan(CHART_FN).status.code).toBe(SpanStatusCode.ERROR);
    expect(exceptions(CHART_FN)).toHaveLength(1);
  });
});
