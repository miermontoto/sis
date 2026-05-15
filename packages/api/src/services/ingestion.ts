import { sql } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';
import { getDb } from '../db/connection.js';
import { artists, albums, tracks, trackArtists, listeningHistory } from '../db/schema.js';
import { spotifyFetch, isRateLimited } from './spotify-client.js';
import { syntheticId } from './ids.js';
import type { SpotifyTrack, SpotifyPlayHistoryItem, SpotifyArtistsBatchResponse, SpotifyArtistFull, SpotifyImage, SpotifyAlbumTracksResponse } from '../types/spotify.js';

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

  // resolver artistas: preferir IDs reales de spotify sobre sintéticos (import:/local:)
  // para evitar vincular el local a un placeholder pendiente de resolver
  for (const artist of track.artists) {
    const existing = db.get(
      sql`SELECT spotify_id FROM artists WHERE LOWER(name) = LOWER(${artist.name})
          ORDER BY CASE
            WHEN spotify_id LIKE 'local:%' THEN 2
            WHEN spotify_id LIKE 'import:%' THEN 1
            ELSE 0
          END
          LIMIT 1`
    ) as { spotify_id: string } | undefined;

    artist.id = existing?.spotify_id ?? syntheticId(LOCAL_PREFIX, artist.name, artist.name);
  }

  // álbum: busca por nombre + artista en DB para reusar IDs existentes
  const albumName = track.album.name || 'Unknown Album';
  const primaryArtistId = track.artists[0]?.id;
  const existingAlbum = primaryArtistId ? db.get(
    sql`SELECT a.spotify_id FROM albums a
        WHERE LOWER(a.name) = LOWER(${albumName}) AND a.spotify_id LIKE 'local:%'
          AND EXISTS (
            SELECT 1 FROM tracks t
            JOIN track_artists ta ON ta.track_id = t.spotify_id AND ta.position = 0
            WHERE t.album_id = a.spotify_id AND ta.artist_id = ${primaryArtistId}
          )
        LIMIT 1`
  ) as { spotify_id: string } | undefined : undefined;
  track.album.id = existingAlbum?.spotify_id ?? syntheticId(LOCAL_PREFIX, primaryArtist, albumName);

  // track: busca por nombre+álbum en DB; fallback incluye álbum en el hash
  // para que tracks homónimos en álbumes distintos no colisionen
  const existingTrack = db.get(
    sql`SELECT spotify_id FROM tracks WHERE LOWER(name) = LOWER(${track.name}) AND album_id = ${track.album.id} AND spotify_id LIKE 'local:%'`
  ) as { spotify_id: string } | undefined;
  track.id = existingTrack?.spotify_id ?? syntheticId(LOCAL_PREFIX, `${primaryArtist}\0${albumName}`, track.name);
}

