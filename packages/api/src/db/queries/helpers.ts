import { sql } from 'drizzle-orm';
import { getDb } from '../connection.js';
import { TIME_RANGES, DEFAULT_TIME_RANGE, isTimeRange } from '../../constants.js';
import type { TimeRange } from '../../constants.js';
import { COLLECTION_ID_PREFIX } from '@sis/shared';
import type { EntityType, RankingMetric, CreditSubjectType } from '@sis/shared';

export type Db = ReturnType<typeof getDb>;
export type SqlChunk = ReturnType<typeof sql>;
export type { EntityType };
export type Sort = RankingMetric | 'natural';

// --- tipos de resultado ---

export interface StatsRow {
  play_count: number;
  total_ms: number;
  first_played: string | null;
  last_played: string | null;
}

export interface AggregateRow {
  entity_id: string;
  play_count: number;
  total_ms: number;
}

export interface SeriesRow {
  period: string;
  play_count: number;
  total_ms: number;
}

export interface RecentPlayRow {
  id: number;
  played_at: string;
  track_id: string;
}

// --- helpers de rango temporal ---

// 'all' es el único rango que mapea al centinela 0 (= sin filtro, devuelve null).
// La sobrecarga deja que los call sites con un rango literal —getRangeStart('month')—
// obtengan `string` en vez de `string | null` y se ahorren un null que no puede darse.
// Ambos helpers indexan TIME_RANGES, así que un `range` no reconocido daría
// `undefined` y, tras la aritmética, un Invalid Date cuyo toISOString() lanza
// RangeError (un 500 por un query param inválido). Se normaliza a la entrada.
export function getRangeStart(range: Exclude<TimeRange, 'all'>): string;
export function getRangeStart(range: TimeRange | string): string | null;
export function getRangeStart(range: TimeRange | string): string | null {
  const days = TIME_RANGES[isTimeRange(range) ? range : DEFAULT_TIME_RANGE];
  if (days === 0) return null;
  if (days === -1) return new Date(Date.UTC(new Date().getFullYear(), 0, 1)).toISOString();
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

export function getPreviousPeriodRange(range: TimeRange | string): { prevStart: string; prevEnd: string } | null {
  const days = TIME_RANGES[isTimeRange(range) ? range : DEFAULT_TIME_RANGE];
  if (days === 0) return null;

  if (days === -1) {
    const now = new Date();
    const year = now.getFullYear();
    return {
      prevStart: new Date(Date.UTC(year - 1, 0, 1)).toISOString(),
      prevEnd: new Date(Date.UTC(year - 1, now.getMonth(), now.getDate())).toISOString(),
    };
  }

  const now = new Date();
  const prevEnd = new Date(now);
  prevEnd.setDate(prevEnd.getDate() - days);
  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevStart.getDate() - days);
  return { prevStart: prevStart.toISOString(), prevEnd: prevEnd.toISOString() };
}

export function getLookbackPreviousPeriodRange(
  range: TimeRange,
  lookbackDays: number,
): { prevStart: string; prevEnd: string } | null {
  const days = TIME_RANGES[range];
  const now = new Date();
  const prevEnd = new Date(now.getTime() - lookbackDays * 86_400_000);

  if (days === 0) {
    return { prevStart: '1970-01-01T00:00:00.000Z', prevEnd: prevEnd.toISOString() };
  }
  if (days === -1) {
    return {
      prevStart: new Date(Date.UTC(now.getFullYear(), 0, 1)).toISOString(),
      prevEnd: prevEnd.toISOString(),
    };
  }

  const prevStart = new Date(prevEnd.getTime() - days * 86_400_000);
  return { prevStart: prevStart.toISOString(), prevEnd: prevEnd.toISOString() };
}

export function getDateTrunc(range: TimeRange): SqlChunk {
  return getDateTruncForDays(TIME_RANGES[range]);
}

// --- merge rules: primitivas genéricas ---

// Alias SQL único por tipo de entidad para el LEFT JOIN a merge_rules
const MERGE_ALIAS: Record<EntityType, string> = {
  album: 'mr_album',
  artist: 'mr_artist',
  track: 'mr_track',
};

