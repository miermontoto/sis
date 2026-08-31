import { sql } from 'drizzle-orm';
import type { Db } from './helpers.js';
import type { ChartEntry, DropoutEntry, ChartResponse, ChartHistoryResponse, ChartPeakStats, RankingMetric, WeekStartOption, Granularity, EntityType } from '@sis/shared';
import { resolvedEntityId, entityMergeJoin, userFilter, resolvedPlayJoins, albumNullFilter, playDuration, periodExpr } from './helpers.js';
import { CHART_SIZE } from '../../constants.js';
import { ChartPeaksAccumulator, peakSlices, periodYear, type ChartRankSlice, type PeakSlice, type RankSliceRow } from '../../services/chart-peaks.js';

type Sort = RankingMetric;
type WeekStart = WeekStartOption;

// periodo anterior (para rank changes)
export function prevPeriod(period: string, granularity: Granularity): string | null {
  if (granularity === 'year') {
    return String(parseInt(period) - 1);
  }
  if (granularity === 'month') {
    const [y, m] = period.split('-').map(Number);
    const d = new Date(y, m - 2, 1); // mes anterior
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  // week: YYYY-WNN
  const match = period.match(/^(\d{4})-W(\d{2})$/);
  if (!match) return null;
  const [, ys, ws] = match;
  const wn = parseInt(ws);
  if (wn <= 0) return `${parseInt(ys) - 1}-W52`;
  return `${ys}-W${String(wn - 1).padStart(2, '0')}`;
}

// obtener ranking para un periodo específico (raw, sin metadata)
export function getRawRanking(db: Db, entityType: EntityType, granularity: Granularity, weekStart: WeekStart, period: string, sort: Sort, limit: number, userId: number) {
  const pExpr = periodExpr(granularity, weekStart);
  const uf = userFilter(userId);

  // artistas: dedupe por play dentro de una CTE antes de agregar (evita doble count con merges)
  if (entityType === 'artist') {
    const mrJoin = entityMergeJoin('artist', userId);
    const metric = sort === 'plays' ? sql`count(*)` : sql`sum(duration_ms)`;
    return db.all(sql`
      SELECT entity_id, count(*) as plays, sum(duration_ms) as total_ms
      FROM (
        SELECT DISTINCT ${resolvedEntityId('artist', userId)} as entity_id, lh.id as play_id, ${playDuration()} as duration_ms, ${pExpr} as p
        FROM listening_history lh
        JOIN tracks t ON t.spotify_id = lh.track_id
        JOIN track_artists ta ON ta.track_id = lh.track_id
        ${mrJoin}
        WHERE lh.user_id = ${userId} AND ${pExpr} = ${period}
      )
      GROUP BY entity_id
      ORDER BY ${metric} DESC
      LIMIT ${limit}
    `) as { entity_id: string; plays: number; total_ms: number }[];
  }

  const metric = sort === 'plays' ? sql`count(*)` : sql`sum(${playDuration()})`;
  const groupCol = resolvedEntityId(entityType, userId);

  return db.all(sql`
    SELECT ${groupCol} as entity_id, count(*) as plays, sum(${playDuration()}) as total_ms
    FROM listening_history lh
    ${resolvedPlayJoins(entityType, userId)}
    WHERE ${pExpr} = ${period} ${uf}
    ${albumNullFilter(entityType)}
    GROUP BY entity_id
    ORDER BY ${metric} DESC
    LIMIT ${limit}
  `) as { entity_id: string; plays: number; total_ms: number }[];
}

// primer periodo con datos de cada entidad (hasta currentPeriod). Marca hasta
// dónde hay que escanear hacia atrás para cerrar sus stats de chart.
export function getChartFirstPeriods(db: Db, entityType: EntityType, granularity: Granularity, weekStart: WeekStart, currentPeriod: string, userId: number, entityIds: string[]): Record<string, string> {
  if (entityIds.length === 0) return {};

  const pExpr = periodExpr(granularity, weekStart);
  const idsIn = sql.join(entityIds.map(id => sql`${id}`), sql`, `);

  const rows = entityType === 'artist'
    ? db.all(sql`
      SELECT ${resolvedEntityId('artist', userId)} as entity_id, min(${pExpr}) as first_period
      FROM listening_history lh
      JOIN tracks t ON t.spotify_id = lh.track_id
      JOIN track_artists ta ON ta.track_id = lh.track_id
      ${entityMergeJoin('artist', userId)}
      WHERE lh.user_id = ${userId} AND COALESCE(mr_artist.target_id, ta.artist_id) IN (${idsIn})
      GROUP BY entity_id
    `) as { entity_id: string; first_period: string }[]
    : db.all(sql`
      SELECT ${resolvedEntityId(entityType, userId)} as entity_id, min(${pExpr}) as first_period
      FROM listening_history lh
      ${resolvedPlayJoins(entityType, userId)}
      WHERE 1=1 ${userFilter(userId)}
      ${entityType === 'track'
        ? sql`AND COALESCE(mr_track.target_id, lh.track_id) IN (${idsIn})`
        : sql`AND COALESCE(mr_album.target_id, t.album_id) IN (${idsIn})`}
      ${albumNullFilter(entityType)}
      GROUP BY entity_id
    `) as { entity_id: string; first_period: string }[];

  const result: Record<string, string> = {};
  // min() sobre todos los periodos: si es posterior al actual, la entidad no
  // tiene historial que escanear y se cierra con los defaults
  for (const row of rows) if (row.first_period <= currentPeriod) result[row.entity_id] = row.first_period;
  return result;
}

// ranking por periodo (top CHART_SIZE) acotado a una ventana de fechas. La
// ventana usa played_at directamente para que entre por el índice
// (user_id, played_at) en vez de escanear todo el historial; los cortes caen
// siempre entre periodos, así que ninguna partición se calcula a medias.
// Devuelve sólo las filas de las entidades pedidas, más las labels de periodo
// con datos del tramo (necesarias para la racha consecutiva).
export function getChartRankSlice(db: Db, entityType: EntityType, granularity: Granularity, weekStart: WeekStart, currentPeriod: string, sort: Sort, userId: number, entityIds: string[], startAt: string, endAt: string): ChartRankSlice {
  const pExpr = periodExpr(granularity, weekStart);
  const window = sql`AND lh.played_at >= ${startAt} AND lh.played_at < ${endAt}`;

  let ranked: { period: string; entity_id: string; rank: number }[];

  if (entityType === 'artist') {
    // dedup por play antes de agregar — evita doble count cuando un track tiene 2 artists mergeados al mismo target
    const metricDedup = sort === 'plays' ? sql`count(*)` : sql`sum(duration_ms)`;
    ranked = db.all(sql`
      SELECT period, entity_id, rank FROM (
        SELECT period, entity_id,
               ROW_NUMBER() OVER (PARTITION BY period ORDER BY ${metricDedup} DESC) as rank
        FROM (
          SELECT DISTINCT ${pExpr} as period, ${resolvedEntityId('artist', userId)} as entity_id, lh.id as play_id, ${playDuration()} as duration_ms
          FROM listening_history lh
          JOIN tracks t ON t.spotify_id = lh.track_id
          JOIN track_artists ta ON ta.track_id = lh.track_id
          ${entityMergeJoin('artist', userId)}
          WHERE lh.user_id = ${userId} ${window}
        )
        GROUP BY period, entity_id
        HAVING period <= ${currentPeriod}
      )
      WHERE rank <= ${CHART_SIZE}
    `) as { period: string; entity_id: string; rank: number }[];
  } else {
    const metric = sort === 'plays' ? sql`count(*)` : sql`sum(${playDuration()})`;
    ranked = db.all(sql`
      SELECT period, entity_id, rank FROM (
        SELECT ${pExpr} as period, ${resolvedEntityId(entityType, userId)} as entity_id,
               ROW_NUMBER() OVER (PARTITION BY ${pExpr} ORDER BY ${metric} DESC) as rank
        FROM listening_history lh
        ${resolvedPlayJoins(entityType, userId)}
        WHERE 1=1 ${userFilter(userId)} ${window} ${albumNullFilter(entityType)}
        GROUP BY period, entity_id
        HAVING period <= ${currentPeriod}
      )
      WHERE rank <= ${CHART_SIZE}
    `) as { period: string; entity_id: string; rank: number }[];
  }

  const idSet = new Set(entityIds);
  const periods = new Set<string>();
  const rows: RankSliceRow[] = [];
  for (const row of ranked) {
    periods.add(row.period);
    if (idSet.has(row.entity_id)) rows.push({ period: row.period, entityId: row.entity_id, rank: row.rank });
  }
  return { rows, periods: [...periods] };
}

// trozos a escanear para cerrar las stats de un set de entidades, del más
// reciente al más antiguo. Compartido por el endpoint batch y el de streaming.
export function chartPeakSlices(db: Db, entityType: EntityType, granularity: Granularity, weekStart: WeekStart, currentPeriod: string, userId: number, entityIds: string[]): { slices: PeakSlice[]; firstPeriods: Record<string, string> } {
  const firstPeriods = getChartFirstPeriods(db, entityType, granularity, weekStart, currentPeriod, userId, entityIds);
  const years = Object.values(firstPeriods).map(periodYear);
  const newestYear = periodYear(currentPeriod);
  const oldestYear = years.length > 0 ? Math.min(...years, newestYear) : newestYear;
  return { slices: peakSlices(oldestYear, newestYear, granularity, weekStart), firstPeriods };
}

// batch fetch de metadata para un conjunto de entidades (reemplaza N+1 queries individuales)
export interface EntityMeta { name: string; imageUrl: string | null; artistName: string | null; artistId: string | null; artists: { id: string; name: string }[]; }

export function fetchEntityMetadata(db: Db, entityType: EntityType, ids: string[]): Map<string, EntityMeta> {
  const result = new Map<string, EntityMeta>();
  if (ids.length === 0) return result;

  const placeholders = sql.join(ids.map(id => sql`${id}`), sql`, `);

  if (entityType === 'track') {
    const rows = db.all(sql`
      SELECT t.spotify_id as id, t.name, al.image_url
      FROM tracks t LEFT JOIN albums al ON al.spotify_id = t.album_id
      WHERE t.spotify_id IN (${placeholders})
    `) as any[];
    for (const r of rows) result.set(r.id, { name: r.name, imageUrl: r.image_url, artistName: null, artistId: null, artists: [] });

    // todos los artistas de cada track en una sola query (evita N+1); el de position 0 hace de principal
    const artistRows = db.all(sql`
      SELECT ta.track_id, a.spotify_id as artist_id, a.name as artist_name
      FROM track_artists ta JOIN artists a ON a.spotify_id = ta.artist_id
      WHERE ta.track_id IN (${placeholders})
      ORDER BY ta.track_id, ta.position
    `) as any[];
    for (const r of artistRows) {
      const meta = result.get(r.track_id);
      if (!meta) continue;
      meta.artists.push({ id: r.artist_id, name: r.artist_name });
      if (meta.artistId === null) { meta.artistId = r.artist_id; meta.artistName = r.artist_name; }
    }
  } else if (entityType === 'album') {
    const rows = db.all(sql`
      SELECT al.spotify_id as id, al.name, al.image_url,
             (SELECT a.name FROM tracks t2 JOIN track_artists ta2 ON ta2.track_id = t2.spotify_id AND ta2.position = 0
              JOIN artists a ON a.spotify_id = ta2.artist_id WHERE t2.album_id = al.spotify_id LIMIT 1) as artist_name,
             (SELECT ta2.artist_id FROM tracks t2 JOIN track_artists ta2 ON ta2.track_id = t2.spotify_id AND ta2.position = 0
              WHERE t2.album_id = al.spotify_id LIMIT 1) as artist_id
      FROM albums al WHERE al.spotify_id IN (${placeholders})
    `) as any[];
    for (const r of rows) result.set(r.id, { name: r.name, imageUrl: r.image_url, artistName: r.artist_name, artistId: r.artist_id, artists: r.artist_id ? [{ id: r.artist_id, name: r.artist_name }] : [] });
  } else {
    const rows = db.all(sql`SELECT spotify_id as id, name, image_url FROM artists WHERE spotify_id IN (${placeholders})`) as any[];
    for (const r of rows) result.set(r.id, { name: r.name, imageUrl: r.image_url, artistName: null, artistId: null, artists: [] });
  }

  return result;
}

// obtener chart completo con metadata y rank changes (sin historial — se carga async)
export function getChart(db: Db, entityType: EntityType, granularity: Granularity, weekStart: WeekStart, period: string, sort: Sort, userId: number, limit = CHART_SIZE, signal?: AbortSignal): ChartResponse {
  const aborted = () => signal?.aborted;
  const empty: ChartResponse = { period, entries: [], dropouts: [] };

  const current = getRawRanking(db, entityType, granularity, weekStart, period, sort, limit, userId);
  if (aborted()) return empty;

  // ranking del periodo anterior para rank changes
  const prev = prevPeriod(period, granularity);
  const prevMap = new Map<string, number>();
  if (prev) {
    const prevRows = getRawRanking(db, entityType, granularity, weekStart, prev, sort, CHART_SIZE, userId);
    prevRows.forEach((r, i) => prevMap.set(r.entity_id, i + 1));
  }
  if (aborted()) return empty;

  // IDs de dropouts
  const entityIds = current.map(r => r.entity_id);
  const currentSet = new Set(entityIds);
  const dropoutIds = prev
    ? [...prevMap.entries()].filter(([id]) => !currentSet.has(id)).sort((a, b) => a[1] - b[1])
    : [];
  const dIds = dropoutIds.map(([id]) => id);

  // batch fetch de metadata para entries + dropouts en una sola query
  const allIds = [...entityIds, ...dIds];
  const metaMap = fetchEntityMetadata(db, entityType, allIds);
  if (aborted()) return empty;

  // enriquecer entries (sin historial — peakRank/weeksOnChart se cargan async)
  const entries: ChartEntry[] = current.map((row, i) => {
    const rank = i + 1;
    const previousRank = prevMap.get(row.entity_id) ?? null;
    const rankChange = prev === null ? null : previousRank === null ? null : previousRank - rank;
    const notInPrev = prev !== null && previousRank === null;
    const meta = metaMap.get(row.entity_id);

    return { rank, entityId: row.entity_id, name: meta?.name ?? '', imageUrl: meta?.imageUrl ?? null, artistName: meta?.artistName ?? null, artistId: meta?.artistId ?? null, artists: meta?.artists ?? [], plays: row.plays, totalMs: row.total_ms, previousRank, rankChange, isNew: notInPrev, isReentry: false, peakRank: rank, peakPeriod: period, peakPeriods: [period], timesAtPeak: 1, weeksOnChart: 1, consecutiveWeeks: notInPrev ? 0 : 1 };
  });

  if (aborted()) return empty;

  // entidades que salieron del chart (sin historial)
  const dropouts: DropoutEntry[] = [];
  if (prev && dropoutIds.length > 0) {
    for (const [eid, prevRank] of dropoutIds) {
      const meta = metaMap.get(eid);
      dropouts.push({
        entityId: eid,
        name: meta?.name ?? '',
        imageUrl: meta?.imageUrl ?? null,
        artistName: meta?.artistName ?? null,
        artistId: meta?.artistId ?? null,
        artists: meta?.artists ?? [],
        previousRank: prevRank,
        peakRank: prevRank,
        peakPeriod: prev,
        weeksOnChart: 1,
      });
    }
  }

  return { period, entries, dropouts };
}

/** Peak stats de un set de entidades del chart (carga diferida). Recibe los
 *  entityIds del frontend para no repetir getRawRanking. Escanea por trozos de
 *  un año, del más reciente al más antiguo, cerrando entidades por el camino;
 *  el endpoint de streaming hace lo mismo pero emitiéndolas conforme se cierran. */
export function getChartPeaks(db: Db, entityType: EntityType, granularity: Granularity, weekStart: WeekStart, period: string, sort: Sort, userId: number, entityIds: string[]): Record<string, ChartPeakStats> {
  const result: Record<string, ChartPeakStats> = {};
  if (entityIds.length === 0) return result;

  const { slices, firstPeriods } = chartPeakSlices(db, entityType, granularity, weekStart, period, userId, entityIds);
  const acc = new ChartPeaksAccumulator(entityIds, firstPeriods, period, prevPeriod(period, granularity));

  slices.forEach((slice, i) => {
    if (acc.done) return;
    acc.addSlice(getChartRankSlice(db, entityType, granularity, weekStart, period, sort, userId, entityIds, slice.startAt, slice.endAt));
    for (const { entityId, ...stats } of acc.drain(slice.year, i === slices.length - 1)) result[entityId] = stats;
  });

  return result;
}

// listar periodos disponibles (que tienen datos)
export function getAvailablePeriods(db: Db, granularity: Granularity, weekStart: WeekStart, userId: number): string[] {
  const pExpr = periodExpr(granularity, weekStart);
  const uf = userFilter(userId);

  const rows = db.all(sql`
    SELECT DISTINCT ${pExpr} as period
    FROM listening_history lh
    WHERE 1=1 ${uf}
    ORDER BY period DESC
  `) as { period: string }[];

  return rows.map(r => r.period);
}

// --- historial de chart para una entidad individual ---

export function getEntityChartHistory(db: Db, entityType: EntityType, entityId: string, weekStart: WeekStart, sort: Sort, userId: number): ChartHistoryResponse {
  const pExpr = periodExpr('week', weekStart);
  const metric = sort === 'plays' ? sql`count(*)` : sql`sum(${playDuration()})`;
  const uf = userFilter(userId);
  const albumFilter = entityType === 'album' ? sql`AND t.album_id IS NOT NULL` : sql``;

  let myData: { period: string; val: number }[];
  let allScores: { period: string; eid: string; val: number }[];
  let firstPeriod: string;

  if (entityType === 'artist') {
    // dedupe por play — evita doble count con artists co-apareciendo en un track mergeado
    const mrJoin = entityMergeJoin('artist', userId);
    const metricDedup = sort === 'plays' ? sql`count(*)` : sql`sum(duration_ms)`;

    myData = db.all(sql`
      SELECT period, ${metricDedup} as val
      FROM (
        SELECT DISTINCT ${pExpr} as period, ${resolvedEntityId('artist', userId)} as entity_id, lh.id as play_id, lh.played_at as played_at, ${playDuration()} as duration_ms
        FROM listening_history lh
        JOIN tracks t ON t.spotify_id = lh.track_id
        JOIN track_artists ta ON ta.track_id = lh.track_id
        ${mrJoin}
        WHERE lh.user_id = ${userId} AND COALESCE(mr_artist.target_id, ta.artist_id) = ${entityId}
      )
      GROUP BY period
      ORDER BY period ASC
    `) as { period: string; val: number }[];

    if (myData.length === 0) {
      return { currentRank: null, currentPeriod: '', peakRank: 0, peakPeriod: '', peakPeriods: [], timesAtPeak: 0, weeksOnChart: 0, history: [] };
    }

    firstPeriod = myData[0].period;

    allScores = db.all(sql`
      SELECT period, eid, ${metricDedup} as val
      FROM (
        SELECT DISTINCT ${pExpr} as period, ${resolvedEntityId('artist', userId)} as eid, lh.id as play_id, ${playDuration()} as duration_ms
        FROM listening_history lh
        JOIN tracks t ON t.spotify_id = lh.track_id
        JOIN track_artists ta ON ta.track_id = lh.track_id
        ${mrJoin}
        WHERE lh.user_id = ${userId}
      )
      GROUP BY period, eid
      HAVING period >= ${firstPeriod}
    `) as { period: string; eid: string; val: number }[];
  } else {
    let groupCol: ReturnType<typeof sql>;
    let joinClause: ReturnType<typeof sql>;
    let entityFilter: ReturnType<typeof sql>;
    if (entityType === 'track') {
      groupCol = resolvedEntityId('track', userId);
      joinClause = entityMergeJoin('track', userId);
      entityFilter = sql`AND COALESCE(mr_track.target_id, lh.track_id) = ${entityId}`;
    } else {
      // album
      groupCol = resolvedEntityId('album', userId);
      joinClause = entityMergeJoin('album', userId);
      entityFilter = sql`AND COALESCE(mr_album.target_id, t.album_id) = ${entityId}`;
    }

    myData = db.all(sql`
      SELECT ${pExpr} as period, ${metric} as val
      FROM listening_history lh
      JOIN tracks t ON t.spotify_id = lh.track_id
      ${joinClause}
      WHERE 1=1 ${uf} ${entityFilter} ${albumFilter}
      GROUP BY period
      ORDER BY period ASC
    `) as { period: string; val: number }[];

    if (myData.length === 0) {
      return { currentRank: null, currentPeriod: '', peakRank: 0, peakPeriod: '', peakPeriods: [], timesAtPeak: 0, weeksOnChart: 0, history: [] };
    }

    firstPeriod = myData[0].period;

    allScores = db.all(sql`
      SELECT ${pExpr} as period, ${groupCol} as eid, ${metric} as val
      FROM listening_history lh
      JOIN tracks t ON t.spotify_id = lh.track_id
      ${joinClause}
      WHERE 1=1 ${uf} ${albumFilter}
      GROUP BY period, eid
      HAVING period >= ${firstPeriod}
    `) as { period: string; eid: string; val: number }[];
  }

  const myScoreMap = new Map(myData.map(s => [s.period, s.val]));
  const periodSet = new Set(myData.map(s => s.period));

  // agrupar por periodo y calcular rank (solo periodos donde el target tiene plays)
  const scoresByPeriod = new Map<string, { eid: string; val: number }[]>();
  for (const row of allScores) {
    if (!periodSet.has(row.period)) continue; // descartar periodos irrelevantes
    if (!scoresByPeriod.has(row.period)) scoresByPeriod.set(row.period, []);
    scoresByPeriod.get(row.period)!.push(row);
  }

  const rows: { period: string; rank: number }[] = [];
  for (const { period } of myData) {
    const myVal = myScoreMap.get(period)!;
    const periodScores = scoresByPeriod.get(period) ?? [];
    let higher = 0;
    for (const s of periodScores) {
      if (s.val > myVal) higher++;
    }
    const rank = higher + 1;
    if (rank <= CHART_SIZE) {
      rows.push({ period, rank });
    }
  }

  if (rows.length === 0) {
    return { currentRank: null, currentPeriod: '', peakRank: 0, peakPeriod: '', peakPeriods: [], timesAtPeak: 0, weeksOnChart: 0, history: [] };
  }

  // determinar periodo actual (no cerrado)
  const latestPeriod = db.all(sql`
    SELECT ${pExpr} as period FROM listening_history lh WHERE 1=1 ${uf} ORDER BY lh.played_at DESC LIMIT 1
  `)[0] as { period: string } | undefined;

  const lastRow = rows[rows.length - 1];
  const currentRank = latestPeriod && lastRow.period === latestPeriod.period ? lastRow.rank : null;

  // excluir semana actual (no cerrada) de peaks y weeksOnChart
  const closedRows = latestPeriod ? rows.filter(r => r.period !== latestPeriod.period) : rows;

  let peakRank = 0;
  let peakPeriod = '';
  let peakPeriods: string[] = [];
  let timesAtPeak = 0;

  if (closedRows.length > 0) {
    peakRank = closedRows[0].rank;
    peakPeriod = closedRows[0].period;
    for (const r of closedRows) {
      if (r.rank < peakRank) {
        peakRank = r.rank;
        peakPeriod = r.period;
      }
    }
    peakPeriods = closedRows.filter(r => r.rank === peakRank).map(r => r.period);
    timesAtPeak = peakPeriods.length;
  }

  // llenar gaps entre primer y último periodo
  const firstOnChart = rows[0].period;
  const lastPeriod = latestPeriod?.period ?? lastRow.period;

  const allPeriods = db.all(sql`
    SELECT DISTINCT ${pExpr} as period FROM listening_history lh
    WHERE 1=1 ${uf} AND ${pExpr} >= ${firstPeriod}
    ORDER BY period ASC
  `) as { period: string }[];

  const rankMap = new Map(rows.map(r => [r.period, r.rank]));
  const fullHistory: { period: string; rank: number | null }[] = [];
  let inRange = false;
  for (const p of allPeriods) {
    if (p.period === firstOnChart) inRange = true;
    if (inRange) fullHistory.push({ period: p.period, rank: rankMap.get(p.period) ?? null });
    if (p.period === lastPeriod) break;
  }

  return {
    currentRank,
    currentPeriod: latestPeriod?.period ?? lastRow.period,
    peakRank,
    peakPeriod,
    peakPeriods,
    timesAtPeak,
    weeksOnChart: currentRank != null ? closedRows.length + 1 : closedRows.length,
    history: fullHistory,
  };
}
