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

export interface MergeSuggestionRow { id: string; name: string; image_url: string | null; plays: number }

/** Candidatos a merge del usuario por plays: entidades con escuchas que no son source de
 *  ningún merge suyo. Artistas = el pool entero; álbumes y temas = los del grupo de merge
 *  de `parent`. Cada brazo ancla primero en lo pequeño y cuenta después: agregar el
 *  historial entero de entrada y filtrar al final costaba 180-270ms por apertura del
 *  modal (349k plays), y corría en el main thread. */
export function getMergeSuggestions(db: Db, type: EntityType, userId: number, parent: string | null): MergeSuggestionRow[] {
  const sourceFilter = sql`e.spotify_id NOT IN (SELECT source_id FROM merge_rules WHERE entity_type = ${type} AND user_id = ${userId})`;
  const importFilter = sql`e.spotify_id NOT LIKE 'unresolved:%'`;

  if (type === 'artist') {
    // eje artista = agregar por track y expandir a créditos: el COUNT sobre lh × créditos
    // multiplicaba las filas antes de agrupar (274ms → 75ms, mismas filas)
    return db.all(sql`
      WITH pt AS (
        SELECT track_id, COUNT(*) AS c FROM listening_history WHERE user_id = ${userId} GROUP BY track_id
      ), s AS (
        SELECT ta.artist_id, SUM(pt.c) AS plays FROM pt JOIN track_artists ta ON ta.track_id = pt.track_id GROUP BY ta.artist_id
      )
      SELECT e.spotify_id AS id, e.name, e.image_url, s.plays
      FROM s JOIN artists e ON e.spotify_id = s.artist_id
      WHERE ${sourceFilter} AND ${importFilter}
      ORDER BY s.plays DESC
    `) as MergeSuggestionRow[];
  }
  if (!parent) return [];

  // el grupo de merge del padre: álbumes y temas de sus alias también son candidatos
  const parentIds = getEntityMergeGroup(db, 'artist', parent, userId);
  const artistIn = sql`ta.artist_id IN (${sql.join(parentIds.map(id => sql`${id}`), sql`, `)})`;

  // los CROSS JOIN fijan el orden candidatos → tracks → plays: con JOIN a secas el planner
  // arranca por listening_history filtrando sólo por user_id (8.6s en vez de 31ms)
  if (type === 'album') {
    return db.all(sql`
      WITH cand AS (
        SELECT DISTINCT t.album_id FROM track_artists ta JOIN tracks t ON t.spotify_id = ta.track_id
        WHERE ${artistIn} AND ta.position = 0 AND t.album_id IS NOT NULL
      )
      SELECT e.spotify_id AS id, e.name, e.image_url, COUNT(*) AS plays
      FROM cand
      CROSS JOIN tracks tr
      CROSS JOIN listening_history lh
      CROSS JOIN albums e
      WHERE tr.album_id = cand.album_id
        AND lh.user_id = ${userId} AND lh.track_id = tr.spotify_id
        AND e.spotify_id = cand.album_id
        AND ${sourceFilter} AND ${importFilter}
      GROUP BY e.spotify_id
      ORDER BY plays DESC, e.name
    `) as MergeSuggestionRow[];
  }

  // el artista en cualquier posición (no solo la principal): distintos releases de la
  // misma canción lo acreditan en distinto orden (ej. "The Line" en el álbum de la banda
  // sonora vs. el single), y con position = 0 no aparecerían como candidatos
  return db.all(sql`
    WITH cand AS (SELECT DISTINCT ta.track_id FROM track_artists ta WHERE ${artistIn})
    SELECT e.spotify_id AS id, e.name, al.image_url, COUNT(*) AS plays
    FROM cand
    CROSS JOIN listening_history lh
    CROSS JOIN tracks e
    LEFT JOIN albums al ON al.spotify_id = e.album_id
    WHERE lh.user_id = ${userId} AND lh.track_id = cand.track_id
      AND e.spotify_id = cand.track_id
      AND ${sourceFilter} AND ${importFilter}
    GROUP BY e.spotify_id
    ORDER BY plays DESC, e.name
  `) as MergeSuggestionRow[];
}

/** mergedFrom (sources que apuntan a este ID) + mergedInto (target si este ID es un source).
 *  **Filtra por usuario, como el resto del módulo**: una regla de merge es una decisión
 *  privada de quien la crea. Sin el filtro, el detalle enseñaba (y dejaba deshacer) los
 *  merges de los demás usuarios de la instancia. */
export function getEntityMergeInfo(db: Db, type: EntityType, entityId: string, userId: number): MergeInfo {
  // tracks no tienen image_url propia — la toman del álbum
  if (type === 'track') {
    const mergedFrom = db.all(sql`
      SELECT mr.id as rule_id, mr.source_id, e.name, al.image_url
      FROM merge_rules mr
      JOIN tracks e ON e.spotify_id = mr.source_id
      LEFT JOIN albums al ON al.spotify_id = e.album_id
      WHERE mr.entity_type = 'track' AND mr.target_id = ${entityId} AND mr.user_id = ${userId}
    `) as MergeInfo['mergedFrom'];

    const mergedInto = db.all(sql`
      SELECT mr.id as rule_id, mr.target_id, e.name, al.image_url
      FROM merge_rules mr
      JOIN tracks e ON e.spotify_id = mr.target_id
      LEFT JOIN albums al ON al.spotify_id = e.album_id
      WHERE mr.entity_type = 'track' AND mr.source_id = ${entityId} AND mr.user_id = ${userId}
    `)[0] as MergeInfo['mergedInto'] | undefined;

    return { mergedFrom, mergedInto: mergedInto ?? null };
  }

  const table = sql.raw(entityTableName(type));

  const mergedFrom = db.all(sql`
    SELECT mr.id as rule_id, mr.source_id, e.name, e.image_url
    FROM merge_rules mr
    JOIN ${table} e ON e.spotify_id = mr.source_id
    WHERE mr.entity_type = ${type} AND mr.target_id = ${entityId} AND mr.user_id = ${userId}
  `) as MergeInfo['mergedFrom'];

  const mergedInto = db.all(sql`
    SELECT mr.id as rule_id, mr.target_id, e.name, e.image_url
    FROM merge_rules mr
    JOIN ${table} e ON e.spotify_id = mr.target_id
    WHERE mr.entity_type = ${type} AND mr.source_id = ${entityId} AND mr.user_id = ${userId}
  `)[0] as MergeInfo['mergedInto'] | undefined;

  return { mergedFrom, mergedInto: mergedInto ?? null };
}
