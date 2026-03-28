import { sql } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';
import { getDb } from '../db/connection.js';
import { artists, albums, tracks, trackArtists, listeningHistory } from '../db/schema.js';
import { spotifyFetch } from './spotify-client.js';
import { syntheticId } from './ids.js';
import type { SpotifyTrack, SpotifyPlayHistoryItem, SpotifyArtistsBatchResponse, SpotifyArtistFull, SpotifyImage } from '../types/spotify.js';

interface SpotifySearchArtistResult {
  artists: { items: SpotifyArtistFull[] };
}

interface SpotifySearchAlbumResult {
  albums: { items: { id: string; name: string; images: SpotifyImage[]; artists: { id: string; name: string }[]; release_date: string; total_tracks: number; album_type: string }[] };
}

const now = () => new Date().toISOString();

// directorio para portadas descargadas
const COVERS_DIR = path.resolve(process.env.DATABASE_PATH || './data/sis.db', '..', 'covers');
fs.mkdirSync(COVERS_DIR, { recursive: true });
const LOCAL_PREFIX = 'local:';

// resuelve IDs para archivos locales, mutando el track in-place
// artistas: busca por nombre en DB, si existe usa su ID, si no genera local:hash
// álbum y track: siempre synthetic local:hash
export function resolveLocalFileIds(track: SpotifyTrack) {
  if (!track.is_local) return;

  const db = getDb();
  const primaryArtist = track.artists[0]?.name ?? 'Unknown Artist';

  // resolver artistas
  for (const artist of track.artists) {
    const existing = db.get(
      sql`SELECT spotify_id FROM artists WHERE LOWER(name) = LOWER(${artist.name})`
    ) as { spotify_id: string } | undefined;

    artist.id = existing?.spotify_id ?? syntheticId(LOCAL_PREFIX, artist.name, artist.name);
  }

  // álbum: busca por nombre en DB, si existe usa su ID, si no genera local:hash
  const albumName = track.album.name || 'Unknown Album';
  const existingAlbum = db.get(
    sql`SELECT spotify_id FROM albums WHERE LOWER(name) = LOWER(${albumName}) AND spotify_id LIKE 'local:%'`
  ) as { spotify_id: string } | undefined;
  track.album.id = existingAlbum?.spotify_id ?? syntheticId(LOCAL_PREFIX, primaryArtist, albumName);

  // track: busca por nombre+álbum en DB, si existe usa su ID, si no genera local:hash
  const existingTrack = db.get(
    sql`SELECT spotify_id FROM tracks WHERE LOWER(name) = LOWER(${track.name}) AND album_id = ${track.album.id} AND spotify_id LIKE 'local:%'`
  ) as { spotify_id: string } | undefined;
  track.id = existingTrack?.spotify_id ?? syntheticId(LOCAL_PREFIX, primaryArtist, track.name);
}

// upsert de artistas, álbum y track, retornando si hubo inserción nueva
export function upsertTrack(track: SpotifyTrack) {
  resolveLocalFileIds(track);
  const db = getDb();

  // upsert álbum
  db.insert(albums)
    .values({
      spotifyId: track.album.id,
      name: track.album.name,
      imageUrl: track.album.images[0]?.url ?? null,
      releaseDate: track.album.release_date,
      totalTracks: track.album.total_tracks,
      albumType: track.album.album_type,
      updatedAt: now(),
    })
    .onConflictDoUpdate({
      target: albums.spotifyId,
      set: {
        name: track.album.name,
        imageUrl: sql`COALESCE(${track.album.images[0]?.url ?? null}, albums.image_url)`,
        updatedAt: now(),
      },
    })
    .run();

  // upsert artistas
  for (const artist of track.artists) {
    db.insert(artists)
      .values({
        spotifyId: artist.id,
        name: artist.name,
        updatedAt: now(),
      })
      .onConflictDoUpdate({
        target: artists.spotifyId,
        set: { name: artist.name, updatedAt: now() },
      })
      .run();
  }

  // upsert track
  db.insert(tracks)
    .values({
      spotifyId: track.id,
      name: track.name,
      albumId: track.album.id,
      durationMs: track.duration_ms,
      trackNumber: track.track_number,
      explicit: track.explicit,
      popularity: track.popularity,
      updatedAt: now(),
    })
    .onConflictDoUpdate({
      target: tracks.spotifyId,
      set: {
        name: track.name,
        popularity: track.popularity,
        updatedAt: now(),
      },
    })
    .run();

  // upsert relación track-artistas
  track.artists.forEach((artist, i) => {
    db.insert(trackArtists)
      .values({
        trackId: track.id,
        artistId: artist.id,
        position: i,
      })
      .onConflictDoNothing()
      .run();
  });
}

