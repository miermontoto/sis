import { sql } from 'drizzle-orm';
import type { getDb } from '../connection.js';
import { TIME_RANGES } from '../../constants.js';
import type { TimeRange } from '../../constants.js';
import type { EntityType, RankingMetric } from '@sis/shared';

export type Db = ReturnType<typeof getDb>;
export type SqlChunk = ReturnType<typeof sql>;
export type { EntityType };
export type Sort = RankingMetric | 'natural';

// --- tipos de resultado ---

export interface StatsRow {
  play_count: number;
  total_ms: number;
  first_played: string | null;
  last_played: string | null;
}

export interface AggregateRow {
  entity_id: string;
  play_count: number;
  total_ms: number;
}

export interface SeriesRow {
  period: string;
  play_count: number;
  total_ms: number;
}

export interface RecentPlayRow {
  id: number;
  played_at: string;
  track_id: string;
}

// --- helpers de rango temporal ---

export function getRangeStart(range: TimeRange): string | null {
  const days = TIME_RANGES[range];
  if (days === 0) return null;
  if (days === -1) return new Date(Date.UTC(new Date().getFullYear(), 0, 1)).toISOString();
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

export function getPreviousPeriodRange(range: TimeRange): { prevStart: string; prevEnd: string } | null {
  const days = TIME_RANGES[range];
  if (days === 0) return null;

  if (days === -1) {
    const now = new Date();
    const year = now.getFullYear();
    return {
      prevStart: new Date(Date.UTC(year - 1, 0, 1)).toISOString(),
      prevEnd: new Date(Date.UTC(year - 1, now.getMonth(), now.getDate())).toISOString(),
    };
  }

  const now = new Date();
  const prevEnd = new Date(now);
  prevEnd.setDate(prevEnd.getDate() - days);
  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevStart.getDate() - days);
  return { prevStart: prevStart.toISOString(), prevEnd: prevEnd.toISOString() };
}

export function getLookbackPreviousPeriodRange(
  range: TimeRange,
  lookbackDays: number,
): { prevStart: string; prevEnd: string } | null {
  const days = TIME_RANGES[range];
  const now = new Date();
  const prevEnd = new Date(now.getTime() - lookbackDays * 86_400_000);

  if (days === 0) {
    return { prevStart: '1970-01-01T00:00:00.000Z', prevEnd: prevEnd.toISOString() };
  }
  if (days === -1) {
    return {
      prevStart: new Date(Date.UTC(now.getFullYear(), 0, 1)).toISOString(),
      prevEnd: prevEnd.toISOString(),
    };
  }

  const prevStart = new Date(prevEnd.getTime() - days * 86_400_000);
  return { prevStart: prevStart.toISOString(), prevEnd: prevEnd.toISOString() };
}

export function getDateTrunc(range: TimeRange): SqlChunk {
  return getDateTruncForDays(TIME_RANGES[range]);
}

// --- merge rules: primitivas genéricas ---

// Alias SQL único por tipo de entidad para el LEFT JOIN a merge_rules
const MERGE_ALIAS: Record<EntityType, string> = {
  album: 'mr_album',
  artist: 'mr_artist',
  track: 'mr_track',
};

// Columna origen que se redirige al target del merge
function sourceCol(type: EntityType): SqlChunk {
  if (type === 'album') return sql`t.album_id`;
  if (type === 'artist') return sql`ta.artist_id`;
  return sql`lh.track_id`;
}

/** Ensambla el nombre de la tabla de origen para lookups directos por spotifyId. */
export function entityTableName(type: EntityType): 'albums' | 'artists' | 'tracks' {
  if (type === 'album') return 'albums';
  if (type === 'artist') return 'artists';
  return 'tracks';
}

/** JOIN chain que resuelve track merges y une a la tabla tracks por track canónico.
 *  Tras esto, `t` apunta al track canónico (target del merge o el original).
 *  Usar en queries que agrupan/filtran por t.album_id para atribución correcta. */
