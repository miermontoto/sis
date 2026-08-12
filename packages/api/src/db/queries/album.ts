import { sql } from 'drizzle-orm';
import type { Db, Sort } from './helpers.js';
import { rangeWhere, userFilter, albumIdIn, playDuration } from './helpers.js';

/** Artistas principales de un álbum. Usa artist_ids de Spotify si están disponibles, sino heurística por track artists */
export function getAlbumArtists(db: Db, albumId: string, ids?: string[]) {
  const albumIds = ids ?? [albumId];

  // intentar usar artist_ids almacenados del album (datos de spotify)
  const album = db.all(sql`
    SELECT artist_ids FROM albums WHERE spotify_id = ${albumId}
  `)[0] as { artist_ids: string | string[] | null } | undefined;

  if (album?.artist_ids) {
    const parsed = typeof album.artist_ids === 'string'
      ? JSON.parse(album.artist_ids)
      : album.artist_ids;
    const artistIdList: string[] = Array.isArray(parsed) ? parsed : [];

    if (artistIdList.length > 0) {
      const placeholders = sql.join(artistIdList.map(id => sql`${id}`), sql`, `);
      return db.all(sql`
        SELECT a.spotify_id as artist_id, a.name, a.image_url
        FROM artists a
        WHERE a.spotify_id IN (${placeholders})
      `) as { artist_id: string; name: string; image_url: string | null }[];
    }
  }

  // fallback: heurística — position=0 artists presentes en >50% de los tracks
  const totalRow = db.all(sql`
    SELECT count(*) as total FROM tracks t WHERE ${albumIdIn(albumIds)}
  `)[0] as { total: number };
  const threshold = Math.max(1, Math.floor(totalRow.total * 0.5));

  return db.all(sql`
    SELECT ta.artist_id, a.name, a.image_url, count(DISTINCT t.spotify_id) as track_count
    FROM tracks t
    JOIN track_artists ta ON ta.track_id = t.spotify_id AND ta.position = 0
    JOIN artists a ON a.spotify_id = ta.artist_id
    WHERE ${albumIdIn(albumIds)}
    GROUP BY ta.artist_id
    HAVING track_count >= ${threshold}
    ORDER BY track_count DESC, MIN(ta.position) ASC
  `) as { artist_id: string; name: string; image_url: string | null }[];
}

/** Tracks de un álbum con play counts (merge-aware: resuelve track merges, agrupa por track canónico, excluye tracks source) */
export function getAlbumTracks(db: Db, albumId: string, rangeStart: string | null, sort: Sort, ids: string[] | undefined, rangeEnd: string | null | undefined, userId: number) {
  const albumIds = ids ?? [albumId];
  const wr = rangeWhere(rangeStart, rangeEnd);
  const uf = userFilter(userId);

  return db.all(sql`
    SELECT t.spotify_id as track_id, t.name, t.duration_ms, t.track_number, t.disc_number,
           coalesce(s.play_count, 0) as play_count, coalesce(s.total_ms, 0) as total_ms
    FROM tracks t
    LEFT JOIN (
      SELECT COALESCE(mr_track.target_id, lh.track_id) as resolved_track_id, count(*) as play_count, sum(COALESCE(lh.duration_played_ms, tr.duration_ms)) as total_ms
      FROM listening_history lh
      LEFT JOIN merge_rules mr_track ON mr_track.entity_type = 'track' AND mr_track.source_id = lh.track_id AND mr_track.user_id = ${userId}
      JOIN tracks tr ON tr.spotify_id = COALESCE(mr_track.target_id, lh.track_id)
      WHERE ${albumIdIn(albumIds, 'tr')} ${wr} ${uf}
      GROUP BY resolved_track_id
    ) s ON s.resolved_track_id = t.spotify_id
    WHERE ${albumIdIn(albumIds)}
      AND t.spotify_id NOT IN (SELECT source_id FROM merge_rules WHERE entity_type = 'track' AND user_id = ${userId})
    ORDER BY ${sort === 'natural' ? sql`COALESCE(t.disc_number, 1) ASC, COALESCE(t.track_number, 9999) ASC, t.name ASC` : sort === 'plays' ? sql`play_count DESC, COALESCE(t.disc_number, 1) ASC, COALESCE(t.track_number, 9999) ASC` : sql`total_ms DESC, COALESCE(t.disc_number, 1) ASC, COALESCE(t.track_number, 9999) ASC`}
  `) as { track_id: string; name: string; duration_ms: number; track_number: number | null; disc_number: number | null; play_count: number; total_ms: number }[];
}

