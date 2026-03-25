import { sql } from 'drizzle-orm';
import type { Db, EntityType, Sort, StatsRow, AggregateRow, SeriesRow, RecentPlayRow, SqlChunk } from './helpers.js';
import { entityJoins, entityGroupCol, entityWhereCol, rangeWhere, rangeWhereClause, orderByCol, getDateTrunc } from './helpers.js';
import type { TimeRange } from '../../constants.js';

/** Stats agregados (play_count, total_ms, first/last_played) para cualquier entidad */
export function getEntityStats(db: Db, entityType: EntityType, entityId: string, rangeStart: string | null): StatsRow {
  const join = entityJoins(entityType);
  const where = entityWhereCol(entityType, entityId);
  const wr = rangeWhere(rangeStart);

  return db.all(sql`
    SELECT count(*) as play_count, coalesce(sum(t.duration_ms), 0) as total_ms,
           min(lh.played_at) as first_played, max(lh.played_at) as last_played
    FROM listening_history lh
    ${join}
    JOIN tracks t ON t.spotify_id = lh.track_id
    WHERE ${where} ${wr}
  `)[0] as StatsRow;
}

/** Top entidades con agregados de reproducciones */
export function getTopEntities(db: Db, entityType: EntityType, rangeStart: string | null, sort: Sort, limit: number): AggregateRow[] {
  const join = entityJoins(entityType);
  const groupCol = entityGroupCol(entityType);
  const wc = rangeWhereClause(rangeStart);
  const ob = orderByCol(sort);
  const having = entityType === 'album' ? sql`HAVING t.album_id IS NOT NULL` : sql``;

  return db.all(sql`
    SELECT ${groupCol} as entity_id, count(*) as play_count, sum(t.duration_ms) as total_ms
    FROM listening_history lh
    ${join}
    JOIN tracks t ON t.spotify_id = lh.track_id
    ${wc}
    GROUP BY entity_id
    ${having}
    ORDER BY ${ob} DESC
    LIMIT ${limit}
  `) as AggregateRow[];
}

/** Top entidades del periodo anterior (para calcular rank changes) */
export function getPrevPeriodEntities(db: Db, entityType: EntityType, prevStart: string, prevEnd: string, sort: Sort): AggregateRow[] {
  const join = entityJoins(entityType);
  const groupCol = entityGroupCol(entityType);
  const ob = orderByCol(sort);
  const having = entityType === 'album' ? sql`HAVING t.album_id IS NOT NULL` : sql``;

  return db.all(sql`
    SELECT ${groupCol} as entity_id, count(*) as play_count, sum(t.duration_ms) as total_ms
    FROM listening_history lh
    ${join}
    JOIN tracks t ON t.spotify_id = lh.track_id
    WHERE lh.played_at >= ${prevStart} AND lh.played_at < ${prevEnd}
    GROUP BY entity_id
    ${having}
    ORDER BY ${ob} DESC
    LIMIT 200
  `) as AggregateRow[];
}

/** Serie temporal con granularidad automática según rango */
export function getEntitySeries(db: Db, entityType: EntityType, entityId: string, rangeStart: string | null, range: TimeRange): SeriesRow[] {
  const join = entityJoins(entityType);
  const where = entityWhereCol(entityType, entityId);
  const wr = rangeWhere(rangeStart);
  const dateTrunc = getDateTrunc(range);

  return db.all(sql`
    SELECT ${dateTrunc} as period, count(*) as play_count, sum(t.duration_ms) as total_ms
    FROM listening_history lh
    ${join}
    JOIN tracks t ON t.spotify_id = lh.track_id
    WHERE ${where} ${wr}
    GROUP BY period
    ORDER BY period ASC
  `) as SeriesRow[];
}

/** Serie temporal global (sin filtro de entidad, para /listening-time) */
export function getGlobalSeries(db: Db, rangeStart: string | null, granularity: string): SeriesRow[] {
  const wc = rangeWhereClause(rangeStart);
  const dateTrunc = granularity === 'month'
    ? sql`strftime('%Y-%m', lh.played_at)`
    : granularity === 'week'
    ? sql`strftime('%Y-W%W', lh.played_at)`
    : sql`date(lh.played_at)`;

  return db.all(sql`
    SELECT ${dateTrunc} as period, count(*) as play_count, sum(t.duration_ms) as total_ms
    FROM listening_history lh
    JOIN tracks t ON t.spotify_id = lh.track_id
    ${wc}
    GROUP BY period
    ORDER BY period ASC
  `) as SeriesRow[];
}

/** Reproducciones recientes para una entidad */
export function getRecentPlays(db: Db, entityType: EntityType, entityId: string, limit: number): RecentPlayRow[] {
  const join = entityJoins(entityType);

  if (entityType === 'album') {
    return db.all(sql`
      SELECT lh.id, lh.played_at, lh.track_id
      FROM listening_history lh
      JOIN tracks t ON t.spotify_id = lh.track_id
      WHERE t.album_id = ${entityId}
      ORDER BY lh.played_at DESC
      LIMIT ${limit}
    `) as RecentPlayRow[];
  }

  const where = entityType === 'artist'
    ? sql`ta.artist_id = ${entityId}`
    : sql`lh.track_id = ${entityId}`;

  return db.all(sql`
    SELECT lh.id, lh.played_at, lh.track_id
    FROM listening_history lh
    ${join}
    WHERE ${where}
    ORDER BY lh.played_at DESC
    LIMIT ${limit}
  `) as RecentPlayRow[];
}
