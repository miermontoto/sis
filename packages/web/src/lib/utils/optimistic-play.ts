// Parche optimista de un play recién terminado sobre listas de ranking ya
// cargadas. Funciones puras: la vista decide cuándo aplicarlas y qué hacer con
// el resultado.
//
// Por qué parchear en vez de releer: cada endpoint de stats vive detrás de la
// cache SWR con TTLs de 10 min a 1 hora, y la invalidación es por PREFIJO. Para
// que una relectura llegue de verdad a la red habría que purgar '/stats/top-'
// entero, es decir todas las variantes de rango cacheadas, una vez por track
// (~cada 3 minutos) — y detrás vendría el prewarmer a rellenarlas. El parche
// cuesta cero y el TTL normal se encarga de reconciliar.
//
// Lo que el parche NO puede hacer, por diseño: meter en la lista una entidad
// que estuviera fuera de la página cargada, ni saber de merges/relaciones de
// artista que el servidor sí resuelve. Son desviaciones que la siguiente
// revalidación natural corrige.

import { invalidateCache } from '$lib/api';
import type { RankingMetric, ChartResponse, ChartEntry } from '$lib/api';

interface RankedRow {
  playCount: number;
  totalMs: number;
  rankChange: number | null;
  previousRank: number | null;
}

function byMetric(metric: RankingMetric) {
  return metric === 'plays'
    ? (a: RankedRow, b: RankedRow) => b.playCount - a.playCount
    : (a: RankedRow, b: RankedRow) => b.totalMs - a.totalMs;
}

// el sort de JS es estable, así que los empates conservan el orden que trajo el
// servidor en vez de barajarse en cada parche
export function applyPlayToTopRows<T extends RankedRow>(
  rows: T[],
  idOf: (row: T) => string,
  targetIds: string[],
  playedMs: number,
  metric: RankingMetric,
): T[] {
  if (rows.length === 0 || targetIds.length === 0) return rows;
  const targets = new Set(targetIds);

  let hit = false;
  const next = rows.map(row => {
    if (!targets.has(idOf(row))) return row;
    hit = true;
    return { ...row, playCount: row.playCount + 1, totalMs: row.totalMs + playedMs };
  });
  // misma referencia si el play no tocaba nada de lo visible: así el $state de
  // la página no se invalida y no se repinta la vista por un play ajeno
  if (!hit) return rows;

  next.sort(byMetric(metric));
  // el número de puesto que se pinta es la posición en el array, así que el
  // delta contra el periodo de lookback hay que rehacerlo o contradiría a la
  // propia fila. previousRank null = sin lookback (o entrada nueva): se deja
  return next.map((row, i) => (
    row.previousRank == null ? row : { ...row, rankChange: row.previousRank - (i + 1) }
  ));
}

// Los charts son agregados POR PERIODO: un periodo cerrado es inmutable y un
// play nuevo no puede cambiarlo nunca. Sólo tiene sentido parchear el periodo
// abierto; el llamante decide cuál es (ver computeCurrentPeriod).
//
// Los dropouts se dejan intactos a propósito: una entidad que salió del chart y
// vuelve a puntuar tendría que reentrar, y eso no se puede sintetizar sin las
// stats de trayectoria (peakRank, weeksOnChart…) que sólo tiene el servidor.
export function applyPlayToChart(
  chart: ChartResponse,
  targetIds: string[],
  playedMs: number,
  metric: RankingMetric,
): ChartResponse {
  if (chart.entries.length === 0 || targetIds.length === 0) return chart;
  const targets = new Set(targetIds);

  let hit = false;
  const entries: ChartEntry[] = chart.entries.map(entry => {
    if (!targets.has(entry.entityId)) return entry;
    hit = true;
    return { ...entry, plays: entry.plays + 1, totalMs: entry.totalMs + playedMs };
  });
  if (!hit) return chart;

  entries.sort(metric === 'plays'
    ? (a, b) => b.plays - a.plays
    : (a, b) => b.totalMs - a.totalMs);

  return {
    ...chart,
    entries: entries.map((entry, i) => {
      const rank = i + 1;
      return {
        ...entry,
        rank,
        rankChange: entry.previousRank == null ? entry.rankChange : entry.previousRank - rank,
      };
    }),
  };
}

// La otra mitad del problema: cuando el play YA está en listening_history (lo
// dice la marca de agua, ver play-updates), la ficha de la entidad que acaba de
// sonar se puede releer de verdad. Aquí invalidar sí sale barato: el matcher de
// la cache compara el prefijo contra la clave entera (path + query), así que
// '/stats/album/<id>' casa sólo las claves de ESE álbum — un request, no una
// purga de la familia '/stats/album/'. El id va codificado porque así viaja en
// la ruta (los sintéticos llevan ':', ver `import:`/`local:`).
export function invalidateEntityDetail(entityType: 'track' | 'album' | 'artist', id: string): Promise<void> {
  return invalidateCache(`/stats/${entityType}/${encodeURIComponent(id)}`);
}