// Columna origen que se redirige al target del merge
function sourceCol(type: EntityType): SqlChunk {
  if (type === 'album') return sql`t.album_id`;
  if (type === 'artist') return sql`ta.artist_id`;
  return sql`lh.track_id`;
}

/** Ensambla el nombre de la tabla de origen para lookups directos por spotifyId. */
export function entityTableName(type: EntityType): 'albums' | 'artists' | 'tracks' {
  if (type === 'album') return 'albums';
  if (type === 'artist') return 'artists';
  return 'tracks';
}

/** JOIN chain que resuelve track merges y une a la tabla tracks por track canónico.
 *  Tras esto, `t` apunta al track canónico (target del merge o el original).
 *  Usar en queries que agrupan/filtran por t.album_id para atribución correcta. */
export function trackJoinResolvingMerges(userId: number): SqlChunk {
  return sql`LEFT JOIN merge_rules mr_track ON mr_track.entity_type = 'track' AND mr_track.source_id = lh.track_id AND mr_track.user_id = ${userId}
    JOIN tracks t ON t.spotify_id = COALESCE(mr_track.target_id, lh.track_id)`;
}

/** Pertenencia a colecciones ("álbumes lógicos", ver shared/collections.ts) para el eje
 *  álbum: dos LEFT JOIN, uno por tema suelto y otro por álbum entero. Van DENTRO de
 *  entityMergeJoin('album') a propósito, para que ningún query pueda nombrar
 *  resolvedEntityId('album') sin haberlos unido — la misma doctrina que el userId de los
 *  merges: quien acota es el join, no la expresión.
 *  El miembro álbum se busca por el id YA resuelto de merges: si el usuario mete en la
 *  colección un álbum que absorbió a otro, las escuchas del absorbido también entran.
 *
 *  COSTE MEDIDO (349k plays, top-albums all-time): 377ms sin los joins, 453ms con ellos
 *  —y 453ms también con la tabla vacía, porque lo que se paga es el sondeo por fila, no
 *  los miembros—. Se probaron dos alternativas: un guard constante en el ON no evita el
 *  seek (444ms), y sustituir los joins por `IN (set)` + subquery escalar baja a 415ms
 *  pero obliga a devolverle el `userId` a resolvedEntityId en sus ~15 call sites. Si
 *  alguna vez hay que recuperar esos 40-76ms, ese es el camino medido. */
function collectionMemberJoins(userId: number): SqlChunk {
  return sql`
    LEFT JOIN album_collection_members acm_track ON acm_track.user_id = ${userId}
      AND acm_track.member_type = 'track' AND acm_track.member_id = t.spotify_id
    LEFT JOIN album_collection_members acm_album ON acm_album.user_id = ${userId}
      AND acm_album.member_type = 'album' AND acm_album.member_id = COALESCE(mr_album.target_id, t.album_id)`;
}

/** LEFT JOIN a merge_rules para un tipo de entidad, filtrado por usuario. `userId` es
 *  OBLIGATORIO: un merge es una decisión privada, y la variante sin filtro plegaba las
 *  escuchas de uno sobre el canónico que había elegido otro. No la reintroduzcas.
 *  En álbum arrastra además los joins de pertenencia a colecciones (ver arriba). */
export function entityMergeJoin(type: EntityType, userId: number): SqlChunk {
  const alias = sql.raw(MERGE_ALIAS[type]);
  const src = sourceCol(type);
  const mergeJoin = sql`LEFT JOIN merge_rules ${alias} ON ${alias}.entity_type = ${type} AND ${alias}.source_id = ${src} AND ${alias}.user_id = ${userId}`;
  if (type !== 'album') return mergeJoin;
  return sql`${mergeJoin} ${collectionMemberJoins(userId)}`;
}

/** COALESCE(mr_X.target_id, <source_col>) — expresa el ID canónico tras merges.
 *  OJO: sólo nombra el alias, **no filtra nada**. El `userId` que aceptaba era puro
 *  decorado y hacía creer que la query quedaba acotada: quien acota es el
 *  entityMergeJoin() del mismo query, y sin él esto resuelve merges de cualquiera. */
