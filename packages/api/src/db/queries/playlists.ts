import { sql } from 'drizzle-orm';
import type { Db, Sort } from './helpers.js';
import { getRangeStart, orderByCol, userFilter, rangeWhere } from './helpers.js';
import type { TimeRange } from '../../constants.js';

export interface PlaylistStrategyParams {
  limit: number;
  sort: Sort;
}

interface RangeParams {
  range: TimeRange | 'custom';
  startDate?: string;
  endDate?: string;
}

export interface TopRangeParams extends PlaylistStrategyParams, RangeParams {}

export interface TopArtistParams extends PlaylistStrategyParams, RangeParams {
  artistId: string;
}

export interface TopGenreParams extends PlaylistStrategyParams, RangeParams {
  genre: string;
}

export interface DeepCutsParams extends PlaylistStrategyParams, RangeParams {
  maxPopularity: number;
  minPlays: number;
}

export interface TimeVibesParams extends PlaylistStrategyParams, RangeParams {
  days: number[]; // 0=Sun, 1=Mon, ..., 6=Sat
  hours: number[]; // 0-23
}

export interface RediscoveryParams extends PlaylistStrategyParams {
  minPlays: number;
  recencyDays: number;
}

function resolveRange(params: RangeParams) {
  if (params.range === 'custom' && params.startDate && params.endDate) {
    return {
      rangeStart: params.startDate + 'T00:00:00.000Z',
      rangeEnd: params.endDate + 'T23:59:59.999Z',
    };
  }
  return {
    rangeStart: getRangeStart(params.range as TimeRange),
    rangeEnd: null as string | null,
  };
}

// excluir tracks locales (no se pueden añadir a playlists de spotify)
const NO_LOCAL = sql`AND lh.track_id NOT LIKE 'local:%'`;

// factor de sobre-muestreo: traemos más tracks de los pedidos y luego shuffleamos
const OVERSAMPLE = 2.5;

function shuffleAndTake(ids: string[], limit: number): string[] {
  // Fisher-Yates shuffle
  const arr = [...ids];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, limit);
}

/** Top tracks por rango temporal */
export function strategyTopRange(db: Db, userId: number, params: TopRangeParams): string[] {
  const { rangeStart, rangeEnd } = resolveRange(params);
  const ob = orderByCol(params.sort);
  const uf = userFilter(userId);
  const fetchLimit = Math.ceil(params.limit * OVERSAMPLE);

  const whereClause = rangeStart
    ? (rangeEnd ? sql`WHERE lh.played_at >= ${rangeStart} AND lh.played_at <= ${rangeEnd}` : sql`WHERE lh.played_at >= ${rangeStart}`)
    : sql`WHERE 1=1`;

  const rows = db.all(sql`
    SELECT lh.track_id as entity_id, count(*) as play_count, sum(t.duration_ms) as total_ms
    FROM listening_history lh
    JOIN tracks t ON t.spotify_id = lh.track_id
    ${whereClause} ${uf} ${NO_LOCAL}
    GROUP BY lh.track_id
    ORDER BY ${ob} DESC
    LIMIT ${fetchLimit}
  `) as { entity_id: string }[];

  return shuffleAndTake(rows.map(r => r.entity_id), params.limit);
}

/** Top tracks de un artista específico */
export function strategyTopArtist(db: Db, userId: number, params: TopArtistParams): string[] {
  const { rangeStart, rangeEnd } = resolveRange(params);
  const ob = orderByCol(params.sort);
  const uf = userFilter(userId);
  const rw = rangeWhere(rangeStart, rangeEnd);
  const fetchLimit = Math.ceil(params.limit * OVERSAMPLE);

  const rows = db.all(sql`
    SELECT lh.track_id as entity_id, count(*) as play_count, sum(t.duration_ms) as total_ms
    FROM listening_history lh
    JOIN tracks t ON t.spotify_id = lh.track_id
    JOIN track_artists ta ON ta.track_id = lh.track_id
    WHERE ta.artist_id = ${params.artistId} ${rw} ${uf} ${NO_LOCAL}
    GROUP BY lh.track_id
    ORDER BY ${ob} DESC
    LIMIT ${fetchLimit}
  `) as { entity_id: string }[];

  return shuffleAndTake(rows.map(r => r.entity_id), params.limit);
}

