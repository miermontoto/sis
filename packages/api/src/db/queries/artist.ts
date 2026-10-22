import { sql } from 'drizzle-orm';
import type { ArtistScopedRank } from '@sis/shared';
import type { Db, Sort, SqlChunk } from './helpers.js';
import { rangeWhere, orderByCol, resolvedEntityId, userFilter, tracksWithArtistIn, artistPlaysPredicate, resolvedPlayJoins, playDuration, artistCreditedAlbums, trackArtistsFor } from './helpers.js';
import { resolveEntityIds } from './merge.js';

/** Plays por track canónico (merge-aware) de los temas del grupo de artista `ids`: la base
 *  de sus top tracks y de la posición de un tema dentro de su catálogo. */
function artistTrackScores(ids: string[], wr: SqlChunk, userId: number): SqlChunk {
  return sql`
    SELECT ${resolvedEntityId('track')} as track_id, count(*) as play_count, sum(${playDuration()}) as total_ms
    FROM listening_history lh
    ${resolvedPlayJoins('track', userId)}
    WHERE ${tracksWithArtistIn(ids, userId)} ${wr} ${userFilter(userId)}
    GROUP BY ${resolvedEntityId('track')}`;
}

/** Plays por álbum resuelto de los álbumes del grupo de artista `ids`. Sólo los que lo
 *  acreditan a nivel de álbum (`artistCreditedAlbums`): un tema suyo en una recopilación
 *  no hace suyo el disco. */
function artistAlbumScores(ids: string[], wr: SqlChunk, userId: number): SqlChunk {
  const artistPlaceholders = ids.length === 1 ? sql`${ids[0]}` : sql.join(ids.map(id => sql`${id}`), sql`, `);
  const artistCmp = ids.length === 1 ? sql`= ${ids[0]}` : sql`IN (${artistPlaceholders})`;

  return sql`
    SELECT album_id, SUM(play_count) as play_count, SUM(total_ms) as total_ms
    FROM (
      SELECT ${resolvedEntityId('album')} as album_id, count(*) as play_count, sum(${playDuration()}) as total_ms
      FROM listening_history lh
      ${resolvedPlayJoins('album', userId)}
      WHERE t.spotify_id IN (
        SELECT DISTINCT ta_sub.track_id FROM ${trackArtistsFor(userId)} ta_sub WHERE ta_sub.artist_id ${artistCmp}
      ) AND t.album_id IS NOT NULL ${wr} ${userFilter(userId)}
        ${artistPlaysPredicate(ids, userId)}
        AND t.album_id IN ${artistCreditedAlbums(ids, userId)}
      GROUP BY ${resolvedEntityId('album')}
    )
    GROUP BY album_id`;
}

/** Top tracks de un artista. Usa IDs pre-resueltos para incluir plays mergeados. Agrupa por track canónico (merge-aware). */
export function getArtistTopTracks(db: Db, artistId: string, rangeStart: string | null, sort: Sort, limit: number, rangeEnd: string | null | undefined, userId: number, artistIds?: string[]) {
  return db.all(sql`
    ${artistTrackScores(artistIds ?? [artistId], rangeWhere(rangeStart, rangeEnd), userId)}
    ORDER BY ${orderByCol(sort)} DESC
    LIMIT ${limit}
  `) as { track_id: string; play_count: number; total_ms: number }[];
}

/** Top álbumes de un artista (ver artistAlbumScores). */
export function getArtistTopAlbums(db: Db, artistId: string, rangeStart: string | null, sort: Sort, limit: number, rangeEnd: string | null | undefined, userId: number, artistIds?: string[]) {
  return db.all(sql`
    ${artistAlbumScores(artistIds ?? [artistId], rangeWhere(rangeStart, rangeEnd), userId)}
    ORDER BY ${orderByCol(sort)} DESC
    LIMIT ${limit}
  `) as { album_id: string; play_count: number; total_ms: number }[];
}

// builder y columna de id de cada catálogo del artista
const ARTIST_SCOPES = {
  track: { scores: artistTrackScores, idCol: sql`track_id` },
  album: { scores: artistAlbumScores, idCol: sql`album_id` },
} as const;

/** Posición all-time de un tema o álbum dentro del catálogo de un artista: la fila que
 *  ocupa en los top tracks/albums de la página de ese artista (mismo builder y mismo grupo
 *  de merge que su detalle), más el tamaño de esa lista. RANK: los empates comparten
 *  puesto. null = no figura ahí: sin crédito, sin plays, o un alias / miembro de colección
 *  que rankea con otro id. */
export function getArtistScopedRank(db: Db, entityType: 'track' | 'album', entityId: string, artistId: string, sort: Sort, userId: number): ArtistScopedRank | null {
  const { scores, idCol } = ARTIST_SCOPES[entityType];
  const row = db.get(sql`
    SELECT rank, total FROM (
      SELECT ${idCol} as eid, RANK() OVER (ORDER BY ${orderByCol(sort)} DESC) as rank, count(*) OVER () as total
      FROM (${scores(resolveEntityIds(db, 'artist', artistId, userId), sql``, userId)})
    )
    WHERE eid = ${entityId}
  `) as ArtistScopedRank | undefined;
  return row ?? null;
}

/** Lanzamientos conocidos del artista (álbumes y singles con fecha, sin compilations) para marcar
 *  eventos en las gráficas de detalle. Solo cubre álbumes ya ingestados (que el usuario escuchó). */
export function getArtistReleases(db: Db, artistId: string, artistIds: string[] | undefined, userId: number) {
  const ids = artistIds ?? [artistId];

  return db.all(sql`
    SELECT a.spotify_id as id, a.name, a.release_date as date, a.album_type as album_type, a.image_url
    FROM albums a
    WHERE a.release_date IS NOT NULL
      AND (a.album_type IS NULL OR a.album_type != 'compilation')
      AND a.spotify_id IN ${artistCreditedAlbums(ids, userId)}
    ORDER BY a.release_date
  `) as { id: string; name: string; date: string; album_type: string | null; image_url: string | null }[];
}
