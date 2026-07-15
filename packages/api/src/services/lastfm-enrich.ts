// enrichment de metadata desde last.fm — fuente alternativa a spotify para
// tracks/artistas import: (usuarios solo-last.fm o scrobbles no resueltos).
// last.fm no requiere token de spotify y va más rápido que musicbrainz
// (~4 req/s vs 1 req/s), así que corre ANTES en la cadena de duraciones.
import { sql } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { getTrackInfo, getArtistTopTags } from './lastfm-client.js';
import { LASTFM_ENRICH_MAX_TAGS } from '../constants.js';

const now = () => new Date().toISOString();

// duraciones: solo tracks import:/local: aún sin intentar (duration_ms = 0). los
// que last.fm no resuelve se dejan en 0 para que musicbrainz (que corre después
// y marca -1 los agotados) haga el fallback. no tocamos los -1 para no repetir
// consultas que ya se dieron por perdidas.
export async function enrichLastfmDurations(): Promise<number> {
  const db = getDb();
  const missing = db.all(sql`
    SELECT t.spotify_id, t.name, a.name as artist_name
    FROM tracks t
    JOIN track_artists ta ON ta.track_id = t.spotify_id AND ta.position = 0
    JOIN artists a ON a.spotify_id = ta.artist_id
    WHERE t.duration_ms = 0 AND (t.spotify_id LIKE 'import:%' OR t.spotify_id LIKE 'local:%')
  `) as { spotify_id: string; name: string; artist_name: string }[];

  if (missing.length === 0) return 0;
  console.log(`[lastfm-meta] ${missing.length} tracks sin duración, consultando last.fm...`);

  let updated = 0;
  for (const track of missing) {
    const info = await getTrackInfo(track.artist_name, track.name);
    if (info?.durationMs) {
      db.run(sql`UPDATE tracks SET duration_ms = ${info.durationMs}, updated_at = ${now()} WHERE spotify_id = ${track.spotify_id}`);
      updated++;
    }
  }

  console.log(`[lastfm-meta] ${updated} duraciones desde last.fm (resto → musicbrainz)`);
  return updated;
}

// géneros: artistas import: con reproducciones y sin géneros. los tags de
// last.fm son la mejor aproximación disponible (spotify no cubre IDs sintéticos).
// se guardan en minúsculas para casar con la convención de spotify. los artistas
// sin tags quedan en '[]' y se reintentan en ciclos futuros (cadencia 24h, coste
// acotado por el volumen de artistas import: sin resolver).
export async function enrichLastfmGenres(): Promise<number> {
  const db = getDb();
  const missing = db.all(sql`
    SELECT DISTINCT a.spotify_id, a.name
    FROM artists a
    JOIN track_artists ta ON ta.artist_id = a.spotify_id
    JOIN listening_history lh ON lh.track_id = ta.track_id
    WHERE a.spotify_id LIKE 'import:%' AND (a.genres IS NULL OR a.genres = '[]')
  `) as { spotify_id: string; name: string }[];

  if (missing.length === 0) return 0;
  console.log(`[lastfm-meta] ${missing.length} artistas sin géneros, consultando last.fm...`);

  let updated = 0;
  for (const artist of missing) {
    const tags = await getArtistTopTags(artist.name);
    if (tags.length === 0) continue;
    const genres = JSON.stringify(tags.slice(0, LASTFM_ENRICH_MAX_TAGS).map(t => t.toLowerCase()));
    db.run(sql`UPDATE artists SET genres = ${genres}, updated_at = ${now()} WHERE spotify_id = ${artist.spotify_id}`);
    updated++;
  }

  console.log(`[lastfm-meta] ${updated} artistas con géneros desde last.fm`);
  return updated;
}