// enriquecer artistas sin imagen consultando la API de spotify en lotes de 50
export async function enrichArtistMetadata() {
  const db = getDb();
  const missing = db.all(
    sql`SELECT spotify_id FROM artists WHERE image_url IS NULL AND spotify_id NOT LIKE 'local:%' AND spotify_id NOT LIKE 'import:%'`
  ) as { spotify_id: string }[];

  if (missing.length === 0) return;
  console.log(`[metadata] ${missing.length} artistas sin imagen, enriqueciendo...`);

  const BATCH_SIZE = 50;
  let updated = 0;

  for (let i = 0; i < missing.length; i += BATCH_SIZE) {
    const batch = missing.slice(i, i + BATCH_SIZE);
    const ids = batch.map(a => a.spotify_id).join(',');
    const data = await spotifyFetch<SpotifyArtistsBatchResponse>('/artists', { params: { ids } });

    if (!data?.artists) continue;

    for (const artist of data.artists) {
      if (!artist) continue;
      db.update(artists)
        .set({
          imageUrl: artist.images[0]?.url ?? null,
          genres: artist.genres,
          popularity: artist.popularity,
          updatedAt: now(),
        })
        .where(sql`spotify_id = ${artist.id}`)
        .run();
      if (artist.images[0]?.url) updated++;
    }
  }

  console.log(`[metadata] ${updated} artistas actualizados con imagen`);
}

// resolver artistas con ID import: buscándolos en la API de Spotify
// actualiza el ID, imagen, géneros y popularidad; re-apunta track_artists
const RESOLVE_BATCH_LIMIT = 500; // máximo por ejecución
const SEARCH_DELAY_MS = 100; // pausa entre búsquedas para respetar rate limits

export async function resolveImportArtists() {
  const db = getDb();
  const pending = db.all(
    sql`SELECT spotify_id, name FROM artists WHERE spotify_id LIKE 'import:%' ORDER BY
      (SELECT count(*) FROM track_artists WHERE artist_id = artists.spotify_id) DESC
    LIMIT ${RESOLVE_BATCH_LIMIT}`
  ) as { spotify_id: string; name: string }[];

  if (pending.length === 0) return;
  console.log(`[resolve] ${pending.length} artistas import: por resolver...`);

  let resolved = 0;

  for (const row of pending) {
    const data = await spotifyFetch<SpotifySearchArtistResult>('/search', {
      params: { q: row.name, type: 'artist', limit: '1' },
    });

    if (!data?.artists?.items?.length) {
      // marcar como no resoluble cambiando prefijo
      db.update(artists)
        .set({ updatedAt: now() })
        .where(sql`spotify_id = ${row.spotify_id}`)
        .run();
      await sleep(SEARCH_DELAY_MS);
      continue;
    }

    const found = data.artists.items[0];
    // verificar que el nombre coincida razonablemente
    if (found.name.toLowerCase() !== row.name.toLowerCase()) {
      await sleep(SEARCH_DELAY_MS);
      continue;
    }

    // check si el artista real ya existe en DB
    const existing = db.get(
      sql`SELECT spotify_id FROM artists WHERE spotify_id = ${found.id}`
    ) as { spotify_id: string } | undefined;

    try {
      if (existing) {
        // el artista real ya existe: re-apuntar track_artists y eliminar el import:
        db.run(sql`DELETE FROM track_artists WHERE artist_id = ${row.spotify_id}
          AND track_id IN (SELECT track_id FROM track_artists WHERE artist_id = ${found.id})`);
        db.run(sql`UPDATE track_artists SET artist_id = ${found.id} WHERE artist_id = ${row.spotify_id}`);
        db.run(sql`DELETE FROM artists WHERE spotify_id = ${row.spotify_id}`);
        // actualizar imagen si el real no la tiene
        if (found.images[0]?.url) {
          db.run(sql`UPDATE artists SET image_url = ${found.images[0].url}, updated_at = ${now()} WHERE spotify_id = ${found.id} AND (image_url IS NULL OR image_url = '')`);
        }
      } else {
        // crear artista con ID real, migrar track_artists, eliminar import:
        db.insert(artists)
          .values({
            spotifyId: found.id,
            name: found.name,
            imageUrl: found.images[0]?.url ?? null,
            genres: found.genres,
            popularity: found.popularity,
            updatedAt: now(),
          })
          .onConflictDoNothing()
          .run();
        db.run(sql`DELETE FROM track_artists WHERE artist_id = ${row.spotify_id}
          AND track_id IN (SELECT track_id FROM track_artists WHERE artist_id = ${found.id})`);
        db.run(sql`UPDATE track_artists SET artist_id = ${found.id} WHERE artist_id = ${row.spotify_id}`);
        db.run(sql`DELETE FROM artists WHERE spotify_id = ${row.spotify_id}`);
      }
    } catch (err) {
      console.error(`[resolve] error resolviendo artista "${row.name}":`, err);
      await sleep(SEARCH_DELAY_MS);
      continue;
    }

    resolved++;
    await sleep(SEARCH_DELAY_MS);
  }

  console.log(`[resolve] ${resolved}/${pending.length} artistas resueltos`);
}

