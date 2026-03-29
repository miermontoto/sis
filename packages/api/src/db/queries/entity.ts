import { sql } from 'drizzle-orm';
import type { Db, EntityType, Sort, StatsRow, AggregateRow, SeriesRow, RecentPlayRow, SqlChunk } from './helpers.js';
import { entityJoins, entityGroupCol, entityWhereCol, rangeWhere, rangeWhereClause, orderByCol, getDateTrunc, getDateTruncForDays, mergeRulesJoin, userFilter } from './helpers.js';
import type { TimeRange } from '../../constants.js';

// helper: construir IN (...) con IDs literales
function inList(ids: string[], tableAlias = 't') {
  const col = sql.raw(`${tableAlias}.album_id`);
  if (ids.length === 1) return sql`${col} = ${ids[0]}`;
  const placeholders = sql.join(ids.map(id => sql`${id}`), sql`, `);
  return sql`${col} IN (${placeholders})`;
}

/** Stats agregados para cualquier entidad. Para álbumes, pasar albumIds pre-resueltos. */
export function getEntityStats(db: Db, entityType: EntityType, entityId: string, rangeStart: string | null, rangeEnd: string | null | undefined, albumIds: string[] | undefined, userId: number): StatsRow {
  const join = entityJoins(entityType);
  const where = entityType === 'album' && albumIds ? inList(albumIds) : entityWhereCol(entityType, entityId);
  const wr = rangeWhere(rangeStart, rangeEnd);
  const uf = userFilter(userId);

  return db.all(sql`
    SELECT count(*) as play_count, coalesce(sum(t.duration_ms), 0) as total_ms,
           min(lh.played_at) as first_played, max(lh.played_at) as last_played
    FROM listening_history lh
    ${join}
    JOIN tracks t ON t.spotify_id = lh.track_id
    WHERE ${where} ${wr} ${uf}
  `)[0] as StatsRow;
}

/** Top entidades con agregados de reproducciones */
export function getTopEntities(db: Db, entityType: EntityType, rangeStart: string | null, sort: Sort, limit: number, rangeEnd: string | null | undefined, userId: number): AggregateRow[] {
  const join = entityJoins(entityType);
  const groupCol = entityGroupCol(entityType, userId);
  const ob = orderByCol(sort);
  const uf = userFilter(userId);

  if (entityType === 'album') {
    const mrJoin = mergeRulesJoin(userId);
    // para álbumes: si no hay filtro de rango, usar WHERE con user filter directamente
    const rangeFilter = rangeStart
      ? (rangeEnd ? sql`WHERE lh.played_at >= ${rangeStart} AND lh.played_at <= ${rangeEnd}` : sql`WHERE lh.played_at >= ${rangeStart}`)
      : sql`WHERE 1=1`;

    return db.all(sql`
      SELECT entity_id, SUM(play_count) as play_count, SUM(total_ms) as total_ms
      FROM (
        SELECT ${groupCol} as entity_id, count(*) as play_count, sum(t.duration_ms) as total_ms
        FROM listening_history lh
        JOIN tracks t ON t.spotify_id = lh.track_id
        ${mrJoin}
        ${rangeFilter} ${uf}
        GROUP BY t.album_id
        HAVING t.album_id IS NOT NULL
      )
      GROUP BY entity_id
      ORDER BY ${ob} DESC
      LIMIT ${limit}
    `) as AggregateRow[];
  }

  // para no-album: usar rangeWhereClause + userFilter
  const hasRange = rangeStart != null;
  const whereClause = hasRange
    ? (rangeEnd ? sql`WHERE lh.played_at >= ${rangeStart} AND lh.played_at <= ${rangeEnd}` : sql`WHERE lh.played_at >= ${rangeStart}`)
    : sql`WHERE 1=1`;

  return db.all(sql`
    SELECT ${groupCol} as entity_id, count(*) as play_count, sum(t.duration_ms) as total_ms
    FROM listening_history lh
    ${join}
    JOIN tracks t ON t.spotify_id = lh.track_id
    ${whereClause} ${uf}
    GROUP BY entity_id
    ORDER BY ${ob} DESC
    LIMIT ${limit}
  `) as AggregateRow[];
}

