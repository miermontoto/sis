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
    LEFT JOIN merge_rules mr_artist ON mr_artist.entity_type = 'artist' AND mr_artist.source_id = ta.artist_id AND mr_artist.user_id = ${userId}
    JOIN artists a ON a.spotify_id = COALESCE(mr_artist.target_id, ta.artist_id)
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

function toFtsQuery(term: string): string {
  const words = term.replace(/[""]/g, '').split(/\s+/).filter(Boolean);
  if (words.length === 0) return '""';
  return words.map(w => `"${w}"*`).join(' ');
}

export function searchEntities(db: Db, term: string, limit: number, userId: number) {
  const ftsQuery = toFtsQuery(term);
  const likeTerm = `%${term}%`;

  const artistRows = db.all(sql`
    SELECT a.spotify_id as id, a.name, a.image_url as imageUrl,
           COALESCE(s.play_count, 0) + COALESCE(ms.merged_count, 0) as playCount
    FROM artists a
    LEFT JOIN (SELECT entity_id FROM search_index WHERE search_index MATCH ${ftsQuery} AND entity_type = 'artist') si
      ON si.entity_id = a.spotify_id
    LEFT JOIN (
      SELECT ta.artist_id, COUNT(*) as play_count
      FROM listening_history lh
      JOIN track_artists ta ON ta.track_id = lh.track_id
      WHERE lh.user_id = ${userId}
      GROUP BY ta.artist_id
    ) s ON s.artist_id = a.spotify_id
    LEFT JOIN (
      SELECT mr.target_id, SUM(sc.play_count) as merged_count
      FROM merge_rules mr
      JOIN (
        SELECT ta.artist_id, COUNT(*) as play_count
        FROM listening_history lh
        JOIN track_artists ta ON ta.track_id = lh.track_id
        WHERE lh.user_id = ${userId}
        GROUP BY ta.artist_id
      ) sc ON sc.artist_id = mr.source_id
      WHERE mr.entity_type = 'artist' AND mr.user_id = ${userId}
      GROUP BY mr.target_id
    ) ms ON ms.target_id = a.spotify_id
    WHERE a.spotify_id NOT IN (SELECT source_id FROM merge_rules WHERE entity_type = 'artist' AND user_id = ${userId})
      AND (si.entity_id IS NOT NULL OR unaccent(a.name) LIKE ${likeTerm})
    ORDER BY (si.entity_id IS NOT NULL) DESC, playCount DESC
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
    LEFT JOIN (SELECT entity_id FROM search_index WHERE search_index MATCH ${ftsQuery} AND entity_type = 'album') si
      ON si.entity_id = al.spotify_id
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
      WHERE mr.entity_type = 'album' AND mr.user_id = ${userId}
      GROUP BY mr.target_id
    ) ms ON ms.target_id = al.spotify_id
    WHERE al.spotify_id NOT IN (SELECT source_id FROM merge_rules WHERE entity_type = 'album' AND user_id = ${userId})
      AND (si.entity_id IS NOT NULL OR unaccent(al.name) LIKE ${likeTerm})
    ORDER BY (si.entity_id IS NOT NULL) DESC, playCount DESC
    LIMIT ${limit}
  `) as any[];

  const trackRows = db.all(sql`
    SELECT t.spotify_id as id, t.name,
           al.image_url as albumImageUrl,
           ar.name as artistName,
           COALESCE(s.play_count, 0) + COALESCE(ms.merged_count, 0) as playCount
    FROM tracks t
    LEFT JOIN (SELECT entity_id FROM search_index WHERE search_index MATCH ${ftsQuery} AND entity_type = 'track') si
      ON si.entity_id = t.spotify_id
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
    LEFT JOIN (
      SELECT mr.target_id, SUM(sc.play_count) as merged_count
      FROM merge_rules mr
      JOIN (
        SELECT track_id, COUNT(*) as play_count
        FROM listening_history WHERE user_id = ${userId} GROUP BY track_id
      ) sc ON sc.track_id = mr.source_id
      WHERE mr.entity_type = 'track' AND mr.user_id = ${userId}
      GROUP BY mr.target_id
    ) ms ON ms.target_id = t.spotify_id
    WHERE t.spotify_id NOT IN (SELECT source_id FROM merge_rules WHERE entity_type = 'track' AND user_id = ${userId})
      AND (si.entity_id IS NOT NULL OR unaccent(t.name) LIKE ${likeTerm} OR unaccent(ar.name) LIKE ${likeTerm})
    ORDER BY (si.entity_id IS NOT NULL) DESC, playCount DESC
    LIMIT ${limit}
  `) as any[];

  const libraryRows = db.all(sql`
    SELECT sp.id, sp.name, sp.image_url as imageUrl,
           COALESCE(sp.owner_name, 'Playlist') as subtitle,
           sp.track_count as trackCount,
           sp.spotify_id as spotifyId,
           'library' as source
    FROM spotify_playlists sp
    LEFT JOIN (SELECT entity_id FROM search_index WHERE search_index MATCH ${ftsQuery} AND entity_type = 'playlist_library') si
      ON CAST(sp.id AS TEXT) = si.entity_id
    WHERE sp.user_id = ${userId}
      AND (si.entity_id IS NOT NULL OR unaccent(sp.name) LIKE ${likeTerm})
    ORDER BY sp.track_count DESC
    LIMIT ${limit}
  `) as any[];

  const generatedRows = db.all(sql`
    SELECT gp.id, gp.name, NULL as imageUrl,
           REPLACE(gp.strategy, '_', ' ') as subtitle,
           gp.track_count as trackCount,
           gp.spotify_playlist_id as spotifyId,
           'generated' as source
    FROM generated_playlists gp
    LEFT JOIN (SELECT entity_id FROM search_index WHERE search_index MATCH ${ftsQuery} AND entity_type = 'playlist_generated') si
      ON CAST(gp.id AS TEXT) = si.entity_id
    WHERE gp.user_id = ${userId}
      AND (si.entity_id IS NOT NULL OR unaccent(gp.name) LIKE ${likeTerm})
    ORDER BY gp.track_count DESC
    LIMIT ${limit}
  `) as any[];

  const playlistRows = [...libraryRows, ...generatedRows]
    .sort((a, b) => b.trackCount - a.trackCount)
    .slice(0, limit);

  return { artists: artistRows, albums: albumRows, tracks: trackRows, playlists: playlistRows };
}

