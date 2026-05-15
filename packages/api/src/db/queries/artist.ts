import { sql } from 'drizzle-orm';
import type { Db, Sort } from './helpers.js';
import { rangeWhere, orderByCol, resolvedEntityId, entityMergeJoin, userFilter, tracksWithArtistIn, resolvedPlayJoins, playDuration } from './helpers.js';

/** Top tracks de un artista. Usa IDs pre-resueltos para incluir plays mergeados. Agrupa por track canónico (merge-aware). */
export function getArtistTopTracks(db: Db, artistId: string, rangeStart: string | null, sort: Sort, limit: number, rangeEnd: string | null | undefined, userId: number, artistIds?: string[]) {
  const wr = rangeWhere(rangeStart, rangeEnd);
  const ob = orderByCol(sort);
  const uf = userFilter(userId);
  const ids = artistIds ?? [artistId];
  const tracksFilter = tracksWithArtistIn(ids);

  return db.all(sql`
    SELECT ${resolvedEntityId('track', userId)} as track_id, count(*) as play_count, sum(${playDuration()}) as total_ms
    FROM listening_history lh
    ${resolvedPlayJoins('track', userId)}
    WHERE ${tracksFilter} ${wr} ${uf}
    GROUP BY ${resolvedEntityId('track', userId)}
    ORDER BY ${ob} DESC
    LIMIT ${limit}
  `) as { track_id: string; play_count: number; total_ms: number }[];
}

/** Top álbumes de un artista (solo donde es artista principal, position=0). Usa IDs pre-resueltos.
 *  resolvedPlayJoins('album') resuelve track merges + album merges automáticamente. */
export function getArtistTopAlbums(db: Db, artistId: string, rangeStart: string | null, sort: Sort, limit: number, rangeEnd: string | null | undefined, userId: number, artistIds?: string[]) {
  const wr = rangeWhere(rangeStart, rangeEnd);
  const ob = orderByCol(sort);
  const uf = userFilter(userId);
  const ids = artistIds ?? [artistId];
  const artistPlaceholders = ids.length === 1 ? sql`${ids[0]}` : sql.join(ids.map(id => sql`${id}`), sql`, `);
  const artistCmp = ids.length === 1 ? sql`= ${ids[0]}` : sql`IN (${artistPlaceholders})`;

  return db.all(sql`
    SELECT album_id, SUM(play_count) as play_count, SUM(total_ms) as total_ms
    FROM (
      SELECT ${resolvedEntityId('album', userId)} as album_id, count(*) as play_count, sum(${playDuration()}) as total_ms
      FROM listening_history lh
      ${resolvedPlayJoins('album', userId)}
      WHERE t.spotify_id IN (
        SELECT DISTINCT ta_sub.track_id FROM track_artists ta_sub WHERE ta_sub.artist_id ${artistCmp}
      ) AND t.album_id IS NOT NULL ${wr} ${uf}
        AND t.album_id IN (
          SELECT DISTINCT t2.album_id FROM tracks t2
          JOIN track_artists ta2 ON ta2.track_id = t2.spotify_id
          WHERE ta2.artist_id ${artistCmp} AND ta2.position = 0
        )
      GROUP BY ${resolvedEntityId('album', userId)}
    )
    GROUP BY album_id
    ORDER BY ${ob} DESC
    LIMIT ${limit}
  `) as { album_id: string; play_count: number; total_ms: number }[];
}
