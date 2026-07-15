import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { getDb } from '../../db/connection.js';
import { generatedPlaylists, generatedPlaylistTracks } from '../../db/schema.js';
import { PLAYLIST_SCOPES, REGENERATE_INTERVALS_MS } from '../../constants.js';
import { hasRequiredScopes } from '../../services/token-manager.js';
import { spotifyFetch } from '../../services/spotify-client.js';
import { enrichTrack } from '../../db/queries/index.js';
import { syncCreatedPlaylistToLibrary } from '../../services/playlist-sync.js';
import {
  STRATEGY_LABELS,
  resolveTrackIds,
  autoName,
  regeneratePlaylist,
  type Strategy,
} from '../../services/playlist-generation.js';
import type { RegenerateInterval } from '@sis/shared';
import type { AppVariables } from '../../app.js';

const generated = new Hono<{ Variables: AppVariables }>();

// generar playlist (preview o crear en spotify)
generated.post('/generate', async (c) => {
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

  // ejecutar estrategia -> trackIds
  const resolved = resolveTrackIds(db, userId, strategy, params);
  if ('error' in resolved) return c.json({ error: resolved.error }, resolved.status);
  const trackIds = resolved.trackIds;

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

  const playlistName = body.name || autoName(strategy, params);

  // crear playlist en spotify
  const created = await spotifyFetch<{
    id: string;
    external_urls: { spotify: string };
    images?: { url: string }[];
    owner?: { display_name: string | null };
    snapshot_id?: string;
  }>(
    `/users/${spotifyId}/playlists`,
    { userId, method: 'POST', body: { name: playlistName, description: '', public: false } },
  );

  if (!created) {
    return c.json({ error: 'error al crear playlist en Spotify' }, 502);
  }

  console.log(`[playlists] creada playlist ${created.id} con ${trackIds.length} tracks`);

  // agregar tracks (máx 100 por request)
  const uris = trackIds.map(id => `spotify:track:${id}`);
  let snapshotId = created.snapshot_id ?? null;
  for (let i = 0; i < uris.length; i += 100) {
    const batch = uris.slice(i, i + 100);
    const addResult = await spotifyFetch<{ snapshot_id: string }>(`/playlists/${created.id}/tracks`, {
      userId,
      method: 'POST',
      body: { uris: batch },
    });
    snapshotId = addResult?.snapshot_id ?? snapshotId;
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

  db.insert(generatedPlaylistTracks).values(
    trackIds.map((id, i) => ({ playlistId: row.id, trackId: id, position: i + 1 }))
  ).run();

  const libraryPlaylistId = syncCreatedPlaylistToLibrary({
    userId,
    spotifyPlaylistId: created.id,
    name: playlistName,
    ownerName: created.owner?.display_name ?? spotifyId,
    imageUrl: created.images?.[0]?.url ?? null,
    snapshotId,
    trackIds,
  });

  return c.json({
    id: row.id,
    spotifyPlaylistId: created.id,
    libraryPlaylistId,
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
generated.get('/', (c) => {
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

  const total = db.get(sql`
    SELECT count(*) as count FROM generated_playlists WHERE user_id = ${userId}
  `) as { count: number };

  return c.json({
    items: rows.map(r => ({
      id: r.id,
      spotifyPlaylistId: r.spotify_playlist_id,
      name: r.name,
      strategy: r.strategy,
      params: typeof r.params === 'string' ? JSON.parse(r.params) : r.params,
      trackCount: r.track_count,
      autoRegenerate: !!r.auto_regenerate,
      regenerateIntervalMs: r.regenerate_interval_ms ?? null,
      lastRegeneratedAt: r.last_regenerated_at ?? null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
    total: total.count,
  });
});

// detalle de una playlist generada
generated.get('/:id', (c) => {
  const userId = c.get('userId');
  const db = getDb();
  const id = parseInt(c.req.param('id'));

  const row = db.get(sql`
    SELECT * FROM generated_playlists WHERE id = ${id} AND user_id = ${userId}
  `) as any;

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
    autoRegenerate: !!row.auto_regenerate,
    regenerateIntervalMs: row.regenerate_interval_ms ?? null,
    lastRegeneratedAt: row.last_regenerated_at ?? null,
    tracks,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
});

// eliminar playlist
generated.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const db = getDb();
  const id = parseInt(c.req.param('id'));
  const removeFromSpotify = c.req.query('spotify') === 'true';

  const row = db.get(sql`
    SELECT * FROM generated_playlists WHERE id = ${id} AND user_id = ${userId}
  `) as any;

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

// configurar auto-regeneración: activar/desactivar + cadencia (daily/weekly/monthly)
generated.post('/:id/schedule', async (c) => {
  const userId = c.get('userId');
  const db = getDb();
  const id = parseInt(c.req.param('id'));

  const body = await c.req.json<{ autoRegenerate: boolean; interval?: RegenerateInterval }>();

  const row = db.get(sql`
    SELECT id, regenerate_interval_ms, last_regenerated_at
    FROM generated_playlists WHERE id = ${id} AND user_id = ${userId}
  `) as { id: number; regenerate_interval_ms: number | null; last_regenerated_at: string | null } | undefined;

  if (!row) return c.json({ error: 'playlist no encontrada' }, 404);

  const enable = !!body.autoRegenerate;
  let intervalMs: number | null = row.regenerate_interval_ms ?? null;

  if (enable) {
    const preset = body.interval;
    if (!preset || !(preset in REGENERATE_INTERVALS_MS)) {
      return c.json({ error: 'cadencia inválida' }, 400);
    }
    intervalMs = REGENERATE_INTERVALS_MS[preset];
  }

  const now = new Date().toISOString();
  // al activar, anclar last_regenerated_at a ahora para que la 1ª auto-regen sea
  // un intervalo después (no inmediata aunque la playlist sea antigua)
  const lastRegen = enable ? now : row.last_regenerated_at ?? null;

  db.run(sql`
    UPDATE generated_playlists
    SET auto_regenerate = ${enable ? 1 : 0},
        regenerate_interval_ms = ${intervalMs},
        last_regenerated_at = ${lastRegen},
        updated_at = ${now}
    WHERE id = ${id}
  `);

  return c.json({
    id,
    autoRegenerate: enable,
    regenerateIntervalMs: intervalMs,
    lastRegeneratedAt: lastRegen,
  });
});

// regenerar playlist (re-ejecutar estrategia y actualizar en spotify)
generated.post('/:id/regenerate', async (c) => {
  const userId = c.get('userId');
  const id = parseInt(c.req.param('id'));

  const result = await regeneratePlaylist(userId, id);
  if (!result.ok) {
    return result.scopes
      ? c.json({ error: result.error, scopes: result.scopes }, result.status)
      : c.json({ error: result.error }, result.status);
  }

  return c.json(result.playlist);
});

export default generated;
