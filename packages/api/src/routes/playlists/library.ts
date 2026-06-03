import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { getDb } from '../../db/connection.js';
import { PLAYLIST_SCOPES } from '../../constants.js';
import { hasRequiredScopes } from '../../services/token-manager.js';
import { spotifyFetchRaw } from '../../services/spotify-client.js';
import { enrichTrack, getLibraryPlaylists, getPlaylistTrackStats, getPlaylistGenres, getPlaylistSeries } from '../../db/queries/index.js';
import { syncUserPlaylists } from '../../services/playlist-sync.js';
import type { AppVariables } from '../../app.js';

const library = new Hono<{ Variables: AppVariables }>();

// listar playlists sincronizadas (metadata ligera)
library.get('/library', (c) => {
  const userId = c.get('userId');
  const db = getDb();
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 200);
  const offset = parseInt(c.req.query('offset') || '0');

  const { items, total } = getLibraryPlaylists(db, userId, limit, offset);

  return c.json({
    items: items.map(r => ({
      id: r.id,
      spotifyId: r.spotify_id,
      name: r.name,
      imageUrl: r.image_url,
      ownerName: r.owner_name,
      isOwned: !!r.is_owned,
      isAlgorithmic: !!r.is_algorithmic,
      trackCount: r.track_count,
      lastSyncedAt: r.last_synced_at,
    })),
    total,
  });
});

// sync manual
library.post('/library/sync', async (c) => {
  const userId = c.get('userId');
  await syncUserPlaylists(userId);
  return c.json({ success: true });
});

// agregar track a playlist
library.post('/library/:id/tracks', async (c) => {
  const userId = c.get('userId');
  const db = getDb();
  const playlistId = parseInt(c.req.param('id'));
  const { trackId } = await c.req.json<{ trackId: string }>();

  if (!trackId) return c.json({ error: 'trackId requerido' }, 400);

  const row = db.get(sql`
    SELECT id, spotify_id, is_owned FROM spotify_playlists
    WHERE id = ${playlistId} AND user_id = ${userId}
  `) as any;

  if (!row) return c.json({ error: 'playlist no encontrada' }, 404);
  if (!row.is_owned) return c.json({ error: 'no se puede modificar playlist ajena' }, 403);

  if (!hasRequiredScopes(userId, PLAYLIST_SCOPES)) {
    return c.json({ error: 'missing_scopes', scopes: PLAYLIST_SCOPES }, 403);
  }

  const uri = `spotify:track:${trackId}`;
  const res = await spotifyFetchRaw(
    `/playlists/${row.spotify_id}/tracks`,
    { userId, method: 'POST', body: { uris: [uri] } },
  );
  if (!res) return c.json({ error: 'rate_limited' }, 429);
  if (!res.ok) return c.json({ error: 'spotify_rejected' }, res.status as 400);

  const maxPos = db.get(sql`
    SELECT COALESCE(MAX(position), -1) as maxPos FROM spotify_playlist_tracks WHERE playlist_id = ${playlistId}
  `) as { maxPos: number };

  db.run(sql`
    INSERT OR IGNORE INTO spotify_playlist_tracks (playlist_id, track_id, position, added_at)
    VALUES (${playlistId}, ${trackId}, ${maxPos.maxPos + 1}, ${new Date().toISOString()})
  `);

  db.run(sql`UPDATE spotify_playlists SET track_count = track_count + 1 WHERE id = ${playlistId}`);

  return c.json({ success: true });
});

// eliminar track de playlist
library.delete('/library/:id/tracks', async (c) => {
  const userId = c.get('userId');
  const db = getDb();
  const playlistId = parseInt(c.req.param('id'));
  const { trackId } = await c.req.json<{ trackId: string }>();

  if (!trackId) return c.json({ error: 'trackId requerido' }, 400);

  const row = db.get(sql`
    SELECT id, spotify_id, is_owned FROM spotify_playlists
    WHERE id = ${playlistId} AND user_id = ${userId}
  `) as any;

  if (!row) return c.json({ error: 'playlist no encontrada' }, 404);
  if (!row.is_owned) return c.json({ error: 'no se puede modificar playlist ajena' }, 403);

  if (!hasRequiredScopes(userId, PLAYLIST_SCOPES)) {
    return c.json({ error: 'missing_scopes', scopes: PLAYLIST_SCOPES }, 403);
  }

  const uri = `spotify:track:${trackId}`;
  const res = await spotifyFetchRaw(
    `/playlists/${row.spotify_id}/tracks`,
    { userId, method: 'DELETE', body: { tracks: [{ uri }] } },
  );
  if (!res) return c.json({ error: 'rate_limited' }, 429);
  if (!res.ok) return c.json({ error: 'spotify_rejected' }, res.status as 400);

  db.run(sql`
    DELETE FROM spotify_playlist_tracks WHERE playlist_id = ${playlistId} AND track_id = ${trackId}
  `);

  db.run(sql`UPDATE spotify_playlists SET track_count = MAX(track_count - 1, 0) WHERE id = ${playlistId}`);

  return c.json({ success: true });
});

// detalle de una playlist de biblioteca
library.get('/library/:id', (c) => {
  const userId = c.get('userId');
  const db = getDb();
  const id = parseInt(c.req.param('id'));

  const row = db.get(sql`
    SELECT * FROM spotify_playlists WHERE id = ${id} AND user_id = ${userId}
  `) as any;

  if (!row) return c.json({ error: 'playlist no encontrada' }, 404);

  const sort = c.req.query('sort') === 'plays' ? 'plays' : 'time';
  const trackStats = getPlaylistTrackStats(db, id, userId, sort);
  const genres = getPlaylistGenres(db, id);
  const series = getPlaylistSeries(db, id, userId);

  const tracksPlayed = trackStats.filter(t => t.play_count > 0).length;

  return c.json({
    playlist: {
      id: row.id,
      spotifyId: row.spotify_id,
      name: row.name,
      imageUrl: row.image_url,
      ownerName: row.owner_name,
      isOwned: !!row.is_owned,
      isAlgorithmic: !!row.is_algorithmic,
      trackCount: row.track_count,
      lastSyncedAt: row.last_synced_at,
    },
    tracks: trackStats.map(t => ({
      trackId: t.track_id,
      position: t.position,
      addedAt: t.added_at,
      playCount: t.play_count,
      totalMs: t.total_ms,
      lastPlayed: t.last_played,
      track: enrichTrack(db, t.track_id),
    })),
    genres,
    series,
    coverage: {
      tracksPlayed,
      totalTracks: row.track_count,
      percent: row.track_count > 0 ? Math.round((tracksPlayed / row.track_count) * 100) : 0,
    },
    stats: {
      totalPlays: trackStats.reduce((s, t) => s + t.play_count, 0),
      totalMs: trackStats.reduce((s, t) => s + t.total_ms, 0),
    },
  });
});

export default library;