// resolver álbumes con ID import: buscándolos en la API de Spotify
export async function resolveImportAlbums() {
  const db = getDb();
  const pending = db.all(
    sql`SELECT a.spotify_id, a.name,
      (SELECT ar.name FROM artists ar JOIN track_artists ta ON ta.artist_id = ar.spotify_id
       JOIN tracks t ON t.spotify_id = ta.track_id WHERE t.album_id = a.spotify_id LIMIT 1) as artist_name
    FROM albums a WHERE a.spotify_id LIKE 'import:%' AND a.image_url IS NULL
    ORDER BY (SELECT count(*) FROM tracks WHERE album_id = a.spotify_id) DESC
    LIMIT ${RESOLVE_BATCH_LIMIT}`
  ) as { spotify_id: string; name: string; artist_name: string | null }[];

  if (pending.length === 0) return;
  console.log(`[resolve] ${pending.length} álbumes import: por resolver...`);

  let resolved = 0;

  for (const row of pending) {
    if (!row.artist_name) {
      // sin artista asociado, marcar como buscado
      db.update(albums)
        .set({ imageUrl: '', updatedAt: now() })
        .where(sql`spotify_id = ${row.spotify_id}`)
        .run();
      continue;
    }

    const query = `album:${row.name} artist:${row.artist_name}`;
    const data = await spotifyFetch<SpotifySearchAlbumResult>('/search', {
      params: { q: query, type: 'album', limit: '1' },
    });

    if (!data?.albums?.items?.length) {
      // marcar como buscado sin resultado
      db.update(albums)
        .set({ imageUrl: '', updatedAt: now() })
        .where(sql`spotify_id = ${row.spotify_id}`)
        .run();
      await sleep(SEARCH_DELAY_MS);
      continue;
    }

    const found = data.albums.items[0];
    // verificar nombre
    if (found.name.toLowerCase() !== row.name.toLowerCase()) {
      db.update(albums)
        .set({ imageUrl: '', updatedAt: now() })
        .where(sql`spotify_id = ${row.spotify_id}`)
        .run();
      await sleep(SEARCH_DELAY_MS);
      continue;
    }

    const imageUrl = found.images[0]?.url ?? null;

    // check si el álbum real ya existe
    const existing = db.get(
      sql`SELECT spotify_id FROM albums WHERE spotify_id = ${found.id}`
    ) as { spotify_id: string } | undefined;

    try {
      if (existing) {
        // re-apuntar tracks al álbum real y eliminar import:
        db.run(sql`UPDATE tracks SET album_id = ${found.id} WHERE album_id = ${row.spotify_id}`);
        db.run(sql`DELETE FROM albums WHERE spotify_id = ${row.spotify_id}`);
        // actualizar imagen si el real no la tiene
        if (imageUrl) {
          db.run(sql`UPDATE albums SET image_url = ${imageUrl}, updated_at = ${now()} WHERE spotify_id = ${found.id} AND (image_url IS NULL OR image_url = '')`);
        }
      } else {
        // crear álbum con ID real, migrar tracks, eliminar import:
        db.insert(albums)
          .values({
            spotifyId: found.id,
            name: found.name,
            imageUrl,
            releaseDate: found.release_date,
            totalTracks: found.total_tracks,
            albumType: found.album_type,
            updatedAt: now(),
          })
          .onConflictDoNothing()
          .run();
        db.run(sql`UPDATE tracks SET album_id = ${found.id} WHERE album_id = ${row.spotify_id}`);
        db.run(sql`DELETE FROM albums WHERE spotify_id = ${row.spotify_id}`);
      }
    } catch (err) {
      console.error(`[resolve] error resolviendo álbum "${row.name}":`, err);
      await sleep(SEARCH_DELAY_MS);
      continue;
    }

    resolved++;
    await sleep(SEARCH_DELAY_MS);
  }

  console.log(`[resolve] ${resolved}/${pending.length} álbumes resueltos`);
}

