// Queries que antes estaban inline en stats.ts, extraídas para el worker pool
import { sql } from 'drizzle-orm';
import type { Db, EntityType, SqlChunk } from './helpers.js';
import { rangeWhere, userFilter, trackArtistsFor, trackArtistsWhere, trackArtistPairs, albumArtistId, albumArtistName, artistNameOf, hasCreditOverrides, primaryArtistOf } from './helpers.js';
import type { CreditSubjectType } from '@sis/shared';

export function getTopGenres(db: Db, rangeStart: string | null, rangeEnd: string | null, limit: number, userId: number) {
  const rw = rangeWhere(rangeStart, rangeEnd);
  const uf = userFilter(userId);

  // plays por track primero (GROUP BY +lh.track_id: el + deja al planner ir por
  // (user_id, played_at) en rangos cortos) y los créditos restringidos a esos tracks; la
  // multiplicidad por crédito y por género es la de siempre (mismas cifras, ~4-25× menos)
  return db.all(sql`
    WITH pt AS MATERIALIZED (
      SELECT lh.track_id, count(*) as plays
      FROM listening_history lh
      WHERE 1=1 ${uf} ${rw}
      GROUP BY +lh.track_id
    )
    SELECT genre.value as genre, sum(pt.plays) as play_count
    FROM pt
    JOIN ${trackArtistsWhere(userId, col => sql`${col('track_id')} IN (SELECT track_id FROM pt)`)} ta ON ta.track_id = pt.track_id
    LEFT JOIN merge_rules mr_artist ON mr_artist.entity_type = 'artist' AND mr_artist.source_id = ta.artist_id AND mr_artist.user_id = ${userId}
    JOIN artists a ON a.spotify_id = COALESCE(mr_artist.target_id, ta.artist_id)
    JOIN json_each(a.genres) genre
    GROUP BY genre.value
    ORDER BY play_count DESC
    LIMIT ${limit}
  `) as { genre: string; play_count: number }[];
}

export function getHeatmap(db: Db, rangeStart: string | null, rangeEnd: string | null, userId: number) {
  const rw = rangeWhere(rangeStart, rangeEnd);
  const uf = userFilter(userId);

  return db.all(sql`
    SELECT
      cast(strftime('%w', lh.played_at) as integer) as day_of_week,
      cast(strftime('%H', lh.played_at) as integer) as hour,
      count(*) as play_count
    FROM listening_history lh
    WHERE 1=1 ${uf} ${rw}
    GROUP BY day_of_week, hour
  `) as { day_of_week: number; hour: number; play_count: number }[];
}

export function getMonthlyDistribution(db: Db, rangeStart: string | null, rangeEnd: string | null, userId: number) {
  const rw = rangeWhere(rangeStart, rangeEnd);
  const uf = userFilter(userId);

  return db.all(sql`
    SELECT
      cast(strftime('%m', lh.played_at) as integer) as month,
      count(*) as play_count
    FROM listening_history lh
    WHERE 1=1 ${uf} ${rw}
    GROUP BY month
    ORDER BY month
  `) as { month: number; play_count: number }[];
}

export function getStreakDays(db: Db, userId: number) {
  return db.all(sql`
    SELECT DISTINCT date(played_at) as day
    FROM listening_history
    WHERE user_id = ${userId}
    ORDER BY day ASC
  `) as { day: string }[];
}

function toFtsQuery(term: string): string {
  const words = term.replace(/[""]/g, '').split(/\s+/).filter(Boolean);
  if (words.length === 0) return '""';
  return words.map(w => `"${w}"*`).join(' ');
}

