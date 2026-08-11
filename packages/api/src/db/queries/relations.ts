// Relaciones "soft" entre artistas: enlaces simétricos que no alteran el tracking.
// A diferencia de un merge no hay lado canónico, así que la fila se guarda con el par
// normalizado (artist_a < artist_b) y es la lectura la que decide cuál es "el otro".
import { sql } from 'drizzle-orm';
import type { Db } from './helpers.js';
import { getEntityMergeGroup } from './merge.js';

export interface RelatedArtistRow {
  // ids de las filas que resuelven a este artista, separados por coma (group_concat).
  // Normalmente uno; hay varios si dos artistas relacionados por separado acabaron
  // mergeados entre ellos, y entonces borrar la relación tiene que borrarlos todos.
  rule_ids: string;
  artist_id: string;
  name: string;
  image_url: string | null;
}

/** Artistas relacionados (soft) con `artistId`. Trabaja sobre el grupo de merge entero:
 *  una relación creada sobre un alias absorbido sigue viéndose desde el canónico y al
 *  revés. El otro lado se resuelve a su propio canónico y las relaciones que caen dentro
 *  del mismo grupo se descartan (ahí la relación ya es "hard": un merge). */
export function getArtistRelations(db: Db, artistId: string, userId: number): RelatedArtistRow[] {
  const group = getEntityMergeGroup(db, 'artist', artistId, userId);
  const inGroup = sql.join(group.map(id => sql`${id}`), sql`, `);
  // el lado que no pertenece al grupo consultado
  const other = sql`CASE WHEN ar.artist_a IN (${inGroup}) THEN ar.artist_b ELSE ar.artist_a END`;

  return db.all(sql`
    SELECT group_concat(x.id) as rule_ids, x.other_id as artist_id, a.name, a.image_url
    FROM (
      SELECT ar.id as id, COALESCE(mr.target_id, ${other}) as other_id
      FROM artist_relations ar
      LEFT JOIN merge_rules mr
        ON mr.entity_type = 'artist' AND mr.user_id = ${userId} AND mr.source_id = ${other}
      WHERE ar.user_id = ${userId}
        AND (ar.artist_a IN (${inGroup}) OR ar.artist_b IN (${inGroup}))
    ) x
    JOIN artists a ON a.spotify_id = x.other_id
    WHERE x.other_id NOT IN (${inGroup})
    GROUP BY x.other_id
    ORDER BY a.name COLLATE NOCASE
  `) as RelatedArtistRow[];
}
