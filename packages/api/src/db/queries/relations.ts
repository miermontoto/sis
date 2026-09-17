// Relaciones "soft" entre artistas: enlaces simétricos que no alteran el tracking.
// A diferencia de un merge no hay lado canónico, así que la fila se guarda con el par
// normalizado (artist_a < artist_b) y es la lectura la que decide cuál es "el otro".
// Aquí vive también getRelationStats, que pone cifras a las filas de la sección de
// relaciones del detalle — las soft y las hard, que se pintan juntas.
import { sql } from 'drizzle-orm';
import type { Db, EntityType } from './helpers.js';
import { playDuration, trackJoinResolvingMerges, albumPlaysPredicate } from './helpers.js';
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

export interface RelationStatsRow {
  entity_id: string;
  play_count: number;
  total_ms: number;
}

/** Escuchas de cada id de `ids`, contadas **como las cuenta su propia página**: el id
 *  más los alias que haya absorbido. Esa regla es la única que hace que las filas de la
 *  sección de relaciones signifiquen todas lo mismo — un alias reporta justo lo que
 *  aporta al grupo, y un canónico el total que verías al pinchar.
 *
 *  Una sola pasada para toda la sección en vez de una query por fila: el mapa
 *  miembro → raíz entra en SQL como CTE de VALUES, así que agrupar por raíz no obliga
 *  a un COALESCE sobre merge_rules (que no es sargable y degenera en scan completo). */
export function getRelationStats(db: Db, type: EntityType, ids: string[], userId: number): RelationStatsRow[] {
  const roots = [...new Set(ids)];
  if (roots.length === 0) return [];

  // alias absorbidos por cada raíz, en una query para todas
  const sources = db.all(sql`
    SELECT target_id, source_id FROM merge_rules
    WHERE entity_type = ${type} AND user_id = ${userId}
      AND target_id IN (${sql.join(roots.map(id => sql`${id}`), sql`, `)})
  `) as { target_id: string; source_id: string }[];

  const pairs: [string, string][] = roots.map(id => [id, id]);
  for (const r of sources) pairs.push([r.source_id, r.target_id]);

  const members = pairs.map(([member]) => member);
  const rel = sql`rel(member_id, root_id) AS (VALUES ${sql.join(
    pairs.map(([member, root]) => sql`(${member}, ${root})`), sql`, `,
  )})`;

  if (type === 'artist') {
    // Los CROSS JOIN fijan el orden: un CTE de VALUES no tiene estadísticas, así que con
    // JOIN a secas el planner arranca por listening_history usando sólo user_id y se come
    // el historial entero del usuario (722ms medidos contra 14ms anclando en `rel` →
    // idx_ta_artist_position → idx_lh_user_track). No los quites.
    // El DISTINCT por play es la otra mitad: si una raíz y un alias suyo están acreditados
    // en el mismo track, el join por track_artists contaría ese play una vez por crédito.
    return db.all(sql`
      WITH ${rel}
      SELECT root_id as entity_id, count(*) as play_count, coalesce(sum(ms), 0) as total_ms
      FROM (
        SELECT DISTINCT lh.id as play_id, rel.root_id as root_id, ${playDuration()} as ms
        FROM rel
        CROSS JOIN track_artists ta ON ta.artist_id = rel.member_id
        CROSS JOIN listening_history lh ON lh.track_id = ta.track_id AND lh.user_id = ${userId}
        CROSS JOIN tracks t ON t.spotify_id = lh.track_id
      )
      GROUP BY root_id
    `) as RelationStatsRow[];
  }

  if (type === 'album') {
    // un play tiene un solo track canónico y por tanto un solo álbum: sin DISTINCT
    return db.all(sql`
      WITH ${rel}
      SELECT rel.root_id as entity_id, count(*) as play_count, coalesce(sum(${playDuration()}), 0) as total_ms
      FROM listening_history lh
      ${trackJoinResolvingMerges(userId)}
      JOIN rel ON rel.member_id = t.album_id
      WHERE lh.user_id = ${userId} ${albumPlaysPredicate(members, userId)}
      GROUP BY rel.root_id
    `) as RelationStatsRow[];
  }

  return db.all(sql`
    WITH ${rel}
    SELECT rel.root_id as entity_id, count(*) as play_count, coalesce(sum(${playDuration()}), 0) as total_ms
    FROM rel
    JOIN listening_history lh ON lh.track_id = rel.member_id AND lh.user_id = ${userId}
    JOIN tracks t ON t.spotify_id = lh.track_id
    GROUP BY rel.root_id
  `) as RelationStatsRow[];
}