/** Top entidades del periodo anterior */
export function getPrevPeriodEntities(db: Db, entityType: EntityType, prevStart: string, prevEnd: string, sort: Sort, userId: number): AggregateRow[] {
  const join = entityJoins(entityType);
  const groupCol = entityGroupCol(entityType, userId);
  const ob = orderByCol(sort);
  const uf = userFilter(userId);

  if (entityType === 'album') {
    const mrJoin = mergeRulesJoin(userId);
    return db.all(sql`
      SELECT entity_id, SUM(play_count) as play_count, SUM(total_ms) as total_ms
      FROM (
        SELECT ${groupCol} as entity_id, count(*) as play_count, sum(t.duration_ms) as total_ms
        FROM listening_history lh
        JOIN tracks t ON t.spotify_id = lh.track_id
        ${mrJoin}
        WHERE lh.played_at >= ${prevStart} AND lh.played_at < ${prevEnd} ${uf}
        GROUP BY t.album_id
        HAVING t.album_id IS NOT NULL
      )
      GROUP BY entity_id
      ORDER BY ${ob} DESC
      LIMIT 200
    `) as AggregateRow[];
  }

  return db.all(sql`
    SELECT ${groupCol} as entity_id, count(*) as play_count, sum(t.duration_ms) as total_ms
    FROM listening_history lh
    ${join}
    JOIN tracks t ON t.spotify_id = lh.track_id
    WHERE lh.played_at >= ${prevStart} AND lh.played_at < ${prevEnd} ${uf}
    GROUP BY entity_id
    ORDER BY ${ob} DESC
    LIMIT 200
  `) as AggregateRow[];
}

/** Serie temporal. Para álbumes, pasar albumIds pre-resueltos. */
export function getEntitySeries(db: Db, entityType: EntityType, entityId: string, rangeStart: string | null, range: TimeRange, albumIds: string[] | undefined, rangeEnd: string | null | undefined, customDays: number | undefined, userId: number): SeriesRow[] {
  const join = entityJoins(entityType);
  const where = entityType === 'album' && albumIds ? inList(albumIds) : entityWhereCol(entityType, entityId);
  const wr = rangeWhere(rangeStart, rangeEnd);
  const dateTrunc = customDays != null ? getDateTruncForDays(customDays) : getDateTrunc(range);
  const uf = userFilter(userId);

  return db.all(sql`
    SELECT ${dateTrunc} as period, count(*) as play_count, sum(t.duration_ms) as total_ms
    FROM listening_history lh
    ${join}
    JOIN tracks t ON t.spotify_id = lh.track_id
    WHERE ${where} ${wr} ${uf}
    GROUP BY period
    ORDER BY period ASC
  `) as SeriesRow[];
}

/** Serie temporal global */
export function getGlobalSeries(db: Db, rangeStart: string | null, granularity: string, rangeEnd: string | null | undefined, userId: number): SeriesRow[] {
  const uf = userFilter(userId);
  const dateTrunc = granularity === 'month'
    ? sql`strftime('%Y-%m', lh.played_at)`
    : granularity === 'week'
    ? sql`strftime('%Y-W%W', lh.played_at)`
    : sql`date(lh.played_at)`;

  const whereClause = rangeStart
    ? (rangeEnd ? sql`WHERE lh.played_at >= ${rangeStart} AND lh.played_at <= ${rangeEnd}` : sql`WHERE lh.played_at >= ${rangeStart}`)
    : sql`WHERE 1=1`;

  return db.all(sql`
    SELECT ${dateTrunc} as period, count(*) as play_count, sum(t.duration_ms) as total_ms
    FROM listening_history lh
    JOIN tracks t ON t.spotify_id = lh.track_id
    ${whereClause} ${uf}
    GROUP BY period
    ORDER BY period ASC
  `) as SeriesRow[];
}

/** Reproducciones recientes. Para álbumes, pasar albumIds pre-resueltos. */
export function getRecentPlays(db: Db, entityType: EntityType, entityId: string, limit: number, albumIds: string[] | undefined, userId: number): RecentPlayRow[] {
  const join = entityJoins(entityType);
  const uf = userFilter(userId);

  if (entityType === 'album') {
    const where = albumIds ? inList(albumIds) : sql`t.album_id = ${entityId}`;
    return db.all(sql`
      SELECT lh.id, lh.played_at, lh.track_id
      FROM listening_history lh
      JOIN tracks t ON t.spotify_id = lh.track_id
      WHERE ${where} ${uf}
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
    WHERE ${where} ${uf}
    ORDER BY lh.played_at DESC
    LIMIT ${limit}
  `) as RecentPlayRow[];
}
