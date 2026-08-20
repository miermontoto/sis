import { sql } from 'drizzle-orm';
import type { Db, Sort } from './helpers.js';
import { rangeWhere, orderByCol, resolvedEntityId, userFilter, tracksWithArtistIn, artistPlaysPredicate, resolvedPlayJoins, playDuration } from './helpers.js';

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

/** Top álbumes de un artista. Incluye álbumes donde es artista principal (position=0)
 *  o está acreditado en el campo artist_ids del álbum (multi-artista). */
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
        ${artistPlaysPredicate(ids, userId)}
        AND (
          t.album_id IN (
            SELECT DISTINCT t2.album_id FROM tracks t2
            JOIN track_artists ta2 ON ta2.track_id = t2.spotify_id
            WHERE ta2.artist_id ${artistCmp} AND ta2.position = 0
          )
          OR t.album_id IN (
            SELECT a2.spotify_id FROM albums a2, json_each(a2.artist_ids) je
            WHERE je.value ${artistCmp}
          )
        )
      GROUP BY ${resolvedEntityId('album', userId)}
    )
    GROUP BY album_id
    ORDER BY ${ob} DESC
    LIMIT ${limit}
  `) as { album_id: string; play_count: number; total_ms: number }[];
}

/** Lanzamientos conocidos del artista (álbumes y singles con fecha, sin compilations) para marcar
 *  eventos en las gráficas de detalle. Solo cubre álbumes ya ingestados (que el usuario escuchó). */
export function getArtistReleases(db: Db, artistId: string, artistIds?: string[]) {
  const ids = artistIds ?? [artistId];
  const artistPlaceholders = ids.length === 1 ? sql`${ids[0]}` : sql.join(ids.map(id => sql`${id}`), sql`, `);
  const artistCmp = ids.length === 1 ? sql`= ${ids[0]}` : sql`IN (${artistPlaceholders})`;

  return db.all(sql`
    SELECT a.spotify_id as id, a.name, a.release_date as date, a.album_type as album_type, a.image_url
    FROM albums a
    WHERE a.release_date IS NOT NULL
      AND (a.album_type IS NULL OR a.album_type != 'compilation')
      AND (
        a.spotify_id IN (
          SELECT a2.spotify_id FROM albums a2, json_each(a2.artist_ids) je
          WHERE je.value ${artistCmp}
        )
        OR a.spotify_id IN (
          SELECT DISTINCT t2.album_id FROM tracks t2
          JOIN track_artists ta2 ON ta2.track_id = t2.spotify_id
          WHERE ta2.artist_id ${artistCmp} AND ta2.position = 0
        )
      )
    ORDER BY a.release_date
  `) as { id: string; name: string; date: string; album_type: string | null; image_url: string | null }[];
}