// upsert de artistas, álbum y track, retornando si hubo inserción nueva
export function upsertTrack(track: SpotifyTrack) {
  resolveLocalFileIds(track);
  const db = getDb();

  // dedupe: si ya existe un álbum con mismo nombre + mismo artista primario, reusar su ID
  // en vez de crear un registro nuevo (evita álbumes duplicados entre mercados/ediciones
  // y entre fuentes sintéticas —import:/local:— y las reales de spotify)
  const primaryArtistId = track.album.artists?.[0]?.id;
  if (primaryArtistId && track.album.id) {
    const existing = db.get(sql`
      SELECT spotify_id FROM albums
      WHERE LOWER(name) = LOWER(${track.album.name})
        AND spotify_id != ${track.album.id}
        AND (
          json_extract(artist_ids, '$[0]') = ${primaryArtistId}
          OR EXISTS (
            SELECT 1 FROM tracks t
            JOIN track_artists ta ON ta.track_id = t.spotify_id AND ta.position = 0
            WHERE t.album_id = albums.spotify_id AND ta.artist_id = ${primaryArtistId}
          )
        )
      ORDER BY
        (SELECT COUNT(*) FROM tracks WHERE album_id = albums.spotify_id) DESC,
        (SELECT COUNT(*) FROM listening_history lh JOIN tracks tr ON tr.spotify_id = lh.track_id WHERE tr.album_id = albums.spotify_id) DESC,
        spotify_id ASC
      LIMIT 1
    `) as { spotify_id: string } | undefined;
    if (existing) track.album.id = existing.spotify_id;
  }

  // upsert álbum (incluye artist_ids del album-level de spotify)
  const albumArtistIds = track.album.artists?.map(a => a.id) ?? null;
  db.insert(albums)
    .values({
      spotifyId: track.album.id,
      name: track.album.name,
      imageUrl: track.album.images[0]?.url ?? null,
      artistIds: albumArtistIds,
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
        artistIds: albumArtistIds ?? sql`albums.artist_ids`,
        updatedAt: now(),
      },
    })
    .run();

  // registrar portada observada
  const albumImageUrl = track.album.images[0]?.url;
  if (albumImageUrl) {
    db.run(sql`INSERT OR IGNORE INTO album_covers (album_id, image_url, source) VALUES (${track.album.id}, ${albumImageUrl}, 'spotify')`);
  }

  // upsert artistas (ignorar nombres vacíos)
  for (const artist of track.artists) {
    if (!artist.name) continue;
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
      discNumber: track.disc_number ?? 1,
      explicit: track.explicit,
      popularity: track.popularity,
      updatedAt: now(),
    })
    .onConflictDoUpdate({
      target: tracks.spotifyId,
      set: {
        name: track.name,
        durationMs: track.duration_ms,
        trackNumber: track.track_number,
        discNumber: track.disc_number ?? 1,
        explicit: track.explicit,
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

// asegurar que todos los tracks de un álbum están en la DB (fetch de Spotify si faltan)
export async function ensureFullAlbumTracks(albumId: string, totalTracks: number | null, userId: number): Promise<void> {
  if (!totalTracks || albumId.startsWith('local:') || albumId.startsWith('import:')) return;

  const db = getDb();
  const row = db.all(sql`
    SELECT count(*) as c,
           sum(CASE WHEN disc_number IS NULL THEN 1 ELSE 0 END) as missing_disc
    FROM tracks
    WHERE album_id = ${albumId}
  `)[0] as { c: number; missing_disc: number | null };
  if (row.c >= totalTracks && (row.missing_disc ?? 0) === 0) return;

  const data = await spotifyFetch<SpotifyAlbumTracksResponse>(`/albums/${albumId}/tracks`, {
    userId, params: { limit: '50' },
  });
  if (!data?.items) return;

  for (const item of data.items) {
    for (const artist of item.artists) {
      if (!artist.name) continue;
      db.insert(artists)
        .values({ spotifyId: artist.id, name: artist.name, updatedAt: now() })
        .onConflictDoUpdate({ target: artists.spotifyId, set: { name: artist.name, updatedAt: now() } })
        .run();
    }

    db.insert(tracks)
      .values({
        spotifyId: item.id, name: item.name, albumId,
        durationMs: item.duration_ms, trackNumber: item.track_number, discNumber: item.disc_number,
        explicit: item.explicit, updatedAt: now(),
      })
      .onConflictDoUpdate({
        target: tracks.spotifyId,
        set: { name: item.name, trackNumber: item.track_number, discNumber: item.disc_number, durationMs: item.duration_ms, updatedAt: now() },
      })
      .run();

    item.artists.forEach((artist, i) => {
      db.insert(trackArtists)
        .values({ trackId: item.id, artistId: artist.id, position: i })
        .onConflictDoNothing()
        .run();
    });
  }

  let next = data.next;
  while (next) {
    const url = new URL(next);
    const path = url.pathname.replace(/^\/v1/, '') + url.search;
    const page = await spotifyFetch<SpotifyAlbumTracksResponse>(path, { userId });
    if (!page?.items) break;
    for (const item of page.items) {
      for (const artist of item.artists) {
        if (!artist.name) continue;
        db.insert(artists)
          .values({ spotifyId: artist.id, name: artist.name, updatedAt: now() })
          .onConflictDoUpdate({ target: artists.spotifyId, set: { name: artist.name, updatedAt: now() } })
          .run();
      }
      db.insert(tracks)
        .values({
          spotifyId: item.id, name: item.name, albumId,
          durationMs: item.duration_ms, trackNumber: item.track_number, discNumber: item.disc_number,
          explicit: item.explicit, updatedAt: now(),
        })
        .onConflictDoUpdate({
          target: tracks.spotifyId,
          set: { name: item.name, trackNumber: item.track_number, discNumber: item.disc_number, durationMs: item.duration_ms, updatedAt: now() },
        })
        .run();
      item.artists.forEach((artist, i) => {
        db.insert(trackArtists)
          .values({ trackId: item.id, artistId: artist.id, position: i })
          .onConflictDoNothing()
          .run();
      });
    }
    next = page.next;
  }
}

// enriquecer artistas sin imagen consultando la API de spotify en lotes de 50
// userId: cualquier usuario activo cuyo token se usa para la API
export async function enrichArtistMetadata(userId: number) {
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
    const data = await spotifyFetch<SpotifyArtistsBatchResponse>('/artists', { userId, params: { ids } });

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

// eliminar entidades import: huérfanas (tracks/track_artists ya re-apuntados)
export function cleanOrphanImports() {
  const db = getDb();
  const orphanArtists = db.run(
    sql`DELETE FROM artists WHERE spotify_id LIKE 'import:%'
      AND spotify_id NOT IN (SELECT DISTINCT artist_id FROM track_artists)`
  );
  const orphanAlbums = db.run(
    sql`DELETE FROM albums WHERE spotify_id LIKE 'import:%'
      AND spotify_id NOT IN (SELECT DISTINCT album_id FROM tracks WHERE album_id IS NOT NULL)`
  );
  if (orphanArtists.changes || orphanAlbums.changes) {
    console.log(`[cleanup] eliminados ${orphanArtists.changes} artistas y ${orphanAlbums.changes} álbumes import: huérfanos`);
  }
}

// eliminar tracks import: que no son música (vídeos de YouTube, contenido pirata, entrevistas, etc.)
export function cleanNonMusicImports() {
  const db = getDb();

  const NON_MUSIC_ARTISTS = [
    'Linus Tech Tips', 'Loudwire', 'MSVD', 'Flashback FM', 'Craig Ferguson',
    'Elden Ring Clips', 'FLeA24681', 'Exclusive',
  ];
  const artistList = NON_MUSIC_ARTISTS.map(a => `'${a}'`).join(',');

  const trash = db.all(sql.raw(`
    SELECT t.spotify_id FROM tracks t
    LEFT JOIN track_artists ta ON ta.track_id = t.spotify_id AND ta.position = 0
    LEFT JOIN artists a ON a.spotify_id = ta.artist_id
    WHERE t.spotify_id LIKE 'import:%' AND (
      t.name LIKE '%www%' OR t.name LIKE '%.com%'
      OR a.name LIKE '%Video Converter%'
      OR a.name LIKE '%Rock & Roll Hall of Fame%'
      OR a.name IN (${artistList})
      OR t.name LIKE '%REACTION%' OR t.name LIKE '%Reaction)%'
      OR (t.name LIKE '%Interview%' AND t.name NOT LIKE '%(Live%')
      OR t.name LIKE '%Behind The Scenes%' OR t.name LIKE '%Studio Tour%'
      OR t.name LIKE '%Drum Cover%' OR t.name LIKE '%Guitar Cover%'
      OR t.name LIKE '%Walked Out%'
      OR t.name LIKE '%Making Of%' OR t.name LIKE '%Making of%'
      OR t.name LIKE '%Hall of Fame Induction%'
      OR t.name LIKE '%Tutorial%' OR t.name LIKE '%Explained%'
    )
  `)) as { spotify_id: string }[];

  if (trash.length === 0) return;

  let deletedPlays = 0;
  for (const { spotify_id } of trash) {
    const r = db.run(sql`DELETE FROM listening_history WHERE track_id = ${spotify_id}`);
    deletedPlays += r.changes;
    db.run(sql`DELETE FROM track_artists WHERE track_id = ${spotify_id}`);
    db.run(sql`DELETE FROM generated_playlist_tracks WHERE track_id = ${spotify_id}`);
    db.run(sql`DELETE FROM spotify_playlist_tracks WHERE track_id = ${spotify_id}`);
    db.run(sql`DELETE FROM tracks WHERE spotify_id = ${spotify_id}`);
  }
  console.log(`[cleanup] eliminados ${trash.length} tracks no-música (${deletedPlays} plays)`);
}

const RESOLVE_BATCH_LIMIT = 50;
const SEARCH_DELAY_MS = 500;

export async function resolveImportArtists(userId: number) {
  if (isRateLimited()) return;

  const db = getDb();
  const pending = db.all(
    sql`SELECT spotify_id, name FROM artists WHERE spotify_id LIKE 'import:%'
      AND spotify_id IN (SELECT DISTINCT artist_id FROM track_artists)
    ORDER BY (SELECT count(*) FROM track_artists WHERE artist_id = artists.spotify_id) DESC
    LIMIT ${RESOLVE_BATCH_LIMIT}`
  ) as { spotify_id: string; name: string }[];

  if (pending.length === 0) return;
  console.log(`[resolve] ${pending.length} artistas import: por resolver...`);

  let resolved = 0;

  for (const row of pending) {
    const data = await spotifyFetch<SpotifySearchArtistResult>('/search', {
      userId, params: { q: row.name, type: 'artist', limit: '1' },
    });

    if (!data) {
      if (isRateLimited()) break;
      await sleep(SEARCH_DELAY_MS);
      continue;
    }

    if (!data.artists?.items?.length) {
      const newId = row.spotify_id.replace('import:', 'unresolved:');
      db.run(sql`UPDATE artists SET spotify_id = ${newId}, updated_at = ${now()} WHERE spotify_id = ${row.spotify_id}`);
      db.run(sql`UPDATE track_artists SET artist_id = ${newId} WHERE artist_id = ${row.spotify_id}`);
      await sleep(SEARCH_DELAY_MS);
      continue;
    }

    const found = data.artists.items[0];
    if (found.name.toLowerCase() !== row.name.toLowerCase()) {
      const newId = row.spotify_id.replace('import:', 'unresolved:');
      db.run(sql`UPDATE artists SET spotify_id = ${newId}, updated_at = ${now()} WHERE spotify_id = ${row.spotify_id}`);
      db.run(sql`UPDATE track_artists SET artist_id = ${newId} WHERE artist_id = ${row.spotify_id}`);
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
export async function resolveImportAlbums(userId: number) {
  if (isRateLimited()) return;

  const db = getDb();
  const pending = db.all(
    sql`SELECT a.spotify_id, a.name,
      (SELECT ar.name FROM artists ar JOIN track_artists ta ON ta.artist_id = ar.spotify_id
       JOIN tracks t ON t.spotify_id = ta.track_id WHERE t.album_id = a.spotify_id LIMIT 1) as artist_name
    FROM albums a WHERE a.spotify_id LIKE 'import:%' AND a.image_url IS NULL
      AND a.spotify_id IN (SELECT DISTINCT album_id FROM tracks WHERE album_id IS NOT NULL)
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
      userId, params: { q: query, type: 'album', limit: '1' },
    });

    if (!data) {
      if (isRateLimited()) break;
      await sleep(SEARCH_DELAY_MS);
      continue;
    }

    if (!data.albums?.items?.length) {
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
          db.run(sql`INSERT OR IGNORE INTO album_covers (album_id, image_url, source) VALUES (${found.id}, ${imageUrl}, 'spotify')`);
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
export async function fixTrackAlbumAssignments(userId: number) {
  if (isRateLimited()) return;

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
      userId, params: { ids },
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

        db.run(sql`UPDATE tracks SET album_id = ${apiTrack.album.id}, track_number = ${apiTrack.track_number}, disc_number = ${apiTrack.disc_number ?? 1}, verified_album = 1 WHERE spotify_id = ${apiTrack.id}`);
        fixed++;
      } else {
        // álbum correcto → marcar como verificado
        db.run(sql`UPDATE tracks SET track_number = ${apiTrack.track_number}, disc_number = ${apiTrack.disc_number ?? 1}, verified_album = 1 WHERE spotify_id = ${apiTrack.id}`);
      }
    }

    await sleep(SEARCH_DELAY_MS);
  }

  if (fixed > 0) console.log(`[resolve] ${fixed} tracks reasignados al álbum correcto`);
}

// corregir track_artists para tracks con Spotify ID real que solo tienen 1 artista
// (ocurre cuando el import solo almacena el artista principal del álbum)
export async function fixTrackArtistAssociations(userId: number) {
  if (isRateLimited()) return;

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
      userId, params: { ids },
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

      // upsert todos los artistas y relaciones (ignorar nombres vacíos)
      let added = false;
      for (let pos = 0; pos < apiTrack.artists.length; pos++) {
        const artist = apiTrack.artists[pos];
        if (!artist.name) continue;

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
        // re-apuntar playlist references (generated + spotify library)
        db.run(sql`UPDATE OR IGNORE generated_playlist_tracks SET track_id = ${canonical} WHERE track_id = ${dupe}`);
        db.run(sql`DELETE FROM generated_playlist_tracks WHERE track_id = ${dupe}`);
        db.run(sql`UPDATE OR IGNORE spotify_playlist_tracks SET track_id = ${canonical} WHERE track_id = ${dupe}`);
        db.run(sql`DELETE FROM spotify_playlist_tracks WHERE track_id = ${dupe}`);
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
            db.run(sql`UPDATE OR IGNORE generated_playlist_tracks SET track_id = ${existing.spotify_id} WHERE track_id = ${dt.spotify_id}`);
            db.run(sql`DELETE FROM generated_playlist_tracks WHERE track_id = ${dt.spotify_id}`);
            db.run(sql`UPDATE OR IGNORE spotify_playlist_tracks SET track_id = ${existing.spotify_id} WHERE track_id = ${dt.spotify_id}`);
            db.run(sql`DELETE FROM spotify_playlist_tracks WHERE track_id = ${dt.spotify_id}`);
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
        db.run(sql`INSERT OR IGNORE INTO album_covers (album_id, image_url, source) VALUES (${album.spotify_id}, ${coverUrl}, 'musicbrainz')`);
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

export async function enrichImportTrackDurations() {
  const db = getDb();
  const missing = db.all(sql`
    SELECT t.spotify_id, t.name, a.name as artist_name
    FROM tracks t
    JOIN track_artists ta ON ta.track_id = t.spotify_id AND ta.position = 0
    JOIN artists a ON a.spotify_id = ta.artist_id
    WHERE t.duration_ms <= 0 AND (t.spotify_id LIKE 'import:%' OR t.spotify_id LIKE 'local:%')
  `) as { spotify_id: string; name: string; artist_name: string }[];

  if (missing.length === 0) return;
  console.log(`[metadata] ${missing.length} tracks importados sin duración, buscando en MusicBrainz...`);

  let updated = 0;
  for (const track of missing) {
    const query = `recording:${track.name} AND artist:${track.artist_name}`;
    const url = `${MB_BASE}/recording?query=${encodeURIComponent(query)}&fmt=json&limit=1`;

    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': MB_USER_AGENT, 'Accept': 'application/json' },
      });

      if (res.ok) {
        const data = await res.json() as { recordings?: { score: number; length?: number }[] };
        const recording = data.recordings?.[0];
        if (recording && recording.score >= 80 && recording.length) {
          db.run(sql`UPDATE tracks SET duration_ms = ${recording.length}, updated_at = ${now()} WHERE spotify_id = ${track.spotify_id}`);
          updated++;
          console.log(`[metadata] duración encontrada: ${track.artist_name} - ${track.name} (${Math.round(recording.length / 1000)}s)`);
        } else {
          db.run(sql`UPDATE tracks SET duration_ms = -1, updated_at = ${now()} WHERE spotify_id = ${track.spotify_id}`);
        }
      }
    } catch (err) {
      console.error(`[metadata] error buscando duración de "${track.name}":`, err);
    }

    await sleep(MB_DELAY_MS);
  }

  console.log(`[metadata] ${updated} tracks importados actualizados con duración`);
}

const DEDUP_WINDOW_S = 30;

function findNearbyPlay(db: ReturnType<typeof getDb>, trackId: string, playedAt: string, userId: number) {
  return db.get(sql`
    SELECT id, duration_played_ms FROM listening_history
    WHERE user_id = ${userId} AND track_id = ${trackId}
      AND abs(strftime('%s', played_at) - strftime('%s', ${playedAt})) <= ${DEDUP_WINDOW_S}
    LIMIT 1
  `) as { id: number; duration_played_ms: number | null } | undefined;
}

// insertar reproducción de archivo local (llamado desde polling cuando el track cambia)
export function insertLocalPlay(trackId: string, playedAt: string, userId: number, durationMs?: number): boolean {
  const db = getDb();

  const existing = findNearbyPlay(db, trackId, playedAt, userId);
  if (existing) {
    if (existing.duration_played_ms === null && durationMs) {
      db.run(sql`UPDATE listening_history SET duration_played_ms = ${durationMs} WHERE id = ${existing.id}`);
    }
    return false;
  }

  try {
    db.insert(listeningHistory)
      .values({
        trackId,
        playedAt,
        userId,
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
export function insertPlay(item: SpotifyPlayHistoryItem, userId: number, durationPlayedMs?: number): boolean {
  const db = getDb();

  upsertTrack(item.track);

  const existing = findNearbyPlay(db, item.track.id, item.played_at, userId);
  if (existing) {
    if (existing.duration_played_ms === null && durationPlayedMs) {
      db.run(sql`UPDATE listening_history SET duration_played_ms = ${durationPlayedMs} WHERE id = ${existing.id}`);
    }
    return false;
  }

  try {
    db.insert(listeningHistory)
      .values({
        trackId: item.track.id,
        playedAt: item.played_at,
        userId,
        contextType: item.context?.type ?? null,
        contextUri: item.context?.uri ?? null,
        durationPlayedMs: durationPlayedMs ?? null,
      })
      .run();
    return true;
  } catch (err: any) {
    // UNIQUE constraint = ya existe, no es error
    if (err.message?.includes('UNIQUE')) return false;
    throw err;
  }
}

export function cleanDuplicatePlays() {
  const db = getDb();
  // encontrar el ID a eliminar en cada par de duplicados (mismo track, ±30s)
  // conservar el que tenga duración; si ambos iguales, conservar el más antiguo (id menor)
  const toDelete = db.all(sql`
    SELECT CASE
      WHEN a.duration_played_ms IS NOT NULL AND b.duration_played_ms IS NULL THEN b.id
      WHEN b.duration_played_ms IS NOT NULL AND a.duration_played_ms IS NULL THEN a.id
      ELSE b.id
    END as id
    FROM listening_history a
    JOIN listening_history b ON a.user_id = b.user_id AND a.track_id = b.track_id AND a.id < b.id
    WHERE abs(strftime('%s', a.played_at) - strftime('%s', b.played_at)) <= ${DEDUP_WINDOW_S}
  `) as { id: number }[];

  if (toDelete.length === 0) return;

  const ids = toDelete.map(r => r.id);
  for (let i = 0; i < ids.length; i += 500) {
    const batch = ids.slice(i, i + 500);
    db.run(sql`DELETE FROM listening_history WHERE id IN (${sql.join(batch.map(id => sql`${id}`), sql`, `)})`);
  }
  console.log(`[cleanup] eliminados ${ids.length} plays duplicados (±${DEDUP_WINDOW_S}s)`);
}

// eliminar duplicados Basic/Extended: mismo track+user, uno con duración NULL y otro con duración,
// separados por ~duración del track (Basic graba endTime, Extended graba startTime)
export function cleanBasicExtendedDuplicates() {
  const db = getDb();
  const toDelete = db.all(sql`
    SELECT a.id
    FROM listening_history a
    JOIN listening_history b ON a.user_id = b.user_id AND a.track_id = b.track_id AND a.id != b.id
    JOIN tracks t ON t.spotify_id = a.track_id
    WHERE a.duration_played_ms IS NULL
      AND b.duration_played_ms IS NOT NULL
      AND t.duration_ms > 0
      AND abs(
        abs(strftime('%s', a.played_at) - strftime('%s', b.played_at))
        - (t.duration_ms / 1000)
      ) <= 15
  `) as { id: number }[];

  if (toDelete.length === 0) return;

  const ids = [...new Set(toDelete.map(r => r.id))];
  for (let i = 0; i < ids.length; i += 500) {
    const batch = ids.slice(i, i + 500);
    db.run(sql`DELETE FROM listening_history WHERE id IN (${sql.join(batch.map(id => sql`${id}`), sql`, `)})`);
  }
  console.log(`[cleanup] eliminados ${ids.length} duplicados Basic/Extended`);
}

// unificar tracks import: con su equivalente real de Spotify (mismo nombre + artista principal)
export function mergeImportTracks() {
  const db = getDb();

  const groups = db.all(sql`
    SELECT i.spotify_id as import_id, r.spotify_id as real_id, i.name as track_name
    FROM tracks i
    JOIN track_artists tai ON tai.track_id = i.spotify_id AND tai.position = 0
    JOIN track_artists tar ON tar.artist_id = tai.artist_id AND tar.position = 0
    JOIN tracks r ON r.spotify_id = tar.track_id AND LOWER(TRIM(r.name)) = LOWER(TRIM(i.name))
    WHERE i.spotify_id LIKE 'import:%'
      AND r.spotify_id NOT LIKE 'import:%'
      AND r.spotify_id NOT LIKE 'local:%'
  `) as { import_id: string; real_id: string; track_name: string }[];

  if (groups.length === 0) return;
  console.log(`[cleanup] ${groups.length} tracks import: con equivalente real`);

  let merged = 0;
  for (const { import_id, real_id, track_name } of groups) {
    try {
      db.run(sql`UPDATE OR IGNORE listening_history SET track_id = ${real_id} WHERE track_id = ${import_id}`);
      db.run(sql`DELETE FROM listening_history WHERE track_id = ${import_id}`);
      db.run(sql`INSERT OR IGNORE INTO track_artists (track_id, artist_id, position)
        SELECT ${real_id}, artist_id, position FROM track_artists WHERE track_id = ${import_id}`);
      db.run(sql`DELETE FROM track_artists WHERE track_id = ${import_id}`);
      db.run(sql`UPDATE OR IGNORE generated_playlist_tracks SET track_id = ${real_id} WHERE track_id = ${import_id}`);
      db.run(sql`DELETE FROM generated_playlist_tracks WHERE track_id = ${import_id}`);
      db.run(sql`UPDATE OR IGNORE spotify_playlist_tracks SET track_id = ${real_id} WHERE track_id = ${import_id}`);
      db.run(sql`DELETE FROM spotify_playlist_tracks WHERE track_id = ${import_id}`);
      db.run(sql`DELETE FROM tracks WHERE spotify_id = ${import_id}`);
      merged++;
    } catch (err) {
      console.error(`[cleanup] error unificando "${track_name}":`, err);
    }
  }

  if (merged > 0) console.log(`[cleanup] ${merged} tracks import: unificados con reales`);
}
