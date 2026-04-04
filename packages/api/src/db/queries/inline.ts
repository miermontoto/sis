// Queries que antes estaban inline en stats.ts, extraídas para el worker pool
import { sql } from 'drizzle-orm';
import type { Db } from './helpers.js';
import { rangeWhere, userFilter } from './helpers.js';

export function getTopGenres(db: Db, rangeStart: string | null, rangeEnd: string | null, limit: number, userId: number) {
  const rw = rangeWhere(rangeStart, rangeEnd);
  const uf = userFilter(userId);

  return db.all(sql`
    SELECT genre.value as genre, count(*) as play_count
    FROM listening_history lh
    JOIN track_artists ta ON ta.track_id = lh.track_id
    JOIN artists a ON a.spotify_id = ta.artist_id
    JOIN json_each(a.genres) genre
    WHERE 1=1 ${uf} ${rw}
    GROUP BY genre.value
    ORDER BY play_count DESC
    LIMIT ${limit}
  `) as { genre: string; play_count: number }[];
}

export function getHeatmap(db: Db, rangeStart: string | null, rangeEnd: string | null, userId: number) {
  const rw = rangeWhere(rangeStart, rangeEnd);
  const uf = userFilter(userId);

  return db.all(sql`
    SELECT
      cast(strftime('%w', lh.played_at) as integer) as day_of_week,
      cast(strftime('%H', lh.played_at) as integer) as hour,
      count(*) as play_count
    FROM listening_history lh
    WHERE 1=1 ${uf} ${rw}
    GROUP BY day_of_week, hour
  `) as { day_of_week: number; hour: number; play_count: number }[];
}

export function getStreakDays(db: Db, userId: number) {
  return db.all(sql`
    SELECT DISTINCT date(played_at) as day
    FROM listening_history
    WHERE user_id = ${userId}
    ORDER BY day ASC
  `) as { day: string }[];
}

export function searchEntities(db: Db, term: string, limit: number, userId: number) {
  const artistRows = db.all(sql`
    SELECT a.spotify_id as id, a.name, a.image_url as imageUrl,
           COALESCE(s.play_count, 0) as playCount
    FROM artists a
    LEFT JOIN (
      SELECT ta.artist_id, COUNT(*) as play_count
      FROM listening_history lh
      JOIN track_artists ta ON ta.track_id = lh.track_id
      WHERE lh.user_id = ${userId}
      GROUP BY ta.artist_id
    ) s ON s.artist_id = a.spotify_id
    WHERE unaccent(a.name) LIKE ${'%' + term + '%'}
      AND a.spotify_id NOT LIKE 'import:%'
    ORDER BY playCount DESC
    LIMIT ${limit}
  `) as any[];

  const albumRows = db.all(sql`
    SELECT al.spotify_id as id, al.name, al.image_url as imageUrl,
           (SELECT ar.name FROM tracks t2
            JOIN track_artists ta2 ON ta2.track_id = t2.spotify_id AND ta2.position = 0
            JOIN artists ar ON ar.spotify_id = ta2.artist_id
            WHERE t2.album_id = al.spotify_id LIMIT 1) as artistName,
           COALESCE(s.play_count, 0) + COALESCE(ms.merged_count, 0) as playCount
    FROM albums al
    LEFT JOIN (
      SELECT t.album_id, COUNT(*) as play_count
      FROM listening_history lh
      JOIN tracks t ON t.spotify_id = lh.track_id
      WHERE t.album_id IS NOT NULL AND lh.user_id = ${userId}
      GROUP BY t.album_id
    ) s ON s.album_id = al.spotify_id
    LEFT JOIN (
      SELECT mr.target_id, SUM(sc.play_count) as merged_count
      FROM merge_rules mr
      JOIN (
        SELECT t.album_id, COUNT(*) as play_count
        FROM listening_history lh
        JOIN tracks t ON t.spotify_id = lh.track_id
        WHERE t.album_id IS NOT NULL AND lh.user_id = ${userId}
        GROUP BY t.album_id
      ) sc ON sc.album_id = mr.source_id
      WHERE mr.entity_type = 'album'
      GROUP BY mr.target_id
    ) ms ON ms.target_id = al.spotify_id
    WHERE unaccent(al.name) LIKE ${'%' + term + '%'}
      AND al.spotify_id NOT LIKE 'import:%'
      AND al.spotify_id NOT IN (SELECT source_id FROM merge_rules WHERE entity_type = 'album')
    ORDER BY playCount DESC
    LIMIT ${limit}
  `) as any[];

  const trackRows = db.all(sql`
    SELECT t.spotify_id as id, t.name,
           al.image_url as albumImageUrl,
           ar.name as artistName,
           COALESCE(s.play_count, 0) as playCount
    FROM tracks t
    LEFT JOIN albums al ON al.spotify_id = t.album_id
    LEFT JOIN (
      SELECT track_id, MIN(artist_id) as artist_id
      FROM track_artists WHERE position = 0 GROUP BY track_id
    ) pa ON pa.track_id = t.spotify_id
    LEFT JOIN artists ar ON ar.spotify_id = pa.artist_id
    LEFT JOIN (
      SELECT track_id, COUNT(*) as play_count
      FROM listening_history WHERE user_id = ${userId} GROUP BY track_id
    ) s ON s.track_id = t.spotify_id
    WHERE (unaccent(t.name) LIKE ${'%' + term + '%'}
           OR unaccent(ar.name) LIKE ${'%' + term + '%'})
      AND t.spotify_id NOT LIKE 'import:%'
    ORDER BY playCount DESC
    LIMIT ${limit}
  `) as any[];

  return { artists: artistRows, albums: albumRows, tracks: trackRows };
}