export function resolvedEntityId(type: EntityType): SqlChunk {
  const alias = sql.raw(MERGE_ALIAS[type]);
  if (type !== 'album') return sql`COALESCE(${alias}.target_id, ${sourceCol(type)})`;
  // orden de precedencia: el tema añadido a mano manda sobre la colección de su álbum
  // (por eso se puede sacar un corte suelto de una era y ponerlo en otra), y las dos
  // sobre el merge. La clave `collection:N` sólo existe aquí y en el cliente: no hay
  // fila de esa colección en `albums`, y el concat con NULL se queda en NULL, que es
  // justo lo que necesita el COALESCE para caer al siguiente nivel.
  return sql`COALESCE(${COLLECTION_ID_PREFIX} || acm_track.collection_id, ${COLLECTION_ID_PREFIX} || acm_album.collection_id, ${alias}.target_id, ${sourceCol(type)})`;
}

// --- créditos corregidos por el usuario (credit_overrides, ver shared/credits.ts) ---

/** ¿Tiene el usuario alguna lista corregida de este tipo? Es lo que decide si las
 *  queries llevan la relación corregida o la tabla a secas: casi nadie corrige nada, y
 *  así su SQL —y su plan— es byte a byte el de siempre. Se consulta en cada query en vez
 *  de cachearse porque cada worker tiene su conexión y la mutación ocurre en el main
 *  thread: una cache en memoria no se enteraría. Es una bajada de PK, microsegundos. */
export function hasCreditOverrides(userId: number, type: CreditSubjectType): boolean {
  return getDb().get(sql`SELECT 1 AS ok FROM credit_overrides WHERE user_id = ${userId} AND subject_type = ${type} LIMIT 1`) !== undefined;
}

/** `track_artists` tal como la ve el usuario: los temas que corrigió llevan SU lista
 *  (con sus posiciones: la 0 es el principal) y el resto la del catálogo. Va en el
 *  lugar de la tabla —`JOIN ${trackArtistsFor(userId)} ta ON …`— y expone sus mismas
 *  tres columnas, así que el resto de la query no cambia.
 *
 *  COSTE MEDIDO (copia de prod, 349k plays, 200 temas corregidos): top artists
 *  all-time 282 → 286ms, stats de artista 55 → 53ms (el `artist_id = X` baja a los dos
 *  brazos del UNION y cada uno usa su índice), join por play 1.15 → 1.03s. Sin
 *  correcciones no hay coste: devuelve el nombre de la tabla.
 *
 *  Sólo para lo que atribuye escuchas o pinta créditos a ESE usuario. Los barridos del
 *  catálogo (dedup, identity, import) siguen sobre la tabla: una corrección privada no
 *  es evidencia sobre qué grabación es qué. `null` = sin usuario (los créditos del
 *  catálogo), para los formateadores que también sirven superficies sin sesión. */
export function trackArtistsFor(userId: number | null): SqlChunk {
  if (userId === null || !hasCreditOverrides(userId, 'track')) return sql`track_artists`;
  return sql`(
    SELECT track_id, artist_id, position FROM track_artists
    WHERE track_id NOT IN (SELECT subject_id FROM credit_overrides WHERE user_id = ${userId} AND subject_type = 'track')
    UNION ALL
    SELECT subject_id, artist_id, position FROM credit_overrides WHERE user_id = ${userId} AND subject_type = 'track'
  )`;
}

/** Pares (track, artista resuelto) sin repetir, con los créditos y merges del usuario,
 *  como subconsulta con columnas `track_id`, `eid`. Expandir agregados POR TRACK a estos
 *  pares equivale al DISTINCT por (artista, play) sobre lh × track_artists —que un play
 *  cuente una sola vez por artista aunque dos créditos de su track resuelvan al mismo
 *  canónico—, porque esa dedup sólo depende del track: se hace sobre ~70k pares en vez de
 *  ~400k filas play × crédito (los escaneos de artista de rankings, historiales y charts
 *  bajan 1.6-5.6×, mismas filas). Agrupa siempre por track ANTES de unir aquí. */