export function trackJoinResolvingMerges(userId: number): SqlChunk {
  return sql`LEFT JOIN merge_rules mr_track ON mr_track.entity_type = 'track' AND mr_track.source_id = lh.track_id AND mr_track.user_id = ${userId}
    JOIN tracks t ON t.spotify_id = COALESCE(mr_track.target_id, lh.track_id)`;
}

/** LEFT JOIN a merge_rules para un tipo de entidad, filtrado por usuario. */
export function entityMergeJoin(type: EntityType, userId?: number): SqlChunk {
  const alias = sql.raw(MERGE_ALIAS[type]);
  const src = sourceCol(type);
  if (userId != null) {
    return sql`LEFT JOIN merge_rules ${alias} ON ${alias}.entity_type = ${type} AND ${alias}.source_id = ${src} AND ${alias}.user_id = ${userId}`;
  }
  return sql`LEFT JOIN merge_rules ${alias} ON ${alias}.entity_type = ${type} AND ${alias}.source_id = ${src}`;
}

/** COALESCE(mr_X.target_id, <source_col>) — expresa el ID canónico tras merges. */
export function resolvedEntityId(type: EntityType, _userId?: number): SqlChunk {
  const alias = sql.raw(MERGE_ALIAS[type]);
  return sql`COALESCE(${alias}.target_id, ${sourceCol(type)})`;
}

// --- helpers de SQL dinámico según tipo de entidad ---

export function playDuration(): SqlChunk {
  // tiempo escuchado por play, capado a la duración real del track: ms_played nunca
  // debería superar la longitud del track, así que plays "over-long" (bucles o errores
  // de import) no inflan el total. Si el track no tiene duración válida (<=0), no capar.
  return sql`CASE WHEN t.duration_ms > 0
    THEN MIN(COALESCE(lh.duration_played_ms, t.duration_ms), t.duration_ms)
    ELSE lh.duration_played_ms END`;
}

export function orderByCol(sort: Sort): SqlChunk {
  return sort === 'plays' ? sql`play_count` : sql`total_ms`;
}

/** JOIN chain completo desde listening_history hasta la entidad resuelta, con todos los niveles de merge.
 *  Album:  lh → track merge → canonical track t → album merge (mr_album)
 *  Track:  lh → tracks t → track merge (mr_track)
 *  Artist: lh → tracks t → track_artists ta → artist merge (mr_artist)
 *  Tras esto: `t` siempre es el track correcto, y resolvedEntityId/entityGroupCol funcionan para agrupar. */
export function resolvedPlayJoins(entityType: EntityType, userId: number): SqlChunk {
  if (entityType === 'album') {
    return sql`${trackJoinResolvingMerges(userId)} ${entityMergeJoin('album', userId)}`;
  }
  if (entityType === 'artist') {
    return sql`JOIN tracks t ON t.spotify_id = lh.track_id
      JOIN track_artists ta ON ta.track_id = lh.track_id
      ${entityMergeJoin('artist', userId)}`;
  }
  return sql`JOIN tracks t ON t.spotify_id = lh.track_id
    ${entityMergeJoin('track', userId)}`;
}

/** AND t.album_id IS NOT NULL — necesario para queries de álbumes, vacío para otros tipos. */
export function albumNullFilter(entityType: EntityType): SqlChunk {
  return entityType === 'album' ? sql`AND t.album_id IS NOT NULL` : sql``;
}

/** @deprecated Usar resolvedPlayJoins() que incluye todos los joins necesarios. */
export function entityJoins(entityType: EntityType, userId?: number): SqlChunk {
  if (entityType === 'artist') {
    return sql`JOIN track_artists ta ON ta.track_id = lh.track_id ${entityMergeJoin('artist', userId)}`;
  }
  return sql``;
}

export function entityGroupCol(entityType: EntityType, userId?: number): SqlChunk {
  return resolvedEntityId(entityType, userId);
}