// corregir tracks con Spotify ID real que están asignados al álbum incorrecto
// (ocurre cuando el import agrupa versiones distintas bajo el mismo álbum)
export async function fixTrackAlbumAssignments() {
  const db = getDb();

  // buscar tracks con ID real de Spotify cuyo álbum podría ser incorrecto
  // nos centramos en tracks que están en un álbum real pero podrían pertenecer a otro
  const candidates = db.all(sql`
    SELECT t.spotify_id
    FROM tracks t
    WHERE t.spotify_id NOT LIKE 'import:%'
      AND t.spotify_id NOT LIKE 'local:%'
      AND t.album_id IS NOT NULL
      AND t.verified_album IS NULL
    LIMIT 500
  `) as { spotify_id: string }[];

  if (candidates.length === 0) return;

  // batch fetch en grupos de 50 (límite de la API de Spotify)
  let fixed = 0;
  for (let i = 0; i < candidates.length; i += 50) {
    const batch = candidates.slice(i, i + 50);
    const ids = batch.map(c => c.spotify_id).join(',');

    const data = await spotifyFetch<{ tracks: SpotifyTrack[] }>('/tracks', {
      params: { ids },
    });

    if (!data?.tracks) continue;

    for (const apiTrack of data.tracks) {
      if (!apiTrack?.album?.id) continue;

      const current = db.get(sql`SELECT album_id FROM tracks WHERE spotify_id = ${apiTrack.id}`) as { album_id: string } | undefined;
      if (!current) continue;

      if (current.album_id !== apiTrack.album.id) {
        // álbum incorrecto → corregir
        // asegurarse de que el álbum correcto existe
        db.insert(albums)
          .values({
            spotifyId: apiTrack.album.id,
            name: apiTrack.album.name,
            imageUrl: apiTrack.album.images?.[0]?.url ?? null,
            releaseDate: apiTrack.album.release_date,
            totalTracks: apiTrack.album.total_tracks,
            albumType: apiTrack.album.album_type,
            updatedAt: now(),
          })
          .onConflictDoNothing()
          .run();

        db.run(sql`UPDATE tracks SET album_id = ${apiTrack.album.id}, verified_album = 1 WHERE spotify_id = ${apiTrack.id}`);
        fixed++;
      } else {
        // álbum correcto → marcar como verificado
        db.run(sql`UPDATE tracks SET verified_album = 1 WHERE spotify_id = ${apiTrack.id}`);
      }
    }

    await sleep(SEARCH_DELAY_MS);
  }

  if (fixed > 0) console.log(`[resolve] ${fixed} tracks reasignados al álbum correcto`);
}