export function getAlbumMergeInfo(db: Db, albumId: string) {
  const mergedFrom = db.all(sql`
    SELECT mr.id as rule_id, mr.source_id, al.name, al.image_url
    FROM merge_rules mr
    JOIN albums al ON al.spotify_id = mr.source_id
    WHERE mr.entity_type = 'album' AND mr.target_id = ${albumId}
  `) as { rule_id: number; source_id: string; name: string; image_url: string | null }[];

  const mergedInto = db.all(sql`
    SELECT mr.id as rule_id, mr.target_id, al.name, al.image_url
    FROM merge_rules mr
    JOIN albums al ON al.spotify_id = mr.target_id
    WHERE mr.entity_type = 'album' AND mr.source_id = ${albumId}
  `)[0] as { rule_id: number; target_id: string; name: string; image_url: string | null } | undefined;

  return { mergedFrom, mergedInto: mergedInto ?? null };
}

// lookups ligeros para entidades (reemplazan drizzle select en routes)
export function lookupArtistById(db: Db, id: string) {
  return db.all(sql`
    SELECT spotify_id, name, image_url, genres FROM artists WHERE spotify_id = ${id}
  `)[0] as { spotify_id: string; name: string; image_url: string | null; genres: any } | undefined;
}

export function lookupAlbumById(db: Db, id: string) {
  return db.all(sql`
    SELECT spotify_id, name, image_url, release_date, total_tracks, album_type FROM albums WHERE spotify_id = ${id}
  `)[0] as { spotify_id: string; name: string; image_url: string | null; release_date: string | null; total_tracks: number | null; album_type: string | null } | undefined;
}

export function lookupTrackById(db: Db, id: string) {
  return db.all(sql`
    SELECT spotify_id, name, duration_ms, track_number, explicit, album_id FROM tracks WHERE spotify_id = ${id}
  `)[0] as { spotify_id: string; name: string; duration_ms: number; track_number: number | null; explicit: boolean | null; album_id: string | null } | undefined;
}

export function getTrackArtists(db: Db, trackId: string) {
  return db.all(sql`
    SELECT a.spotify_id, a.name, a.image_url
    FROM track_artists ta
    JOIN artists a ON a.spotify_id = ta.artist_id
    WHERE ta.track_id = ${trackId}
    ORDER BY ta.position ASC
  `) as { spotify_id: string; name: string; image_url: string | null }[];
}