// `tracksIn` (subconsulta de track_ids) restringe los pares a los tracks que sonaron, con
// el filtro DENTRO de cada brazo del UNION de créditos corregidos: sin él la relación se
// expandía entera (los 69k créditos + DISTINCT + índice automático) en cada query, aunque
// el rango tuviese diez temas — top artists de una semana 160-270ms → 4-11ms, mismas
// filas. Pásalo siempre que los plays estén acotados (rango, ventana).
export function trackArtistPairs(userId: number, tracksIn?: SqlChunk): SqlChunk {
  const credits = tracksIn
    ? trackArtistsWhere(userId, col => sql`${col('track_id')} IN (${tracksIn})`)
    : trackArtistsFor(userId);
  return sql`(
      SELECT DISTINCT ta.track_id, ${resolvedEntityId('artist')} as eid
      FROM ${credits} ta
      ${entityMergeJoin('artist', userId)}
    )`;
}

/** Scores por artista resuelto agregando primero por track (ver trackArtistPairs). Cada
 *  columna de `cols` es una expresión POR PLAY sobre `lh`/`t` que se suma; `bucket`
 *  (expresión por play, p. ej. un periodExpr) añade la columna `period` y se agrupa
 *  también por ella. Devuelve un SELECT con [period,] eid y una columna por clave de
 *  `cols`; `where` filtra los plays (además del usuario). Sustituye al DISTINCT por
 *  (artista, play) sobre lh × créditos con el mismo resultado fila a fila. */
export function artistPerTrackScores(userId: number, cols: Record<string, SqlChunk>, opts: { bucket?: SqlChunk; where?: SqlChunk; restrictPairs?: boolean } = {}): SqlChunk {
  const names = Object.keys(cols);
  const perTrack = sql.join(names.map(n => sql`sum(${cols[n]}) as ${sql.raw(n)}`), sql`, `);
  const perArtist = sql.join(names.map(n => sql`sum(pt.${sql.raw(n)}) as ${sql.raw(n)}`), sql`, `);
  const { bucket } = opts;
  return sql`
    SELECT ${bucket ? sql`pt.period, ` : sql``}am.eid, ${perArtist}
    FROM (
      SELECT ${bucket ? sql`${bucket} as period, ` : sql``}lh.track_id, ${perTrack}
      FROM listening_history lh
      JOIN tracks t ON t.spotify_id = lh.track_id
      WHERE lh.user_id = ${userId} ${opts.where ?? sql``}
      GROUP BY ${bucket ? sql`1, 2` : sql`1`}
    ) pt
    JOIN ${trackArtistPairs(userId, opts.restrictPairs
      // ventana acotada: los pares se limitan a sus tracks (la misma ventana, por índice)
      ? sql`SELECT lh.track_id FROM listening_history lh WHERE lh.user_id = ${userId} ${opts.where ?? sql``}`
      : undefined)} am ON am.track_id = pt.track_id
    GROUP BY ${bucket ? sql`pt.period, am.eid` : sql`am.eid`}`;
}

type CreditCol = 'track_id' | 'artist_id' | 'position';

/** trackArtistsFor con el filtro metido DENTRO de cada brazo del UNION: la forma para
 *  las subconsultas correladas (`EXISTS (… WHERE ta.track_id = lh.track_id)`), donde el
 *  planner no baja al UNION un término que nombra la fila de fuera y, sin esto, cada
 *  fila rematerializa la tabla entera. `where` recibe un accesor de columna porque los
 *  dos brazos no se llaman igual (`subject_id` es el `track_id` de la corrección). Sin
 *  correcciones es una subconsulta simple sobre la tabla, que SQLite aplana. */
export function trackArtistsWhere(userId: number | null, where: (col: (c: CreditCol) => SqlChunk) => SqlChunk): SqlChunk {
  const catalog = sql`SELECT ta_w.track_id, ta_w.artist_id, ta_w.position FROM track_artists ta_w
    WHERE ${where(c => sql.raw(`ta_w.${c}`))}`;
  if (userId === null || !hasCreditOverrides(userId, 'track')) return sql`(${catalog})`;
  return sql`(${catalog}
      AND ta_w.track_id NOT IN (SELECT subject_id FROM credit_overrides WHERE user_id = ${userId} AND subject_type = 'track')
    UNION ALL
    SELECT co_w.subject_id, co_w.artist_id, co_w.position FROM credit_overrides co_w
    WHERE co_w.user_id = ${userId} AND co_w.subject_type = 'track'
      AND ${where(c => sql.raw(c === 'track_id' ? 'co_w.subject_id' : `co_w.${c}`))})`;
}

