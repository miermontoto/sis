import { sql } from 'drizzle-orm';
import type { Db, EntityType, Sort, StatsRow, AggregateRow, SeriesRow, RecentPlayRow, SqlChunk } from './helpers.js';
import { entityJoins, entityGroupCol, entityWhereCol, rangeWhere, rangeWhereClause, orderByCol, getDateTrunc, getDateTruncForDays, mergeRulesJoin, userFilter, albumIdIn } from './helpers.js';
import type { TimeRange } from '../../constants.js';

/** Stats agregados para cualquier entidad. Para álbumes, pasar albumIds pre-resueltos. */
export function getEntityStats(db: Db, entityType: EntityType, entityId: string, rangeStart: string | null, rangeEnd: string | null | undefined, albumIds: string[] | undefined, userId: number): StatsRow {
  const join = entityJoins(entityType);
  const where = entityType === 'album' && albumIds ? albumIdIn(albumIds) : entityWhereCol(entityType, entityId);
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
    const rangeFilter = rangeStart
      ? (rangeEnd ? sql`WHERE lh.played_at >= ${rangeStart} AND lh.played_at <= ${rangeEnd}` : sql`WHERE lh.played_at >= ${rangeStart}`)
      : sql`WHERE 1=1`;

    return db.all(sql`
      SELECT ${groupCol} as entity_id, count(*) as play_count, sum(t.duration_ms) as total_ms
      FROM listening_history lh
      JOIN tracks t ON t.spotify_id = lh.track_id
      ${mrJoin}
      ${rangeFilter} ${uf} AND t.album_id IS NOT NULL
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
      SELECT ${groupCol} as entity_id, count(*) as play_count, sum(t.duration_ms) as total_ms
      FROM listening_history lh
      JOIN tracks t ON t.spotify_id = lh.track_id
      ${mrJoin}
      WHERE lh.played_at >= ${prevStart} AND lh.played_at < ${prevEnd} ${uf} AND t.album_id IS NOT NULL
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
  const where = entityType === 'album' && albumIds ? albumIdIn(albumIds) : entityWhereCol(entityType, entityId);
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
    const where = albumIds ? albumIdIn(albumIds) : sql`t.album_id = ${entityId}`;
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

export interface HistoryPageResult {
  items: RecentPlayRow[];
  total: number;
}

/** Historial paginado, con filtros opcionales. */
export function getHistoryPage(db: Db, userId: number, limit: number, offset: number, filters?: { date?: string; albumId?: string; trackId?: string; artistId?: string }): HistoryPageResult {
  const { date, albumId, trackId, artistId } = filters ?? {};
  const dateFilter = date ? sql` AND date(lh.played_at) = ${date}` : sql``;
  const needsTrackJoin = albumId || artistId;
  const trackJoin = needsTrackJoin ? sql`JOIN tracks t ON t.spotify_id = lh.track_id` : sql``;
  const artistJoin = artistId ? sql`JOIN track_artists ta ON ta.track_id = lh.track_id` : sql``;
  const albumWhere = albumId ? sql` AND t.album_id = ${albumId}` : sql``;
  const trackWhere = trackId ? sql` AND lh.track_id = ${trackId}` : sql``;
  const artistWhere = artistId ? sql` AND ta.artist_id = ${artistId}` : sql``;

  const items = db.all(sql`
    SELECT lh.id, lh.played_at, lh.track_id
    FROM listening_history lh
    ${trackJoin}
    ${artistJoin}
    WHERE lh.user_id = ${userId}${dateFilter}${albumWhere}${trackWhere}${artistWhere}
    ORDER BY lh.played_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `) as RecentPlayRow[];

  const total = (db.all(sql`
    SELECT count(*) as count
    FROM listening_history lh
    ${trackJoin}
    ${artistJoin}
    WHERE lh.user_id = ${userId}${dateFilter}${albumWhere}${trackWhere}${artistWhere}
  `) as { count: number }[])[0].count;

  return { items, total };
}

/** Eliminar entradas del historial por IDs, restringido al usuario. */
export function deleteHistoryEntries(db: Db, userId: number, ids: number[]): number {
  if (ids.length === 0) return 0;
  const placeholders = sql.join(ids.map(id => sql`${id}`), sql`, `);
  const result = db.run(sql`
    DELETE FROM listening_history
    WHERE id IN (${placeholders}) AND user_id = ${userId}
  `);
  return result.changes;
}
