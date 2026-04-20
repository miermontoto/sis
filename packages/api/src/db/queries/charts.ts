import { sql } from 'drizzle-orm';
import type { Db } from './helpers.js';
import type { ChartEntry, DropoutEntry, ChartResponse, ChartHistoryResponse, RankingMetric, WeekStartOption, Granularity, EntityType } from '@sis/shared';
import { resolvedAlbumId, mergeRulesJoin, userFilter } from './helpers.js';
import { CHART_SIZE } from '../../constants.js';

type Sort = RankingMetric;
type WeekStart = WeekStartOption;

// expresión de periodo según granularidad
function periodExpr(granularity: Granularity, weekStart: WeekStart) {
  if (granularity === 'week') {
    if (weekStart === 'monday') return sql`strftime('%Y-W%W', lh.played_at)`;
    if (weekStart === 'sunday') return sql`strftime('%Y-W%W', lh.played_at, '-1 day')`;
    return sql`strftime('%Y-W%W', lh.played_at, '-4 days')`;
  }
  if (granularity === 'month') return sql`strftime('%Y-%m', lh.played_at)`;
  return sql`strftime('%Y', lh.played_at)`;
}

// periodo anterior (para rank changes)
function prevPeriod(period: string, granularity: Granularity): string | null {
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
function getRawRanking(db: Db, entityType: EntityType, granularity: Granularity, weekStart: WeekStart, period: string, sort: Sort, limit: number, userId: number) {
  const pExpr = periodExpr(granularity, weekStart);
  const metric = sort === 'plays' ? sql`count(*)` : sql`sum(t.duration_ms)`;
  const uf = userFilter(userId);

  let groupCol, joinClause;
  if (entityType === 'track') {
    groupCol = sql`lh.track_id`;
    joinClause = sql``;
  } else if (entityType === 'album') {
    groupCol = resolvedAlbumId(userId);
    joinClause = mergeRulesJoin(userId);
  } else {
    groupCol = sql`ta.artist_id`;
    joinClause = sql`JOIN track_artists ta ON ta.track_id = lh.track_id`;
  }

  return db.all(sql`
    SELECT ${groupCol} as entity_id, count(*) as plays, sum(t.duration_ms) as total_ms
    FROM listening_history lh
    JOIN tracks t ON t.spotify_id = lh.track_id
    ${joinClause}
    WHERE ${pExpr} = ${period} ${uf}
    ${entityType === 'album' ? sql`AND t.album_id IS NOT NULL` : sql``}
    GROUP BY entity_id
    ORDER BY ${metric} DESC
    LIMIT ${limit}
  `) as { entity_id: string; plays: number; total_ms: number }[];
}

// historial de chart para un conjunto de entidades hasta el periodo actual.
// Optimizado: en vez de ROW_NUMBER() sobre toda la tabla, obtiene scores de las entidades
// objetivo por periodo, luego cuenta cuántas entidades las superan por periodo.
function getChartHistory(db: Db, entityType: EntityType, granularity: Granularity, weekStart: WeekStart, sort: Sort, entityIds: string[], currentPeriod: string, userId: number): Map<string, { peakRank: number; peakPeriod: string; peakPeriods: string[]; timesAtPeak: number; weeksOnChart: number; consecutiveWeeks: number }> {
  if (entityIds.length === 0) return new Map();

  const pExpr = periodExpr(granularity, weekStart);
  const metric = sort === 'plays' ? sql`count(*)` : sql`sum(t.duration_ms)`;
  const uf = userFilter(userId);
  const albumFilter = entityType === 'album' ? sql`AND t.album_id IS NOT NULL` : sql``;

  let groupCol, joinClause, entityInFilter;
  if (entityType === 'track') {
    groupCol = sql`lh.track_id`;
    joinClause = sql``;
    entityInFilter = sql`AND lh.track_id IN (${sql.join(entityIds.map(id => sql`${id}`), sql`, `)})`;
  } else if (entityType === 'album') {
    groupCol = resolvedAlbumId(userId);
    joinClause = mergeRulesJoin(userId);
    entityInFilter = sql`AND COALESCE(mr_album.target_id, t.album_id) IN (${sql.join(entityIds.map(id => sql`${id}`), sql`, `)})`;
  } else {
    groupCol = sql`ta.artist_id`;
    joinClause = sql`JOIN track_artists ta ON ta.track_id = lh.track_id`;
    entityInFilter = sql`AND ta.artist_id IN (${sql.join(entityIds.map(id => sql`${id}`), sql`, `)})`;
  }

  // paso 1: scores de las entidades objetivo por periodo (rápido — filtrado por entity IDs)
  const targetScores = db.all(sql`
    SELECT ${pExpr} as period, ${groupCol} as entity_id, ${metric} as val
    FROM listening_history lh
    JOIN tracks t ON t.spotify_id = lh.track_id
    ${joinClause}
    WHERE 1=1 ${uf} ${entityInFilter} ${albumFilter}
    GROUP BY period, entity_id
    HAVING period <= ${currentPeriod}
    ORDER BY period
  `) as { period: string; entity_id: string; val: number }[];

  if (targetScores.length === 0) return new Map();

  // paso 2: una sola query con ROW_NUMBER acotada al rango de fechas de los targets
  // — mucho más rápido que N queries por periodo o que materializar toda la historia
  const dateRange = db.all(sql`
    SELECT min(lh.played_at) as min_date
    FROM listening_history lh
    JOIN tracks t ON t.spotify_id = lh.track_id
    ${joinClause}
    WHERE 1=1 ${uf} ${entityInFilter} ${albumFilter}
  `)[0] as { min_date: string } | undefined;

  const rankedRows = db.all(sql`
    SELECT period, entity_id, rank FROM (
      SELECT ${pExpr} as period, ${groupCol} as entity_id,
             ROW_NUMBER() OVER (PARTITION BY ${pExpr} ORDER BY ${metric} DESC) as rank
      FROM listening_history lh
      JOIN tracks t ON t.spotify_id = lh.track_id
      ${joinClause}
      WHERE lh.played_at >= ${dateRange?.min_date ?? '1970-01-01'} ${uf} ${albumFilter}
      GROUP BY period, entity_id
      HAVING period <= ${currentPeriod}
    )
    WHERE rank <= ${CHART_SIZE}
  `) as { period: string; entity_id: string; rank: number }[];

  // indexar por (entity_id, period)
  const idSet = new Set(entityIds);
  const entityPeriodSets = new Map<string, Set<string>>();
  const result = new Map<string, { peakRank: number; peakPeriod: string; peakPeriods: string[]; timesAtPeak: number; weeksOnChart: number; consecutiveWeeks: number }>();

  for (const row of rankedRows) {
    if (!idSet.has(row.entity_id)) continue;

    if (!entityPeriodSets.has(row.entity_id)) entityPeriodSets.set(row.entity_id, new Set());
    entityPeriodSets.get(row.entity_id)!.add(row.period);

    const existing = result.get(row.entity_id);
    if (!existing) {
      result.set(row.entity_id, { peakRank: row.rank, peakPeriod: row.period, peakPeriods: [row.period], timesAtPeak: 1, weeksOnChart: 1, consecutiveWeeks: 0 });
    } else {
      existing.weeksOnChart++;
      if (row.rank < existing.peakRank) {
        existing.peakRank = row.rank;
        existing.peakPeriod = row.period;
        existing.peakPeriods = [row.period];
        existing.timesAtPeak = 1;
      } else if (row.rank === existing.peakRank) {
        existing.timesAtPeak++;
        existing.peakPeriods.push(row.period);
      }
    }
  }

  // calcular racha consecutiva hacia atrás desde el periodo actual
  const allPeriodLabels = [...new Set(rankedRows.map(r => r.period))].sort();
  const currentIdx = allPeriodLabels.indexOf(currentPeriod);
  for (const [eid, periodsSet] of entityPeriodSets) {
    const entry = result.get(eid);
    if (!entry || currentIdx < 0) continue;
    let consecutive = 0;
    for (let i = currentIdx; i >= 0; i--) {
      if (periodsSet.has(allPeriodLabels[i])) consecutive++;
      else break;
    }
    entry.consecutiveWeeks = consecutive;
  }

  return result;
}

// batch fetch de metadata para un conjunto de entidades (reemplaza N+1 queries individuales)
interface EntityMeta { name: string; imageUrl: string | null; artistName: string | null; artistId: string | null; }

function fetchEntityMetadata(db: Db, entityType: EntityType, ids: string[]): Map<string, EntityMeta> {
  const result = new Map<string, EntityMeta>();
  if (ids.length === 0) return result;

  const placeholders = sql.join(ids.map(id => sql`${id}`), sql`, `);

  if (entityType === 'track') {
    const rows = db.all(sql`
      SELECT t.spotify_id as id, t.name, al.image_url,
             (SELECT a.name FROM track_artists ta2 JOIN artists a ON a.spotify_id = ta2.artist_id
              WHERE ta2.track_id = t.spotify_id AND ta2.position = 0 LIMIT 1) as artist_name,
             (SELECT ta2.artist_id FROM track_artists ta2
              WHERE ta2.track_id = t.spotify_id AND ta2.position = 0 LIMIT 1) as artist_id
      FROM tracks t LEFT JOIN albums al ON al.spotify_id = t.album_id
      WHERE t.spotify_id IN (${placeholders})
    `) as any[];
    for (const r of rows) result.set(r.id, { name: r.name, imageUrl: r.image_url, artistName: r.artist_name, artistId: r.artist_id });
  } else if (entityType === 'album') {
    const rows = db.all(sql`
      SELECT al.spotify_id as id, al.name, al.image_url,
             (SELECT a.name FROM tracks t2 JOIN track_artists ta2 ON ta2.track_id = t2.spotify_id AND ta2.position = 0
              JOIN artists a ON a.spotify_id = ta2.artist_id WHERE t2.album_id = al.spotify_id LIMIT 1) as artist_name,
             (SELECT ta2.artist_id FROM tracks t2 JOIN track_artists ta2 ON ta2.track_id = t2.spotify_id AND ta2.position = 0
              WHERE t2.album_id = al.spotify_id LIMIT 1) as artist_id
      FROM albums al WHERE al.spotify_id IN (${placeholders})
    `) as any[];
    for (const r of rows) result.set(r.id, { name: r.name, imageUrl: r.image_url, artistName: r.artist_name, artistId: r.artist_id });
  } else {
    const rows = db.all(sql`SELECT spotify_id as id, name, image_url FROM artists WHERE spotify_id IN (${placeholders})`) as any[];
    for (const r of rows) result.set(r.id, { name: r.name, imageUrl: r.image_url, artistName: null, artistId: null });
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

    return { rank, entityId: row.entity_id, name: meta?.name ?? '', imageUrl: meta?.imageUrl ?? null, artistName: meta?.artistName ?? null, artistId: meta?.artistId ?? null, plays: row.plays, totalMs: row.total_ms, previousRank, rankChange, isNew: notInPrev, isReentry: false, peakRank: rank, peakPeriod: period, peakPeriods: [period], timesAtPeak: 1, weeksOnChart: 1, consecutiveWeeks: notInPrev ? 0 : 1 };
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
        previousRank: prevRank,
        peakRank: prevRank,
        peakPeriod: prev,
        weeksOnChart: 1,
      });
    }
  }

  return { period, entries, dropouts };
}