/** Singles del mismo artista ligados a un álbum (los singles de adelanto son entidades aparte en
 *  Spotify): se enlazan si el nombre del single o alguno de sus tracks coincide con un track del
 *  álbum. Eventos de lanzamiento para las gráficas de detalle + sección "Singles" del rail, por lo
 *  que cada single lleva las escuchas del usuario (all-time, la página de álbum es all-time).
 *  Las plays son las del TEMA, no las de la entidad single: se suman las del propio single y las de
 *  su copia en el álbum, porque Spotify atribuye el scrobble a la entidad que sonó y casi siempre es
 *  el álbum. La agregación se acota a los candidatos (CTE) para no escanear todo el historial. */
export function getAlbumRelatedSingles(db: Db, albumId: string, ids: string[] | undefined, userId: number) {
  const albumIds = ids ?? [albumId];
  const albumPlaceholders = sql.join(albumIds.map(id => sql`${id}`), sql`, `);

  return db.all(sql`
    WITH album_track_names AS (
      SELECT DISTINCT lower(t.name) AS ln FROM tracks t WHERE t.album_id IN (${albumPlaceholders})
    ),
    album_artists AS (
      SELECT DISTINCT ta.artist_id FROM tracks t
      JOIN track_artists ta ON ta.track_id = t.spotify_id AND ta.position = 0
      WHERE t.album_id IN (${albumPlaceholders})
    ),
    candidates AS (
      SELECT DISTINCT s.spotify_id AS id, s.name AS name, s.release_date AS date, s.image_url AS image_url
      FROM albums s
      WHERE s.album_type = 'single' AND s.release_date IS NOT NULL
        -- solo se excluye el álbum de la página, NO sus alias de merge: mergear un single de
        -- adelanto en su álbum (para unificar plays) no debe borrarlo de la lista de singles ni
        -- del eje de las gráficas, que es justo donde su fecha de lanzamiento aporta información
        AND s.spotify_id != ${albumId}
        AND (
          EXISTS (
            SELECT 1 FROM tracks st
            JOIN track_artists sta ON sta.track_id = st.spotify_id AND sta.position = 0
            WHERE st.album_id = s.spotify_id AND sta.artist_id IN (SELECT artist_id FROM album_artists)
          )
          OR EXISTS (
            SELECT 1 FROM json_each(s.artist_ids) je WHERE je.value IN (SELECT artist_id FROM album_artists)
          )
        )
        AND (
          lower(s.name) IN (SELECT ln FROM album_track_names)
          OR EXISTS (
            SELECT 1 FROM tracks st2 WHERE st2.album_id = s.spotify_id
              AND lower(st2.name) IN (SELECT ln FROM album_track_names)
          )
        )
    ),
    -- títulos que identifican al single: el suyo propio + los de sus tracks
    candidate_names AS (
      SELECT c.id AS cid, lower(c.name) AS ln FROM candidates c
      UNION
      SELECT c.id, lower(st.name) FROM candidates c JOIN tracks st ON st.album_id = c.id
    ),
    -- tracks que cuentan como escuchas del single: los del propio single + la copia del mismo
    -- tema en el álbum (Spotify suele atribuir el scrobble a la entidad álbum, no al single).
    -- UNION dedup por (cid, track_id) para no contar dos veces el mismo track.
    matched_tracks AS (
      SELECT c.id AS cid, t.spotify_id AS track_id FROM candidates c JOIN tracks t ON t.album_id = c.id
      UNION
      SELECT cn.cid, t.spotify_id FROM candidate_names cn
      JOIN tracks t ON t.album_id IN (${albumPlaceholders}) AND lower(t.name) = cn.ln
    )
    SELECT c.id, c.name, c.date, c.image_url,
           coalesce(st.play_count, 0) AS play_count, coalesce(st.total_ms, 0) AS total_ms
    FROM candidates c
    LEFT JOIN (
      SELECT mt.cid AS cid, count(*) AS play_count, sum(${playDuration()}) AS total_ms
      FROM matched_tracks mt
      JOIN listening_history lh ON lh.track_id = mt.track_id
      JOIN tracks t ON t.spotify_id = lh.track_id
      WHERE lh.user_id = ${userId}
      GROUP BY mt.cid
    ) st ON st.cid = c.id
    ORDER BY c.date
  `) as { id: string; name: string; date: string; image_url: string | null; play_count: number; total_ms: number }[];
}
