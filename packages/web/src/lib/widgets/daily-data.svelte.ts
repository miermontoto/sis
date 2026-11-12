// datos de ritmo diario que comparten varios widgets (stats, cifra suelta, últimos
// 7 días, objetivo, siguiente hito): los catorce días naturales hasta hoy, el año
// en curso, la racha y el total. Una sola copia: cada fuente se pide la primera vez
// que un widget la necesita, el play optimista se suma una vez (no una por tarjeta)
// y la confirmación del servidor relee lo que no se puede derivar del play.
// Antes vivía todo en la página del dashboard; con los widgets, cada uno pide lo
// suyo y esto es lo que se repetiría
import { untrack } from 'svelte';
import { api, invalidateCache, type HealthData, type StreaksData } from '$lib/api';
import { playUpdatesStore, type PlayUpdate } from '$lib/stores/play-updates.svelte';
import { statFlashStore } from '$lib/stores/stat-flash.svelte';
import type { WeekStripDay } from '$lib/components/WeekStrip.svelte';
import { dashboardStore } from './dashboard-store.svelte';

const DAY_MS = 86_400_000;
// la tira enseña siete días; se piden catorce para comparar con la semana anterior
export const STRIP_DAYS = 7;
export const WINDOW_DAYS = STRIP_DAYS * 2;
// los contadores no son entidades: se marcan para el parpadeo con claves propias.
// Van en dos grupos porque cambian en momentos distintos: el tiempo se deriva del
// play al vuelo, las rachas y el total esperan a que el servidor confirme
export const FLASH_KEY_TIME = 'dashboard:time';
export const FLASH_KEY_TOTALS = 'dashboard:totals';

// los buckets diarios de /listening-time son UTC: las claves se calculan igual
export const utcDayKey = (d: Date) => d.toISOString().slice(0, 10);

type Source = 'days' | 'year' | 'health' | 'streaks';

let _days = $state<WeekStripDay[]>([]);
let _year = $state<{ plays: number; ms: number }>({ plays: 0, ms: 0 });
let _health = $state<HealthData | null>(null);
let _streaks = $state<StreaksData | null>(null);
let _loading = $state<Record<Source, boolean>>({ days: true, year: true, health: true, streaks: true });
const requested = new Set<Source>();

function loadDays() {
  // catorce días naturales (UTC) terminando hoy. Rango custom y no `week`: ése es
  // una ventana rodante de 7×24h que no casa con barras por día
  const now = new Date();
  const keys = Array.from({ length: WINDOW_DAYS }, (_, i) => utcDayKey(new Date(now.getTime() - (WINDOW_DAYS - 1 - i) * DAY_MS)));
  return api.listeningTime('custom', 'day', { startDate: keys[0], endDate: keys[keys.length - 1] })
    .then(items => {
      const byDay = new Map(items.map(d => [d.period, d]));
      _days = keys.map(key => ({ key, plays: byDay.get(key)?.play_count ?? 0, ms: byDay.get(key)?.total_ms ?? 0 }));
    });
}

const LOADERS: Record<Source, () => Promise<unknown>> = {
  days: loadDays,
  year: () => api.listeningTime('thisYear', 'month').then(items => {
    _year = items.reduce((acc, d) => ({ plays: acc.plays + d.play_count, ms: acc.ms + d.total_ms }), { plays: 0, ms: 0 });
  }),
  health: () => api.health().then(h => { _health = h; }),
  streaks: () => api.streaks().then(s => { _streaks = s; }),
};

function load(source: Source) {
  _loading[source] = true;
  LOADERS[source]()
    .catch(e => console.error(`dashboard ${source}:`, e))
    .finally(() => { _loading[source] = false; });
}

// suma el play al bucket de hoy; si la página lleva abierta desde antes de la
// medianoche UTC, hoy aún no existe y la ventana se desliza un día
function applyPlay(update: PlayUpdate) {
  if (requested.has('days')) {
    const key = utcDayKey(new Date());
    const buckets = _days.at(-1)?.key === key ? _days : [..._days.slice(1), { key, plays: 0, ms: 0 }];
    _days = buckets.map(d => d.key === key ? { ...d, plays: d.plays + 1, ms: d.ms + update.playedMs } : d);
  }
  if (requested.has('year')) _year = { plays: _year.plays + 1, ms: _year.ms + update.playedMs };
  statFlashStore.flash([FLASH_KEY_TIME]);
}

// la racha y el total no se derivan del play (el primer play de un día nuevo
// alarga la racha): se releen cuando el servidor ya lo tiene. '/stats/streaks'
// casa un solo endpoint; /health no pasa por la cache
function applyConfirmed() {
  if (requested.has('streaks')) {
    invalidateCache('/stats/streaks')
      .then(() => api.streaks())
      .then(s => { _streaks = s; statFlashStore.flash([FLASH_KEY_TOTALS]); })
      .catch(() => {});
  }
  if (requested.has('health')) {
    api.health().then(h => { _health = h; statFlashStore.flash([FLASH_KEY_TOTALS]); }).catch(() => {});
  }
}

// los efectos viven fuera de cualquier componente (un widget puede desmontarse
// y otro seguir leyendo): una raíz, creada con la primera petición
let rooted = false;
function root() {
  if (rooted) return;
  rooted = true;
  $effect.root(() => {
    let lastOptimistic = playUpdatesStore.optimistic?.seq ?? 0;
    let lastConfirmed = playUpdatesStore.confirmed?.seq ?? 0;
    let lastReload = dashboardStore.reloadSeq;
    $effect(() => {
      const update = playUpdatesStore.optimistic;
      if (!update || update.seq <= lastOptimistic) return;
      lastOptimistic = update.seq;
      untrack(() => applyPlay(update));
    });
    $effect(() => {
      const batch = playUpdatesStore.confirmed;
      if (!batch || batch.seq <= lastConfirmed) return;
      lastConfirmed = batch.seq;
      untrack(applyConfirmed);
    });
    // pull-to-refresh: la página ya ha purgado la cache, aquí sólo se relee
    $effect(() => {
      const seq = dashboardStore.reloadSeq;
      if (seq === lastReload) return;
      lastReload = seq;
      untrack(() => { for (const s of requested) load(s); });
    });
  });
}

export const dailyData = {
  // pide las fuentes que aún no se han pedido; llamar desde el efecto de un widget
  ensure(...sources: Source[]) {
    root();
    for (const s of sources) {
      if (requested.has(s)) continue;
      requested.add(s);
      load(s);
    }
  },
  loading: (...sources: Source[]) => sources.some(s => _loading[s]),
  get days() { return _days; },
  get week() { return _days.slice(-STRIP_DAYS); },
  get prevWeek() { return _days.slice(0, -STRIP_DAYS); },
  get year() { return _year; },
  get health() { return _health; },
  get streaks() { return _streaks; },
};