// corregir track_artists para tracks con Spotify ID real que solo tienen 1 artista
// (ocurre cuando el import solo almacena el artista principal del álbum)
export async function fixTrackArtistAssociations() {
  const db = getDb();

  const candidates = db.all(sql`
    SELECT t.spotify_id
    FROM tracks t
    WHERE t.spotify_id NOT LIKE 'import:%'
      AND t.spotify_id NOT LIKE 'local:%'
      AND t.verified_artists IS NULL
    LIMIT 200
  `) as { spotify_id: string }[];

  if (candidates.length === 0) return;
  console.log(`[resolve] verificando artistas de ${candidates.length} tracks...`);

  let fixed = 0;
  for (let i = 0; i < candidates.length; i += 50) {
    const batch = candidates.slice(i, i + 50);
    const ids = batch.map(c => c.spotify_id).join(',');

    const data = await spotifyFetch<{ tracks: SpotifyTrack[] }>('/tracks', {
      params: { ids },
    });

    if (!data?.tracks) continue;

    for (const apiTrack of data.tracks) {
      if (!apiTrack) continue;

      // verificar que el track aún existe (pudo ser eliminado por dedup)
      const exists = db.get(sql`SELECT 1 FROM tracks WHERE spotify_id = ${apiTrack.id}`);
      if (!exists) continue;

      if (!apiTrack.artists?.length) {
        db.run(sql`UPDATE tracks SET verified_artists = 1 WHERE spotify_id = ${apiTrack.id}`);
        continue;
      }

      // limpiar artistas import: obsoletos antes de insertar los reales
      db.run(sql`DELETE FROM track_artists
        WHERE track_id = ${apiTrack.id}
          AND artist_id LIKE 'import:%'`);

      // upsert todos los artistas y relaciones
      let added = false;
      for (let pos = 0; pos < apiTrack.artists.length; pos++) {
        const artist = apiTrack.artists[pos];

        db.insert(artists)
          .values({
            spotifyId: artist.id,
            name: artist.name,
            updatedAt: now(),
          })
          .onConflictDoUpdate({
            target: artists.spotifyId,
            set: { name: artist.name, updatedAt: now() },
          })
          .run();

        const result = db.insert(trackArtists)
          .values({
            trackId: apiTrack.id,
            artistId: artist.id,
            position: pos,
          })
          .onConflictDoNothing()
          .run();

        if (result.changes > 0) added = true;
      }

      db.run(sql`UPDATE tracks SET verified_artists = 1 WHERE spotify_id = ${apiTrack.id}`);
      if (added) fixed++;
    }

    await sleep(SEARCH_DELAY_MS);
  }

  if (fixed > 0) console.log(`[resolve] ${fixed} tracks con artistas actualizados`);
}

// deduplicar tracks: unificar versiones del mismo tema (single, álbum, remaster)
// en un solo track canónico, re-apuntando listening_history y track_artists
export function deduplicateTracks() {
  const db = getDb();

  const groups = db.all(sql`
    SELECT LOWER(t.name) as track_name,
           (SELECT MIN(artist_id) FROM track_artists WHERE track_id = t.spotify_id AND position = 0) as artist_id,
           GROUP_CONCAT(t.spotify_id) as ids
    FROM tracks t
    WHERE t.spotify_id NOT LIKE 'import:%'
      AND t.spotify_id NOT LIKE 'local:%'
    GROUP BY track_name, artist_id
    HAVING count(*) > 1
  `) as { track_name: string; artist_id: string | null; ids: string }[];

  if (groups.length === 0) return;
  console.log(`[dedup] ${groups.length} grupos de tracks duplicados`);

  let merged = 0;

  for (const group of groups) {
    if (!group.artist_id) continue;
    const ids = group.ids.split(',');

    // elegir canónico: preferir album > single, luego más plays
    let best: { id: string; score: number; plays: number } | null = null;
    for (const id of ids) {
      const row = db.get(sql`
        SELECT t.spotify_id,
               CASE WHEN a.album_type = 'album' THEN 0 WHEN a.album_type IS NULL THEN 1
                    WHEN a.album_type = 'compilation' THEN 2 ELSE 3 END as type_score,
               COALESCE((SELECT count(*) FROM listening_history WHERE track_id = t.spotify_id), 0) as play_count
        FROM tracks t
        LEFT JOIN albums a ON a.spotify_id = t.album_id
        WHERE t.spotify_id = ${id}
      `) as { spotify_id: string; type_score: number; play_count: number } | undefined;
      if (!row) continue;
      if (!best || row.type_score < best.score || (row.type_score === best.score && row.play_count > best.plays)) {
        best = { id: row.spotify_id, score: row.type_score, plays: row.play_count };
      }
    }

    if (!best) continue;
    const canonical = best.id;
    const dupes = ids.filter(id => id !== canonical);
    if (dupes.length === 0) continue;

    try {
      for (const dupe of dupes) {
        // re-apuntar listening_history (ignorar conflictos por played_at UNIQUE)
        db.run(sql`UPDATE OR IGNORE listening_history SET track_id = ${canonical} WHERE track_id = ${dupe}`);
        db.run(sql`DELETE FROM listening_history WHERE track_id = ${dupe}`);
        // copiar artistas al canónico
        db.run(sql`INSERT OR IGNORE INTO track_artists (track_id, artist_id, position)
          SELECT ${canonical}, artist_id, position FROM track_artists WHERE track_id = ${dupe}`);
        db.run(sql`DELETE FROM track_artists WHERE track_id = ${dupe}`);
        // eliminar track duplicado
        db.run(sql`DELETE FROM tracks WHERE spotify_id = ${dupe}`);
      }
      merged++;
    } catch (err) {
      console.error(`[dedup] error deduplicando "${group.track_name}":`, err);
    }
  }

  if (merged > 0) console.log(`[dedup] ${merged} grupos de tracks unificados`);
}