/** Top tracks de un género */
export function strategyTopGenre(db: Db, userId: number, params: TopGenreParams): string[] {
  const { rangeStart, rangeEnd } = resolveRange(params);
  const ob = orderByCol(params.sort);
  const uf = userFilter(userId);
  const rw = rangeWhere(rangeStart, rangeEnd);
  const fetchLimit = Math.ceil(params.limit * OVERSAMPLE);

  const rows = db.all(sql`
    SELECT lh.track_id as entity_id, count(*) as play_count, sum(t.duration_ms) as total_ms
    FROM listening_history lh
    JOIN tracks t ON t.spotify_id = lh.track_id
    JOIN track_artists ta ON ta.track_id = lh.track_id
    JOIN artists a ON a.spotify_id = ta.artist_id
    JOIN json_each(a.genres) g
    WHERE g.value = ${params.genre} ${rw} ${uf} ${NO_LOCAL}
    GROUP BY lh.track_id
    ORDER BY ${ob} DESC
    LIMIT ${fetchLimit}
  `) as { entity_id: string }[];

  return shuffleAndTake(rows.map(r => r.entity_id), params.limit);
}

/** Tracks con baja popularidad que el usuario escucha (hidden gems) */
export function strategyDeepCuts(db: Db, userId: number, params: DeepCutsParams): string[] {
  const { rangeStart, rangeEnd } = resolveRange(params);
  const fetchLimit = Math.ceil(params.limit * OVERSAMPLE);

  const whereClause = rangeStart
    ? (rangeEnd ? sql`WHERE lh.played_at >= ${rangeStart} AND lh.played_at <= ${rangeEnd}` : sql`WHERE lh.played_at >= ${rangeStart}`)
    : sql`WHERE 1=1`;

  const rows = db.all(sql`
    SELECT lh.track_id, count(*) as play_count, t.popularity
    FROM listening_history lh
    JOIN tracks t ON t.spotify_id = lh.track_id
    ${whereClause}
      AND lh.user_id = ${userId}
      AND t.popularity IS NOT NULL
      AND t.popularity <= ${params.maxPopularity}
      ${NO_LOCAL}
    GROUP BY lh.track_id
    HAVING play_count >= ${params.minPlays}
    ORDER BY t.popularity ASC, play_count DESC
    LIMIT ${fetchLimit}
  `) as { track_id: string }[];

  return shuffleAndTake(rows.map(r => r.track_id), params.limit);
}

/** Tracks que se escuchan en ciertos días y horas (vibes por horario) */
export function strategyTimeVibes(db: Db, userId: number, params: TimeVibesParams): string[] {
  const { rangeStart, rangeEnd } = resolveRange(params);
  const fetchLimit = Math.ceil(params.limit * OVERSAMPLE);

  const whereClause = rangeStart
    ? (rangeEnd ? sql`WHERE lh.played_at >= ${rangeStart} AND lh.played_at <= ${rangeEnd}` : sql`WHERE lh.played_at >= ${rangeStart}`)
    : sql`WHERE 1=1`;

  const dayPlaceholders = sql.join(params.days.map(d => sql`${d}`), sql`, `);
  const hourPlaceholders = sql.join(params.hours.map(h => sql`${h}`), sql`, `);

  const rows = db.all(sql`
    SELECT lh.track_id, count(*) as play_count
    FROM listening_history lh
    ${whereClause}
      AND lh.user_id = ${userId}
      AND cast(strftime('%w', lh.played_at) as integer) IN (${dayPlaceholders})
      AND cast(strftime('%H', lh.played_at) as integer) IN (${hourPlaceholders})
      ${NO_LOCAL}
    GROUP BY lh.track_id
    ORDER BY play_count DESC
    LIMIT ${fetchLimit}
  `) as { track_id: string }[];

  return shuffleAndTake(rows.map(r => r.track_id), params.limit);
}

/** Tracks olvidados: muchas escuchas históricas pero sin actividad reciente */
export function strategyRediscovery(db: Db, userId: number, params: RediscoveryParams): string[] {
  const cutoff = new Date(Date.now() - params.recencyDays * 86_400_000).toISOString();
  const fetchLimit = Math.ceil(params.limit * OVERSAMPLE);

  const rows = db.all(sql`
    SELECT lh.track_id, count(*) as total_plays, max(lh.played_at) as last_played
    FROM listening_history lh
    WHERE lh.user_id = ${userId}
      AND lh.track_id NOT LIKE 'local:%'
    GROUP BY lh.track_id
    HAVING total_plays >= ${params.minPlays}
      AND last_played < ${cutoff}
    ORDER BY total_plays DESC
    LIMIT ${fetchLimit}
  `) as { track_id: string }[];

  return shuffleAndTake(rows.map(r => r.track_id), params.limit);
}
