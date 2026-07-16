// lógica reutilizable de generación/regeneración de playlists: resolución de la
// estrategia a trackIds, naming automático, escritura en Spotify y el flujo de
// regeneración completo. extraído de routes/playlists/generated.ts para que tanto
// la ruta (regeneración manual) como el scheduler (auto-regeneración) lo compartan.
import { sql } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { generatedPlaylistTracks } from '../db/schema.js';
import { PLAYLIST_SCOPES } from '../constants.js';
import { hasRequiredScopes } from './token-manager.js';
import { spotifyFetch } from './spotify-client.js';
import { getCachedRecords } from './records-cache.js';
import {
  enrichTrack,
  strategyTopRange, strategyTopArtist, strategyTopGenre,
  strategyDeepCuts, strategyTimeVibes, strategyRediscovery,
  strategyTop, strategyChart,
  resolveEntitiesToTracks,
} from '../db/queries/index.js';
import type {
  TopRangeParams, TopArtistParams, TopGenreParams,
  DeepCutsParams, TimeVibesParams, RediscoveryParams,
  TopParams, ChartParams,
} from '../db/queries/index.js';
import type { Sort } from '../db/queries/helpers.js';
import type { RecordEntry, ArtistRecordEntry, WeekStartOption, RankingMetric, GeneratedPlaylist } from '@sis/shared';

type Db = ReturnType<typeof getDb>;

export type Strategy = 'top_range' | 'top_artist' | 'top_genre' | 'deep_cuts' | 'time_vibes' | 'rediscovery' | 'record' | 'top' | 'chart';

export const STRATEGY_LABELS: Record<Strategy, string> = {
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
  mostDistinctTracks: 'Most Distinct Tracks',
  oneHitWonders: 'One-Hit Wonders',
  mostNo1Tracks: 'Most #1 Tracks',
  mostNo1Albums: 'Most #1 Albums',
};

const ARTIST_RECORD_KEYS = new Set(['mostNo1Tracks', 'mostNo1Albums']);
const UNSUPPORTED_RECORD_KEYS = new Set(['mostUniquePerMonth', 'yearEndFinishes']);

// leer la preferencia de ranking metric del usuario (time o plays)
function getUserSort(db: Db, userId: number): Sort {
  const row = db.get(sql`
    SELECT value FROM user_settings WHERE user_id = ${String(userId)} AND key = 'rankingMetric'
  `) as { value: string } | undefined;
  return (row?.value === 'plays' ? 'plays' : 'time') as Sort;
}

type RecordEntityType = 'track' | 'album' | 'artist';
export type ResolveResult = { trackIds: string[] } | { error: string; status: 400 | 404 };

function resolveRecordTracks(db: Db, userId: number, params: Record<string, unknown>): ResolveResult {
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

function runStrategy(db: Db, userId: number, strategy: Strategy, params: Record<string, unknown>): string[] {
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

// resuelve una estrategia+params a la lista de trackIds (unifica record vs resto).
// devuelve {trackIds} o {error,status}; usado por /generate y por la regeneración.
export function resolveTrackIds(db: Db, userId: number, strategy: Strategy, params: Record<string, unknown>): ResolveResult {
  return strategy === 'record'
    ? resolveRecordTracks(db, userId, params)
    : { trackIds: runStrategy(db, userId, strategy, params) };
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

export function autoName(strategy: Strategy, params?: Record<string, unknown>): string {
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

// escribe la lista de tracks en la playlist de Spotify: PUT reemplaza el primer
// lote (máx 100), POST añade el resto (la API limita a 100 uris por request)
export async function writeTracksToSpotify(userId: number, spotifyPlaylistId: string, trackIds: string[]): Promise<void> {
  const uris = trackIds.map(tid => `spotify:track:${tid}`);
  await spotifyFetch(`/playlists/${spotifyPlaylistId}/tracks`, {
    userId,
    method: 'PUT',
    body: { uris: uris.slice(0, 100) },
  });
  for (let i = 100; i < uris.length; i += 100) {
    await spotifyFetch(`/playlists/${spotifyPlaylistId}/tracks`, {
      userId,
      method: 'POST',
      body: { uris: uris.slice(i, i + 100) },
    });
  }
}

// mapea la fila cruda de generated_playlists a la forma pública GeneratedPlaylist
function toGeneratedPlaylist(row: any, params: Record<string, unknown>, trackIds: string[], updatedAt: string): GeneratedPlaylist {
  const db = getDb();
  return {
    id: row.id,
    spotifyPlaylistId: row.spotify_playlist_id,
    name: row.name,
    strategy: row.strategy,
    params,
    trackCount: trackIds.length,
    autoRegenerate: !!row.auto_regenerate,
    regenerateIntervalMs: row.regenerate_interval_ms ?? null,
    lastRegeneratedAt: updatedAt,
    tracks: trackIds.map((tid, i) => ({ position: i + 1, track: enrichTrack(db, tid) })),
    createdAt: row.created_at,
    updatedAt,
  };
}

export type RegenerateResult =
  | { ok: true; playlist: GeneratedPlaylist }
  | { ok: false; error: string; status: 400 | 403 | 404 | 502; scopes?: string[] };

// regenera una playlist generada: reejecuta su estrategia, reescribe Spotify (si
// tiene playlist vinculada) y los tracks locales, y avanza last_regenerated_at.
// reutilizado por la ruta /:id/regenerate (manual) y el scheduler (automático).
export async function regeneratePlaylist(userId: number, id: number): Promise<RegenerateResult> {
  const db = getDb();

  const row = db.get(sql`
    SELECT * FROM generated_playlists WHERE id = ${id} AND user_id = ${userId}
  `) as any;
  if (!row) return { ok: false, error: 'playlist no encontrada', status: 404 };

  const params = typeof row.params === 'string' ? JSON.parse(row.params) : row.params;
  const strategy = row.strategy as Strategy;

  const resolved = resolveTrackIds(db, userId, strategy, params);
  if ('error' in resolved) return { ok: false, error: resolved.error, status: resolved.status };
  const trackIds = resolved.trackIds;

  if (trackIds.length === 0) {
    return { ok: false, error: 'no se encontraron tracks con estos criterios', status: 404 };
  }

  if (row.spotify_playlist_id) {
    if (!hasRequiredScopes(userId, PLAYLIST_SCOPES)) {
      return { ok: false, error: 'missing_scopes', status: 403, scopes: PLAYLIST_SCOPES };
    }
    await writeTracksToSpotify(userId, row.spotify_playlist_id, trackIds);
  }

  const now = new Date().toISOString();
  db.run(sql`DELETE FROM generated_playlist_tracks WHERE playlist_id = ${id}`);
  db.insert(generatedPlaylistTracks).values(
    trackIds.map((tid, i) => ({ playlistId: id, trackId: tid, position: i + 1 }))
  ).run();
  db.run(sql`
    UPDATE generated_playlists
    SET track_count = ${trackIds.length}, updated_at = ${now}, last_regenerated_at = ${now}
    WHERE id = ${id}
  `);

  return { ok: true, playlist: toGeneratedPlaylist(row, params, trackIds, now) };
}