// deduplicar albums: unificar albums con el mismo nombre y artista
export function deduplicateAlbums() {
  const db = getDb();

  const groups = db.all(sql`
    SELECT LOWER(al.name) as album_name,
           MIN(ta.artist_id) as artist_id,
           GROUP_CONCAT(DISTINCT al.spotify_id) as ids,
           count(DISTINCT al.spotify_id) as cnt
    FROM albums al
    JOIN tracks t ON t.album_id = al.spotify_id
    JOIN track_artists ta ON ta.track_id = t.spotify_id AND ta.position = 0
    WHERE al.spotify_id NOT LIKE 'import:%'
      AND al.spotify_id NOT LIKE 'local:%'
    GROUP BY album_name, ta.artist_id
    HAVING cnt > 1
  `) as { album_name: string; artist_id: string | null; ids: string }[];

  if (groups.length === 0) return;
  console.log(`[dedup] ${groups.length} grupos de álbumes duplicados`);

  let merged = 0;

  for (const group of groups) {
    const ids = group.ids.split(',');

    // elegir canónico: preferir con imagen, album > single, más tracks
    let best: { id: string; imgScore: number; typeScore: number; tracks: number } | null = null;
    for (const id of ids) {
      const row = db.get(sql`
        SELECT al.spotify_id,
               CASE WHEN al.image_url IS NOT NULL AND al.image_url != '' THEN 0 ELSE 1 END as img_score,
               CASE WHEN al.album_type = 'album' THEN 0 WHEN al.album_type IS NULL THEN 1
                    WHEN al.album_type = 'compilation' THEN 2 ELSE 3 END as type_score,
               COALESCE(al.total_tracks, 0) as total_tracks
        FROM albums al WHERE al.spotify_id = ${id}
      `) as { spotify_id: string; img_score: number; type_score: number; total_tracks: number } | undefined;
      if (!row) continue;
      if (!best
        || row.img_score < best.imgScore
        || (row.img_score === best.imgScore && row.type_score < best.typeScore)
        || (row.img_score === best.imgScore && row.type_score === best.typeScore && row.total_tracks > best.tracks)) {
        best = { id: row.spotify_id, imgScore: row.img_score, typeScore: row.type_score, tracks: row.total_tracks };
      }
    }

    if (!best) continue;
    const canonical = best.id;
    const dupes = ids.filter(id => id !== canonical);
    if (dupes.length === 0) continue;

    try {
      for (const dupe of dupes) {
        db.run(sql`UPDATE tracks SET album_id = ${canonical} WHERE album_id = ${dupe}`);
        db.run(sql`DELETE FROM albums WHERE spotify_id = ${dupe}`);
      }
      merged++;
    } catch (err) {
      console.error(`[dedup] error deduplicando álbum "${group.album_name}":`, err);
    }
  }

  if (merged > 0) console.log(`[dedup] ${merged} grupos de álbumes unificados`);
}

