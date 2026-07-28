import { sql } from 'drizzle-orm';
import type { Db, Sort, EntityType } from './helpers.js';
import { getRangeStart, orderByCol, userFilter, rangeWhere, playDuration, resolvedPlayJoins, entityGroupCol, entityMergeJoin } from './helpers.js';
import { getTopEntities } from './entity.js';
import { getRawRanking } from './charts.js';
import type { TimeRange } from '../../constants.js';
import type { Granularity, WeekStartOption } from '@sis/shared';

export interface PlaylistStrategyParams {
  limit: number;
  sort: Sort;
  // sobre-muestrear y barajar en vez de devolver el top exacto. por defecto activo
  // en las estrategias de descubrimiento y desactivado en las de ranking
  shuffle?: boolean;
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

// excluir tracks locales (no se pueden añadir a playlists de spotify). se evalúa
// sobre el id canónico para que un merge no cuele un target local
const NO_LOCAL = sql`AND ${entityGroupCol('track')} NOT LIKE 'local:%'`;

// id canónico de track (tras merges) + joins necesarios, iguales a los del /top
const trackGroupCol = () => entityGroupCol('track');
const trackJoins = (userId: number) => resolvedPlayJoins('track', userId);

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

/** Resuelve el modo de muestreo: sin shuffle se pide el top exacto y se conserva
 *  el orden de ranking; con shuffle se sobre-muestrea para dar variedad. */
function sampling(params: PlaylistStrategyParams, defaultShuffle: boolean) {
  const shuffle = params.shuffle ?? defaultShuffle;
  return { shuffle, fetchLimit: shuffle ? Math.ceil(params.limit * OVERSAMPLE) : params.limit };
}

function takeIds(ids: string[], limit: number, shuffle: boolean): string[] {
  return shuffle ? shuffleAndTake(ids, limit) : ids.slice(0, limit);
}

/** Top tracks por rango temporal */
export function strategyTopRange(db: Db, userId: number, params: TopRangeParams): string[] {
  const { rangeStart, rangeEnd } = resolveRange(params);
  const ob = orderByCol(params.sort);
  const uf = userFilter(userId);
  const { shuffle, fetchLimit } = sampling(params, false);

  const rw = rangeWhere(rangeStart, rangeEnd);

  const rows = db.all(sql`
    SELECT ${trackGroupCol()} as entity_id, count(*) as play_count, sum(${playDuration()}) as total_ms
    FROM listening_history lh
    ${trackJoins(userId)}
    WHERE 1=1 ${rw} ${uf} ${NO_LOCAL}
    GROUP BY entity_id
    ORDER BY ${ob} DESC
    LIMIT ${fetchLimit}
  `) as { entity_id: string }[];

  return takeIds(rows.map(r => r.entity_id), params.limit, shuffle);
}

/** Top tracks de un artista específico */
export function strategyTopArtist(db: Db, userId: number, params: TopArtistParams): string[] {
  const { rangeStart, rangeEnd } = resolveRange(params);
  const ob = orderByCol(params.sort);
  const uf = userFilter(userId);
  const rw = rangeWhere(rangeStart, rangeEnd);
  const { shuffle, fetchLimit } = sampling(params, false);

  const rows = db.all(sql`
    SELECT ${trackGroupCol()} as entity_id, count(*) as play_count, sum(${playDuration()}) as total_ms
    FROM listening_history lh
    ${trackJoins(userId)}
    JOIN track_artists ta ON ta.track_id = lh.track_id
    WHERE ta.artist_id = ${params.artistId} ${rw} ${uf} ${NO_LOCAL}
    GROUP BY entity_id
    ORDER BY ${ob} DESC
    LIMIT ${fetchLimit}
  `) as { entity_id: string }[];

  return takeIds(rows.map(r => r.entity_id), params.limit, shuffle);
}

/** Top tracks de un género */
export function strategyTopGenre(db: Db, userId: number, params: TopGenreParams): string[] {
  const { rangeStart, rangeEnd } = resolveRange(params);
  const ob = orderByCol(params.sort);
  const uf = userFilter(userId);
  const rw = rangeWhere(rangeStart, rangeEnd);
  const { shuffle, fetchLimit } = sampling(params, false);

  const rows = db.all(sql`
    SELECT ${trackGroupCol()} as entity_id, count(*) as play_count, sum(${playDuration()}) as total_ms
    FROM listening_history lh
    ${trackJoins(userId)}
    JOIN track_artists ta ON ta.track_id = lh.track_id
    JOIN artists a ON a.spotify_id = ta.artist_id
    JOIN json_each(a.genres) g
    WHERE g.value = ${params.genre} ${rw} ${uf} ${NO_LOCAL}
    GROUP BY entity_id
    ORDER BY ${ob} DESC
    LIMIT ${fetchLimit}
  `) as { entity_id: string }[];

  return takeIds(rows.map(r => r.entity_id), params.limit, shuffle);
}

/** Tracks con baja popularidad que el usuario escucha (hidden gems) */
export function strategyDeepCuts(db: Db, userId: number, params: DeepCutsParams): string[] {
  const { rangeStart, rangeEnd } = resolveRange(params);
  const { shuffle, fetchLimit } = sampling(params, true);
  const rw = rangeWhere(rangeStart, rangeEnd);

  const rows = db.all(sql`
    SELECT ${trackGroupCol()} as entity_id, count(*) as play_count, min(t.popularity) as popularity
    FROM listening_history lh
    ${trackJoins(userId)}
    WHERE lh.user_id = ${userId} ${rw}
      AND t.popularity IS NOT NULL
      AND t.popularity <= ${params.maxPopularity}
      ${NO_LOCAL}
    GROUP BY entity_id
    HAVING play_count >= ${params.minPlays}
    ORDER BY popularity ASC, play_count DESC
    LIMIT ${fetchLimit}
  `) as { entity_id: string }[];

  return takeIds(rows.map(r => r.entity_id), params.limit, shuffle);
}

/** Tracks que se escuchan en ciertos días y horas (vibes por horario) */
export function strategyTimeVibes(db: Db, userId: number, params: TimeVibesParams): string[] {
  const { rangeStart, rangeEnd } = resolveRange(params);
  const { shuffle, fetchLimit } = sampling(params, true);
  const rw = rangeWhere(rangeStart, rangeEnd);

  const dayPlaceholders = sql.join(params.days.map(d => sql`${d}`), sql`, `);
  const hourPlaceholders = sql.join(params.hours.map(h => sql`${h}`), sql`, `);

  const rows = db.all(sql`
    SELECT ${trackGroupCol()} as entity_id, count(*) as play_count
    FROM listening_history lh
    ${entityMergeJoin('track', userId)}
    WHERE lh.user_id = ${userId} ${rw}
      AND cast(strftime('%w', lh.played_at) as integer) IN (${dayPlaceholders})
      AND cast(strftime('%H', lh.played_at) as integer) IN (${hourPlaceholders})
      ${NO_LOCAL}
    GROUP BY entity_id
    ORDER BY play_count DESC
    LIMIT ${fetchLimit}
  `) as { entity_id: string }[];

  return takeIds(rows.map(r => r.entity_id), params.limit, shuffle);
}

/** Resuelve entidades de records a track IDs para crear playlists.
 *  - track: usa IDs directamente
 *  - album: top tracksPerEntity tracks por álbum del historial del usuario
 *  - artist: top tracksPerEntity tracks por artista del historial del usuario
 */
export function resolveEntitiesToTracks(
  db: Db, userId: number,
  entityType: 'track' | 'album' | 'artist',
  entityIds: string[],
  tracksPerEntity: number,
): string[] {
  if (entityIds.length === 0) return [];

  if (entityType === 'track') {
    return entityIds.filter(id => !id.startsWith('local:'));
  }

  const idList = sql.join(entityIds.map(id => sql`${id}`), sql`, `);

  if (entityType === 'album') {
    const rows = db.all(sql`
      WITH ranked AS (
        SELECT lh.track_id, t.album_id, COUNT(*) as plays,
               ROW_NUMBER() OVER (PARTITION BY t.album_id ORDER BY COUNT(*) DESC) as rn
        FROM listening_history lh
        JOIN tracks t ON t.spotify_id = lh.track_id
        WHERE lh.user_id = ${userId}
          AND t.album_id IN (${idList})
          AND lh.track_id NOT LIKE 'local:%'
        GROUP BY lh.track_id, t.album_id
      )
      SELECT track_id FROM ranked WHERE rn <= ${tracksPerEntity}
      ORDER BY plays DESC
    `) as { track_id: string }[];
    return rows.map(r => r.track_id);
  }

  // artist
  const rows = db.all(sql`
    WITH ranked AS (
      SELECT lh.track_id, ta.artist_id, COUNT(*) as plays,
             ROW_NUMBER() OVER (PARTITION BY ta.artist_id ORDER BY COUNT(*) DESC) as rn
      FROM listening_history lh
      JOIN track_artists ta ON ta.track_id = lh.track_id AND ta.position = 0
      WHERE lh.user_id = ${userId}
        AND ta.artist_id IN (${idList})
        AND lh.track_id NOT LIKE 'local:%'
      GROUP BY lh.track_id, ta.artist_id
    )
    SELECT track_id FROM ranked WHERE rn <= ${tracksPerEntity}
    ORDER BY plays DESC
  `) as { track_id: string }[];
  return rows.map(r => r.track_id);
}

/** Tracks olvidados: muchas escuchas históricas pero sin actividad reciente */
export function strategyRediscovery(db: Db, userId: number, params: RediscoveryParams): string[] {
  const cutoff = new Date(Date.now() - params.recencyDays * 86_400_000).toISOString();
  const { shuffle, fetchLimit } = sampling(params, true);

  const rows = db.all(sql`
    SELECT ${trackGroupCol()} as entity_id, count(*) as total_plays, max(lh.played_at) as last_played
    FROM listening_history lh
    ${entityMergeJoin('track', userId)}
    WHERE lh.user_id = ${userId}
      ${NO_LOCAL}
    GROUP BY entity_id
    HAVING total_plays >= ${params.minPlays}
      AND last_played < ${cutoff}
    ORDER BY total_plays DESC
    LIMIT ${fetchLimit}
  `) as { entity_id: string }[];

  return takeIds(rows.map(r => r.entity_id), params.limit, shuffle);
}

export interface TopParams extends PlaylistStrategyParams, RangeParams {
  entityType: 'track' | 'album' | 'artist';
}

/** Top entities → tracks playlist, preservando el orden de ranking */
export function strategyTop(db: Db, userId: number, params: TopParams): string[] {
  const { rangeStart, rangeEnd } = resolveRange(params);
  const limit = Math.min(params.limit || 50, 50);

  if (params.entityType === 'track') {
    const ob = orderByCol(params.sort);
    const uf = userFilter(userId);
    const rw = rangeWhere(rangeStart, rangeEnd);
    const rows = db.all(sql`
      SELECT ${trackGroupCol()} as entity_id, count(*) as play_count, sum(${playDuration()}) as total_ms
      FROM listening_history lh
      ${trackJoins(userId)}
      WHERE 1=1 ${rw} ${uf} ${NO_LOCAL}
      GROUP BY entity_id
      ORDER BY ${ob} DESC
      LIMIT ${limit}
    `) as { entity_id: string }[];
    return rows.map(r => r.entity_id);
  }

  const rows = getTopEntities(db, params.entityType, rangeStart, params.sort, limit, rangeEnd, userId);
  const entityIds = rows.map(r => r.entity_id);
  return resolveEntitiesToTracks(db, userId, params.entityType, entityIds, 3);
}

export interface ChartParams extends PlaylistStrategyParams {
  entityType: 'track' | 'album' | 'artist';
  granularity: Granularity;
  period: string;
  weekStart: WeekStartOption;
}

/** Chart entries → tracks playlist */
export function strategyChart(db: Db, userId: number, params: ChartParams): string[] {
  const limit = Math.min(params.limit || 25, 50);
  // chart rankings sólo admiten 'plays' o 'time'; 'natural' no tiene sentido aquí
  const chartSort = params.sort === 'plays' ? 'plays' : 'time';
  const entries = getRawRanking(db, params.entityType as EntityType, params.granularity, params.weekStart, params.period, chartSort, limit, userId);
  const entityIds = entries.map(e => e.entity_id);
  if (params.entityType === 'track') {
    return entityIds.filter(id => !id.startsWith('local:'));
  }
  return resolveEntitiesToTracks(db, userId, params.entityType, entityIds, 3);
}
