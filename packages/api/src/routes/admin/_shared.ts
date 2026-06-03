import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { getDb } from '../../db/connection.js';
import { albums, artists, tracks } from '../../db/schema.js';
import type { AppVariables } from '../../app.js';
import type { EntityType } from '@sis/shared';

export const adminRouter = () => new Hono<{ Variables: AppVariables }>();

export const VALID_ENTITY_TYPES: EntityType[] = ['album', 'artist', 'track'];

export const isValidEntityType = (s: unknown): s is EntityType =>
  typeof s === 'string' && VALID_ENTITY_TYPES.includes(s as EntityType);

// helper: resolver la tabla drizzle para lookups por spotifyId según tipo
export function entityTable(type: EntityType) {
  if (type === 'album') return albums;
  if (type === 'artist') return artists;
  return tracks;
}

// --- track matching helpers (shared entre album-merge-preview y album-remerge-preview) ---

export interface MatchableTrack {
  id: string;
  name: string;
  trackNumber: number | null;
  discNumber: number | null;
  durationMs: number;
}

const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const trigrams = (s: string) => {
  const t = new Set<string>();
  const n = norm(s);
  for (let i = 0; i <= n.length - 3; i++) t.add(n.slice(i, i + 3));
  return t;
};
const trigramSimilarity = (a: Set<string>, b: Set<string>) => {
  if (a.size === 0 || b.size === 0) return 0;
  let common = 0;
  for (const t of a) if (b.has(t)) common++;
  return common / Math.max(a.size, b.size);
};

export function autoMatchTracks(
  sourceTracks: MatchableTrack[],
  targetTracks: MatchableTrack[],
): { sourceTrackId: string; targetTrackId: string; confidence: 'position' | 'name' }[] {
  const matches: { sourceTrackId: string; targetTrackId: string; confidence: 'position' | 'name' }[] = [];
  const usedSource = new Set<string>();
  const usedTarget = new Set<string>();

  // pass 1: match by track_number within same disc
  for (const st of sourceTracks) {
    if (st.trackNumber == null) continue;
    const disc = st.discNumber ?? 1;
    const match = targetTracks.find(tt =>
      !usedTarget.has(tt.id) && tt.trackNumber === st.trackNumber && (tt.discNumber ?? 1) === disc
    );
    if (match) {
      matches.push({ sourceTrackId: st.id, targetTrackId: match.id, confidence: 'position' });
      usedSource.add(st.id);
      usedTarget.add(match.id);
    }
  }

  // pass 2: name similarity for unmatched
  const candidates: { sourceId: string; targetId: string; sim: number }[] = [];
  for (const st of sourceTracks) {
    if (usedSource.has(st.id)) continue;
    const stTri = trigrams(st.name);
    for (const tt of targetTracks) {
      if (usedTarget.has(tt.id)) continue;
      const sim = trigramSimilarity(stTri, trigrams(tt.name));
      if (sim >= 0.4) candidates.push({ sourceId: st.id, targetId: tt.id, sim });
    }
  }
  candidates.sort((a, b) => b.sim - a.sim);
  for (const c of candidates) {
    if (usedSource.has(c.sourceId) || usedTarget.has(c.targetId)) continue;
    matches.push({ sourceTrackId: c.sourceId, targetTrackId: c.targetId, confidence: 'name' });
    usedSource.add(c.sourceId);
    usedTarget.add(c.targetId);
  }

  return matches;
}

export type MergeValidationResult =
  | { ok: true }
  | { ok: false; reason: 'exists' | 'source_is_target' | 'target_is_source' };

export function validateMergeRule(
  db: ReturnType<typeof getDb>,
  userId: number,
  entityType: string,
  sourceId: string,
  targetId: string,
): MergeValidationResult {
  const row = db.get(sql`
    SELECT
      EXISTS(SELECT 1 FROM merge_rules WHERE entity_type = ${entityType} AND user_id = ${userId}
        AND ((source_id = ${sourceId} AND target_id = ${targetId})
          OR (source_id = ${targetId} AND target_id = ${sourceId}))) as dup,
      EXISTS(SELECT 1 FROM merge_rules WHERE entity_type = ${entityType} AND user_id = ${userId}
        AND target_id = ${sourceId}) as src_is_tgt,
      EXISTS(SELECT 1 FROM merge_rules WHERE entity_type = ${entityType} AND user_id = ${userId}
        AND source_id = ${targetId}) as tgt_is_src
  `) as { dup: number; src_is_tgt: number; tgt_is_src: number };
  if (row.dup) return { ok: false, reason: 'exists' };
  if (row.src_is_tgt) return { ok: false, reason: 'source_is_target' };
  if (row.tgt_is_src) return { ok: false, reason: 'target_is_source' };
  return { ok: true };
}

export const MERGE_ERRORS: Record<string, (type: string) => [string, number]> = {
  exists: () => ['merge rule already exists', 409],
  source_is_target: (t) => [`source ${t} is already a merge target — merge its sources into the new target instead`, 400],
  target_is_source: (t) => [`target ${t} is already merged into another ${t}`, 400],
};
