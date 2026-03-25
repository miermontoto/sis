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
  const days = TIME_RANGES[range];
  if (days > 0 && days <= 30) return sql`date(lh.played_at)`;
  if (days > 30 && days <= 180) return sql`strftime('%Y-W%W', lh.played_at)`;
  return sql`strftime('%Y-%m', lh.played_at)`;
}

// --- helpers de SQL dinámico según tipo de entidad ---

export function orderByCol(sort: Sort): SqlChunk {
  return sort === 'plays' ? sql`play_count` : sql`total_ms`;
}

export function entityJoins(entityType: EntityType): SqlChunk {
  if (entityType === 'artist') return sql`JOIN track_artists ta ON ta.track_id = lh.track_id`;
  return sql``;
}

export function entityGroupCol(entityType: EntityType): SqlChunk {
  if (entityType === 'artist') return sql`ta.artist_id`;
  if (entityType === 'track') return sql`lh.track_id`;
  return sql`t.album_id`;
}

export function entityWhereCol(entityType: EntityType, id: string): SqlChunk {
  if (entityType === 'artist') return sql`ta.artist_id = ${id}`;
  if (entityType === 'track') return sql`lh.track_id = ${id}`;
  return sql`t.album_id = ${id}`;
}

export function rangeWhere(rangeStart: string | null): SqlChunk {
  return rangeStart ? sql`AND lh.played_at >= ${rangeStart}` : sql``;
}

export function rangeWhereClause(rangeStart: string | null): SqlChunk {
  return rangeStart ? sql`WHERE lh.played_at >= ${rangeStart}` : sql``;
}
