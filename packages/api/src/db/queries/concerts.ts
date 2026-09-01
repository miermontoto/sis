import { sql } from 'drizzle-orm';
import type { Db } from './helpers.js';

// Conciertos asistidos: lectura sobre el grupo de merge del artista (igual que
// las valoraciones de álbum) y resolución read-only del setlist contra la
// librería. Aquí no se acuña nada: el matching es evidencia, no identidad.

export interface ConcertRow {
  id: number;
  artist_id: string;
  artist_name: string;
  artist_image_url: string | null;
  concert_date: string;
  venue: string | null;
  city: string | null;
  country: string | null;
  tour: string | null;
  notes: string | null;
  setlistfm_id: string | null;
  setlistfm_url: string | null;
}

export interface ConcertSongRow {
  concert_id: number;
  position: number;
  name: string;
  track_id: string | null;
  info: string | null;
  is_encore: number;
  cover_artist: string | null;
}

const idList = (ids: string[]) => sql.join(ids.map(id => sql`${id}`), sql`, `);

/** Conciertos del usuario, opcionalmente acotados a un grupo de artistas
 *  (el grupo de merge ya resuelto por el call site). Más recientes primero. */
export function getConcerts(db: Db, userId: number, artistIds?: string[] | null): ConcertRow[] {
  const artistFilter = artistIds && artistIds.length > 0
    ? sql`AND c.artist_id IN (${idList(artistIds)})`
    : sql``;

  return db.all(sql`
    SELECT c.id, c.artist_id, a.name as artist_name, a.image_url as artist_image_url,
           c.concert_date, c.venue, c.city, c.country, c.tour, c.notes,
           c.setlistfm_id, c.setlistfm_url
    FROM concerts c
    JOIN artists a ON a.spotify_id = c.artist_id
    WHERE c.user_id = ${userId} ${artistFilter}
    ORDER BY c.concert_date DESC, c.id DESC
  `) as ConcertRow[];
}

/** Setlists de un lote de conciertos, en orden de interpretación. */
export function getConcertSongs(db: Db, concertIds: number[]): ConcertSongRow[] {
  if (concertIds.length === 0) return [];
  const ids = sql.join(concertIds.map(id => sql`${id}`), sql`, `);
  return db.all(sql`
    SELECT concert_id, position, name, track_id, info, is_encore, cover_artist
    FROM concert_songs
    WHERE concert_id IN (${ids})
    ORDER BY concert_id, position
  `) as ConcertSongRow[];
}

/** Escuchas de cada canción resuelta ANTERIORES a la fecha del bolo: es lo que
 *  distingue "ya te la sabías" de "la descubriste allí".
 *
 *  El CTE expande cada canción a su grupo de merge de track ANTES de tocar el
 *  historial, para que el filtro acabe siendo `lh.track_id = <id>` y ataque
 *  idx_lh_user_track. La forma directa —COALESCE(mr.target_id, lh.track_id) =
 *  cs.track_id— no es sargable y degenera en un scan completo del historial por
 *  fila. El CROSS JOIN fija ese orden (song_ids → historial), que es justo el
 *  que interesa. Una sola query para todo el lote. */
export function getConcertSongPlays(db: Db, userId: number, concertIds: number[]): { concert_id: number; position: number; plays: number }[] {
  if (concertIds.length === 0) return [];
  const ids = sql.join(concertIds.map(id => sql`${id}`), sql`, `);
  return db.all(sql`
    WITH song_ids AS (
      SELECT cs.concert_id, cs.position, cs.track_id AS play_id, c.concert_date
      FROM concert_songs cs
      JOIN concerts c ON c.id = cs.concert_id
      WHERE cs.concert_id IN (${ids}) AND cs.track_id IS NOT NULL
      UNION ALL
      SELECT cs.concert_id, cs.position, mr.source_id AS play_id, c.concert_date
      FROM concert_songs cs
      JOIN concerts c ON c.id = cs.concert_id
      JOIN merge_rules mr ON mr.entity_type = 'track' AND mr.user_id = ${userId} AND mr.target_id = cs.track_id
      WHERE cs.concert_id IN (${ids}) AND cs.track_id IS NOT NULL
    )
    SELECT si.concert_id, si.position, count(*) as plays
    FROM song_ids si
    CROSS JOIN listening_history lh
      ON lh.user_id = ${userId}
     AND lh.track_id = si.play_id
     AND lh.played_at < si.concert_date || 'T00:00:00.000Z'
    GROUP BY si.concert_id, si.position
  `) as { concert_id: number; position: number; plays: number }[];
}