/** Artista principal (posición 0) de UN tema tal como lo ve el usuario, para las
 *  búsquedas correladas por fila ("el artista de esta fila"). NO pasa por
 *  trackArtistsFor a propósito: dentro de una subconsulta correlada el UNION ALL no
 *  recibe el `track_id = <fila>` (sólo baja a sus brazos lo que es constante) y se
 *  rematerializa entero en cada fila —el resumen de perfil pasó de 0.6s a 277s—. Aquí
 *  son dos bajadas de PK: la lista corregida si la hay, si no la del catálogo. */
export function primaryArtistOf(trackExpr: SqlChunk, userId: number | null): SqlChunk {
  const catalog = sql`(SELECT MIN(ta_pa.artist_id) FROM track_artists ta_pa WHERE ta_pa.track_id = ${trackExpr} AND ta_pa.position = 0)`;
  if (userId === null || !hasCreditOverrides(userId, 'track')) return catalog;
  return sql`COALESCE(
    (SELECT co_pa.artist_id FROM credit_overrides co_pa WHERE co_pa.user_id = ${userId} AND co_pa.subject_type = 'track'
     AND co_pa.subject_id = ${trackExpr} AND co_pa.position = 0),
    ${catalog})`;
}

/** Nombre del artista `idExpr` (el complemento de primaryArtistOf en las filas). */
export function artistNameOf(idExpr: SqlChunk): SqlChunk {
  return sql`(SELECT a_nm.name FROM artists a_nm WHERE a_nm.spotify_id = ${idExpr})`;
}

// álbumes con créditos corregidos por el usuario: su lista manda sobre `artist_ids` y
// sobre la heurística de mayoría (ver artistCreditedAlbums)
function albumOverrideIds(userId: number): SqlChunk {
  return sql`(SELECT subject_id FROM credit_overrides WHERE user_id = ${userId} AND subject_type = 'album')`;
}

// --- helpers de SQL dinámico según tipo de entidad ---

export function playDuration(): SqlChunk {
  // tiempo escuchado por play, capado a la duración real del track: ms_played nunca
  // debería superar la longitud del track, así que plays "over-long" (bucles o errores
  // de import) no inflan el total. Si el track no tiene duración válida (<=0), no capar.
  return sql`CASE WHEN t.duration_ms > 0
    THEN MIN(COALESCE(lh.duration_played_ms, t.duration_ms), t.duration_ms)
    ELSE lh.duration_played_ms END`;
}

export function orderByCol(sort: Sort): SqlChunk {
  return sort === 'plays' ? sql`play_count` : sql`total_ms`;
}

/** JOIN chain completo desde listening_history hasta la entidad resuelta, con todos los niveles de merge.
 *  Album:  lh → track merge → canonical track t → album merge (mr_album)
 *  Track:  lh → tracks t → track merge (mr_track)
 *  Artist: lh → tracks t → track_artists ta → artist merge (mr_artist)
 *  Tras esto: `t` siempre es el track correcto, y resolvedEntityId/entityGroupCol funcionan para agrupar. */
export function resolvedPlayJoins(entityType: EntityType, userId: number): SqlChunk {
  if (entityType === 'album') {
    return sql`${trackJoinResolvingMerges(userId)} ${entityMergeJoin('album', userId)}`;
  }
  if (entityType === 'artist') {
    return sql`JOIN tracks t ON t.spotify_id = lh.track_id
      JOIN ${trackArtistsFor(userId)} ta ON ta.track_id = lh.track_id
      ${entityMergeJoin('artist', userId)}`;
  }
  return sql`JOIN tracks t ON t.spotify_id = lh.track_id
    ${entityMergeJoin('track', userId)}`;
}

/** Artista de una fila del eje álbum: el principal de su lista corregida si el usuario
 *  la corrigió, si no el de posición 0 de sus temas y, si no lo hay, el dueño de la
 *  colección. Un álbum lógico (`collection:N`) SÍ tiene fila en `albums` —de ahí le
 *  vienen nombre, portada y color— pero no tiene temas propios, así que la subconsulta
 *  de siempre devolvía NULL y la fila salía sin artista. */