export function searchEntities(db: Db, term: string, limit: number, userId: number) {
  const ftsQuery = toFtsQuery(term);
  const likeTerm = `%${term}%`;
  // el término llega en minúsculas y sin acentos, así que en un nombre todo ascii unaccent()
  // no cambia nada que el LIKE nativo no ignore ya: sólo los demás (un 6%) cruzan a js, y
  // en temas el recorrido baja de 22ms a 9ms. Más bytes que caracteres = no es ascii; un
  // GLOB con clase de caracteres dice lo mismo, pero cuesta casi el doble
  const nameLike = (col: SqlChunk) => sql`(${col} LIKE ${likeTerm} OR (length(${col}) <> length(CAST(${col} AS BLOB)) AND unaccent(${col}) LIKE ${likeTerm}))`;
  // el índice FTS es global y del catálogo: lo que el usuario añadió a una lista no está
  // en él, y buscar por ese artista tiene que encontrar el tema o el álbum
  const correctedMatch = (type: CreditSubjectType, col: SqlChunk) => hasCreditOverrides(userId, type)
    ? sql`OR ${col} IN (SELECT co.subject_id FROM credit_overrides co JOIN artists a_co ON a_co.spotify_id = co.artist_id
        WHERE co.user_id = ${userId} AND co.subject_type = ${type} AND unaccent(a_co.name) LIKE ${likeTerm})`
    : sql``;

  // primero qué casa y sólo después sus cifras, por entidad y por índice. Antes cada tipo
  // agregaba dos veces el historial entero y filtraba al final: ~1.6s por búsqueda en una
  // cuenta de 350k plays, para quedarse con cinco filas de cada tipo. Los aciertos del FTS
  // se miran con IN y no con un LEFT JOIN: el join los recorría por cada fila de la tabla
  // y sacaba repetido un tema con dos artistas en posición 0 (tiene dos entradas en el índice)
  const ftsHits = (type: EntityType) => sql`hits AS MATERIALIZED (SELECT entity_id FROM search_index WHERE search_index MATCH ${ftsQuery} AND entity_type = ${type})`;
  const mergeSources = (type: EntityType) => sql`SELECT source_id FROM merge_rules WHERE entity_type = ${type} AND user_id = ${userId}`;
  // de quién son las escuchas que enseña la fila: ella y las fuentes de sus merges
  const mergeGroup = (type: EntityType, id: SqlChunk) => sql`SELECT ${id} UNION ALL SELECT mr.source_id FROM merge_rules mr WHERE mr.user_id = ${userId} AND mr.entity_type = ${type} AND mr.target_id = ${id}`;

  const artistRows = db.all(sql`
    WITH ${ftsHits('artist')}
    SELECT a.spotify_id as id, a.name, a.image_url as imageUrl,
           (SELECT COUNT(*)
            FROM ${trackArtistsWhere(userId, col => sql`${col('artist_id')} IN (${mergeGroup('artist', sql`a.spotify_id`)})`)} ta
            CROSS JOIN listening_history lh ON lh.user_id = ${userId} AND lh.track_id = ta.track_id) as playCount
    FROM artists a
    WHERE a.spotify_id NOT IN (${mergeSources('artist')})
      AND (a.spotify_id IN hits OR ${nameLike(sql`a.name`)})
    ORDER BY (a.spotify_id IN hits) DESC, playCount DESC
    LIMIT ${limit}
  `) as any[];

  const albumRows = db.all(sql`
    WITH ${ftsHits('album')}
    SELECT al.spotify_id as id, al.name, al.image_url as imageUrl,
           ${albumArtistId(sql`al.spotify_id`, userId)} as artistId,
           ${albumArtistName(sql`al.spotify_id`, userId)} as artistName,
           (SELECT COUNT(*)
            FROM tracks t
            CROSS JOIN listening_history lh ON lh.user_id = ${userId} AND lh.track_id = t.spotify_id
            WHERE t.album_id IN (${mergeGroup('album', sql`al.spotify_id`)})) as playCount
    FROM albums al
    WHERE al.spotify_id NOT IN (${mergeSources('album')})
      AND (al.spotify_id IN hits OR ${nameLike(sql`al.name`)} ${correctedMatch('album', sql`al.spotify_id`)})
    ORDER BY (al.spotify_id IN hits) DESC, playCount DESC
    LIMIT ${limit}
  `) as any[];

  // los temas que lidera un artista que casa, anclados en él: el principal de cada tema
  // del catálogo entero costaba 80ms por búsqueda sólo para poder mirar su nombre
  const ledByMatch = sql`SELECT ta.track_id FROM ${trackArtistsWhere(userId, col => sql`${col('position')} = 0 AND ${col('artist_id')} IN (SELECT spotify_id FROM artists WHERE ${nameLike(sql`name`)})`)} ta`;
  const primaryArtist = primaryArtistOf(sql`t.spotify_id`, userId);
  const trackRows = db.all(sql`
    WITH ${ftsHits('track')}
    SELECT t.spotify_id as id, t.name,
           al.image_url as albumImageUrl,
           ${primaryArtist} as artistId,
           ${artistNameOf(primaryArtist)} as artistName,
           (SELECT COUNT(*) FROM listening_history lh
            WHERE lh.user_id = ${userId} AND lh.track_id IN (${mergeGroup('track', sql`t.spotify_id`)})) as playCount
    FROM tracks t
    LEFT JOIN albums al ON al.spotify_id = t.album_id
    WHERE t.spotify_id NOT IN (${mergeSources('track')})
      AND (t.spotify_id IN hits OR t.spotify_id IN (${ledByMatch}) ${correctedMatch('track', sql`t.spotify_id`)} OR ${nameLike(sql`t.name`)})
    ORDER BY (t.spotify_id IN hits) DESC, playCount DESC
    LIMIT ${limit}
  `) as any[];

  const libraryRows = db.all(sql`
    SELECT sp.id, sp.name, sp.image_url as imageUrl,
           COALESCE(sp.owner_name, 'Playlist') as subtitle,
           sp.track_count as trackCount,
           sp.spotify_id as spotifyId,
           'library' as source
    FROM spotify_playlists sp
    LEFT JOIN (SELECT entity_id FROM search_index WHERE search_index MATCH ${ftsQuery} AND entity_type = 'playlist_library') si
      ON CAST(sp.id AS TEXT) = si.entity_id
    WHERE sp.user_id = ${userId}
      AND (si.entity_id IS NOT NULL OR ${nameLike(sql`sp.name`)})
    ORDER BY sp.track_count DESC
    LIMIT ${limit}
  `) as any[];

  const generatedRows = db.all(sql`
    SELECT gp.id, gp.name, NULL as imageUrl,
           REPLACE(gp.strategy, '_', ' ') as subtitle,
           gp.track_count as trackCount,
           gp.spotify_playlist_id as spotifyId,
           'generated' as source
    FROM generated_playlists gp
    LEFT JOIN (SELECT entity_id FROM search_index WHERE search_index MATCH ${ftsQuery} AND entity_type = 'playlist_generated') si
      ON CAST(gp.id AS TEXT) = si.entity_id
    WHERE gp.user_id = ${userId}
      AND (si.entity_id IS NOT NULL OR ${nameLike(sql`gp.name`)})
    ORDER BY gp.track_count DESC
    LIMIT ${limit}
  `) as any[];

  const playlistRows = [...libraryRows, ...generatedRows]
    .sort((a, b) => b.trackCount - a.trackCount)
    .slice(0, limit);

  return { artists: artistRows, albums: albumRows, tracks: trackRows, playlists: playlistRows };
}

