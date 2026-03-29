import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { generatedPlaylists, generatedPlaylistTracks, userSettings } from '../db/schema.js';
import { PLAYLIST_SCOPES } from '../constants.js';
import { hasRequiredScopes } from '../services/token-manager.js';
import { spotifyFetch } from '../services/spotify-client.js';
import {
  enrichTrack,
  strategyTopRange, strategyTopArtist, strategyTopGenre,
  strategyDeepCuts, strategyTimeVibes, strategyRediscovery,
} from '../db/queries/index.js';
import type {
  TopRangeParams, TopArtistParams, TopGenreParams,
  DeepCutsParams, TimeVibesParams, RediscoveryParams,
} from '../db/queries/index.js';
import type { Sort } from '../db/queries/helpers.js';
import type { AppVariables } from '../app.js';

const playlists = new Hono<{ Variables: AppVariables }>();

type Strategy = 'top_range' | 'top_artist' | 'top_genre' | 'deep_cuts' | 'time_vibes' | 'rediscovery';

const STRATEGY_LABELS: Record<Strategy, string> = {
  top_range: 'Top Tracks',
  top_artist: 'Top Artist',
  top_genre: 'Top Genre',
  deep_cuts: 'Deep Cuts',
  time_vibes: 'Time Vibes',
  rediscovery: 'Rediscovery',
};

// leer la preferencia de ranking metric del usuario (time o plays)
function getUserSort(db: ReturnType<typeof getDb>, userId: number): Sort {
  const row = db.all(sql`
    SELECT value FROM user_settings WHERE user_id = ${String(userId)} AND key = 'rankingMetric'
  `)[0] as { value: string } | undefined;
  return (row?.value === 'plays' ? 'plays' : 'time') as Sort;
}

function runStrategy(db: ReturnType<typeof getDb>, userId: number, strategy: Strategy, params: Record<string, unknown>): string[] {
  const sort = getUserSort(db, userId);
  const p = { ...params, sort };

  switch (strategy) {
    case 'top_range':
      return strategyTopRange(db, userId, p as unknown as TopRangeParams);
    case 'top_artist':
      return strategyTopArtist(db, userId, p as unknown as TopArtistParams);
    case 'top_genre':
      return strategyTopGenre(db, userId, p as unknown as TopGenreParams);
    case 'deep_cuts':
      return strategyDeepCuts(db, userId, p as unknown as DeepCutsParams);
    case 'time_vibes':
      return strategyTimeVibes(db, userId, p as unknown as TimeVibesParams);
    case 'rediscovery':
      return strategyRediscovery(db, userId, p as unknown as RediscoveryParams);
    default:
      return [];
  }
}

function autoName(strategy: Strategy): string {
  const now = new Date();
  const month = now.toLocaleString('en', { month: 'short', year: 'numeric' });
  return `SIS — ${STRATEGY_LABELS[strategy]} — ${month}`;
}