export function albumArtistId(eidExpr: SqlChunk, userId: number): SqlChunk {
  const override = hasCreditOverrides(userId, 'album')
    ? sql`(SELECT co.artist_id FROM credit_overrides co WHERE co.user_id = ${userId} AND co.subject_type = 'album'
       AND co.subject_id = ${eidExpr} ORDER BY co.position LIMIT 1),`
    : sql``;
  // primer tema del álbum que tenga principal (el JOIN de siempre se saltaba los que no)
  return sql`COALESCE(${override}
    (SELECT pa FROM (SELECT ${primaryArtistOf(sql`t2.spotify_id`, userId)} AS pa FROM tracks t2 WHERE t2.album_id = ${eidExpr})
     WHERE pa IS NOT NULL LIMIT 1),
    (SELECT ac.artist_id FROM album_collections ac WHERE ${COLLECTION_ID_PREFIX} || ac.id = ${eidExpr}))`;
}

export function albumArtistName(eidExpr: SqlChunk, userId: number): SqlChunk {
  return artistNameOf(albumArtistId(eidExpr, userId));
}

/** AND t.album_id IS NOT NULL — necesario para queries de álbumes, vacío para otros tipos.
 *  El OR deja pasar al tema suelto que es miembro de una colección: su play cuenta para
 *  ella aunque el track no tenga álbum, que es el caso de los sintéticos sin shell. */
export function albumNullFilter(entityType: EntityType): SqlChunk {
  return entityType === 'album' ? sql`AND (t.album_id IS NOT NULL OR acm_track.collection_id IS NOT NULL)` : sql``;
}

export function entityGroupCol(entityType: EntityType): SqlChunk {
  return resolvedEntityId(entityType);
}

export function entityWhereCol(entityType: EntityType, id: string, ids?: string[]): SqlChunk {
  if (entityType === 'artist') return sql`ta.artist_id = ${id}`;
  if (entityType === 'track') {
    if (ids && ids.length > 1) {
      const placeholders = sql.join(ids.map(tid => sql`${tid}`), sql`, `);
      return sql`lh.track_id IN (${placeholders})`;
    }
    return sql`lh.track_id = ${id}`;
  }
  // album
  if (ids && ids.length > 1) {
    const placeholders = sql.join(ids.map(aid => sql`${aid}`), sql`, `);
    return sql`t.album_id IN (${placeholders})`;
  }
  return sql`t.album_id = ${id}`;
}

// comparador = ó IN según cardinalidad, para listas de ids
function idCmp(ids: string[]): SqlChunk {
  if (ids.length === 1) return sql`= ${ids[0]}`;
  return sql`IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})`;
}

/** Filtro por track_id usando la tabla track_artists — una fila por play,
 *  evita duplicados cuando varias artist_ids de la misma track acaban en el mismo target.
 *  Filtra sobre lh.track_id (no t.spotify_id) para que el planner ataque listening_history
 *  por idx_lh_user_track en vez de escanearla; con el JOIN t.spotify_id = lh.track_id de los
 *  call sites ambas formas son equivalentes. */
export function tracksWithArtistIn(ids: string[], userId: number): SqlChunk {
  return sql`lh.track_id IN (SELECT DISTINCT ta_sub.track_id FROM ${trackArtistsFor(userId)} ta_sub WHERE ta_sub.artist_id ${idCmp(ids)})`;
}

/** Predicado driving sobre lh.track_id para queries de álbum que resuelven track merges:
 *  tracks del álbum + sources de merges cuyo target es un track del álbum. Es un SUPERSET
 *  del set cualificado (los JOINs de resolución siguen filtrando exacto) — su único papel
 *  es dar al planner un camino por idx_lh_user_track en vez del scan completo que provoca
 *  el JOIN por COALESCE de trackJoinResolvingMerges. */
export function albumPlaysPredicate(albumIds: string[], userId: number): SqlChunk {
  return sql`AND lh.track_id IN (
    SELECT spotify_id FROM tracks WHERE album_id ${idCmp(albumIds)}
    UNION
    SELECT mr_p.source_id FROM merge_rules mr_p JOIN tracks t_p ON t_p.spotify_id = mr_p.target_id
    WHERE mr_p.entity_type = 'track' AND mr_p.user_id = ${userId} AND t_p.album_id ${idCmp(albumIds)}
  )`;
}

