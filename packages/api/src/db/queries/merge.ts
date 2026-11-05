// Helpers genéricos para reglas de merge (álbum / artista / track).
// Cada regla es una fila en merge_rules con entity_type distinguiendo el tipo.
import { sql } from 'drizzle-orm';
import type { Db, EntityType } from './helpers.js';
import { entityTableName, trackArtistsWhere } from './helpers.js';
import { getEntityCredits } from './credits.js';
import type { MergeRule, MergeSource } from '@sis/shared';

export interface MergeInfo {
  mergedFrom: MergeSource[];
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
 *  ningún merge suyo. Artistas = el pool entero; álbumes y temas = los de los grupos de
 *  merge de `parent` y de los artistas acreditados en `target`, con los créditos que ve el
 *  usuario: con los del catálogo, un artista añadido a mano no tenía candidatos y su álbum
 *  corregido abría el modal vacío. Cada brazo ancla primero en lo pequeño y cuenta después:
 *  agregar el historial entero de entrada y filtrar al final costaba 180-270ms por apertura
 *  del modal (349k plays), y corría en el main thread. */
export function getMergeSuggestions(db: Db, type: EntityType, userId: number, parent: string | null, target: string | null): MergeSuggestionRow[] {
  const sourceFilter = sql`e.spotify_id NOT IN (SELECT source_id FROM merge_rules WHERE entity_type = ${type} AND user_id = ${userId})`;
  const importFilter = sql`e.spotify_id NOT LIKE 'unresolved:%'`;

  if (type === 'artist') {
    // eje artista = agregar por track y expandir a créditos: el COUNT sobre lh × créditos
    // multiplicaba las filas antes de agrupar (274ms → 75ms, mismas filas). Los temas
    // corregidos se cuentan aparte, cada brazo por su índice: cruzar pt con el UNION
    // materializado de trackArtistsFor da las mismas filas en 192ms en vez de 94ms
    return db.all(sql`
      WITH pt AS (
        SELECT track_id, COUNT(*) AS c FROM listening_history WHERE user_id = ${userId} GROUP BY track_id
      ), s AS (
        SELECT artist_id, SUM(plays) AS plays FROM (
          SELECT ta.artist_id, SUM(pt.c) AS plays FROM pt JOIN track_artists ta ON ta.track_id = pt.track_id
          WHERE pt.track_id NOT IN (SELECT subject_id FROM credit_overrides WHERE user_id = ${userId} AND subject_type = 'track')
          GROUP BY ta.artist_id
          UNION ALL
          SELECT co.artist_id, SUM(pt.c) FROM credit_overrides co JOIN pt ON pt.track_id = co.subject_id
          WHERE co.user_id = ${userId} AND co.subject_type = 'track'
          GROUP BY co.artist_id
        ) GROUP BY artist_id
      )
      SELECT e.spotify_id AS id, e.name, e.image_url, s.plays
      FROM s JOIN artists e ON e.spotify_id = s.artist_id
      WHERE ${sourceFilter} AND ${importFilter}
      ORDER BY s.plays DESC
    `) as MergeSuggestionRow[];
  }

  // `parent` es el contexto de la fila (y lo único que mandan los apks publicados); el
  // resto de artistas sale de la misma lista que enseña el modal de créditos del target
  const seeds = [
    ...(parent ? [parent] : []),
    ...(target ? getEntityCredits(db, type, target, userId).credits.map(a => a.id) : []),
  ];
  if (seeds.length === 0) return [];

  // el grupo de merge de cada uno: álbumes y temas de sus alias también son candidatos
  const artistIds = [...new Set(seeds.flatMap(id => getEntityMergeGroup(db, 'artist', id, userId)))];
  const artistIn = sql`IN (${sql.join(artistIds.map(id => sql`${id}`), sql`, `)})`;

  // los CROSS JOIN fijan el orden candidatos → tracks → plays: con JOIN a secas el planner
  // arranca por listening_history filtrando sólo por user_id (8.6s en vez de 31ms).
  // de los créditos de álbum entran sólo los corregidos, por índice: artistCreditedAlbums
  // recorre el json de los 28k álbumes y pasaba el pool de 10ms a 180ms
  if (type === 'album') {
    return db.all(sql`
      WITH cand AS (
        SELECT t.album_id
        FROM ${trackArtistsWhere(userId, col => sql`${col('artist_id')} ${artistIn} AND ${col('position')} = 0`)} ta
        JOIN tracks t ON t.spotify_id = ta.track_id
        WHERE t.album_id IS NOT NULL
        UNION
        SELECT subject_id FROM credit_overrides
        WHERE user_id = ${userId} AND subject_type = 'album' AND artist_id ${artistIn}
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
    WITH cand AS (SELECT DISTINCT ta.track_id FROM ${trackArtistsWhere(userId, col => sql`${col('artist_id')} ${artistIn}`)} ta)
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

/** Todas las reglas del usuario, con metadata para la vista de settings. El campo `artist_*`
 *  es la agrupación padre: el artista principal del target en álbumes y temas, null en
 *  artistas (se agrupa por target en el cliente). Los subquery se acotan a los targets de
 *  las reglas: agrupar el catálogo entero costaba ~290ms por llamada. */
export function listMergeRules(db: Db, userId: number): MergeRule[] {
  const targetsOf = (type: EntityType) => sql`SELECT target_id FROM merge_rules WHERE user_id = ${userId} AND entity_type = ${type}`;

  const albumRows = db.all(sql`
    SELECT mr.id, mr.entity_type, mr.source_id, mr.target_id, mr.created_at,
           sa.name as source_name, sa.image_url as source_image,
           ta.name as target_name, ta.image_url as target_image,
           ar.spotify_id as artist_id, ar.name as artist_name, ar.image_url as artist_image
    FROM merge_rules mr
    JOIN albums sa ON sa.spotify_id = mr.source_id
    JOIN albums ta ON ta.spotify_id = mr.target_id
    LEFT JOIN (
      SELECT DISTINCT t.album_id, ta2.artist_id
      FROM tracks t
      JOIN track_artists ta2 ON ta2.track_id = t.spotify_id AND ta2.position = 0
      WHERE t.album_id IN (${targetsOf('album')})
    ) album_artist ON album_artist.album_id = mr.target_id
    LEFT JOIN artists ar ON ar.spotify_id = album_artist.artist_id
    WHERE mr.user_id = ${userId} AND mr.entity_type = 'album'
    ORDER BY ar.name, ta.name, sa.name
  `) as MergeRule[];

  const artistRows = db.all(sql`
    SELECT mr.id, mr.entity_type, mr.source_id, mr.target_id, mr.created_at,
           sa.name as source_name, sa.image_url as source_image,
           ta.name as target_name, ta.image_url as target_image,
           NULL as artist_id, NULL as artist_name, NULL as artist_image
    FROM merge_rules mr
    JOIN artists sa ON sa.spotify_id = mr.source_id
    JOIN artists ta ON ta.spotify_id = mr.target_id
    WHERE mr.user_id = ${userId} AND mr.entity_type = 'artist'
    ORDER BY ta.name, sa.name
  `) as MergeRule[];

  const trackRows = db.all(sql`
    SELECT mr.id, mr.entity_type, mr.source_id, mr.target_id, mr.created_at,
           st.name as source_name, sal.image_url as source_image,
           tt.name as target_name, tal.image_url as target_image,
           ar.spotify_id as artist_id, ar.name as artist_name, ar.image_url as artist_image
    FROM merge_rules mr
    JOIN tracks st ON st.spotify_id = mr.source_id
    LEFT JOIN albums sal ON sal.spotify_id = st.album_id
    JOIN tracks tt ON tt.spotify_id = mr.target_id
    LEFT JOIN albums tal ON tal.spotify_id = tt.album_id
    LEFT JOIN (
      SELECT track_id, MIN(artist_id) as artist_id
      FROM track_artists
      WHERE position = 0 AND track_id IN (${targetsOf('track')})
      GROUP BY track_id
    ) ta_pri ON ta_pri.track_id = mr.target_id
    LEFT JOIN artists ar ON ar.spotify_id = ta_pri.artist_id
    WHERE mr.user_id = ${userId} AND mr.entity_type = 'track'
    ORDER BY ar.name, tt.name, st.name
  `) as MergeRule[];

  return [...albumRows, ...artistRows, ...trackRows];
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
