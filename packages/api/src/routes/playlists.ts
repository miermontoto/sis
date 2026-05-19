import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { generatedPlaylists, generatedPlaylistTracks, userSettings } from '../db/schema.js';
import { PLAYLIST_SCOPES } from '../constants.js';
import { hasRequiredScopes } from '../services/token-manager.js';
import { spotifyFetch, spotifyFetchRaw } from '../services/spotify-client.js';
import {
  enrichTrack,
  strategyTopRange, strategyTopArtist, strategyTopGenre,
  strategyDeepCuts, strategyTimeVibes, strategyRediscovery,
  strategyTop, strategyChart,
  resolveEntitiesToTracks,
  getLibraryPlaylists, getPlaylistTrackStats, getPlaylistGenres, getPlaylistSeries,
} from '../db/queries/index.js';
import { syncCreatedPlaylistToLibrary, syncUserPlaylists } from '../services/playlist-sync.js';
import { getCachedRecords } from '../services/records-cache.js';
import type {
  TopRangeParams, TopArtistParams, TopGenreParams,
  DeepCutsParams, TimeVibesParams, RediscoveryParams,
  TopParams, ChartParams,
} from '../db/queries/index.js';
import type { Sort } from '../db/queries/helpers.js';
import type { RecordEntry, ArtistRecordEntry, WeekStartOption, RankingMetric } from '@sis/shared';
import type { AppVariables } from '../app.js';

const playlists = new Hono<{ Variables: AppVariables }>();

type Strategy = 'top_range' | 'top_artist' | 'top_genre' | 'deep_cuts' | 'time_vibes' | 'rediscovery' | 'record' | 'top' | 'chart';

const STRATEGY_LABELS: Record<Strategy, string> = {
  top_range: 'Top Tracks',
  top_artist: 'Top Artist',
  top_genre: 'Top Genre',
  deep_cuts: 'Deep Cuts',
  time_vibes: 'Time Vibes',
  rediscovery: 'Rediscovery',
  record: 'Record',
  top: 'Top',
  chart: 'Chart',
};

const RECORD_KEY_TITLES: Record<string, string> = {
  peakWeekPlays: 'Peak Week',
  biggestDebuts: 'Biggest Debuts',
  mostWeeksAtNo1: 'Most Weeks at #1',
  mostWeeksInTop5: 'Most Charted',
  longestChartRun: 'Longest Chart Run',
  inMostPlaylists: 'In Most Playlists',
  longestGap: 'Longest Gap',
  goldenOldies: 'Golden Oldies',
  latestDiscoveries: 'Latest Discoveries',
  mostAccolades: 'Most Records',
  topNoAlbum: 'Top No Album',
  mostDistinctTracks: 'Most Distinct Tracks',
  oneHitWonders: 'One-Hit Wonders',
  mostNo1Tracks: 'Most #1 Tracks',
  mostNo1Albums: 'Most #1 Albums',
};

const ARTIST_RECORD_KEYS = new Set(['mostNo1Tracks', 'mostNo1Albums']);
const UNSUPPORTED_RECORD_KEYS = new Set(['mostUniquePerMonth', 'yearEndFinishes']);

// leer la preferencia de ranking metric del usuario (time o plays)
function getUserSort(db: ReturnType<typeof getDb>, userId: number): Sort {
  const row = db.get(sql`
    SELECT value FROM user_settings WHERE user_id = ${String(userId)} AND key = 'rankingMetric'
  `) as { value: string } | undefined;
  return (row?.value === 'plays' ? 'plays' : 'time') as Sort;
}

type RecordEntityType = 'track' | 'album' | 'artist';
type RecordResolveResult = { trackIds: string[] } | { error: string; status: 400 | 404 };

