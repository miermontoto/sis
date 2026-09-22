// Colecciones ("álbumes lógicos"): contenedor del usuario que agrega álbumes enteros
// y temas sueltos de un artista. Ver shared/collections.ts para el modelo y
// helpers.ts (collectionMemberJoins / resolvedEntityId) para la capa que hace que
// sustituyan a sus miembros en los rankings.
//
// Aquí vive lo que NO sale gratis de esa capa: el CRUD, la expansión del alcance de
// una colección (qué álbumes y qué temas aporta) y las queries de su página de
// detalle, que son las de un álbum pero con dos ejes en vez de uno.
import { sql } from 'drizzle-orm';
import type { Db, Sort, SqlChunk, StatsRow, SeriesRow, RecentPlayRow } from './helpers.js';
import { rangeWhere, userFilter, getDateTrunc, getDateTruncForDays, playDuration, resolvedPlayJoins } from './helpers.js';
import { collectionKey, COLLECTION_ID_PREFIX } from '@sis/shared';
import type { AlbumCollectionSummary, CollectionMember, CollectionMemberType, CollectionRef, FormattedAlbum } from '@sis/shared';
import type { TimeRange } from '../../constants.js';

// tipo de álbum que se le atribuye a una colección allí donde la UI espera uno
// (`FormattedAlbum.albumType`): no es ninguno de los de spotify a propósito
export const COLLECTION_ALBUM_TYPE = 'collection';