export function getDiscoverySeries(db: Db, entityType: string, granularity: string, rangeStart: string | null, rangeEnd: string | null, userId: number) {
  const uf = userFilter(userId);
  const rw = rangeWhere(rangeStart, rangeEnd);
  const dateTrunc = granularity === 'month'
    ? sql`strftime('%Y-%m', lh.played_at)`
    : granularity === 'week'
    ? sql`strftime('%Y-W%W', lh.played_at)`
    : sql`date(lh.played_at)`;

  let rows: { period: string; distinct_count: number }[];

  if (entityType === 'album') {
    rows = db.all(sql`
      SELECT ${dateTrunc} as period, COUNT(DISTINCT COALESCE(mr_album.target_id, t.album_id)) as distinct_count
      FROM listening_history lh
      JOIN tracks t ON t.spotify_id = lh.track_id
      LEFT JOIN merge_rules mr_album ON mr_album.entity_type = 'album' AND mr_album.source_id = t.album_id AND mr_album.user_id = ${userId}
      WHERE t.album_id IS NOT NULL ${uf} ${rw}
      GROUP BY period ORDER BY period
    `) as typeof rows;
  } else if (entityType === 'artist') {
    // (periodo, track) y los pares (track, artista resuelto) de esos mismos tracks, y el
    // cruce en JS: la relación de créditos corregidos ya no se expande entera, y dos
    // subconsultas materializadas sin índice se cruzaban en SQL por producto (7.6s en un
    // año). Mismas cuentas: artistas distintos por periodo, sin periodos sin créditos
    const periodTracks = db.all(sql`
      SELECT DISTINCT ${dateTrunc} as period, lh.track_id
      FROM listening_history lh
      WHERE 1=1 ${uf} ${rw}
    `) as { period: string; track_id: string }[];
    const pairs = db.all(sql`
      SELECT am.track_id, am.eid
      FROM ${trackArtistPairs(userId, sql`SELECT lh.track_id FROM listening_history lh WHERE 1=1 ${uf} ${rw}`)} am
    `) as { track_id: string; eid: string }[];

    const artistsOf = new Map<string, string[]>();
    for (const { track_id, eid } of pairs) {
      const list = artistsOf.get(track_id);
      if (list) list.push(eid);
      else artistsOf.set(track_id, [eid]);
    }
    const byPeriod = new Map<string, Set<string>>();
    for (const { period, track_id } of periodTracks) {
      const eids = artistsOf.get(track_id);
      if (!eids) continue;
      const seen = byPeriod.get(period) ?? new Set<string>();
      for (const eid of eids) seen.add(eid);
      byPeriod.set(period, seen);
    }
    rows = [...byPeriod]
      .map(([period, seen]) => ({ period, distinct_count: seen.size }))
      .sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0));
  } else {
    rows = db.all(sql`
      SELECT ${dateTrunc} as period, COUNT(DISTINCT COALESCE(mr_track.target_id, lh.track_id)) as distinct_count
      FROM listening_history lh
      LEFT JOIN merge_rules mr_track ON mr_track.entity_type = 'track' AND mr_track.source_id = lh.track_id AND mr_track.user_id = ${userId}
      WHERE 1=1 ${uf} ${rw}
      GROUP BY period ORDER BY period
    `) as typeof rows;
  }

  let cumulative = 0;
  return rows.map(r => ({ period: r.period, distinct_count: r.distinct_count, cumulative: (cumulative += r.distinct_count) }));
}