export function entityWhereCol(entityType: EntityType, id: string, ids?: string[]): SqlChunk {
  if (entityType === 'artist') return sql`ta.artist_id = ${id}`;
  if (entityType === 'track') {
    if (ids && ids.length > 1) {
      const placeholders = sql.join(ids.map(tid => sql`${tid}`), sql`, `);
      return sql`lh.track_id IN (${placeholders})`;
    }
    return sql`lh.track_id = ${id}`;
  }
  // album
  if (ids && ids.length > 1) {
    const placeholders = sql.join(ids.map(aid => sql`${aid}`), sql`, `);
    return sql`t.album_id IN (${placeholders})`;
  }
  return sql`t.album_id = ${id}`;
}

/** Filtro por track_id usando la tabla track_artists — una fila por play,
 *  evita duplicados cuando varias artist_ids de la misma track acaban en el mismo target */
export function tracksWithArtistIn(ids: string[]): SqlChunk {
  const placeholders = ids.length === 1 ? sql`${ids[0]}` : sql.join(ids.map(id => sql`${id}`), sql`, `);
  const cmp = ids.length === 1 ? sql`= ${ids[0]}` : sql`IN (${placeholders})`;
  return sql`t.spotify_id IN (SELECT DISTINCT ta_sub.track_id FROM track_artists ta_sub WHERE ta_sub.artist_id ${cmp})`;
}

// filtro de usuario para listening_history
export function userFilter(userId: number): SqlChunk {
  return sql`AND lh.user_id = ${userId}`;
}

export function userWhereClause(userId: number): SqlChunk {
  return sql`WHERE lh.user_id = ${userId}`;
}

export function periodExpr(granularity: 'week' | 'month' | 'year', weekStart: 'monday' | 'sunday' | 'friday' | 'thursday' = 'monday'): SqlChunk {
  if (granularity === 'week') {
    if (weekStart === 'monday') return sql`strftime('%Y-W%W', lh.played_at)`;
    if (weekStart === 'sunday') return sql`strftime('%Y-W%W', lh.played_at, '-1 day')`;
    return sql`strftime('%Y-W%W', lh.played_at, '-4 days')`;
  }
  if (granularity === 'month') return sql`strftime('%Y-%m', lh.played_at)`;
  return sql`strftime('%Y', lh.played_at)`;
}

export function getDateTruncForDays(days: number): SqlChunk {
  if (days > 0 && days <= 30) return sql`date(lh.played_at)`;
  if (days > 0 && days <= 180) return sql`strftime('%Y-W%W', lh.played_at)`;
  return sql`strftime('%Y-%m', lh.played_at)`;
}

export function getPreviousPeriodRangeCustom(startDate: string, endDate: string): { prevStart: string; prevEnd: string } {
  const start = new Date(startDate).getTime();
  const end = new Date(endDate).getTime();
  const span = end - start;
  const prevEnd = new Date(start);
  const prevStart = new Date(start - span);
  return { prevStart: prevStart.toISOString(), prevEnd: prevEnd.toISOString() };
}

export function rangeWhere(rangeStart: string | null, rangeEnd?: string | null): SqlChunk {
  if (!rangeStart) return sql``;
  if (rangeEnd) return sql`AND lh.played_at >= ${rangeStart} AND lh.played_at <= ${rangeEnd}`;
  return sql`AND lh.played_at >= ${rangeStart}`;
}

export function rangeWhereClause(rangeStart: string | null, rangeEnd?: string | null): SqlChunk {
  if (!rangeStart) return sql``;
  if (rangeEnd) return sql`WHERE lh.played_at >= ${rangeStart} AND lh.played_at <= ${rangeEnd}`;
  return sql`WHERE lh.played_at >= ${rangeStart}`;
}

/** Construir IN (...) o = para lista de IDs de álbum */
export function albumIdIn(ids: string[], tableAlias = 't'): SqlChunk {
  const col = sql.raw(`${tableAlias}.album_id`);
  if (ids.length === 1) return sql`${col} = ${ids[0]}`;
  const placeholders = sql.join(ids.map(id => sql`${id}`), sql`, `);
  return sql`${col} IN (${placeholders})`;
}
