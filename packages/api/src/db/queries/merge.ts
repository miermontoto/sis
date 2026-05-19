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

/** Grupo bidireccional de merge para `entityId`: incluye target, hermanos (otros sources
 *  del mismo target) y el propio ID, sin importar si `entityId` es target o source.
 *  Útil para filtrar "todo lo que pertenece al mismo grupo" cuando no se sabe la dirección. */
export function getEntityMergeGroup(db: Db, type: EntityType, entityId: string, userId: number): string[] {
  const ids = new Set<string>([entityId]);

  // si entityId es target, añadir sus sources
  const sources = db.all(sql`
    SELECT source_id FROM merge_rules
    WHERE entity_type = ${type} AND target_id = ${entityId} AND user_id = ${userId}
  `) as { source_id: string }[];
  for (const r of sources) ids.add(r.source_id);

  // si entityId es source, añadir target y hermanos
  const target = db.all(sql`
    SELECT target_id FROM merge_rules
    WHERE entity_type = ${type} AND source_id = ${entityId} AND user_id = ${userId}
  `)[0] as { target_id: string } | undefined;
  if (target) {
    ids.add(target.target_id);
    const siblings = db.all(sql`
      SELECT source_id FROM merge_rules
      WHERE entity_type = ${type} AND target_id = ${target.target_id} AND user_id = ${userId}
    `) as { source_id: string }[];
    for (const r of siblings) ids.add(r.source_id);
  }

  return [...ids];
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