/** Obtener peak stats para un set de entidades en el chart (carga diferida).
 *  Recibe entityIds del frontend para no repetir getRawRanking. */
export function getChartPeaks(db: Db, entityType: EntityType, granularity: Granularity, weekStart: WeekStart, period: string, sort: Sort, userId: number, entityIds: string[]): Record<string, { peakRank: number; peakPeriod: string; peakPeriods: string[]; timesAtPeak: number; weeksOnChart: number; consecutiveWeeks: number; isReentry: boolean }> {
  const history = getChartHistory(db, entityType, granularity, weekStart, sort, entityIds, period, userId);

  const prev = prevPeriod(period, granularity);
  const prevSet = new Set<string>();
  if (prev) {
    const prevRows = getRawRanking(db, entityType, granularity, weekStart, prev, sort, CHART_SIZE, userId);
    prevRows.forEach(r => prevSet.add(r.entity_id));
  }

  const result: Record<string, { peakRank: number; peakPeriod: string; peakPeriods: string[]; timesAtPeak: number; weeksOnChart: number; consecutiveWeeks: number; isReentry: boolean }> = {};

  for (const id of entityIds) {
    const hist = history.get(id);
    const notInPrev = prev !== null && !prevSet.has(id);
    result[id] = {
      peakRank: hist?.peakRank ?? 1,
      peakPeriod: hist?.peakPeriod ?? period,
      peakPeriods: hist?.peakPeriods ?? [period],
      timesAtPeak: hist?.timesAtPeak ?? 1,
      weeksOnChart: hist?.weeksOnChart ?? 1,
      consecutiveWeeks: hist?.consecutiveWeeks ?? (notInPrev ? 0 : 1),
      isReentry: notInPrev && (hist?.weeksOnChart ?? 0) > 1,
    };
  }

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
  const metric = sort === 'plays' ? sql`count(*)` : sql`sum(t.duration_ms)`;
  const uf = userFilter(userId);
  const albumFilter = entityType === 'album' ? sql`AND t.album_id IS NOT NULL` : sql``;

  let groupCol, joinClause, entityFilter;
  if (entityType === 'track') {
    groupCol = sql`lh.track_id`;
    joinClause = sql``;
    entityFilter = sql`AND lh.track_id = ${entityId}`;
  } else if (entityType === 'album') {
    groupCol = resolvedAlbumId(userId);
    joinClause = mergeRulesJoin(userId);
    entityFilter = sql`AND COALESCE(mr_album.target_id, t.album_id) = ${entityId}`;
  } else {
    groupCol = sql`ta.artist_id`;
    joinClause = sql`JOIN track_artists ta ON ta.track_id = lh.track_id`;
    entityFilter = sql`AND ta.artist_id = ${entityId}`;
  }

  // paso 1: score del target por periodo + rango de fechas para acotar el scan global
  const myData = db.all(sql`
    SELECT ${pExpr} as period, ${metric} as val, min(lh.played_at) as min_date, max(lh.played_at) as max_date
    FROM listening_history lh
    JOIN tracks t ON t.spotify_id = lh.track_id
    ${joinClause}
    WHERE 1=1 ${uf} ${entityFilter} ${albumFilter}
    GROUP BY period
    ORDER BY period ASC
  `) as { period: string; val: number; min_date: string; max_date: string }[];

  if (myData.length === 0) {
    return { currentRank: null, currentPeriod: '', peakRank: 0, peakPeriod: '', peakPeriods: [], timesAtPeak: 0, weeksOnChart: 0, history: [] };
  }

  const myScoreMap = new Map(myData.map(s => [s.period, s.val]));
  const periodSet = new Set(myData.map(s => s.period));

  // fecha mínima de la entidad — acotar el scan global (no upper bound: el periodo actual puede tener plays posteriores)
  const dateMin = myData[0].min_date;

  // paso 2: obtener scores de todas las entidades desde dateMin (usa índice played_at)
  const allScores = db.all(sql`
    SELECT ${pExpr} as period, ${groupCol} as eid, ${metric} as val
    FROM listening_history lh
    JOIN tracks t ON t.spotify_id = lh.track_id
    ${joinClause}
    WHERE lh.played_at >= ${dateMin} ${uf} ${albumFilter}
    GROUP BY period, eid
  `) as { period: string; eid: string; val: number }[];

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

  const lastRow = rows[rows.length - 1];
  let peakRank = rows[0].rank;
  let peakPeriod = rows[0].period;
  for (const r of rows) {
    if (r.rank < peakRank) {
      peakRank = r.rank;
      peakPeriod = r.period;
    }
  }
  const peakPeriods = rows.filter(r => r.rank === peakRank).map(r => r.period);
  const timesAtPeak = peakPeriods.length;

  // determinar si está en el chart actual
  const latestPeriod = db.all(sql`
    SELECT ${pExpr} as period FROM listening_history lh WHERE 1=1 ${uf} ORDER BY lh.played_at DESC LIMIT 1
  `)[0] as { period: string } | undefined;

  const currentRank = latestPeriod && lastRow.period === latestPeriod.period ? lastRow.rank : null;

  // llenar gaps entre primer y último periodo
  const firstPeriod = rows[0].period;
  const lastPeriod = latestPeriod?.period ?? lastRow.period;

  const allPeriods = db.all(sql`
    SELECT DISTINCT ${pExpr} as period FROM listening_history lh
    WHERE lh.played_at >= ${dateMin} ${uf}
    ORDER BY period ASC
  `) as { period: string }[];

  const rankMap = new Map(rows.map(r => [r.period, r.rank]));
  const fullHistory: { period: string; rank: number | null }[] = [];
  let inRange = false;
  for (const p of allPeriods) {
    if (p.period === firstPeriod) inRange = true;
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
    weeksOnChart: rows.length,
    history: fullHistory,
  };
}