/** Ídem para artista, en queries que resuelven track merges (el filtro por track_artists
 *  a secas no basta como superset: un source mergeado hacia un track del artista cuenta). */
export function artistPlaysPredicate(artistIds: string[], userId: number): SqlChunk {
  const credits = trackArtistsFor(userId);
  return sql`AND lh.track_id IN (
    SELECT ta_d.track_id FROM ${credits} ta_d WHERE ta_d.artist_id ${idCmp(artistIds)}
    UNION
    SELECT mr_p.source_id FROM merge_rules mr_p JOIN ${credits} ta_p ON ta_p.track_id = mr_p.target_id
    WHERE mr_p.entity_type = 'track' AND mr_p.user_id = ${userId} AND ta_p.artist_id ${idCmp(artistIds)}
  )`;
}

// filtro de usuario para listening_history
export function userFilter(userId: number): SqlChunk {
  return sql`AND lh.user_id = ${userId}`;
}

export function userWhereClause(userId: number): SqlChunk {
  return sql`WHERE lh.user_id = ${userId}`;
}

export function periodExpr(granularity: 'week' | 'month' | 'year', weekStart: 'monday' | 'sunday' | 'friday' | 'thursday' = 'monday'): SqlChunk {
  if (granularity === 'week') {
    if (weekStart === 'monday') return sql`strftime('%Y-W%W', lh.played_at)`;
    if (weekStart === 'sunday') return sql`strftime('%Y-W%W', lh.played_at, '-1 day')`;
    return sql`strftime('%Y-W%W', lh.played_at, '-4 days')`;
  }
  if (granularity === 'month') return sql`strftime('%Y-%m', lh.played_at)`;
  return sql`strftime('%Y', lh.played_at)`;
}

export function getDateTruncForDays(days: number): SqlChunk {
  if (days > 0 && days <= 30) return sql`date(lh.played_at)`;
  if (days > 0 && days <= 180) return sql`strftime('%Y-W%W', lh.played_at)`;
  return sql`strftime('%Y-%m', lh.played_at)`;
}

export function getPreviousPeriodRangeCustom(startDate: string, endDate: string): { prevStart: string; prevEnd: string } {
  const start = new Date(startDate).getTime();
  const end = new Date(endDate).getTime();
  const span = end - start;
  const prevEnd = new Date(start);
  const prevStart = new Date(start - span);
  return { prevStart: prevStart.toISOString(), prevEnd: prevEnd.toISOString() };
}

export function rangeWhere(rangeStart: string | null, rangeEnd?: string | null): SqlChunk {
  if (!rangeStart) return sql``;
  if (rangeEnd) return sql`AND lh.played_at >= ${rangeStart} AND lh.played_at <= ${rangeEnd}`;
  return sql`AND lh.played_at >= ${rangeStart}`;
}

export function rangeWhereClause(rangeStart: string | null, rangeEnd?: string | null): SqlChunk {
  if (!rangeStart) return sql``;
  if (rangeEnd) return sql`WHERE lh.played_at >= ${rangeStart} AND lh.played_at <= ${rangeEnd}`;
  return sql`WHERE lh.played_at >= ${rangeStart}`;
}

/** Construir IN (...) o = para lista de IDs de álbum */
export function albumIdIn(ids: string[], tableAlias = 't'): SqlChunk {
  const col = sql.raw(`${tableAlias}.album_id`);
  if (ids.length === 1) return sql`${col} = ${ids[0]}`;
  const placeholders = sql.join(ids.map(id => sql`${id}`), sql`, `);
  return sql`${col} IN (${placeholders})`;
}