interface CollectionRow {
  id: number;
  user_id: number;
  artist_id: string;
  name: string;
  image_url: string | null;
  color: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** Alcance de una colección: los ids que aporta a cualquier agregación.
 *  `albumIds` viene expandido con los álbumes que cada miembro haya absorbido por
 *  merge (si metes en la colección un álbum que se comió a otro, las escuchas del
 *  absorbido entran también); los temas sueltos no hace falta expandirlos porque
 *  el join de merge de la propia query ya resuelve el track canónico. */
export interface CollectionScope {
  albumIds: string[];
  trackIds: string[];
}

/** Reparte cada álbum del alcance al miembro que lo aporta: él mismo si es miembro, y
 *  si no, el miembro que lo absorbió por merge. Es lo que hace que las filas de la lista
 *  de miembros sean disjuntas y sumen el total de la colección. */
function albumOwners(db: Db, memberAlbumIds: string[], userId: number): Map<string, string> {
  const owners = new Map<string, string>();
  if (memberAlbumIds.length === 0) return owners;
  for (const id of memberAlbumIds) owners.set(id, id);
  const absorbed = db.all(sql`
    SELECT source_id, target_id FROM merge_rules
    WHERE entity_type = 'album' AND user_id = ${userId} AND target_id IN (${idList(memberAlbumIds)})
  `) as { source_id: string; target_id: string }[];
  // un source que además es miembro se queda para sí: lo específico gana
  for (const r of absorbed) if (!owners.has(r.source_id)) owners.set(r.source_id, r.target_id);
  return owners;
}

export function getCollectionScope(db: Db, collectionId: number, userId: number): CollectionScope {
  const rows = db.all(sql`
    SELECT member_type, member_id FROM album_collection_members
    WHERE collection_id = ${collectionId} AND user_id = ${userId}
    ORDER BY position ASC
  `) as { member_type: CollectionMemberType; member_id: string }[];

  const albumIds = rows.filter(r => r.member_type === 'album').map(r => r.member_id);
  const trackIds = rows.filter(r => r.member_type === 'track').map(r => r.member_id);

  if (albumIds.length > 0) {
    const absorbed = db.all(sql`
      SELECT source_id FROM merge_rules
      WHERE entity_type = 'album' AND user_id = ${userId} AND target_id IN (${idList(albumIds)})
    `) as { source_id: string }[];
    for (const r of absorbed) if (!albumIds.includes(r.source_id)) albumIds.push(r.source_id);
  }

  return { albumIds, trackIds };
}

function idList(ids: string[]): SqlChunk {
  return sql.join(ids.map(id => sql`${id}`), sql`, `);
}

/** WHERE del alcance sobre el track YA resuelto de merges (`t` de resolvedPlayJoins).
 *  Los dos ejes van en OR: un tema suelto cuenta aunque su álbum no sea miembro. */
function scopeWhere(scope: CollectionScope): SqlChunk {
  const parts: SqlChunk[] = [];
  if (scope.albumIds.length > 0) parts.push(sql`t.album_id IN (${idList(scope.albumIds)})`);
  if (scope.trackIds.length > 0) parts.push(sql`t.spotify_id IN (${idList(scope.trackIds)})`);
  if (parts.length === 0) return sql`1 = 0`;
  return sql`(${sql.join(parts, sql` OR `)})`;
}

/** Predicado driving sobre lh.track_id, mismo papel que albumPlaysPredicate: darle al
 *  planner un camino por idx_lh_user_track en vez del scan completo que provoca el JOIN
 *  por COALESCE de la resolución de merges. Es un SUPERSET del set cualificado — quien
 *  filtra exacto sigue siendo scopeWhere. */
function scopeDrive(scope: CollectionScope, userId: number): SqlChunk {
  const parts: SqlChunk[] = [];
  if (scope.albumIds.length > 0) {
    const albums = idList(scope.albumIds);
    parts.push(sql`SELECT spotify_id FROM tracks WHERE album_id IN (${albums})`);
    parts.push(sql`SELECT mr_p.source_id FROM merge_rules mr_p JOIN tracks t_p ON t_p.spotify_id = mr_p.target_id
      WHERE mr_p.entity_type = 'track' AND mr_p.user_id = ${userId} AND t_p.album_id IN (${albums})`);
  }
  if (scope.trackIds.length > 0) {
    const tracks = idList(scope.trackIds);
    parts.push(sql`SELECT spotify_id FROM tracks WHERE spotify_id IN (${tracks})`);
    parts.push(sql`SELECT source_id FROM merge_rules
      WHERE entity_type = 'track' AND user_id = ${userId} AND target_id IN (${tracks})`);
  }
  if (parts.length === 0) return sql`AND 1 = 0`;
  return sql`AND lh.track_id IN (${sql.join(parts, sql` UNION `)})`;
}

// --- lectura ---

export function getCollectionRow(db: Db, collectionId: number, userId: number): CollectionRow | undefined {
  return db.all(sql`
    SELECT * FROM album_collections WHERE id = ${collectionId} AND user_id = ${userId}
  `)[0] as CollectionRow | undefined;
}

/** Portada efectiva: la elegida a mano o, si no hay, la del primer miembro que tenga.
 *  Una colección recién creada no tiene imagen propia y sin esto saldría en blanco en
 *  todas las listas de ranking, que es donde más se nota. */
export function collectionCover(db: Db, collectionId: number): string | null {
  return coverFallback(db, collectionId);
}

function coverFallback(db: Db, collectionId: number): string | null {
  const row = db.all(sql`
    SELECT COALESCE(al.image_url, al_t.image_url) AS image_url
    FROM album_collection_members acm
    LEFT JOIN albums al ON acm.member_type = 'album' AND al.spotify_id = acm.member_id
    LEFT JOIN tracks t ON acm.member_type = 'track' AND t.spotify_id = acm.member_id
    LEFT JOIN albums al_t ON al_t.spotify_id = t.album_id
    WHERE acm.collection_id = ${collectionId}
      AND COALESCE(al.image_url, al_t.image_url) IS NOT NULL
    ORDER BY acm.position ASC
    LIMIT 1
  `)[0] as { image_url: string | null } | undefined;
  return row?.image_url ?? null;
}

/** Resumen de una colección con sus recuentos y sus cifras all-time. */
export function getCollectionSummary(db: Db, collectionId: number, userId: number): AlbumCollectionSummary | null {
  const row = getCollectionRow(db, collectionId, userId);
  if (!row) return null;
  return hydrateSummary(db, row, userId);
}

function hydrateSummary(db: Db, row: CollectionRow, userId: number): AlbumCollectionSummary {
  const counts = db.all(sql`
    SELECT
      SUM(CASE WHEN member_type = 'album' THEN 1 ELSE 0 END) AS albums,
      SUM(CASE WHEN member_type = 'track' THEN 1 ELSE 0 END) AS tracks
    FROM album_collection_members WHERE collection_id = ${row.id}
  `)[0] as { albums: number | null; tracks: number | null };

  const artist = db.all(sql`
    SELECT name FROM artists WHERE spotify_id = ${row.artist_id}
  `)[0] as { name: string } | undefined;

  const stats = getCollectionStats(db, row.id, null, null, userId);

  return {
    id: row.id,
    name: row.name,
    artistId: row.artist_id,
    artistName: artist?.name ?? '',
    imageUrl: row.image_url ?? coverFallback(db, row.id),
    color: row.color,
    notes: row.notes,
    albumCount: counts.albums ?? 0,
    trackCount: counts.tracks ?? 0,
    playCount: stats.play_count,
    totalMs: stats.total_ms,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Colecciones de un artista (resuelto sobre su grupo de merge, como el resto de
 *  anotaciones del detalle: valoraciones y conciertos). */
export function getArtistCollections(db: Db, artistIds: string[], userId: number): AlbumCollectionSummary[] {
  if (artistIds.length === 0) return [];
  const rows = db.all(sql`
    SELECT * FROM album_collections
    WHERE user_id = ${userId} AND artist_id IN (${idList(artistIds)})
    ORDER BY created_at ASC
  `) as CollectionRow[];
  return rows.map(r => hydrateSummary(db, r, userId));
}

/** Miembros hidratados, cada uno con sus cifras propias (las que suma la colección). */
export function getCollectionMembers(db: Db, collectionId: number, userId: number): CollectionMember[] {
  const rows = db.all(sql`
    SELECT acm.member_type, acm.member_id, acm.position,
           COALESCE(al.name, t.name) AS name,
           COALESCE(al.image_url, al_t.image_url) AS image_url,
           al.release_date AS release_date
    FROM album_collection_members acm
    LEFT JOIN albums al ON acm.member_type = 'album' AND al.spotify_id = acm.member_id
    LEFT JOIN tracks t ON acm.member_type = 'track' AND t.spotify_id = acm.member_id
    LEFT JOIN albums al_t ON al_t.spotify_id = t.album_id
    WHERE acm.collection_id = ${collectionId} AND acm.user_id = ${userId}
    ORDER BY acm.position ASC
  `) as { member_type: CollectionMemberType; member_id: string; position: number; name: string | null; image_url: string | null; release_date: string | null }[];

  if (rows.length === 0) return [];

  const albumIds = rows.filter(r => r.member_type === 'album').map(r => r.member_id);
  const trackIds = rows.filter(r => r.member_type === 'track').map(r => r.member_id);
  const plays = memberPlays(db, albumIds, trackIds, userId, albumOwners(db, albumIds, userId));
  const artistsByMember = memberArtists(db, albumIds, trackIds);

  return rows.map(r => {
    const stat = plays.get(`${r.member_type}:${r.member_id}`);
    return {
      entityType: r.member_type,
      entityId: r.member_id,
      position: r.position,
      // el miembro puede haber desaparecido del catálogo (un dedup se llevó la fila):
      // se pinta con su id en vez de romper la página, y se puede quitar desde ella
      name: r.name ?? r.member_id,
      imageUrl: r.image_url,
      artists: artistsByMember.get(`${r.member_type}:${r.member_id}`) ?? [],
      releaseDate: r.member_type === 'album' ? r.release_date : undefined,
      playCount: stat?.play_count ?? 0,
      totalMs: stat?.total_ms ?? 0,
    };
  });
}

/** Cifras que aporta cada miembro. Se cuentan por el álbum CRUDO del play y no por el
 *  resuelto de merges, porque aquí la pregunta es "¿cuánto pone éste?" y no "¿bajo qué
 *  id vive?": agrupando por el resuelto, un miembro que está mergeado dentro de otro
 *  miembro marcaba 0 (sus plays aparecían bajo el otro) y las filas dejaban de sumar el
 *  total de la colección.
 *  El mapa reparte cada álbum crudo del alcance a UN miembro —él mismo si lo es, y si no
 *  el miembro que lo absorbió—, así que las filas son disjuntas y suman exactamente lo
 *  que suma la colección. */
function memberPlays(db: Db, albumIds: string[], trackIds: string[], userId: number, ownerByAlbum: Map<string, string>): Map<string, { play_count: number; total_ms: number }> {
  const out = new Map<string, { play_count: number; total_ms: number }>();

  if (ownerByAlbum.size > 0) {
    const scopeIds = [...ownerByAlbum.keys()];
    const rows = db.all(sql`
      SELECT t.album_id AS eid, count(*) AS play_count, sum(${playDuration()}) AS total_ms
      FROM listening_history lh
      LEFT JOIN merge_rules mr_track ON mr_track.entity_type = 'track' AND mr_track.source_id = lh.track_id AND mr_track.user_id = ${userId}
      JOIN tracks t ON t.spotify_id = COALESCE(mr_track.target_id, lh.track_id)
      WHERE lh.user_id = ${userId}
        AND t.album_id IN (${idList(scopeIds)})
        AND lh.track_id IN (
          SELECT spotify_id FROM tracks WHERE album_id IN (${idList(scopeIds)})
          UNION
          SELECT mr_p.source_id FROM merge_rules mr_p JOIN tracks t_p ON t_p.spotify_id = mr_p.target_id
          WHERE mr_p.entity_type = 'track' AND mr_p.user_id = ${userId} AND t_p.album_id IN (${idList(scopeIds)})
        )
      GROUP BY t.album_id
    `) as { eid: string; play_count: number; total_ms: number }[];
    for (const r of rows) {
      const owner = ownerByAlbum.get(r.eid);
      if (!owner) continue;
      const key = `album:${owner}`;
      const acc = out.get(key) ?? { play_count: 0, total_ms: 0 };
      acc.play_count += r.play_count;
      acc.total_ms += r.total_ms;
      out.set(key, acc);
    }
    // un miembro sin ningún play sigue necesitando fila con su cero
    for (const id of albumIds) if (!out.has(`album:${id}`)) out.set(`album:${id}`, { play_count: 0, total_ms: 0 });
  }

  if (trackIds.length > 0) {
    const ids = idList(trackIds);
    const rows = db.all(sql`
      SELECT COALESCE(mr_track.target_id, lh.track_id) AS eid,
             count(*) AS play_count, sum(${playDuration()}) AS total_ms
      FROM listening_history lh
      LEFT JOIN merge_rules mr_track ON mr_track.entity_type = 'track' AND mr_track.source_id = lh.track_id AND mr_track.user_id = ${userId}
      JOIN tracks t ON t.spotify_id = COALESCE(mr_track.target_id, lh.track_id)
      WHERE lh.user_id = ${userId} AND COALESCE(mr_track.target_id, lh.track_id) IN (${ids})
      GROUP BY eid
    `) as { eid: string; play_count: number; total_ms: number }[];
    for (const r of rows) out.set(`track:${r.eid}`, { play_count: r.play_count, total_ms: r.total_ms });
  }

  return out;
}

function memberArtists(db: Db, albumIds: string[], trackIds: string[]): Map<string, { id: string; name: string }[]> {
  const out = new Map<string, { id: string; name: string }[]>();
  const push = (key: string, id: string, name: string) => {
    const list = out.get(key);
    if (list) { if (!list.some(a => a.id === id)) list.push({ id, name }); }
    else out.set(key, [{ id, name }]);
  };

  if (albumIds.length > 0) {
    // artistas de posición 0 de sus temas: el mismo criterio de respaldo que
    // getAlbumArtists, sin la vía de albums.artist_ids (aquí basta con etiquetar la fila)
    const rows = db.all(sql`
      SELECT t.album_id AS eid, a.spotify_id AS id, a.name, count(*) AS n
      FROM tracks t
      JOIN track_artists ta ON ta.track_id = t.spotify_id AND ta.position = 0
      JOIN artists a ON a.spotify_id = ta.artist_id
      WHERE t.album_id IN (${idList(albumIds)})
      GROUP BY t.album_id, a.spotify_id
      ORDER BY n DESC
    `) as { eid: string; id: string; name: string }[];
    for (const r of rows) push(`album:${r.eid}`, r.id, r.name);
  }

  if (trackIds.length > 0) {
    const rows = db.all(sql`
      SELECT ta.track_id AS eid, a.spotify_id AS id, a.name
      FROM track_artists ta
      JOIN artists a ON a.spotify_id = ta.artist_id
      WHERE ta.track_id IN (${idList(trackIds)})
      ORDER BY ta.track_id, ta.position
    `) as { eid: string; id: string; name: string }[];
    for (const r of rows) push(`track:${r.eid}`, r.id, r.name);
  }

  return out;
}

// --- agregaciones de la página de detalle ---
// Mismas que las de un álbum, pero con el alcance en dos ejes (álbumes + temas
// sueltos), así que no pueden pasar por entityWhereCol/albumPlaysPredicate.

export function getCollectionStats(db: Db, collectionId: number, rangeStart: string | null, rangeEnd: string | null | undefined, userId: number): StatsRow {
  const scope = getCollectionScope(db, collectionId, userId);
  return db.all(sql`
    SELECT count(*) as play_count, coalesce(sum(${playDuration()}), 0) as total_ms,
           min(lh.played_at) as first_played, max(lh.played_at) as last_played
    FROM listening_history lh
    ${resolvedPlayJoins('album', userId)}
    WHERE ${scopeWhere(scope)} ${rangeWhere(rangeStart, rangeEnd)} ${userFilter(userId)} ${scopeDrive(scope, userId)}
  `)[0] as StatsRow;
}

export function getCollectionSeries(db: Db, collectionId: number, rangeStart: string | null, range: TimeRange, rangeEnd: string | null | undefined, customDays: number | undefined, userId: number): SeriesRow[] {
  const scope = getCollectionScope(db, collectionId, userId);
  const dateTrunc = customDays != null ? getDateTruncForDays(customDays) : getDateTrunc(range);
  return db.all(sql`
    SELECT ${dateTrunc} as period, count(*) as play_count, sum(${playDuration()}) as total_ms
    FROM listening_history lh
    ${resolvedPlayJoins('album', userId)}
    WHERE ${scopeWhere(scope)} ${rangeWhere(rangeStart, rangeEnd)} ${userFilter(userId)} ${scopeDrive(scope, userId)}
    GROUP BY period
    ORDER BY period ASC
  `) as SeriesRow[];
}

/** Todos los temas que agrega la colección: los de sus álbumes miembro más los sueltos.
 *  Excluye los que son source de un merge (se cuentan bajo su canónico), igual que
 *  getAlbumTracks. */
export function getCollectionTracks(db: Db, collectionId: number, rangeStart: string | null, sort: Sort, rangeEnd: string | null | undefined, userId: number) {
  const scope = getCollectionScope(db, collectionId, userId);
  const parts: SqlChunk[] = [];
  if (scope.albumIds.length > 0) parts.push(sql`t.album_id IN (${idList(scope.albumIds)})`);
  if (scope.trackIds.length > 0) parts.push(sql`t.spotify_id IN (${idList(scope.trackIds)})`);
  if (parts.length === 0) return [];
  const member = sql`(${sql.join(parts, sql` OR `)})`;

  return db.all(sql`
    SELECT t.spotify_id as track_id, t.name, t.duration_ms, t.track_number, t.disc_number, t.album_id,
           coalesce(s.play_count, 0) as play_count, coalesce(s.total_ms, 0) as total_ms
    FROM tracks t
    LEFT JOIN (
      SELECT COALESCE(mr_track.target_id, lh.track_id) as resolved_track_id,
             count(*) as play_count, sum(COALESCE(lh.duration_played_ms, tr.duration_ms)) as total_ms
      FROM listening_history lh
      LEFT JOIN merge_rules mr_track ON mr_track.entity_type = 'track' AND mr_track.source_id = lh.track_id AND mr_track.user_id = ${userId}
      JOIN tracks tr ON tr.spotify_id = COALESCE(mr_track.target_id, lh.track_id)
      WHERE lh.user_id = ${userId} ${rangeWhere(rangeStart, rangeEnd)}
        AND (${scope.albumIds.length > 0 ? sql`tr.album_id IN (${idList(scope.albumIds)})` : sql`0`}
          OR ${scope.trackIds.length > 0 ? sql`tr.spotify_id IN (${idList(scope.trackIds)})` : sql`0`})
      GROUP BY resolved_track_id
    ) s ON s.resolved_track_id = t.spotify_id
    WHERE ${member}
      AND t.spotify_id NOT IN (SELECT source_id FROM merge_rules WHERE entity_type = 'track' AND user_id = ${userId})
    ORDER BY ${sort === 'natural'
      ? sql`COALESCE(t.disc_number, 1) ASC, COALESCE(t.track_number, 9999) ASC, t.name ASC`
      : sort === 'plays' ? sql`play_count DESC, t.name ASC` : sql`total_ms DESC, t.name ASC`}
  `) as { track_id: string; name: string; duration_ms: number; track_number: number | null; disc_number: number | null; album_id: string | null; play_count: number; total_ms: number }[];
}

export function getCollectionRecentPlays(db: Db, collectionId: number, limit: number, userId: number): RecentPlayRow[] {
  const scope = getCollectionScope(db, collectionId, userId);
  return db.all(sql`
    SELECT lh.id, lh.played_at, lh.track_id
    FROM listening_history lh
    ${resolvedPlayJoins('album', userId)}
    WHERE ${scopeWhere(scope)} ${userFilter(userId)} ${scopeDrive(scope, userId)}
    ORDER BY lh.played_at DESC
    LIMIT ${limit}
  `) as RecentPlayRow[];
}

// --- hidratación de ids `collection:N` en el espacio de álbum ---

/** La colección vista como un álbum, para los formateadores de las listas de ranking.
 *  `releaseDate` es la del primer lanzamiento que agrega: es lo que ordena bien una
 *  era o una trilogía entre los discos sueltos del artista. */
export function lookupCollectionAsAlbum(db: Db, collectionId: number): FormattedAlbum | null {
  const row = db.all(sql`
    SELECT ac.name, ac.image_url, ac.color,
           (SELECT MIN(al.release_date) FROM album_collection_members acm
            JOIN albums al ON al.spotify_id = acm.member_id
            WHERE acm.collection_id = ac.id AND acm.member_type = 'album') AS release_date
    FROM album_collections ac WHERE ac.id = ${collectionId}
  `)[0] as { name: string; image_url: string | null; color: string | null; release_date: string | null } | undefined;
  if (!row) return null;
  return {
    name: row.name,
    imageUrl: row.image_url ?? coverFallback(db, collectionId),
    releaseDate: row.release_date,
    albumType: COLLECTION_ALBUM_TYPE,
    color: row.color,
  };
}

/** Artista dueño de una colección, con la forma que devuelve getAlbumArtists. */
export function getCollectionArtists(db: Db, collectionId: number) {
  return db.all(sql`
    SELECT a.spotify_id as artist_id, a.name, a.image_url
    FROM album_collections ac JOIN artists a ON a.spotify_id = ac.artist_id
    WHERE ac.id = ${collectionId}
  `) as { artist_id: string; name: string; image_url: string | null }[];
}

/** Metadatos en lote para un conjunto de claves `collection:N` (fetchEntityMetadata). */
export function fetchCollectionMetadata(db: Db, collectionIds: number[]) {
  if (collectionIds.length === 0) return [];
  return db.all(sql`
    SELECT ac.id, ac.name, ac.image_url, ac.artist_id, a.name AS artist_name
    FROM album_collections ac
    LEFT JOIN artists a ON a.spotify_id = ac.artist_id
    WHERE ac.id IN (${sql.join(collectionIds.map(id => sql`${id}`), sql`, `)})
  `) as { id: number; name: string; image_url: string | null; artist_id: string; artist_name: string | null }[];
}

/** A qué colección pertenece cada entidad de un lote. Es lo que pinta la línea de
 *  pertenencia del detalle de álbum y de tema. Un tema devuelve además la colección a
 *  la que entra por su álbum (`direct: false`): desde ahí no se puede quitar, hay que
 *  ir al álbum. */
export function getCollectionRefs(db: Db, entityType: CollectionMemberType, entityIds: string[], userId: number): Map<string, CollectionRef> {
  const out = new Map<string, CollectionRef>();
  if (entityIds.length === 0) return out;
  const ids = idList(entityIds);

  // los miembros se guardan por su id canónico (ver canonicalMemberId), así que la
  // página de un alias tiene que preguntar por el suyo: sin esto, un álbum mergeado
  // dentro de un miembro no enseñaba la línea de pertenencia
  const canonical = new Map<string, string>(entityIds.map(id => [id, id]));
  const targets = db.all(sql`
    SELECT source_id, target_id FROM merge_rules
    WHERE entity_type = ${entityType} AND user_id = ${userId} AND source_id IN (${ids})
  `) as { source_id: string; target_id: string }[];
  for (const r of targets) canonical.set(r.source_id, r.target_id);

  const lookupIds = [...new Set(canonical.values())];
  const direct = db.all(sql`
    SELECT acm.member_id AS member_id, ac.id, ac.name, ac.image_url
    FROM album_collection_members acm
    JOIN album_collections ac ON ac.id = acm.collection_id
    WHERE acm.user_id = ${userId} AND acm.member_type = ${entityType} AND acm.member_id IN (${idList(lookupIds)})
  `) as { member_id: string; id: number; name: string; image_url: string | null }[];
  const byMember = new Map(direct.map(r => [r.member_id, r]));
  for (const [requested, canon] of canonical) {
    const r = byMember.get(canon);
    if (r) out.set(requested, { id: r.id, name: r.name, imageUrl: r.image_url ?? coverFallback(db, r.id), direct: true });
  }

  if (entityType === 'track') {
    // el álbum del tema también se resuelve de merges: es como lo mira el ranking
    const viaAlbum = db.all(sql`
      SELECT t.spotify_id AS member_id, ac.id, ac.name, ac.image_url
      FROM tracks t
      LEFT JOIN merge_rules mr_album ON mr_album.entity_type = 'album' AND mr_album.source_id = t.album_id AND mr_album.user_id = ${userId}
      JOIN album_collection_members acm ON acm.user_id = ${userId} AND acm.member_type = 'album'
        AND acm.member_id = COALESCE(mr_album.target_id, t.album_id)
      JOIN album_collections ac ON ac.id = acm.collection_id
      WHERE t.spotify_id IN (${ids})
    `) as { member_id: string; id: number; name: string; image_url: string | null }[];
    for (const r of viaAlbum) {
      if (out.has(r.member_id)) continue;
      out.set(r.member_id, { id: r.id, name: r.name, imageUrl: r.image_url ?? coverFallback(db, r.id), direct: false });
    }
  }

  return out;
}

// --- escritura ---

export function createCollection(db: Db, userId: number, artistId: string, name: string, notes: string | null): number {
  const row = db.all(sql`
    INSERT INTO album_collections (user_id, artist_id, name, notes)
    VALUES (${userId}, ${artistId}, ${name}, ${notes})
    RETURNING id
  `)[0] as { id: number };
  return row.id;
}

export function updateCollection(db: Db, collectionId: number, userId: number, fields: { name?: string; notes?: string | null; imageUrl?: string | null; color?: string | null }): void {
  const sets: SqlChunk[] = [];
  if (fields.name !== undefined) sets.push(sql`name = ${fields.name}`);
  if (fields.notes !== undefined) sets.push(sql`notes = ${fields.notes}`);
  if (fields.imageUrl !== undefined) sets.push(sql`image_url = ${fields.imageUrl}`);
  if (fields.color !== undefined) sets.push(sql`color = ${fields.color}`);
  if (sets.length === 0) return;
  sets.push(sql`updated_at = ${new Date().toISOString()}`);
  db.run(sql`UPDATE album_collections SET ${sql.join(sets, sql`, `)} WHERE id = ${collectionId} AND user_id = ${userId}`);
}

export function deleteCollection(db: Db, collectionId: number, userId: number): void {
  // los miembros no caen por la FK: foreign_keys puede estar OFF y el ON DELETE
  // CASCADE sólo actúa con el pragma activo. Borrarlos a mano es lo que garantiza
  // que sus plays vuelvan a atribuirse a los álbumes de verdad
  db.run(sql`DELETE FROM album_collection_members WHERE collection_id = ${collectionId} AND user_id = ${userId}`);
  db.run(sql`DELETE FROM album_collections WHERE id = ${collectionId} AND user_id = ${userId}`);
}

/** Colección a la que ya pertenece una entidad, si es que pertenece a alguna: el
 *  invariante de "un miembro, una colección" se comprueba antes de insertar para poder
 *  devolver un 409 que nombre el conflicto (el UNIQUE sólo daría un error opaco). */
export function findMemberCollection(db: Db, entityType: CollectionMemberType, entityId: string, userId: number): { id: number; name: string } | undefined {
  const memberId = canonicalMemberId(db, entityType, entityId, userId);
  return db.all(sql`
    SELECT ac.id, ac.name FROM album_collection_members acm
    JOIN album_collections ac ON ac.id = acm.collection_id
    WHERE acm.user_id = ${userId} AND acm.member_type = ${entityType} AND acm.member_id = ${memberId}
  `)[0] as { id: number; name: string } | undefined;
}

/** Id con el que se guarda un miembro: SIEMPRE el canónico de su merge.
 *  Un alias no vale: el eje álbum resuelve merges ANTES de mirar la pertenencia
 *  (`acm_album.member_id = COALESCE(mr_album.target_id, t.album_id)`), así que un
 *  miembro que sea source no casa con ningún play y la colección rankearía a cero
 *  mientras su propia página, que cuenta por el álbum crudo, enseña las escuchas.
 *  Guardar el canónico es además lo que dice el merge: son la misma entidad. */
export function canonicalMemberId(db: Db, entityType: CollectionMemberType, entityId: string, userId: number): string {
  const row = db.all(sql`
    SELECT target_id FROM merge_rules
    WHERE entity_type = ${entityType} AND source_id = ${entityId} AND user_id = ${userId}
  `)[0] as { target_id: string } | undefined;
  return row?.target_id ?? entityId;
}

export function addCollectionMember(db: Db, collectionId: number, userId: number, entityType: CollectionMemberType, entityId: string): void {
  const memberId = canonicalMemberId(db, entityType, entityId, userId);
  const next = db.all(sql`
    SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM album_collection_members WHERE collection_id = ${collectionId}
  `)[0] as { pos: number };
  db.run(sql`
    INSERT INTO album_collection_members (collection_id, user_id, member_type, member_id, position)
    VALUES (${collectionId}, ${userId}, ${entityType}, ${memberId}, ${next.pos})
  `);
  touch(db, collectionId, userId);
}

export function removeCollectionMember(db: Db, collectionId: number, userId: number, entityType: CollectionMemberType, entityId: string): void {
  // por el canónico, que es con lo que se guardó: quitar desde la página de un alias
  // tiene que encontrar la fila igual
  const memberId = canonicalMemberId(db, entityType, entityId, userId);
  db.run(sql`
    DELETE FROM album_collection_members
    WHERE collection_id = ${collectionId} AND user_id = ${userId} AND member_type = ${entityType} AND member_id = ${memberId}
  `);
  touch(db, collectionId, userId);
}

/** Reordena los miembros al orden dado; los que no se nombren conservan su posición
 *  relativa detrás. El orden es el de la lista de la página, no una propiedad musical. */
export function reorderCollectionMembers(db: Db, collectionId: number, userId: number, order: { entityType: CollectionMemberType; entityId: string }[]): void {
  order.forEach((m, i) => {
    db.run(sql`
      UPDATE album_collection_members SET position = ${i}
      WHERE collection_id = ${collectionId} AND user_id = ${userId} AND member_type = ${m.entityType} AND member_id = ${m.entityId}
    `);
  });
  touch(db, collectionId, userId);
}

function touch(db: Db, collectionId: number, userId: number): void {
  db.run(sql`UPDATE album_collections SET updated_at = ${new Date().toISOString()} WHERE id = ${collectionId} AND user_id = ${userId}`);
}

/** Ranking de la colección entre los álbumes, en los cuatro rangos fijos. La clave por
 *  la que compite es la misma que emite resolvedEntityId('album'), así que no hace
 *  falta nada especial: basta con preguntar por ella. */
export function collectionRankKey(collectionId: number): string {
  return collectionKey(collectionId);
}

export { COLLECTION_ID_PREFIX };
