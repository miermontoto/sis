import { sql, eq } from 'drizzle-orm';
import type { Db } from './helpers.js';
import { rangeWhere, userFilter } from './helpers.js';
import { tracks, albums, artists, trackArtists } from '../schema.js';

/** Enriquecer track con metadata completa (álbum + artistas) */
export function enrichTrack(db: Db, trackId: string) {
  const track = db.select().from(tracks).where(eq(tracks.spotifyId, trackId)).get();
  if (!track) return null;
  const album = track.albumId
    ? db.select().from(albums).where(eq(albums.spotifyId, track.albumId)).get()
    : null;
  const artRows = db.select().from(trackArtists).where(eq(trackArtists.trackId, trackId)).all();
  const arts = artRows
    .sort((a, b) => a.position - b.position)
    .map(ta => db.select().from(artists).where(eq(artists.spotifyId, ta.artistId)).get())
    .filter(Boolean);
  return {
    id: track.spotifyId,
    name: track.name,
    durationMs: track.durationMs,
    album: album ? { id: album.spotifyId, name: album.name, imageUrl: album.imageUrl } : null,
    artists: arts.map(a => ({ id: a!.spotifyId, name: a!.name })),
  };
}

/** Desglose por álbum (en qué álbumes se escuchó un track) */
export function getTrackAlbumBreakdown(db: Db, trackId: string, rangeStart: string | null, rangeEnd: string | null | undefined, userId: number) {
  const wr = rangeWhere(rangeStart, rangeEnd);
  const uf = userFilter(userId);

  return db.all(sql`
    SELECT t.album_id, count(*) as play_count, sum(t.duration_ms) as total_ms
    FROM listening_history lh
    JOIN tracks t ON t.spotify_id = lh.track_id
    WHERE lh.track_id = ${trackId} ${wr} ${uf}
      AND t.album_id IS NOT NULL
    GROUP BY t.album_id
    ORDER BY play_count DESC
  `) as { album_id: string; play_count: number; total_ms: number }[];
}