/** Álbumes que son DEL artista: sólo los que se le atribuyen DIRECTAMENTE, por dos vías:
 *
 *  1. **Crédito a nivel de álbum** (`albums.artist_ids`, en cualquier posición): un disco a
 *     dos nombres es de los dos, así que OASIS sale en la página de Bad Bunny y Watch The
 *     Throne en la de Kanye. El crédito a nivel de track NO vale por sí solo: bastaba un tema
 *     suyo para que se colara la recopilación entera (8 Mile, SHADYXV, ED REC Vol.X, Black
 *     Panther, y Curtain Call en la de JAŸ-Z porque lidera un bonus track).
 *  2. **Álbum SIN crédito de álbum + mayoría de lo ingestado.** `artist_ids` tiene tres estados:
 *     un array real, `NULL` (sin enriquecer) y `'[]'` (los sintéticos local:/import:, acuñados
 *     sin créditos); `json_extract(...,'$[0]') IS NULL` cubre los dos últimos de una vez —escrito
 *     como `artist_ids IS NULL` se dejaba fuera justo los mixtapes del usuario—. En prod son
 *     casi sólo sintéticos (bootlegs, leaks, archivos locales), que se acuñan por (artista
 *     principal, álbum): el artista de posición 0 de sus temas ES su atribución. Se exige
 *     mayoría: un invitado liderando un corte es normal en un disco propio (Detroit 2, Big
 *     Sean en 20 de 21), pero en una banda sonora nadie pasa de la mitad (8 Mile, 3 de 13).
 *
 *  Hubo una tercera vía —créditos conocidos que NO lo nombran pero lidera la mayoría de los
 *  temas publicados— y se quitó el 2026-10-14 a petición de Juan: contradecía el crédito de
 *  spotify y, con los merges de artista ya resueltos, casi todo lo que aportaba era basura
 *  (recopilatorios de "Various Artists", Writer's Block de Royce en la página de Eminem). Sus
 *  aciertos legítimos (una entidad duplicada como N.W.A. / N.W.A, una OST acreditada al
 *  estudio) se arreglan con un merge de artista o corrigiendo los créditos del álbum, no
 *  con una heurística. No la vuelvas a meter.
 *
 *  La vía (2) ancla primero en el artista (subquery por `idx_ta_artist_position`) y agrupa
 *  después: agrupar de entrada todos los álbumes candidatos son ~11k por página de artista
 *  y cuesta 80ms en vez de 22ms, trabajo que ni depende del artista.
 *
 *  Por encima de las dos, los **créditos corregidos del usuario**: un álbum cuya lista
 *  corrigió sale de las dos vías y entra sólo por la suya. Es lo que permite QUITAR un
 *  disco de un artista, o PONERLO en uno que spotify no acredita. */
export function artistCreditedAlbums(artistIds: string[], userId: number): SqlChunk {
  const cmp = idCmp(artistIds);
  const credits = trackArtistsFor(userId);
  const overridden = hasCreditOverrides(userId, 'album');
  // conjunto motor de (2): álbumes sin crédito de álbum donde el artista lidera algún tema.
  // el filtro de crédito va aquí y no fuera: todos los temas de un álbum comparten su
  // estado, así que basta con podar la semilla (pequeña, anclada en el artista)
  const ledAlbums = sql`
    SELECT t_s.album_id FROM ${credits} ta_s
    JOIN tracks t_s ON t_s.spotify_id = ta_s.track_id
    JOIN albums a_s ON a_s.spotify_id = t_s.album_id
    WHERE ta_s.artist_id ${cmp} AND ta_s.position = 0 AND json_extract(a_s.artist_ids, '$[0]') IS NULL`;
  const notOverridden = (col: SqlChunk) => overridden ? sql`AND ${col} NOT IN ${albumOverrideIds(userId)}` : sql``;
  const overrideArm = overridden
    ? sql`UNION
    SELECT co_cr.subject_id FROM credit_overrides co_cr
    WHERE co_cr.user_id = ${userId} AND co_cr.subject_type = 'album' AND co_cr.artist_id ${cmp}`
    : sql``;
  return sql`(
    SELECT a_cr.spotify_id FROM albums a_cr, json_each(a_cr.artist_ids) je_cr
    WHERE je_cr.value ${cmp} ${notOverridden(sql`a_cr.spotify_id`)}
    UNION
    SELECT t_cr.album_id FROM tracks t_cr
    JOIN ${credits} ta_cr ON ta_cr.track_id = t_cr.spotify_id AND ta_cr.position = 0
    WHERE t_cr.album_id IN (${ledAlbums}) ${notOverridden(sql`t_cr.album_id`)}
    GROUP BY t_cr.album_id
    HAVING SUM(CASE WHEN ta_cr.artist_id ${cmp} THEN 1 ELSE 0 END) * 2 > COUNT(*)
    ${overrideArm}
  )`;
}