export function getDiscoverySeries(db: Db, entityType: string, granularity: string, rangeStart: string | null, rangeEnd: string | null, userId: number) {
  const uf = userFilter(userId);
  const rw = rangeWhere(rangeStart, rangeEnd);
  const dateTrunc = granularity === 'month'
    ? sql`strftime('%Y-%m', lh.played_at)`
    : granularity === 'week'
    ? sql`strftime('%Y-W%W', lh.played_at)`
    : sql`date(lh.played_at)`;

  let rows: { period: string; distinct_count: number }[];

  if (entityType === 'album') {
    rows = db.all(sql`
      SELECT ${dateTrunc} as period, COUNT(DISTINCT COALESCE(mr_album.target_id, t.album_id)) as distinct_count
      FROM listening_history lh
      JOIN tracks t ON t.spotify_id = lh.track_id
      LEFT JOIN merge_rules mr_album ON mr_album.entity_type = 'album' AND mr_album.source_id = t.album_id AND mr_album.user_id = ${userId}
      WHERE t.album_id IS NOT NULL ${uf} ${rw}
      GROUP BY period ORDER BY period
    `) as typeof rows;
  } else if (entityType === 'artist') {
    rows = db.all(sql`
      SELECT ${dateTrunc} as period, COUNT(DISTINCT COALESCE(mr_artist.target_id, ta.artist_id)) as distinct_count
      FROM listening_history lh
      JOIN track_artists ta ON ta.track_id = lh.track_id
      LEFT JOIN merge_rules mr_artist ON mr_artist.entity_type = 'artist' AND mr_artist.source_id = ta.artist_id AND mr_artist.user_id = ${userId}
      WHERE 1=1 ${uf} ${rw}
      GROUP BY period ORDER BY period
    `) as typeof rows;
  } else {
    rows = db.all(sql`
      SELECT ${dateTrunc} as period, COUNT(DISTINCT COALESCE(mr_track.target_id, lh.track_id)) as distinct_count
      FROM listening_history lh
      LEFT JOIN merge_rules mr_track ON mr_track.entity_type = 'track' AND mr_track.source_id = lh.track_id AND mr_track.user_id = ${userId}
      WHERE 1=1 ${uf} ${rw}
      GROUP BY period ORDER BY period
    `) as typeof rows;
  }

  let cumulative = 0;
  return rows.map(r => ({ period: r.period, distinct_count: r.distinct_count, cumulative: (cumulative += r.distinct_count) }));
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

// --- album covers ---

export function getAlbumCovers(db: Db, albumId: string) {
  return db.all(sql`
    SELECT id, album_id, image_url, source, observed_at
    FROM album_covers
    WHERE album_id = ${albumId}
    ORDER BY observed_at DESC
  `) as { id: number; album_id: string; image_url: string; source: string; observed_at: string }[];
}

export function setAlbumCover(db: Db, albumId: string, imageUrl: string) {
  db.run(sql`UPDATE albums SET image_url = ${imageUrl}, updated_at = datetime('now') WHERE spotify_id = ${albumId}`);
}

export function insertAlbumCover(db: Db, albumId: string, imageUrl: string, source: string) {
  db.run(sql`INSERT OR IGNORE INTO album_covers (album_id, image_url, source) VALUES (${albumId}, ${imageUrl}, ${source})`);
}

export function rebuildPlaylistSearchIndex(db: Db, userId: number) {
  db.run(sql`DELETE FROM search_index WHERE entity_type = 'playlist_library' AND entity_id IN (
    SELECT CAST(id AS TEXT) FROM spotify_playlists WHERE user_id = ${userId}
  )`);
  db.run(sql`DELETE FROM search_index WHERE entity_type = 'playlist_generated' AND entity_id IN (
    SELECT CAST(id AS TEXT) FROM generated_playlists WHERE user_id = ${userId}
  )`);
  db.run(sql`INSERT INTO search_index (entity_id, entity_type, name, extra_text)
    SELECT CAST(id AS TEXT), 'playlist_library', name, COALESCE(owner_name, '')
    FROM spotify_playlists WHERE user_id = ${userId}`);
  db.run(sql`INSERT INTO search_index (entity_id, entity_type, name, extra_text)
    SELECT CAST(id AS TEXT), 'playlist_generated', name, strategy
    FROM generated_playlists WHERE user_id = ${userId}`);
}