// deduplicar albums y tracks locales entre sí (no mezclar con Spotify)
export function deduplicateLocalAlbums() {
  const db = getDb();

  // agrupar álbumes local:% con mismo nombre y artista
  const groups = db.all(sql`
    SELECT LOWER(al.name) as album_name,
           MIN(ta.artist_id) as artist_id,
           GROUP_CONCAT(DISTINCT al.spotify_id) as ids,
           count(DISTINCT al.spotify_id) as cnt
    FROM albums al
    JOIN tracks t ON t.album_id = al.spotify_id
    JOIN track_artists ta ON ta.track_id = t.spotify_id AND ta.position = 0
    WHERE al.spotify_id LIKE 'local:%'
    GROUP BY album_name, ta.artist_id
    HAVING cnt > 1
  `) as { album_name: string; artist_id: string | null; ids: string }[];

  if (groups.length === 0) return;
  console.log(`[dedup] ${groups.length} grupos de álbumes locales duplicados`);

  let merged = 0;
  for (const group of groups) {
    const ids = group.ids.split(',');
    // canónico: el que tenga más tracks
    let best: { id: string; trackCount: number } | null = null;
    for (const id of ids) {
      const row = db.get(sql`
        SELECT count(*) as cnt FROM tracks WHERE album_id = ${id}
      `) as { cnt: number };
      if (!best || row.cnt > best.trackCount) {
        best = { id, trackCount: row.cnt };
      }
    }
    if (!best) continue;
    const canonical = best.id;
    const dupes = ids.filter(id => id !== canonical);
    if (dupes.length === 0) continue;

    try {
      for (const dupe of dupes) {
        // mover tracks al álbum canónico, deduplicando por nombre
        const dupeTracks = db.all(sql`
          SELECT spotify_id, LOWER(name) as lname FROM tracks WHERE album_id = ${dupe}
        `) as { spotify_id: string; lname: string }[];

        for (const dt of dupeTracks) {
          const existing = db.get(sql`
            SELECT spotify_id FROM tracks WHERE album_id = ${canonical} AND LOWER(name) = ${dt.lname}
          `) as { spotify_id: string } | undefined;

          if (existing) {
            // track duplicado: mover history y eliminar
            db.run(sql`UPDATE OR IGNORE listening_history SET track_id = ${existing.spotify_id} WHERE track_id = ${dt.spotify_id}`);
            db.run(sql`DELETE FROM listening_history WHERE track_id = ${dt.spotify_id}`);
            db.run(sql`INSERT OR IGNORE INTO track_artists (track_id, artist_id, position)
              SELECT ${existing.spotify_id}, artist_id, position FROM track_artists WHERE track_id = ${dt.spotify_id}`);
            db.run(sql`DELETE FROM track_artists WHERE track_id = ${dt.spotify_id}`);
            db.run(sql`DELETE FROM tracks WHERE spotify_id = ${dt.spotify_id}`);
          } else {
            // track único: mover al álbum canónico
            db.run(sql`UPDATE tracks SET album_id = ${canonical} WHERE spotify_id = ${dt.spotify_id}`);
          }
        }
        db.run(sql`DELETE FROM albums WHERE spotify_id = ${dupe}`);
      }
      merged++;
    } catch (err) {
      console.error(`[dedup] error deduplicando álbum local "${group.album_name}":`, err);
    }
  }

  if (merged > 0) console.log(`[dedup] ${merged} grupos de álbumes locales unificados`);
}

// buscar portadas de álbumes locales en MusicBrainz + Cover Art Archive
const MB_BASE = 'https://musicbrainz.org/ws/2';
const CAA_BASE = 'https://coverartarchive.org';
const MB_USER_AGENT = 'SIS/1.0 (https://sis.mier.info)';
const MB_DELAY_MS = 1100; // MusicBrainz pide ~1 req/s

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// descargar imagen y guardarla localmente, retorna la ruta servible /api/covers/<file>
async function downloadCover(imageUrl: string, albumId: string): Promise<string | null> {
  try {
    const res = await fetch(imageUrl);
    if (!res.ok) return null;

    const contentType = res.headers.get('content-type') ?? 'image/jpeg';
    const ext = contentType.includes('png') ? 'png' : 'jpg';
    // sanitizar ID para nombre de archivo seguro
    const safeId = albumId.replace(/[^a-zA-Z0-9_:-]/g, '_');
    const filename = `${safeId}.${ext}`;

    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(path.join(COVERS_DIR, filename), buffer);

    return `/api/covers/${filename}`;
  } catch {
    return null;
  }
}

