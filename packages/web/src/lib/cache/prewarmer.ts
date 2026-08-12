// loader en background con tiers.
//
// Tier 1: dispara nada más arrancar (lo que el dashboard necesita).
// Tier 2: tras paint inicial, lo que el resto de la app más visita.
// Tier 3: en idle, variantes menos comunes y la otra métrica.
//
// throttling: concurrencia ≤ 3 para no saturar al backend.
// Tier 2/3 ceden tiempo entre items vía requestIdleCallback.

import { api, getRankingMetric, getWeekStart, type RankingMetric } from '../api';

type Task = () => Promise<unknown>;

const CONCURRENCY = 3;
let started = false;

function idle(timeout = 2000): Promise<void> {
  return new Promise(resolve => {
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(() => resolve(), { timeout });
    } else {
      setTimeout(resolve, 50);
    }
  });
}

async function runQueue(tasks: Task[], concurrency = CONCURRENCY): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (i < tasks.length) {
      const idx = i++;
      try {
        await tasks[idx]();
      } catch {
        // errores silenciados: el cache simplemente no se rellena para este item.
      }
    }
  });
  await Promise.all(workers);
}

// fila más perezosa: yield entre tasks para no robar tiempo de main thread.
async function runIdleQueue(tasks: Task[], concurrency = CONCURRENCY): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (i < tasks.length) {
      const idx = i++;
      await idle();
      try {
        await tasks[idx]();
      } catch {
        // noop
      }
    }
  });
  await Promise.all(workers);
}

function tier1Tasks(metric: RankingMetric): Task[] {
  return [
    () => api.health(),
    () => api.topTracks('week', 5, metric),
    () => api.topArtists('week', 5, metric),
    () => api.topAlbums('week', 5, metric),
    () => api.history(1, 10),
    () => api.listeningTime('week', 'day'),
    () => api.streaks(),
  ];
}

function tier2Tasks(metric: RankingMetric, weekStart: string): Task[] {
  const ranges = ['week', 'month', 'year', 'all'] as const;
  const tasks: Task[] = [];

  for (const r of ranges) {
    tasks.push(() => api.topTracks(r, 50, metric));
    tasks.push(() => api.topArtists(r, 50, metric));
    tasks.push(() => api.topAlbums(r, 50, metric));
  }

  // periods de charts (3 granularidades).
  for (const g of ['week', 'month', 'year'] as const) {
    tasks.push(() => api.chartPeriods(g, weekStart));
  }

  // records (3 tabs).
  for (const t of ['tracks', 'albums', 'artists'] as const) {
    tasks.push(() => api.records(weekStart, metric, t));
  }

  // insights bundle del mes (range más visto).
  tasks.push(() => api.listeningTime('month', 'day'));
  tasks.push(() => api.heatmap('month'));
  tasks.push(() => api.topGenres('month'));
  tasks.push(() => api.monthlyDistribution('month'));
  tasks.push(() => api.discovery('month', 'week', 'track'));

  return tasks;
}

function tier3Tasks(metric: RankingMetric): Task[] {
  const otherMetric: RankingMetric = metric === 'time' ? 'plays' : 'time';
  const tasks: Task[] = [];

  // resto de ranges con la métrica actual.
  for (const r of ['3months', '6months', 'thisYear'] as const) {
    tasks.push(() => api.topTracks(r, 50, metric));
    tasks.push(() => api.topArtists(r, 50, metric));
    tasks.push(() => api.topAlbums(r, 50, metric));
  }

  // la otra métrica para los ranges más comunes.
  for (const r of ['week', 'month', 'year'] as const) {
    tasks.push(() => api.topTracks(r, 50, otherMetric));
    tasks.push(() => api.topArtists(r, 50, otherMetric));
    tasks.push(() => api.topAlbums(r, 50, otherMetric));
  }

  // insights para otros ranges.
  for (const r of ['week', 'year', 'all'] as const) {
    tasks.push(() => api.listeningTime(r, r === 'week' ? 'day' : r === 'year' ? 'month' : 'month'));
    tasks.push(() => api.heatmap(r));
    tasks.push(() => api.topGenres(r));
    tasks.push(() => api.monthlyDistribution(r));
  }

  return tasks;
}

// arranca el prewarming. Idempotente: la 2a llamada es no-op.
export async function start(): Promise<void> {
  if (started) return;
  started = true;

  const metric = getRankingMetric();
  const weekStart = getWeekStart();

  // Tier 1: inmediato, en paralelo.
  await runQueue(tier1Tasks(metric));

  // Tier 2: tras primer idle.
  await idle();
  await runIdleQueue(tier2Tasks(metric, weekStart));

  // Tier 3: en idle, más tarde.
  await idle();
  await runIdleQueue(tier3Tasks(metric), 2);
}

// resetea el flag (p.ej. tras un cambio de usuario).
export function reset(): void {
  started = false;
}
