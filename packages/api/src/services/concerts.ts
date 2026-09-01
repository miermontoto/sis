// Ensamblado de conciertos (fila + setlist + matching) y resolución read-only de
// las canciones de un setlist contra la librería del usuario.
//
// El matching es EVIDENCIA, no identidad: aquí nunca se acuña un track sintético.
// Un setlist demuestra que la banda tocó algo, no que el usuario lo haya
// escuchado; acuñar entidades desde aquí metería fantasmas en los rankings. Por
// eso track_id NULL es una respuesta de primera clase ("no está en tu librería"),
// y es justo la que hace legible el "ya te sabías 14 de 19".
import { dbRead } from '../db/read-pool.js';
import { createLogger } from './logger.js';
import type { Concert, ConcertSong, SetlistfmShow } from '@sis/shared';
import type { ConcertRow, ConcertSongRow } from '../db/queries/index.js';

const log = createLogger('concerts');

// misma normalización que el resto de emparejamientos por nombre del proyecto:
// minúsculas, sin diacríticos y con los espacios colapsados
const normalize = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

// nombre base sin los calificativos de edición que Spotify cuelga del título
// ("- Live", "(Remastered 2011)", "- 2009 Mix"…). Sólo se usa como SEGUNDA
// pasada: un tema legítimamente titulado con guion ("Money - That's What I
// Want") se truncaría, y por eso nunca gana a una coincidencia exacta.
const baseName = (s: string) =>
  normalize(s).replace(/\s*[([][^)\]]*[)\]]\s*$/g, '').replace(/\s+-\s+.*$/, '').trim();

/** Índice nombre → id de un catálogo, con la primera aparición ganando (las
 *  queries ya devuelven los ids reales antes que los sintéticos). */
function buildIndex(rows: { spotify_id: string; name: string }[]): { exact: Map<string, string>; base: Map<string, string> } {
  const exact = new Map<string, string>();
  const base = new Map<string, string>();
  for (const row of rows) {
    const n = normalize(row.name);
    if (!exact.has(n)) exact.set(n, row.spotify_id);
    const b = baseName(row.name);
    if (b && !base.has(b)) base.set(b, row.spotify_id);
  }
  return { exact, base };
}

/** Resuelve las canciones de un setlist contra la librería. Dos consultas como
 *  mucho: el catálogo del artista (que cubre casi todo) y, sólo si el setlist
 *  trae versiones de otros, el catálogo de esos artistas — una cover no está
 *  acreditada al artista del bolo, así que jamás aparecería en la primera. */
export async function resolveSetlistSongs(
  artistIds: string[],
  songs: SetlistfmShow['songs'],
): Promise<{ trackId: string | null }[]> {
  if (songs.length === 0) return [];

  const own = buildIndex(await dbRead('getArtistTrackCatalog', artistIds));
  const resolved: (string | null)[] = songs.map(song => {
    const n = normalize(song.name);
    return own.exact.get(n) ?? own.base.get(baseName(song.name)) ?? null;
  });

  // segunda pasada sólo para las covers que siguen sin resolver
  const coverArtists = [...new Set(
    songs.filter((s, i) => resolved[i] === null && s.coverArtist).map(s => s.coverArtist!),
  )];
  if (coverArtists.length > 0) {
    const covers = buildIndex(await dbRead('getTracksByArtistNames', coverArtists));
    songs.forEach((song, i) => {
      if (resolved[i] !== null || !song.coverArtist) return;
      resolved[i] = covers.exact.get(normalize(song.name)) ?? covers.base.get(baseName(song.name)) ?? null;
    });
  }

  const matched = resolved.filter(id => id !== null).length;
  log.debug(`setlist resuelto: ${matched}/${songs.length} canciones en la librería`);
  return resolved.map(trackId => ({ trackId }));
}

/** Compone los Concert completos (fila + setlist + escuchas previas) de un lote
 *  de conciertos ya leídos. Tres consultas para todo el lote, no por concierto. */
export async function hydrateConcerts(userId: number, rows: ConcertRow[]): Promise<Concert[]> {
  if (rows.length === 0) return [];
  const ids = rows.map(r => r.id);

  const [songRows, playRows] = await Promise.all([
    dbRead('getConcertSongs', ids),
    dbRead('getConcertSongPlays', userId, ids),
  ]);

  const playsByKey = new Map(playRows.map(p => [`${p.concert_id}:${p.position}`, p.plays]));
  const songsByConcert = new Map<number, ConcertSong[]>();
  for (const row of songRows as ConcertSongRow[]) {
    const song: ConcertSong = {
      position: row.position,
      name: row.name,
      trackId: row.track_id,
      info: row.info,
      isEncore: !!row.is_encore,
      coverArtist: row.cover_artist,
      // sin track resuelto no hay escuchas que contar: undefined (no 0) para que
      // la UI distinga "no la tienes" de "la tienes y no la habías puesto"
      ...(row.track_id ? { playsBefore: playsByKey.get(`${row.concert_id}:${row.position}`) ?? 0 } : {}),
    };
    songsByConcert.set(row.concert_id, [...(songsByConcert.get(row.concert_id) ?? []), song]);
  }

  return rows.map(row => {
    const songs = songsByConcert.get(row.id) ?? [];
    return {
      id: row.id,
      artistId: row.artist_id,
      artistName: row.artist_name,
      artistImageUrl: row.artist_image_url,
      date: row.concert_date,
      venue: row.venue,
      city: row.city,
      country: row.country,
      tour: row.tour,
      notes: row.notes,
      setlistfmId: row.setlistfm_id,
      setlistfmUrl: row.setlistfm_url,
      songs,
      songsMatched: songs.filter(s => s.trackId !== null).length,
      songsTotal: songs.length,
    };
  });
}