async function fetchMusicBrainzCover(artistName: string, albumName: string, albumId: string): Promise<string | null> {
  // buscar release en MusicBrainz
  const query = `release:${albumName} AND artist:${artistName}`;
  const url = `${MB_BASE}/release?query=${encodeURIComponent(query)}&fmt=json&limit=1`;

  const res = await fetch(url, {
    headers: { 'User-Agent': MB_USER_AGENT, 'Accept': 'application/json' },
  });

  if (!res.ok) return null;

  const data = await res.json() as { releases?: { id: string; score: number }[] };
  const release = data.releases?.[0];
  if (!release || release.score < 80) return null;

  // descargar portada desde Cover Art Archive
  const caaUrl = `${CAA_BASE}/release/${release.id}/front`;
  const caaRes = await fetch(caaUrl, { redirect: 'follow' });
  if (!caaRes.ok) return null;

  const contentType = caaRes.headers.get('content-type') ?? 'image/jpeg';
  const ext = contentType.includes('png') ? 'png' : 'jpg';
  const safeId = albumId.replace(/[^a-zA-Z0-9_:-]/g, '_');
  const filename = `${safeId}.${ext}`;

  const buffer = Buffer.from(await caaRes.arrayBuffer());
  fs.writeFileSync(path.join(COVERS_DIR, filename), buffer);

  return `/api/covers/${filename}`;
}

export async function enrichLocalAlbumCovers() {
  const db = getDb();
  // image_url NULL = no buscado aún, '' = buscado sin resultado
  const missing = db.all(
    sql`SELECT spotify_id, name FROM albums WHERE image_url IS NULL AND (spotify_id LIKE 'local:%' OR spotify_id LIKE 'import:%')`
  ) as { spotify_id: string; name: string }[];

  if (missing.length === 0) return;
  console.log(`[metadata] ${missing.length} álbumes locales sin portada, buscando en MusicBrainz...`);

  let updated = 0;

  for (const album of missing) {
    // obtener el artista principal del álbum
    const artist = db.get(sql`
      SELECT a.name FROM artists a
      JOIN track_artists ta ON ta.artist_id = a.spotify_id
      JOIN tracks t ON t.spotify_id = ta.track_id
      WHERE t.album_id = ${album.spotify_id}
      LIMIT 1
    `) as { name: string } | undefined;

    if (!artist) continue;

    try {
      const coverUrl = await fetchMusicBrainzCover(artist.name, album.name, album.spotify_id);
      // guardar resultado (URL o '' para marcar como buscado sin resultado)
      db.update(albums)
        .set({ imageUrl: coverUrl ?? '', updatedAt: now() })
        .where(sql`spotify_id = ${album.spotify_id}`)
        .run();
      if (coverUrl) {
        updated++;
        console.log(`[metadata] portada encontrada: ${artist.name} - ${album.name}`);
      }
    } catch (err) {
      console.error(`[metadata] error buscando portada de "${album.name}":`, err);
    }

    await sleep(MB_DELAY_MS);
  }

  console.log(`[metadata] ${updated} álbumes locales actualizados con portada`);
}

// insertar reproducción de archivo local (llamado desde polling cuando el track cambia)
export function insertLocalPlay(trackId: string, playedAt: string, durationMs?: number): boolean {
  const db = getDb();
  try {
    db.insert(listeningHistory)
      .values({
        trackId,
        playedAt,
        durationPlayedMs: durationMs ?? null,
      })
      .run();
    return true;
  } catch (err: any) {
    if (err.message?.includes('UNIQUE')) return false;
    throw err;
  }
}

// insertar entrada en el historial, retorna true si se insertó (no duplicado)
export function insertPlay(item: SpotifyPlayHistoryItem): boolean {
  const db = getDb();

  upsertTrack(item.track);

  try {
    db.insert(listeningHistory)
      .values({
        trackId: item.track.id,
        playedAt: item.played_at,
        contextType: item.context?.type ?? null,
        contextUri: item.context?.uri ?? null,
      })
      .run();
    return true;
  } catch (err: any) {
    // UNIQUE constraint = ya existe, no es error
    if (err.message?.includes('UNIQUE')) return false;
    throw err;
  }
}