// generar playlist (preview o crear en spotify)
playlists.post('/generate', async (c) => {
  const userId = c.get('userId');
  const spotifyId = c.get('spotifyId');
  const db = getDb();

  const body = await c.req.json<{
    strategy: Strategy;
    params: Record<string, unknown>;
    name?: string;
    preview?: boolean;
  }>();

  const { strategy, params, preview } = body;

  if (!STRATEGY_LABELS[strategy]) {
    return c.json({ error: 'estrategia inválida' }, 400);
  }

  // ejecutar estrategia
  const trackIds = runStrategy(db, userId, strategy, params);

  if (trackIds.length === 0) {
    return c.json({ error: 'no se encontraron tracks con estos criterios' }, 404);
  }

  // enriquecer tracks
  const enrichedTracks = trackIds.map((id, i) => ({
    position: i + 1,
    track: enrichTrack(db, id),
  }));

  // si es preview, retornar sin crear
  if (preview) {
    return c.json({ tracks: enrichedTracks });
  }

  // verificar scopes para crear en spotify
  if (!hasRequiredScopes(userId, PLAYLIST_SCOPES)) {
    return c.json({ error: 'missing_scopes', scopes: PLAYLIST_SCOPES }, 403);
  }

  const playlistName = body.name || autoName(strategy);

  // crear playlist en spotify
  const created = await spotifyFetch<{ id: string; external_urls: { spotify: string } }>(
    `/users/${spotifyId}/playlists`,
    { userId, method: 'POST', body: { name: playlistName, description: '', public: false } },
  );

  if (!created) {
    return c.json({ error: 'error al crear playlist en Spotify' }, 502);
  }

  console.log(`[playlists] creada playlist ${created.id} con ${trackIds.length} tracks`);

  // agregar tracks (máx 100 por request)
  const uris = trackIds.map(id => `spotify:track:${id}`);
  for (let i = 0; i < uris.length; i += 100) {
    const batch = uris.slice(i, i + 100);
    const addResult = await spotifyFetch<{ snapshot_id: string }>(`/playlists/${created.id}/tracks`, {
      userId,
      method: 'POST',
      body: { uris: batch },
    });
    console.log(`[playlists] añadidos ${batch.length} tracks, snapshot: ${addResult?.snapshot_id ?? 'ERROR'}`);
  }

  // guardar en DB
  const row = db.insert(generatedPlaylists).values({
    userId,
    spotifyPlaylistId: created.id,
    name: playlistName,
    strategy,
    params,
    trackCount: trackIds.length,
  }).returning().get();

  // guardar tracks
  for (let i = 0; i < trackIds.length; i++) {
    db.insert(generatedPlaylistTracks).values({
      playlistId: row.id,
      trackId: trackIds[i],
      position: i + 1,
    }).run();
  }

  return c.json({
    id: row.id,
    spotifyPlaylistId: created.id,
    spotifyUrl: created.external_urls.spotify,
    name: playlistName,
    strategy,
    params,
    trackCount: trackIds.length,
    tracks: enrichedTracks,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
});

// listar playlists del usuario
playlists.get('/', (c) => {
  const userId = c.get('userId');
  const db = getDb();
  const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100);
  const offset = parseInt(c.req.query('offset') || '0');

  const rows = db.all(sql`
    SELECT * FROM generated_playlists
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `) as any[];

  const total = db.all(sql`
    SELECT count(*) as count FROM generated_playlists WHERE user_id = ${userId}
  `)[0] as { count: number };

  return c.json({
    items: rows.map(r => ({
      id: r.id,
      spotifyPlaylistId: r.spotify_playlist_id,
      name: r.name,
      strategy: r.strategy,
      params: typeof r.params === 'string' ? JSON.parse(r.params) : r.params,
      trackCount: r.track_count,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
    total: total.count,
  });
});

// detalle de una playlist
playlists.get('/:id', (c) => {
  const userId = c.get('userId');
  const db = getDb();
  const id = parseInt(c.req.param('id'));

  const row = db.all(sql`
    SELECT * FROM generated_playlists WHERE id = ${id} AND user_id = ${userId}
  `)[0] as any;

  if (!row) return c.json({ error: 'playlist no encontrada' }, 404);

  const trackRows = db.all(sql`
    SELECT track_id, position FROM generated_playlist_tracks
    WHERE playlist_id = ${id}
    ORDER BY position ASC
  `) as { track_id: string; position: number }[];

  const tracks = trackRows.map(tr => ({
    position: tr.position,
    track: enrichTrack(db, tr.track_id),
  }));

  return c.json({
    id: row.id,
    spotifyPlaylistId: row.spotify_playlist_id,
    name: row.name,
    strategy: row.strategy,
    params: typeof row.params === 'string' ? JSON.parse(row.params) : row.params,
    trackCount: row.track_count,
    tracks,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
});

// eliminar playlist
playlists.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const db = getDb();
  const id = parseInt(c.req.param('id'));
  const removeFromSpotify = c.req.query('spotify') === 'true';

  const row = db.all(sql`
    SELECT * FROM generated_playlists WHERE id = ${id} AND user_id = ${userId}
  `)[0] as any;

  if (!row) return c.json({ error: 'playlist no encontrada' }, 404);

  if (removeFromSpotify && row.spotify_playlist_id) {
    await spotifyFetch(`/playlists/${row.spotify_playlist_id}/followers`, {
      userId,
      method: 'DELETE',
    });
  }

  db.run(sql`DELETE FROM generated_playlist_tracks WHERE playlist_id = ${id}`);
  db.run(sql`DELETE FROM generated_playlists WHERE id = ${id}`);

  return c.json({ success: true });
});

// regenerar playlist (re-ejecutar estrategia y actualizar en spotify)
playlists.post('/:id/regenerate', async (c) => {
  const userId = c.get('userId');
  const db = getDb();
  const id = parseInt(c.req.param('id'));

  const row = db.all(sql`
    SELECT * FROM generated_playlists WHERE id = ${id} AND user_id = ${userId}
  `)[0] as any;

  if (!row) return c.json({ error: 'playlist no encontrada' }, 404);

  const params = typeof row.params === 'string' ? JSON.parse(row.params) : row.params;
  const trackIds = runStrategy(db, userId, row.strategy as Strategy, params);

  if (trackIds.length === 0) {
    return c.json({ error: 'no se encontraron tracks con estos criterios' }, 404);
  }

  if (row.spotify_playlist_id) {
    if (!hasRequiredScopes(userId, PLAYLIST_SCOPES)) {
      return c.json({ error: 'missing_scopes', scopes: PLAYLIST_SCOPES }, 403);
    }

    const uris = trackIds.map(tid => `spotify:track:${tid}`);
    await spotifyFetch(`/playlists/${row.spotify_playlist_id}/tracks`, {
      userId,
      method: 'PUT',
      body: { uris: uris.slice(0, 100) },
    });
    for (let i = 100; i < uris.length; i += 100) {
      await spotifyFetch(`/playlists/${row.spotify_playlist_id}/tracks`, {
        userId,
        method: 'POST',
        body: { uris: uris.slice(i, i + 100) },
      });
    }
  }

  db.run(sql`DELETE FROM generated_playlist_tracks WHERE playlist_id = ${id}`);
  for (let i = 0; i < trackIds.length; i++) {
    db.insert(generatedPlaylistTracks).values({
      playlistId: id,
      trackId: trackIds[i],
      position: i + 1,
    }).run();
  }

  const now = new Date().toISOString();
  db.run(sql`UPDATE generated_playlists SET track_count = ${trackIds.length}, updated_at = ${now} WHERE id = ${id}`);

  const enrichedTracks = trackIds.map((tid, i) => ({
    position: i + 1,
    track: enrichTrack(db, tid),
  }));

  return c.json({
    id: row.id,
    spotifyPlaylistId: row.spotify_playlist_id,
    name: row.name,
    strategy: row.strategy,
    params,
    trackCount: trackIds.length,
    tracks: enrichedTracks,
    createdAt: row.created_at,
    updatedAt: now,
  });
});

export default playlists;
