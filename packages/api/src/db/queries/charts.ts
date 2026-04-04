import { sql } from 'drizzle-orm';
import type { Db } from './helpers.js';
import type { ChartEntry, DropoutEntry, ChartResponse, ChartHistoryResponse } from '@sis/shared';
import { resolvedAlbumId, mergeRulesJoin, userFilter } from './helpers.js';
import { CHART_SIZE } from '../../constants.js';

type Sort = 'plays' | 'time';
type WeekStart = 'monday' | 'sunday' | 'friday';
type Granularity = 'week' | 'month' | 'year';
type EntityType = 'tracks' | 'albums' | 'artists';

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
  if (entityType === 'tracks') {
    groupCol = sql`lh.track_id`;
    joinClause = sql``;
  } else if (entityType === 'albums') {
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
    ${entityType === 'albums' ? sql`AND t.album_id IS NOT NULL` : sql``}
    GROUP BY entity_id
    ORDER BY ${metric} DESC
    LIMIT ${limit}
  `) as { entity_id: string; plays: number; total_ms: number }[];
}

// historial de chart para un conjunto de entidades hasta el periodo actual
function getChartHistory(db: Db, entityType: EntityType, granularity: Granularity, weekStart: WeekStart, sort: Sort, entityIds: string[], currentPeriod: string, userId: number): Map<string, { peakRank: number; peakPeriod: string; peakPeriods: string[]; timesAtPeak: number; weeksOnChart: number; consecutiveWeeks: number }> {
  if (entityIds.length === 0) return new Map();

  const pExpr = periodExpr(granularity, weekStart);
  const metric = sort === 'plays' ? sql`count(*)` : sql`sum(t.duration_ms)`;
  const uf = userFilter(userId);

  let groupCol, joinClause;
  if (entityType === 'tracks') {
    groupCol = sql`lh.track_id`;
    joinClause = sql``;
  } else if (entityType === 'albums') {
    groupCol = resolvedAlbumId(userId);
    joinClause = mergeRulesJoin(userId);
  } else {
    groupCol = sql`ta.artist_id`;
    joinClause = sql`JOIN track_artists ta ON ta.track_id = lh.track_id`;
  }

  // obtener apariciones con ranking, solo hasta el periodo actual
  const allPeriods = db.all(sql`
    SELECT period, entity_id, rank FROM (
      SELECT ${pExpr} as period, ${groupCol} as entity_id,
             ROW_NUMBER() OVER (PARTITION BY ${pExpr} ORDER BY ${metric} DESC) as rank
      FROM listening_history lh
      JOIN tracks t ON t.spotify_id = lh.track_id
      ${joinClause}
      WHERE 1=1 ${uf}
      ${entityType === 'albums' ? sql`AND t.album_id IS NOT NULL` : sql``}
      GROUP BY period, entity_id
      HAVING period <= ${currentPeriod}
    )
    WHERE rank <= ${CHART_SIZE}
  `) as { period: string; entity_id: string; rank: number }[];

  // obtener lista de periodos ordenados para calcular consecutivos
  const allPeriodLabels = [...new Set(allPeriods.map(r => r.period))].sort();

  const idSet = new Set(entityIds);
  // por entidad: set de periodos en que aparece
  const entityPeriodSets = new Map<string, Set<string>>();
  const result = new Map<string, { peakRank: number; peakPeriod: string; peakPeriods: string[]; timesAtPeak: number; weeksOnChart: number; consecutiveWeeks: number }>();

  for (const row of allPeriods) {
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

  if (entityType === 'tracks') {
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
  } else if (entityType === 'albums') {
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

// obtener chart completo con metadata, rank changes, y stats de historial
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

  // historial de chart para las entidades actuales
  const entityIds = current.map(r => r.entity_id);
  const history = getChartHistory(db, entityType, granularity, weekStart, sort, entityIds, period, userId);
  if (aborted()) return empty;

  // IDs de dropouts
  const currentSet = new Set(entityIds);
  const dropoutIds = prev
    ? [...prevMap.entries()].filter(([id]) => !currentSet.has(id)).sort((a, b) => a[1] - b[1])
    : [];
  const dIds = dropoutIds.map(([id]) => id);

  // batch fetch de metadata para entries + dropouts en una sola query
  const allIds = [...entityIds, ...dIds];
  const metaMap = fetchEntityMetadata(db, entityType, allIds);
  if (aborted()) return empty;

  // enriquecer entries
  const entries: ChartEntry[] = current.map((row, i) => {
    const rank = i + 1;
    const previousRank = prevMap.get(row.entity_id) ?? null;
    const rankChange = prev === null ? null : previousRank === null ? null : previousRank - rank;
    const hist = history.get(row.entity_id);
    const peakRank = hist?.peakRank ?? rank;
    const peakPeriod = hist?.peakPeriod ?? period;
    const peakPeriods = hist?.peakPeriods ?? [period];
    const timesAtPeak = hist?.timesAtPeak ?? 1;
    const weeksOnChart = hist?.weeksOnChart ?? 1;
    const consecutiveWeeks = hist?.consecutiveWeeks ?? 1;
    const notInPrev = prev !== null && previousRank === null;
    const isNew = notInPrev && weeksOnChart <= 1;
    const isReentry = notInPrev && weeksOnChart > 1;
    const meta = metaMap.get(row.entity_id);

    return { rank, entityId: row.entity_id, name: meta?.name ?? '', imageUrl: meta?.imageUrl ?? null, artistName: meta?.artistName ?? null, artistId: meta?.artistId ?? null, plays: row.plays, totalMs: row.total_ms, previousRank, rankChange, isNew, isReentry, peakRank, peakPeriod, peakPeriods, timesAtPeak, weeksOnChart, consecutiveWeeks };
  });

  if (aborted()) return empty;

  // entidades que salieron del chart
  const dropouts: DropoutEntry[] = [];
  if (prev && dropoutIds.length > 0) {
    const dropoutHistory = getChartHistory(db, entityType, granularity, weekStart, sort, dIds, prev, userId);

    for (const [eid, prevRank] of dropoutIds) {
      const meta = metaMap.get(eid);
      const hist = dropoutHistory.get(eid);
      dropouts.push({
        entityId: eid,
        name: meta?.name ?? '',
        imageUrl: meta?.imageUrl ?? null,
        artistName: meta?.artistName ?? null,
        artistId: meta?.artistId ?? null,
        previousRank: prevRank,
        peakRank: hist?.peakRank ?? prevRank,
        peakPeriod: hist?.peakPeriod ?? prev,
        weeksOnChart: hist?.weeksOnChart ?? 1,
      });
    }
  }

  return { period, entries, dropouts };
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

  let groupCol, joinClause;
  if (entityType === 'tracks') {
    groupCol = sql`lh.track_id`;
    joinClause = sql``;
  } else if (entityType === 'albums') {
    groupCol = resolvedAlbumId(userId);
    joinClause = mergeRulesJoin(userId);
  } else {
    groupCol = sql`ta.artist_id`;
    joinClause = sql`JOIN track_artists ta ON ta.track_id = lh.track_id`;
  }

  // obtener todos los periodos con ranking para esta entidad
  const rows = db.all(sql`
    SELECT period, rank FROM (
      SELECT ${pExpr} as period, ${groupCol} as eid,
             ROW_NUMBER() OVER (PARTITION BY ${pExpr} ORDER BY ${metric} DESC) as rank
      FROM listening_history lh
      JOIN tracks t ON t.spotify_id = lh.track_id
      ${joinClause}
      WHERE 1=1 ${uf}
      ${entityType === 'albums' ? sql`AND t.album_id IS NOT NULL` : sql``}
      GROUP BY period, eid
    )
    WHERE eid = ${entityId} AND rank <= ${CHART_SIZE}
    ORDER BY period ASC
  `) as { period: string; rank: number }[];

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

  // determinar si está en el chart actual (último periodo con datos en el sistema)
  const latestPeriod = db.all(sql`
    SELECT ${pExpr} as period FROM listening_history lh WHERE 1=1 ${uf} ORDER BY lh.played_at DESC LIMIT 1
  `)[0] as { period: string } | undefined;

  const currentRank = latestPeriod && lastRow.period === latestPeriod.period ? lastRow.rank : null;

  // obtener todos los periodos del sistema entre el primero y último del entity para llenar gaps
  const allPeriods = db.all(sql`
    SELECT DISTINCT ${pExpr} as period FROM listening_history lh
    WHERE 1=1 ${uf}
    ORDER BY period ASC
  `) as { period: string }[];

  const firstPeriod = rows[0].period;
  const lastPeriod = latestPeriod?.period ?? lastRow.period;
  const rankMap = new Map(rows.map(r => [r.period, r.rank]));

  const fullHistory: { period: string; rank: number | null }[] = [];
  let inRange = false;
  for (const p of allPeriods) {
    if (p.period === firstPeriod) inRange = true;
    if (inRange) {
      fullHistory.push({ period: p.period, rank: rankMap.get(p.period) ?? null });
    }
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
