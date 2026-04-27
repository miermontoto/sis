import { sql } from 'drizzle-orm';
import type { Db, EntityType, Sort, StatsRow, AggregateRow, SeriesRow, RecentPlayRow, SqlChunk } from './helpers.js';
import { entityJoins, entityGroupCol, entityWhereCol, rangeWhere, rangeWhereClause, orderByCol, getDateTrunc, getDateTruncForDays, entityMergeJoin, resolvedEntityId, userFilter, albumIdIn, tracksWithArtistIn } from './helpers.js';
import type { TimeRange } from '../../constants.js';

/** Stats agregados para cualquier entidad. Para álbumes y artistas, pasar IDs pre-resueltos. */
export function getEntityStats(db: Db, entityType: EntityType, entityId: string, rangeStart: string | null, rangeEnd: string | null | undefined, entityIds: string[] | undefined, userId: number): StatsRow {
  const wr = rangeWhere(rangeStart, rangeEnd);
  const uf = userFilter(userId);

  if (entityType === 'artist') {
    // una fila por play — evita duplicados si varios artists de una track se han mergeado al mismo target
    const ids = entityIds ?? [entityId];
    return db.all(sql`
      SELECT count(*) as play_count, coalesce(sum(t.duration_ms), 0) as total_ms,
             min(lh.played_at) as first_played, max(lh.played_at) as last_played
      FROM listening_history lh
      JOIN tracks t ON t.spotify_id = lh.track_id
      WHERE ${tracksWithArtistIn(ids)} ${wr} ${uf}
    `)[0] as StatsRow;
  }

  const join = entityJoins(entityType, userId);
  const where = entityWhereCol(entityType, entityId, entityIds);

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
  const groupCol = entityGroupCol(entityType, userId);
  const ob = orderByCol(sort);
  const uf = userFilter(userId);

  if (entityType === 'album') {
    const mrJoin = entityMergeJoin('album', userId);
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

  if (entityType === 'artist') {
    // dedup por play antes de agregar: evita doble count cuando un track tiene 2 artists
    // que acaban mergeados al mismo target
    const mrJoin = entityMergeJoin('artist', userId);
    const rangeFilter = rangeStart
      ? (rangeEnd ? sql`AND lh.played_at >= ${rangeStart} AND lh.played_at <= ${rangeEnd}` : sql`AND lh.played_at >= ${rangeStart}`)
      : sql``;

    return db.all(sql`
      SELECT entity_id, count(*) as play_count, sum(duration_ms) as total_ms
      FROM (
        SELECT DISTINCT ${resolvedEntityId('artist', userId)} as entity_id, lh.id as play_id, t.duration_ms as duration_ms
        FROM listening_history lh
        JOIN tracks t ON t.spotify_id = lh.track_id
        JOIN track_artists ta ON ta.track_id = lh.track_id
        ${mrJoin}
        WHERE lh.user_id = ${userId} ${rangeFilter}
      )
      GROUP BY entity_id
      ORDER BY ${ob} DESC
      LIMIT ${limit}
    `) as AggregateRow[];
  }

  // tracks: un play = una fila, merge vía COALESCE
  const hasRange = rangeStart != null;
  const whereClause = hasRange
    ? (rangeEnd ? sql`WHERE lh.played_at >= ${rangeStart} AND lh.played_at <= ${rangeEnd}` : sql`WHERE lh.played_at >= ${rangeStart}`)
    : sql`WHERE 1=1`;
  const trackMrJoin = entityMergeJoin('track', userId);

  return db.all(sql`
    SELECT ${groupCol} as entity_id, count(*) as play_count, sum(t.duration_ms) as total_ms
    FROM listening_history lh
    JOIN tracks t ON t.spotify_id = lh.track_id
    ${trackMrJoin}
    ${whereClause} ${uf}
    GROUP BY entity_id
    ORDER BY ${ob} DESC
    LIMIT ${limit}
  `) as AggregateRow[];
}

/** Top entidades del periodo anterior */
export function getPrevPeriodEntities(db: Db, entityType: EntityType, prevStart: string, prevEnd: string, sort: Sort, userId: number): AggregateRow[] {
  const groupCol = entityGroupCol(entityType, userId);
  const ob = orderByCol(sort);
  const uf = userFilter(userId);

  if (entityType === 'album') {
    const mrJoin = entityMergeJoin('album', userId);
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

  if (entityType === 'artist') {
    const mrJoin = entityMergeJoin('artist', userId);
    return db.all(sql`
      SELECT entity_id, count(*) as play_count, sum(duration_ms) as total_ms
      FROM (
        SELECT DISTINCT ${resolvedEntityId('artist', userId)} as entity_id, lh.id as play_id, t.duration_ms as duration_ms
        FROM listening_history lh
        JOIN tracks t ON t.spotify_id = lh.track_id
        JOIN track_artists ta ON ta.track_id = lh.track_id
        ${mrJoin}
        WHERE lh.played_at >= ${prevStart} AND lh.played_at < ${prevEnd} AND lh.user_id = ${userId}
      )
      GROUP BY entity_id
      ORDER BY ${ob} DESC
      LIMIT 200
    `) as AggregateRow[];
  }

  // tracks
  const trackMrJoin = entityMergeJoin('track', userId);
  return db.all(sql`
    SELECT ${groupCol} as entity_id, count(*) as play_count, sum(t.duration_ms) as total_ms
    FROM listening_history lh
    JOIN tracks t ON t.spotify_id = lh.track_id
    ${trackMrJoin}
    WHERE lh.played_at >= ${prevStart} AND lh.played_at < ${prevEnd} ${uf}
    GROUP BY entity_id
    ORDER BY ${ob} DESC
    LIMIT 200
  `) as AggregateRow[];
}

/** Serie temporal. Para álbumes y artistas, pasar IDs pre-resueltos. */
export function getEntitySeries(db: Db, entityType: EntityType, entityId: string, rangeStart: string | null, range: TimeRange, entityIds: string[] | undefined, rangeEnd: string | null | undefined, customDays: number | undefined, userId: number): SeriesRow[] {
  const wr = rangeWhere(rangeStart, rangeEnd);
  const dateTrunc = customDays != null ? getDateTruncForDays(customDays) : getDateTrunc(range);
  const uf = userFilter(userId);

  if (entityType === 'artist') {
    const ids = entityIds ?? [entityId];
    return db.all(sql`
      SELECT ${dateTrunc} as period, count(*) as play_count, sum(t.duration_ms) as total_ms
      FROM listening_history lh
      JOIN tracks t ON t.spotify_id = lh.track_id
      WHERE ${tracksWithArtistIn(ids)} ${wr} ${uf}
      GROUP BY period
      ORDER BY period ASC
    `) as SeriesRow[];
  }

  const join = entityJoins(entityType, userId);
  const where = entityWhereCol(entityType, entityId, entityIds);

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

/** Reproducciones recientes. Para álbumes y artistas, pasar IDs pre-resueltos. */
export function getRecentPlays(db: Db, entityType: EntityType, entityId: string, limit: number, entityIds: string[] | undefined, userId: number): RecentPlayRow[] {
  const uf = userFilter(userId);

  if (entityType === 'album') {
    const where = entityIds ? albumIdIn(entityIds) : sql`t.album_id = ${entityId}`;
    return db.all(sql`
      SELECT lh.id, lh.played_at, lh.track_id
      FROM listening_history lh
      JOIN tracks t ON t.spotify_id = lh.track_id
      WHERE ${where} ${uf}
      ORDER BY lh.played_at DESC
      LIMIT ${limit}
    `) as RecentPlayRow[];
  }

  if (entityType === 'artist') {
    const ids = entityIds ?? [entityId];
    return db.all(sql`
      SELECT lh.id, lh.played_at, lh.track_id
      FROM listening_history lh
      JOIN tracks t ON t.spotify_id = lh.track_id
      WHERE ${tracksWithArtistIn(ids)} ${uf}
      ORDER BY lh.played_at DESC
      LIMIT ${limit}
    `) as RecentPlayRow[];
  }

  // tracks: soporta IDs resueltos (merges)
  if (entityIds && entityIds.length > 1) {
    const placeholders = sql.join(entityIds.map(tid => sql`${tid}`), sql`, `);
    return db.all(sql`
      SELECT lh.id, lh.played_at, lh.track_id
      FROM listening_history lh
      WHERE lh.track_id IN (${placeholders}) ${uf}
      ORDER BY lh.played_at DESC
      LIMIT ${limit}
    `) as RecentPlayRow[];
  }
  return db.all(sql`
    SELECT lh.id, lh.played_at, lh.track_id
    FROM listening_history lh
    WHERE lh.track_id = ${entityId} ${uf}
    ORDER BY lh.played_at DESC
    LIMIT ${limit}
  `) as RecentPlayRow[];
}

export interface HistoryPageResult {
  items: RecentPlayRow[];
  total: number;
}

/** Historial paginado, con filtros opcionales. Acepta arrays de IDs pre-resueltos (merge-aware). */
export function getHistoryPage(db: Db, userId: number, limit: number, offset: number, filters?: { date?: string; albumIds?: string[]; trackIds?: string[]; artistIds?: string[]; tzOffsetMinutes?: number }): HistoryPageResult {
  const { date, albumIds, trackIds, artistIds, tzOffsetMinutes = 0 } = filters ?? {};
  const tzModifier = (tzOffsetMinutes >= 0 ? '+' : '') + tzOffsetMinutes + ' minutes';
  const dateFilter = date ? sql` AND date(lh.played_at, ${tzModifier}) = ${date}` : sql``;
  const needsTrackJoin = albumIds || artistIds;
  const trackJoin = needsTrackJoin ? sql`JOIN tracks t ON t.spotify_id = lh.track_id` : sql``;
  const artistJoin = artistIds ? sql`JOIN track_artists ta ON ta.track_id = lh.track_id` : sql``;

  const albumWhere = albumIds
    ? (albumIds.length === 1
      ? sql` AND t.album_id = ${albumIds[0]}`
      : sql` AND t.album_id IN (${sql.join(albumIds.map(id => sql`${id}`), sql`, `)})`)
    : sql``;
  const trackWhere = trackIds
    ? (trackIds.length === 1
      ? sql` AND lh.track_id = ${trackIds[0]}`
      : sql` AND lh.track_id IN (${sql.join(trackIds.map(id => sql`${id}`), sql`, `)})`)
    : sql``;
  const artistWhere = artistIds
    ? (artistIds.length === 1
      ? sql` AND ta.artist_id = ${artistIds[0]}`
      : sql` AND ta.artist_id IN (${sql.join(artistIds.map(id => sql`${id}`), sql`, `)})`)
    : sql``;

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
