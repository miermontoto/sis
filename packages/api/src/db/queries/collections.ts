// Colecciones ("álbumes lógicos"): contenedor del usuario que agrega álbumes enteros
// y temas sueltos de un artista. Ver shared/collections.ts para el modelo y
// helpers.ts (collectionMemberJoins / resolvedEntityId) para la capa que hace que
// sustituyan a sus miembros en los rankings.
//
// **Una colección ES un álbum**: su fila vive en `albums` con el id `collection:<id>`,
// así que nombre, portada, color, valoración, buscador y la vista de detalle entera
// le salen gratis, sin rutas ni componentes paralelos. Esta tabla sólo guarda lo que
// un álbum no tiene: de quién es y de qué artista.
//
// Lo que NO sale gratis es todo lo que va del álbum a sus plays, porque una colección
// no tiene temas propios: sus cifras, su serie, su tracklist y su historial salen del
// alcance de sus miembros, y eso es lo que vive aquí.
import { sql } from 'drizzle-orm';
import type { Db, Sort, SqlChunk, StatsRow, SeriesRow, RecentPlayRow } from './helpers.js';
import { rangeWhere, userFilter, getDateTrunc, getDateTruncForDays, playDuration, resolvedPlayJoins, artistCreditedAlbums } from './helpers.js';
import { collectionKey, COLLECTION_ID_PREFIX } from '@sis/shared';
import type { AlbumCollectionSummary, CollectionCandidate, CollectionMember, CollectionMemberType, CollectionRef } from '@sis/shared';
import type { TimeRange } from '../../constants.js';

// tipo de álbum que se le atribuye a una colección allí donde la UI espera uno
// (`FormattedAlbum.albumType`): no es ninguno de los de spotify a propósito
export const COLLECTION_ALBUM_TYPE = 'collection';

interface CollectionRow {
  id: number;
  user_id: number;
  artist_id: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  // de la fila de `albums` (LEFT JOIN: la colección se lee igual aunque su álbum
  // todavía no exista, que es el estado en el que la deja una migración a medias)
  name: string | null;
  image_url: string | null;
  color: string | null;
}

// SELECT común: la colección con los metadatos de su álbum
const COLLECTION_SELECT = sql`
  SELECT ac.*, al.name AS name, al.image_url AS image_url, al.color AS color
  FROM album_collections ac
  LEFT JOIN albums al ON al.spotify_id = ${COLLECTION_ID_PREFIX} || ac.id`;

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
  return db.all(sql`${COLLECTION_SELECT} WHERE ac.id = ${collectionId} AND ac.user_id = ${userId}`)[0] as CollectionRow | undefined;
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
    artistId: row.artist_id,
    artistName: artist?.name ?? '',
    name: row.name ?? '',
    imageUrl: row.image_url,
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
    ${COLLECTION_SELECT}
    WHERE ac.user_id = ${userId} AND ac.artist_id IN (${idList(artistIds)})
    ORDER BY ac.created_at ASC
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

