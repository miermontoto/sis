// Mantenimiento de merge_rules ante borrados físicos de entidades.
//
// Conviven dos sistemas de merge que no se conocían entre sí:
//   - merge_rules es un merge *lógico*: no mueve nada, resolveEntityIds() pliega los
//     sources sobre el target en tiempo de lectura.
//   - reassignTrackRefs() y los dedup de álbum son merges *físicos*: reescriben las
//     referencias y borran la fila de la entidad.
// Sin este módulo, cada borrado físico dejaba reglas apuntando a un id inexistente:
// invisibles en la UI (que las une con INNER JOIN sobre la tabla de la entidad) pero
// aún activas en validateMergeRule, que bloquea volver a mergear la entidad; y si el
// muerto era el target de un grupo, sus sources dejaban de agruparse entre sí.
//
// Es el ÚNICO sitio donde merge_rules se toca sin filtrar por usuario, y a propósito:
// la fila de la entidad desaparece para todos, así que repuntar el id muerto y barrer
// reglas huérfanas o reflexivas vale para todos. Lo que NO puede cruzar usuarios es
// elegir a quién se pliega un grupo — eso va correlacionado por user_id (ver abajo).
import { sql } from 'drizzle-orm';
import type { getDb } from '../../db/connection.js';
import { entityTableName } from '../../db/queries/helpers.js';
import type { EntityType } from '@sis/shared';

type Db = ReturnType<typeof getDb>;

/** Borra reglas reflexivas (A→A), que es en lo que queda una regla cuya pareja acaba
 *  de fusionarse físicamente en una sola fila. */
const dropReflexive = (db: Db, type: EntityType) =>
  db.run(sql`DELETE FROM merge_rules WHERE entity_type = ${type} AND source_id = target_id`);

/** Traspasa al superviviente el papel que `deletedId` tenía en cada regla, antes de que
 *  la fila desaparezca. Llamar SIEMPRE dentro del mismo borrado físico (source→target)
 *  y antes del DELETE, para que la intención del usuario siga aplicando al id que queda. */
export function rewriteMergeRules(db: Db, type: EntityType, deletedId: string, survivorId: string) {
  db.run(sql`UPDATE merge_rules SET source_id = ${survivorId}
    WHERE entity_type = ${type} AND source_id = ${deletedId}`);
  db.run(sql`UPDATE merge_rules SET target_id = ${survivorId}
    WHERE entity_type = ${type} AND target_id = ${deletedId}`);

  dropReflexive(db, type);

  // si el superviviente ya era source de otra regla, lo reescrito formaría cadena
  // (A→superviviente→C) y resolveEntityIds no la recorre: colapsar al canónico real.
  // El canónico se busca POR USUARIO, correlacionado con la fila que se actualiza: a
  // quién se pliega un grupo es una decisión privada, y coger el de cualquiera (un
  // `ORDER BY id LIMIT 1` global) metía el grupo de B dentro del target elegido por A.
  // Los usuarios sin regla propia sobre el superviviente no se tocan.
  const collapsed = db.run(sql`
    UPDATE merge_rules SET target_id = (
      SELECT mr_c.target_id FROM merge_rules mr_c
      WHERE mr_c.entity_type = ${type} AND mr_c.source_id = ${survivorId}
        AND mr_c.user_id = merge_rules.user_id
      ORDER BY mr_c.id LIMIT 1)
    WHERE entity_type = ${type} AND target_id = ${survivorId}
      AND EXISTS (
        SELECT 1 FROM merge_rules mr_e
        WHERE mr_e.entity_type = ${type} AND mr_e.source_id = ${survivorId}
          AND mr_e.user_id = merge_rules.user_id)
  `).changes;
  if (collapsed > 0) dropReflexive(db, type);

  // el superviviente no puede acabar con dos targets ni con el par duplicado:
  // conservar por usuario la regla más antigua, que es la que ya existía
  db.run(sql`DELETE FROM merge_rules
    WHERE entity_type = ${type} AND source_id = ${survivorId}
      AND id NOT IN (SELECT MIN(id) FROM merge_rules
        WHERE entity_type = ${type} AND source_id = ${survivorId} GROUP BY user_id)`);
}

/** Barrido para los borrados sin superviviente (limpieza de huérfanos import:, basura
 *  no-música): elimina las reglas que referencian entidades que ya no existen. */
export function dropOrphanMergeRules(db: Db, type: EntityType): number {
  const table = sql.raw(entityTableName(type));
  return db.run(sql`
    DELETE FROM merge_rules WHERE entity_type = ${type} AND (
      source_id NOT IN (SELECT spotify_id FROM ${table})
      OR target_id NOT IN (SELECT spotify_id FROM ${table}))
  `).changes;
}
