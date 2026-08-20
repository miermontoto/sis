import { sql } from 'drizzle-orm';
import type { Db, EntityType, Sort, StatsRow, AggregateRow, SeriesRow, RecentPlayRow, SqlChunk } from './helpers.js';
import { entityGroupCol, entityWhereCol, rangeWhere, orderByCol, getDateTrunc, getDateTruncForDays, resolvedEntityId, userFilter, albumIdIn, tracksWithArtistIn, albumPlaysPredicate, resolvedPlayJoins, albumNullFilter, entityMergeJoin, trackJoinResolvingMerges, playDuration } from './helpers.js';
import type { TimeRange } from '../../constants.js';

/** Stats agregados para cualquier entidad. Para álbumes y artistas, pasar IDs pre-resueltos. */
export function getEntityStats(db: Db, entityType: EntityType, entityId: string, rangeStart: string | null, rangeEnd: string | null | undefined, entityIds: string[] | undefined, userId: number): StatsRow {
  const wr = rangeWhere(rangeStart, rangeEnd);
  const uf = userFilter(userId);

  if (entityType === 'artist') {
    const ids = entityIds ?? [entityId];
    return db.all(sql`
      SELECT count(*) as play_count, coalesce(sum(${playDuration()}), 0) as total_ms,
             min(lh.played_at) as first_played, max(lh.played_at) as last_played
      FROM listening_history lh
      JOIN tracks t ON t.spotify_id = lh.track_id
      WHERE ${tracksWithArtistIn(ids)} ${wr} ${uf}
    `)[0] as StatsRow;
  }

  // album ó track: resolvedPlayJoins resuelve track merges para álbumes automáticamente.
  // para álbum, el predicado driving evita el scan completo que provoca el JOIN por COALESCE
  const where = entityWhereCol(entityType, entityId, entityIds);
  const drive = entityType === 'album' ? albumPlaysPredicate(entityIds ?? [entityId], userId) : sql``;
  return db.all(sql`
    SELECT count(*) as play_count, coalesce(sum(${playDuration()}), 0) as total_ms,
           min(lh.played_at) as first_played, max(lh.played_at) as last_played
    FROM listening_history lh
    ${resolvedPlayJoins(entityType, userId)}
    WHERE ${where} ${wr} ${uf} ${drive}
  `)[0] as StatsRow;
}

/** Agregación de top artistas: pre-agrega por track (una pasada sobre el historial) y expande
 *  al set dedupeado de (track, artista resuelto). Equivale al DISTINCT (artista, play) sobre el
 *  producto lh × track_artists — que un mismo play cuente una sola vez por artista aunque dos
 *  créditos del track resuelvan al mismo target — pero sin materializar ese producto (~3x menos
 *  coste en rangos largos). */
function topArtistsAggregate(db: Db, playsWhere: SqlChunk, ob: SqlChunk, limit: number, userId: number): AggregateRow[] {
  return db.all(sql`
    SELECT entity_id, sum(cnt) as play_count, sum(ms) as total_ms
    FROM (
      SELECT lh.track_id, count(*) as cnt, sum(${playDuration()}) as ms
      FROM listening_history lh
      JOIN tracks t ON t.spotify_id = lh.track_id
      WHERE ${playsWhere}
      GROUP BY lh.track_id
    ) pt
    JOIN (
      SELECT DISTINCT ta.track_id, ${resolvedEntityId('artist', userId)} as entity_id
      FROM track_artists ta
      ${entityMergeJoin('artist', userId)}
    ) am ON am.track_id = pt.track_id
    GROUP BY entity_id
    ORDER BY ${ob} DESC
    LIMIT ${limit}
  `) as AggregateRow[];
}

/** Top entidades con agregados de reproducciones */
export function getTopEntities(db: Db, entityType: EntityType, rangeStart: string | null, sort: Sort, limit: number, rangeEnd: string | null | undefined, userId: number): AggregateRow[] {
  const groupCol = entityGroupCol(entityType, userId);
  const ob = orderByCol(sort);
  const uf = userFilter(userId);

  const wr = rangeWhere(rangeStart, rangeEnd);

  if (entityType === 'artist') {
    return topArtistsAggregate(db, sql`lh.user_id = ${userId} ${wr}`, ob, limit, userId);
  }

  return db.all(sql`
    SELECT ${groupCol} as entity_id, count(*) as play_count, sum(${playDuration()}) as total_ms
    FROM listening_history lh
    ${resolvedPlayJoins(entityType, userId)}
    WHERE 1=1 ${wr} ${uf} ${albumNullFilter(entityType)}
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

  if (entityType === 'artist') {
    return topArtistsAggregate(db, sql`lh.played_at >= ${prevStart} AND lh.played_at < ${prevEnd} AND lh.user_id = ${userId}`, ob, 200, userId);
  }

  // album ó track
  return db.all(sql`
    SELECT ${groupCol} as entity_id, count(*) as play_count, sum(${playDuration()}) as total_ms
    FROM listening_history lh
    ${resolvedPlayJoins(entityType, userId)}
    WHERE lh.played_at >= ${prevStart} AND lh.played_at < ${prevEnd} ${uf} ${albumNullFilter(entityType)}
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
      SELECT ${dateTrunc} as period, count(*) as play_count, sum(${playDuration()}) as total_ms
      FROM listening_history lh
      JOIN tracks t ON t.spotify_id = lh.track_id
      WHERE ${tracksWithArtistIn(ids)} ${wr} ${uf}
      GROUP BY period
      ORDER BY period ASC
    `) as SeriesRow[];
  }

  // album ó track (mismo predicado driving que en getEntityStats)
  const where = entityWhereCol(entityType, entityId, entityIds);
  const drive = entityType === 'album' ? albumPlaysPredicate(entityIds ?? [entityId], userId) : sql``;
  return db.all(sql`
    SELECT ${dateTrunc} as period, count(*) as play_count, sum(${playDuration()}) as total_ms
    FROM listening_history lh
    ${resolvedPlayJoins(entityType, userId)}
    WHERE ${where} ${wr} ${uf} ${drive}
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
    SELECT ${dateTrunc} as period, count(*) as play_count, sum(${playDuration()}) as total_ms
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

  // ORDER BY +lh.played_at (unary plus) descalifica idx_listening_history_user_played_at como
  // orden: sin él, el planner escanea el historial entero hacia atrás "hasta encontrar limit
  // filas", que para entidades sin plays recientes es un scan completo (~cientos de ms). Con
  // el predicado driving las filas cualificadas se leen por idx_lh_user_track y el sort
  // explícito es sobre ese subconjunto pequeño.
  if (entityType === 'album') {
    const where = entityIds ? albumIdIn(entityIds) : sql`t.album_id = ${entityId}`;
    return db.all(sql`
      SELECT lh.id, lh.played_at, lh.track_id
      FROM listening_history lh
      ${trackJoinResolvingMerges(userId)}
      WHERE ${where} ${uf} ${albumPlaysPredicate(entityIds ?? [entityId], userId)}
      ORDER BY +lh.played_at DESC
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
      ORDER BY +lh.played_at DESC
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