// lookups ligeros para entidades (reemplazan drizzle select en routes)
export function lookupArtistById(db: Db, id: string) {
  return db.all(sql`
    SELECT spotify_id, name, image_url, background_url, genres FROM artists WHERE spotify_id = ${id}
  `)[0] as { spotify_id: string; name: string; image_url: string | null; background_url: string | null; genres: any } | undefined;
}

export function lookupAlbumById(db: Db, id: string) {
  return db.all(sql`
    SELECT spotify_id, name, image_url, release_date, total_tracks, album_type, color FROM albums WHERE spotify_id = ${id}
  `)[0] as { spotify_id: string; name: string; image_url: string | null; release_date: string | null; total_tracks: number | null; album_type: string | null; color: string | null } | undefined;
}

export function lookupTrackById(db: Db, id: string) {
  return db.all(sql`
    SELECT spotify_id, name, duration_ms, track_number, explicit, album_id FROM tracks WHERE spotify_id = ${id}
  `)[0] as { spotify_id: string; name: string; duration_ms: number; track_number: number | null; explicit: boolean | null; album_id: string | null } | undefined;
}

export function getTrackArtists(db: Db, trackId: string, userId: number) {
  return db.all(sql`
    SELECT a.spotify_id, a.name, a.image_url
    FROM ${trackArtistsFor(userId)} ta
    JOIN artists a ON a.spotify_id = ta.artist_id
    WHERE ta.track_id = ${trackId}
    ORDER BY ta.position ASC
  `) as { spotify_id: string; name: string; image_url: string | null }[];
}

// --- album covers ---

export function getAlbumCovers(db: Db, albumId: string) {
  return db.all(sql`
    SELECT id, album_id, image_url, source, observed_at
    FROM album_covers
    WHERE album_id = ${albumId}
    ORDER BY observed_at DESC
  `) as { id: number; album_id: string; image_url: string; source: string; observed_at: string }[];
}

export function setAlbumCover(db: Db, albumId: string, imageUrl: string) {
  db.run(sql`UPDATE albums SET image_url = ${imageUrl}, updated_at = datetime('now') WHERE spotify_id = ${albumId}`);
}

export function insertAlbumCover(db: Db, albumId: string, imageUrl: string, source: string) {
  db.run(sql`INSERT OR IGNORE INTO album_covers (album_id, image_url, source) VALUES (${albumId}, ${imageUrl}, ${source})`);
}

// --- artist images ---

export function getArtistImages(db: Db, artistId: string) {
  return db.all(sql`
    SELECT id, artist_id, image_url, source, observed_at
    FROM artist_images
    WHERE artist_id = ${artistId}
    ORDER BY observed_at DESC
  `) as { id: number; artist_id: string; image_url: string; source: string; observed_at: string }[];
}

export function rebuildPlaylistSearchIndex(db: Db, userId: number) {
  db.run(sql`DELETE FROM search_index WHERE entity_type = 'playlist_library' AND entity_id IN (
    SELECT CAST(id AS TEXT) FROM spotify_playlists WHERE user_id = ${userId}
  )`);
  db.run(sql`DELETE FROM search_index WHERE entity_type = 'playlist_generated' AND entity_id IN (
    SELECT CAST(id AS TEXT) FROM generated_playlists WHERE user_id = ${userId}
  )`);
  db.run(sql`INSERT INTO search_index (entity_id, entity_type, name, extra_text)
    SELECT CAST(id AS TEXT), 'playlist_library', name, COALESCE(owner_name, '')
    FROM spotify_playlists WHERE user_id = ${userId}`);
  db.run(sql`INSERT INTO search_index (entity_id, entity_type, name, extra_text)
    SELECT CAST(id AS TEXT), 'playlist_generated', name, strategy
    FROM generated_playlists WHERE user_id = ${userId}`);
}