/** Artista dueño de una colección, con la forma que devuelve getAlbumArtists. */
export function getCollectionArtists(db: Db, collectionId: number) {
  return db.all(sql`
    SELECT a.spotify_id as artist_id, a.name, a.image_url
    FROM album_collections ac JOIN artists a ON a.spotify_id = ac.artist_id
    WHERE ac.id = ${collectionId}
  `) as { artist_id: string; name: string; image_url: string | null }[];
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
    SELECT acm.member_id AS member_id, ac.id, al.name, al.image_url
    FROM album_collection_members acm
    JOIN album_collections ac ON ac.id = acm.collection_id
    JOIN albums al ON al.spotify_id = ${COLLECTION_ID_PREFIX} || ac.id
    WHERE acm.user_id = ${userId} AND acm.member_type = ${entityType} AND acm.member_id IN (${idList(lookupIds)})
  `) as { member_id: string; id: number; name: string; image_url: string | null }[];
  const byMember = new Map(direct.map(r => [r.member_id, r]));
  for (const [requested, canon] of canonical) {
    const r = byMember.get(canon);
    if (r) out.set(requested, { id: r.id, name: r.name, imageUrl: r.image_url, direct: true });
  }

  if (entityType === 'track') {
    // el álbum del tema también se resuelve de merges: es como lo mira el ranking
    const viaAlbum = db.all(sql`
      SELECT t.spotify_id AS member_id, ac.id, al.name, al.image_url
      FROM tracks t
      LEFT JOIN merge_rules mr_album ON mr_album.entity_type = 'album' AND mr_album.source_id = t.album_id AND mr_album.user_id = ${userId}
      JOIN album_collection_members acm ON acm.user_id = ${userId} AND acm.member_type = 'album'
        AND acm.member_id = COALESCE(mr_album.target_id, t.album_id)
      JOIN album_collections ac ON ac.id = acm.collection_id
      JOIN albums al ON al.spotify_id = ${COLLECTION_ID_PREFIX} || ac.id
      WHERE t.spotify_id IN (${ids})
    `) as { member_id: string; id: number; name: string; image_url: string | null }[];
    for (const r of viaAlbum) {
      if (out.has(r.member_id)) continue;
      out.set(r.member_id, { id: r.id, name: r.name, imageUrl: r.image_url, direct: false });
    }
  }

  return out;
}

// --- elegibilidad: qué puede entrar en la colección de un artista ---

/** Una colección agrupa lo que es DEL artista, así que un miembro tiene que estar
 *  acreditado en él. La definición no se reinventa aquí:
 *   - álbum: `artistCreditedAlbums`, la misma que decide qué discos salen en la
 *     página del artista (crédito de álbum, o mayoría de temas liderados). Con una
 *     regla propia acabarías viendo un disco en su página que la colección rechaza.
 *   - tema: acreditado en CUALQUIER posición. Una colaboración es de los dos, igual
 *     que un disco a dos nombres.
 *  `artistIds` es el grupo de merge del artista de la colección. */
export function isEligibleMember(db: Db, entityType: CollectionMemberType, entityId: string, artistIds: string[]): boolean {
  if (artistIds.length === 0) return false;
  const ids = idList(artistIds);
  const row = entityType === 'album'
    ? db.all(sql`SELECT 1 AS ok FROM albums WHERE spotify_id = ${entityId} AND spotify_id IN ${artistCreditedAlbums(artistIds)}`)[0]
    : db.all(sql`SELECT 1 AS ok FROM track_artists WHERE track_id = ${entityId} AND artist_id IN (${ids}) LIMIT 1`)[0];
  return !!row;
}

/** Colecciones en las que ESTA entidad puede entrar: las de cualquier artista
 *  acreditado en ella. Un tema a dos nombres cabe en la colección de los dos, y sin
 *  esto la página sólo ofrecía las del artista principal.
 *  Se filtra colección a colección con `isEligibleMember` en vez de invertir la regla
 *  de crédito (que no es invertible en el arm de la mayoría): son un puñado de filas
 *  por usuario y así la regla vive en un solo sitio. */
export function getEligibleCollections(db: Db, entityType: CollectionMemberType, entityId: string, userId: number): AlbumCollectionSummary[] {
  const rows = db.all(sql`${COLLECTION_SELECT} WHERE ac.user_id = ${userId} ORDER BY ac.created_at ASC`) as CollectionRow[];
  const memberId = canonicalMemberId(db, entityType, entityId, userId);
  return rows
    .filter(r => isEligibleMember(db, entityType, memberId, artistMergeGroup(db, r.artist_id, userId)))
    .map(r => hydrateSummary(db, r, userId));
}

/** Grupo de merge del artista de una colección: sus alias también acreditan. */
export function artistMergeGroup(db: Db, artistId: string, userId: number): string[] {
  const sources = db.all(sql`
    SELECT source_id FROM merge_rules
    WHERE entity_type = 'artist' AND target_id = ${artistId} AND user_id = ${userId}
  `) as { source_id: string }[];
  return [artistId, ...sources.map(r => r.source_id)];
}

/** Candidatos para el picker de la colección: lo del artista que todavía no está en
 *  ninguna colección. `takenBy` no los esconde — enseñar dónde están es lo que
 *  explica por qué no se pueden añadir (un miembro pertenece a UNA colección). */
export function getCollectionCandidates(db: Db, collectionId: number, userId: number, q: string, limit: number) {
  const row = getCollectionRow(db, collectionId, userId);
  if (!row) return { albums: [], tracks: [] };
  const artistIds = artistMergeGroup(db, row.artist_id, userId);
  const ids = idList(artistIds);
  const term = `%${q.trim().toLowerCase()}%`;
  // cualificado: en la query hay dos `albums` (el candidato y la colección que lo
  // tiene), y un `name` a secas es ambiguo
  const search = q.trim() ? sql`AND lower(a.name) LIKE ${term}` : sql``;

  // la pertenencia se pinta con el nombre de la colección que lo tiene, así que el
  // LEFT JOIN va a las dos tablas; `member_id` ya es canónico (ver canonicalMemberId)
  const albums = db.all(sql`
    SELECT a.spotify_id AS id, a.name, a.image_url, a.release_date,
           coalesce(p.play_count, 0) AS play_count, coalesce(p.total_ms, 0) AS total_ms,
           ac.id AS taken_id, taken.name AS taken_name
    FROM albums a
    LEFT JOIN album_collection_members acm ON acm.user_id = ${userId} AND acm.member_type = 'album' AND acm.member_id = a.spotify_id
    LEFT JOIN album_collections ac ON ac.id = acm.collection_id
    LEFT JOIN albums taken ON taken.spotify_id = ${COLLECTION_ID_PREFIX} || ac.id
    LEFT JOIN (
      SELECT t.album_id AS album_id, count(*) AS play_count, sum(${playDuration()}) AS total_ms
      FROM listening_history lh
      JOIN tracks t ON t.spotify_id = lh.track_id
      WHERE lh.user_id = ${userId} AND t.album_id IN ${artistCreditedAlbums(artistIds)}
      GROUP BY t.album_id
    ) p ON p.album_id = a.spotify_id
    WHERE a.spotify_id IN ${artistCreditedAlbums(artistIds)}
      -- otra colección no es candidata: anidar colecciones contaría sus plays dos veces
      AND a.album_type IS NOT ${COLLECTION_ALBUM_TYPE}
      -- un alias de merge no es candidato: lo que se guarda es su canónico, y
      -- ofrecer los dos es ofrecer la misma entidad dos veces
      AND a.spotify_id NOT IN (SELECT source_id FROM merge_rules WHERE entity_type = 'album' AND user_id = ${userId})
      ${search}
    ORDER BY play_count DESC, a.release_date DESC
    LIMIT ${limit}
  `) as CandidateRow[];

  const tracks = db.all(sql`
    SELECT t.spotify_id AS id, t.name, al.image_url, al.release_date,
           coalesce(p.play_count, 0) AS play_count, coalesce(p.total_ms, 0) AS total_ms,
           ac.id AS taken_id, taken.name AS taken_name
    FROM tracks t
    LEFT JOIN albums al ON al.spotify_id = t.album_id
    LEFT JOIN album_collection_members acm ON acm.user_id = ${userId} AND acm.member_type = 'track' AND acm.member_id = t.spotify_id
    LEFT JOIN album_collections ac ON ac.id = acm.collection_id
    LEFT JOIN albums taken ON taken.spotify_id = ${COLLECTION_ID_PREFIX} || ac.id
    LEFT JOIN (
      -- el alias tiene que ser t: playDuration() capa el tiempo con t.duration_ms
      SELECT lh.track_id AS track_id, count(*) AS play_count, sum(${playDuration()}) AS total_ms
      FROM listening_history lh
      JOIN tracks t ON t.spotify_id = lh.track_id
      WHERE lh.user_id = ${userId} AND lh.track_id IN (SELECT track_id FROM track_artists WHERE artist_id IN (${ids}))
      GROUP BY lh.track_id
    ) p ON p.track_id = t.spotify_id
    WHERE t.spotify_id IN (SELECT track_id FROM track_artists WHERE artist_id IN (${ids}))
      AND t.spotify_id NOT IN (SELECT source_id FROM merge_rules WHERE entity_type = 'track' AND user_id = ${userId})
      ${q.trim() ? sql`AND lower(t.name) LIKE ${term}` : sql``}
    ORDER BY play_count DESC, t.name ASC
    LIMIT ${limit}
  `) as CandidateRow[];

  return { albums: albums.map(toCandidate), tracks: tracks.map(toCandidate) };
}

interface CandidateRow {
  id: string; name: string; image_url: string | null; release_date: string | null;
  play_count: number; total_ms: number; taken_id: number | null; taken_name: string | null;
}

function toCandidate(r: CandidateRow): CollectionCandidate {
  return {
    id: r.id,
    name: r.name,
    imageUrl: r.image_url,
    releaseDate: r.release_date,
    playCount: r.play_count,
    totalMs: r.total_ms,
    takenBy: r.taken_id !== null ? { id: r.taken_id, name: r.taken_name ?? '' } : null,
  };
}

// --- escritura ---

/** Crea la colección y **su fila de álbum**. `artist_ids` y `release_date` se quedan
 *  a NULL a propósito: es lo que mantiene lejos a los cuatro barridos de dedup de
 *  álbumes, que exigen tracks, créditos o una fecha real. `album_type` la marca para
 *  que la UI pueda distinguirla de un lanzamiento de verdad. */
export function createCollection(db: Db, userId: number, artistId: string, name: string, notes: string | null): number {
  const row = db.all(sql`
    INSERT INTO album_collections (user_id, artist_id, notes)
    VALUES (${userId}, ${artistId}, ${notes})
    RETURNING id
  `)[0] as { id: number };
  db.run(sql`
    INSERT INTO albums (spotify_id, name, album_type, updated_at)
    VALUES (${collectionKey(row.id)}, ${name}, ${COLLECTION_ALBUM_TYPE}, datetime('now'))
  `);
  return row.id;
}

/** El nombre vive en la fila de álbum y las notas en la de colección. Portada y color
 *  NO se tocan aquí: son los de `albums` y los edita el mismo `/api/covers/album/:id`
 *  que cualquier otro disco, que es justo lo que se gana teniendo fila propia. */
export function updateCollection(db: Db, collectionId: number, userId: number, fields: { name?: string; notes?: string | null }): void {
  if (!getCollectionRow(db, collectionId, userId)) return;
  if (fields.name !== undefined) {
    db.run(sql`UPDATE albums SET name = ${fields.name}, updated_at = datetime('now') WHERE spotify_id = ${collectionKey(collectionId)}`);
  }
  if (fields.notes !== undefined) {
    db.run(sql`UPDATE album_collections SET notes = ${fields.notes} WHERE id = ${collectionId} AND user_id = ${userId}`);
  }
  touch(db, collectionId, userId);
}

export function deleteCollection(db: Db, collectionId: number, userId: number): void {
  const key = collectionKey(collectionId);
  // los miembros no caen por la FK: foreign_keys puede estar OFF y el ON DELETE
  // CASCADE sólo actúa con el pragma activo. Borrarlos a mano es lo que garantiza
  // que sus plays vuelvan a atribuirse a los álbumes de verdad
  db.run(sql`DELETE FROM album_collection_members WHERE collection_id = ${collectionId} AND user_id = ${userId}`);
  db.run(sql`DELETE FROM album_collections WHERE id = ${collectionId} AND user_id = ${userId}`);
  // y todo lo que cuelga de su fila de álbum, en orden: las valoraciones tienen FK a
  // `albums` y con foreign_keys = ON bloquearían el borrado
  db.run(sql`DELETE FROM album_ratings WHERE album_id = ${key}`);
  db.run(sql`DELETE FROM album_covers WHERE album_id = ${key}`);
  db.run(sql`DELETE FROM albums WHERE spotify_id = ${key}`);
}

/** Colección a la que ya pertenece una entidad, si es que pertenece a alguna: el
 *  invariante de "un miembro, una colección" se comprueba antes de insertar para poder
 *  devolver un 409 que nombre el conflicto (el UNIQUE sólo daría un error opaco). */
export function findMemberCollection(db: Db, entityType: CollectionMemberType, entityId: string, userId: number): { id: number; name: string } | undefined {
  const memberId = canonicalMemberId(db, entityType, entityId, userId);
  return db.all(sql`
    SELECT ac.id, al.name FROM album_collection_members acm
    JOIN album_collections ac ON ac.id = acm.collection_id
    JOIN albums al ON al.spotify_id = ${COLLECTION_ID_PREFIX} || ac.id
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
  inheritMemberCover(db, collectionId, entityType, memberId);
  touch(db, collectionId, userId);
}

/** La portada del miembro entra en el pool de la colección (`album_covers`), que es
 *  de donde el ImagePicker saca las opciones, y se hace activa si todavía no había
 *  ninguna. Así una colección recién hecha ya se ve en las listas de ranking, y el
 *  usuario elige entre las portadas de sus discos sin subir nada. */
function inheritMemberCover(db: Db, collectionId: number, entityType: CollectionMemberType, memberId: string): void {
  const key = collectionKey(collectionId);
  const cover = entityType === 'album'
    ? db.all(sql`SELECT image_url FROM albums WHERE spotify_id = ${memberId}`)[0] as { image_url: string | null } | undefined
    : db.all(sql`SELECT al.image_url FROM tracks t JOIN albums al ON al.spotify_id = t.album_id WHERE t.spotify_id = ${memberId}`)[0] as { image_url: string | null } | undefined;
  if (!cover?.image_url) return;
  db.run(sql`INSERT OR IGNORE INTO album_covers (album_id, image_url, source) VALUES (${key}, ${cover.image_url}, 'spotify')`);
  db.run(sql`UPDATE albums SET image_url = ${cover.image_url} WHERE spotify_id = ${key} AND image_url IS NULL`);
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
