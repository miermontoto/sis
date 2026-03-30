import { sql } from 'drizzle-orm';
import type { getDb } from '../connection.js';
import { TIME_RANGES } from '../../constants.js';
import type { TimeRange } from '../../constants.js';

export type Db = ReturnType<typeof getDb>;
export type SqlChunk = ReturnType<typeof sql>;
export type EntityType = 'artist' | 'track' | 'album';
export type Sort = 'plays' | 'time';

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

export function getDateTrunc(range: TimeRange): SqlChunk {
  return getDateTruncForDays(TIME_RANGES[range]);
}

// --- helpers de SQL dinámico según tipo de entidad ---

export function orderByCol(sort: Sort): SqlChunk {
  return sort === 'plays' ? sql`play_count` : sql`total_ms`;
}

export function entityJoins(entityType: EntityType): SqlChunk {
  if (entityType === 'artist') return sql`JOIN track_artists ta ON ta.track_id = lh.track_id`;
  return sql``;
}

export function entityGroupCol(entityType: EntityType, userId?: number): SqlChunk {
  if (entityType === 'artist') return sql`ta.artist_id`;
  if (entityType === 'track') return sql`lh.track_id`;
  return resolvedAlbumId(userId);
}

export function entityWhereCol(entityType: EntityType, id: string, albumIds?: string[]): SqlChunk {
  if (entityType === 'artist') return sql`ta.artist_id = ${id}`;
  if (entityType === 'track') return sql`lh.track_id = ${id}`;
  // para álbumes, usar IDs pre-resueltos si están disponibles
  if (albumIds && albumIds.length > 1) {
    const placeholders = sql.join(albumIds.map(aid => sql`${aid}`), sql`, `);
    return sql`t.album_id IN (${placeholders})`;
  }
  return sql`t.album_id = ${id}`;
}

// fragmento SQL que resuelve album_id a través de merge_rules (via LEFT JOIN, no subquery)
export function resolvedAlbumId(userId?: number): SqlChunk {
  return sql`COALESCE(mr_album.target_id, t.album_id)`;
}

// JOIN para resolver merge_rules de álbumes — filtrado por usuario
export function mergeRulesJoin(userId?: number): SqlChunk {
  if (userId != null) {
    return sql`LEFT JOIN merge_rules mr_album ON mr_album.entity_type = 'album' AND mr_album.source_id = t.album_id AND mr_album.user_id = ${userId}`;
  }
  return sql`LEFT JOIN merge_rules mr_album ON mr_album.entity_type = 'album' AND mr_album.source_id = t.album_id`;
}

// filtro de usuario para listening_history
export function userFilter(userId: number): SqlChunk {
  return sql`AND lh.user_id = ${userId}`;
}

export function userWhereClause(userId: number): SqlChunk {
  return sql`WHERE lh.user_id = ${userId}`;
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