/** Totales del registro completo para la página global. */
export function getConcertStats(db: Db, userId: number) {
  const totals = db.all(sql`
    SELECT
      count(*) as total,
      count(DISTINCT artist_id) as artists,
      count(DISTINCT venue) as venues,
      count(DISTINCT city) as cities,
      count(DISTINCT country) as countries,
      min(concert_date) as first_date,
      max(concert_date) as last_date
    FROM concerts WHERE user_id = ${userId}
  `)[0] as { total: number; artists: number; venues: number; cities: number; countries: number; first_date: string | null; last_date: string | null };

  const byYear = db.all(sql`
    SELECT substr(concert_date, 1, 4) as year, count(*) as count
    FROM concerts WHERE user_id = ${userId}
    GROUP BY year ORDER BY year
  `) as { year: string; count: number }[];

  const topArtists = db.all(sql`
    SELECT c.artist_id, a.name, a.image_url, count(*) as count
    FROM concerts c
    JOIN artists a ON a.spotify_id = c.artist_id
    WHERE c.user_id = ${userId}
    GROUP BY c.artist_id
    ORDER BY count DESC, a.name COLLATE NOCASE ASC
  `) as { artist_id: string; name: string; image_url: string | null; count: number }[];

  return { totals, byYear, topArtists };
}

/** Catálogo (nombre → spotify_id) de los tracks acreditados a un grupo de
 *  artistas. Lo consume el matching del setlist en memoria: una query por
 *  import en vez de una por canción. El orden deja los ids reales por delante
 *  de los sintéticos (import:/local:), misma preferencia que el ladder de
 *  identidad de history-import. */
export function getArtistTrackCatalog(db: Db, artistIds: string[]): { spotify_id: string; name: string }[] {
  if (artistIds.length === 0) return [];
  return db.all(sql`
    SELECT t.spotify_id, t.name
    FROM tracks t
    JOIN track_artists ta ON ta.track_id = t.spotify_id
    WHERE ta.artist_id IN (${idList(artistIds)})
    ORDER BY CASE
      WHEN t.spotify_id LIKE 'local:%' THEN 2
      WHEN t.spotify_id LIKE 'import:%' THEN 1
      ELSE 0
    END
  `) as { spotify_id: string; name: string }[];
}

/** Tracks de la librería cuyo artista principal es alguno de los nombres dados.
 *  Sirve para resolver las versiones (covers) del setlist, que por definición no
 *  están acreditadas al artista del bolo. */
export function getTracksByArtistNames(db: Db, artistNames: string[]): { spotify_id: string; name: string; artist_name: string }[] {
  if (artistNames.length === 0) return [];
  const names = sql.join(artistNames.map(n => sql`${n.toLowerCase()}`), sql`, `);
  return db.all(sql`
    SELECT t.spotify_id, t.name, a.name as artist_name
    FROM tracks t
    JOIN track_artists ta ON ta.track_id = t.spotify_id AND ta.position = 0
    JOIN artists a ON a.spotify_id = ta.artist_id
    WHERE LOWER(a.name) IN (${names})
    ORDER BY CASE
      WHEN t.spotify_id LIKE 'local:%' THEN 2
      WHEN t.spotify_id LIKE 'import:%' THEN 1
      ELSE 0
    END
  `) as { spotify_id: string; name: string; artist_name: string }[];
}

/** Ids de setlist.fm ya registrados por el usuario, para marcar en la búsqueda
 *  los bolos que ya tiene. */
export function getImportedSetlistIds(db: Db, userId: number, artistIds: string[]): string[] {
  if (artistIds.length === 0) return [];
  const rows = db.all(sql`
    SELECT setlistfm_id FROM concerts
    WHERE user_id = ${userId} AND setlistfm_id IS NOT NULL
      AND artist_id IN (${idList(artistIds)})
  `) as { setlistfm_id: string }[];
  return rows.map(r => r.setlistfm_id);
}

/** Conteos de conciertos para la tarjeta de identidad del perfil. */
export function getConcertCounts(db: Db, userId: number): { concerts_attended: number; artists_seen_live: number } {
  return db.all(sql`
    SELECT count(*) as concerts_attended, count(DISTINCT artist_id) as artists_seen_live
    FROM concerts WHERE user_id = ${userId}
  `)[0] as { concerts_attended: number; artists_seen_live: number };
}
