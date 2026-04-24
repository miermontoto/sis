// Helpers genéricos para reglas de merge (álbum / artista / track).
// Cada regla es una fila en merge_rules con entity_type distinguiendo el tipo.
import { sql } from 'drizzle-orm';
import type { Db, EntityType } from './helpers.js';
import { entityTableName } from './helpers.js';

export interface MergeInfo {
  mergedFrom: { rule_id: number; source_id: string; name: string; image_url: string | null }[];
  mergedInto: { rule_id: number; target_id: string; name: string; image_url: string | null } | null;
}

/** Resuelve un ID a la lista [targetId, ...sourceIds] de los merges del usuario. */
export function resolveEntityIds(db: Db, type: EntityType, entityId: string, userId: number): string[] {
  const sources = db.all(sql`
    SELECT source_id FROM merge_rules
    WHERE entity_type = ${type} AND target_id = ${entityId} AND user_id = ${userId}
  `) as { source_id: string }[];
  return [entityId, ...sources.map(r => r.source_id)];
}

/** mergedFrom (sources que apuntan a este ID) + mergedInto (target si este ID es un source). */
export function getEntityMergeInfo(db: Db, type: EntityType, entityId: string): MergeInfo {
  // tracks no tienen image_url propia — la toman del álbum
  if (type === 'track') {
    const mergedFrom = db.all(sql`
      SELECT mr.id as rule_id, mr.source_id, e.name, al.image_url
      FROM merge_rules mr
      JOIN tracks e ON e.spotify_id = mr.source_id
      LEFT JOIN albums al ON al.spotify_id = e.album_id
      WHERE mr.entity_type = 'track' AND mr.target_id = ${entityId}
    `) as MergeInfo['mergedFrom'];

    const mergedInto = db.all(sql`
      SELECT mr.id as rule_id, mr.target_id, e.name, al.image_url
      FROM merge_rules mr
      JOIN tracks e ON e.spotify_id = mr.target_id
      LEFT JOIN albums al ON al.spotify_id = e.album_id
      WHERE mr.entity_type = 'track' AND mr.source_id = ${entityId}
    `)[0] as MergeInfo['mergedInto'] | undefined;

    return { mergedFrom, mergedInto: mergedInto ?? null };
  }

  const table = sql.raw(entityTableName(type));

  const mergedFrom = db.all(sql`
    SELECT mr.id as rule_id, mr.source_id, e.name, e.image_url
    FROM merge_rules mr
    JOIN ${table} e ON e.spotify_id = mr.source_id
    WHERE mr.entity_type = ${type} AND mr.target_id = ${entityId}
  `) as MergeInfo['mergedFrom'];

  const mergedInto = db.all(sql`
    SELECT mr.id as rule_id, mr.target_id, e.name, e.image_url
    FROM merge_rules mr
    JOIN ${table} e ON e.spotify_id = mr.target_id
    WHERE mr.entity_type = ${type} AND mr.source_id = ${entityId}
  `)[0] as MergeInfo['mergedInto'] | undefined;

  return { mergedFrom, mergedInto: mergedInto ?? null };
}