function resolveRecordTracks(db: ReturnType<typeof getDb>, userId: number, params: Record<string, unknown>): RecordResolveResult {
  const recordKey = typeof params.recordKey === 'string' ? params.recordKey : '';
  const entityType = params.entityType as RecordEntityType;
  const ws = (['monday', 'sunday', 'friday'].includes(params.weekStart as string)
    ? params.weekStart
    : 'monday') as WeekStartOption;
  const sort: RankingMetric = params.sort === 'plays' ? 'plays' : 'time';
  const limit = Math.min(Math.max(Number(params.limit) || 50, 1), 50);

  if (!recordKey || UNSUPPORTED_RECORD_KEYS.has(recordKey)) {
    return { error: 'record key no soportado', status: 400 };
  }
  if (!['track', 'album', 'artist'].includes(entityType)) {
    return { error: 'entity type no soportado', status: 400 };
  }

  const pluralTab = entityType === 'track' ? 'tracks' : entityType === 'album' ? 'albums' : 'artists';
  const cached = getCachedRecords(userId, ws, sort, limit, entityType);
  const tabData = cached?.[pluralTab] as Record<string, unknown> | undefined;
  const list = tabData?.[recordKey];

  if (!Array.isArray(list)) {
    return { error: 'records no disponibles en cache', status: 404 };
  }

  const tracksPerEntity = entityType === 'track' ? 1 : 3;
  let entityIds: string[];
  let resolveAs: RecordEntityType = entityType;

  if (ARTIST_RECORD_KEYS.has(recordKey)) {
    entityIds = (list as ArtistRecordEntry[])
      .map(e => e.artistId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    resolveAs = 'artist';
  } else {
    entityIds = (list as RecordEntry[])
      .map(e => e.entityId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
  }

  return { trackIds: resolveEntitiesToTracks(db, userId, resolveAs, entityIds, tracksPerEntity) };
}

function runStrategy(db: ReturnType<typeof getDb>, userId: number, strategy: Strategy, params: Record<string, unknown>): string[] {
  const sort = getUserSort(db, userId);
  const p = { ...params, sort };

  switch (strategy) {
    case 'record': {
      const result = resolveRecordTracks(db, userId, params);
      return 'trackIds' in result ? result.trackIds : [];
    }
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
    case 'top':
      return strategyTop(db, userId, p as unknown as TopParams);
    case 'chart':
      return strategyChart(db, userId, p as unknown as ChartParams);
    default:
      return [];
  }
}

const ENTITY_LABELS: Record<string, string> = { track: 'Tracks', album: 'Albums', artist: 'Artists' };
const RANGE_LABELS: Record<string, string> = {
  week: 'Week', month: 'Month', '3months': '3 Months', '6months': '6 Months',
  year: 'Year', thisYear: 'This Year', all: 'All Time', custom: 'Custom',
};

function formatCustomRange(startDate: string, endDate: string): string {
  const s = new Date(startDate + 'T00:00:00');
  const e = new Date(endDate + 'T00:00:00');
  const sameYear = s.getFullYear() === e.getFullYear();
  const fmt = (d: Date, includeYear: boolean) =>
    d.toLocaleString('en', { month: 'short', day: 'numeric', ...(includeYear ? { year: 'numeric' } : {}) });
  return `${fmt(s, !sameYear)} – ${fmt(e, true)}`;
}

function autoName(strategy: Strategy, params?: Record<string, unknown>): string {
  const now = new Date();
  const month = now.toLocaleString('en', { month: 'short', year: 'numeric' });
  if (strategy === 'record' && params?.recordKey) {
    const title = RECORD_KEY_TITLES[params.recordKey as string] || 'Record';
    return `[SIS] ${title} — ${month}`;
  }
  if (strategy === 'top' && params?.entityType) {
    const entity = ENTITY_LABELS[params.entityType as string] || 'Tracks';
    if (params.range === 'custom' && params.startDate && params.endDate) {
      const rangeStr = formatCustomRange(params.startDate as string, params.endDate as string);
      return `[SIS] Top ${entity} — ${rangeStr}`;
    }
    const range = RANGE_LABELS[params.range as string] || '';
    return `[SIS] Top ${entity}${range ? ` (${range})` : ''} — ${month}`;
  }
  if (strategy === 'chart' && params?.period) {
    const entity = ENTITY_LABELS[params.entityType as string] || 'Tracks';
    return `[SIS] Chart ${entity} (${params.period}) — ${month}`;
  }
  return `[SIS] ${STRATEGY_LABELS[strategy]} — ${month}`;
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
  let trackIds: string[];

  if (strategy === 'record') {
    const result = resolveRecordTracks(db, userId, params);
    if ('error' in result) return c.json({ error: result.error }, result.status);
    trackIds = result.trackIds;
  } else {
    trackIds = runStrategy(db, userId, strategy, params);
  }

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
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
    total: total.count,
  });
});

// ==================== LIBRARY (V2) ====================

// listar playlists sincronizadas (metadata ligera)
playlists.get('/library', (c) => {
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
playlists.post('/library/sync', async (c) => {
  const userId = c.get('userId');
  await syncUserPlaylists(userId);
  return c.json({ success: true });
});

// agregar track a playlist
playlists.post('/library/:id/tracks', async (c) => {
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
playlists.delete('/library/:id/tracks', async (c) => {
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
playlists.get('/library/:id', (c) => {
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

// ==================== GENERATED (V1) ====================

// detalle de una playlist generada
playlists.get('/:id', (c) => {
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

// regenerar playlist (re-ejecutar estrategia y actualizar en spotify)
playlists.post('/:id/regenerate', async (c) => {
  const userId = c.get('userId');
  const db = getDb();
  const id = parseInt(c.req.param('id'));

  const row = db.get(sql`
    SELECT * FROM generated_playlists WHERE id = ${id} AND user_id = ${userId}
  `) as any;

  if (!row) return c.json({ error: 'playlist no encontrada' }, 404);

  const params = typeof row.params === 'string' ? JSON.parse(row.params) : row.params;
  const strategy = row.strategy as Strategy;
  const resolved = strategy === 'record'
    ? resolveRecordTracks(db, userId, params)
    : { trackIds: runStrategy(db, userId, strategy, params) };
  if ('error' in resolved) return c.json({ error: resolved.error }, resolved.status);
  const trackIds = resolved.trackIds;

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
  db.insert(generatedPlaylistTracks).values(
    trackIds.map((tid, i) => ({ playlistId: id, trackId: tid, position: i + 1 }))
  ).run();

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
