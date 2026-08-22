import { sql } from 'drizzle-orm';
import { getDb } from '../../db/connection.js';
import { artists, albums, trackArtists } from '../../db/schema.js';
import { spotifyFetch, isRateLimited } from '../spotify-client.js';
import { reassignTrackRefs } from './upsert.js';
import type { SpotifyTrack, SpotifySearchArtistResult, SpotifySearchAlbumResult } from '../../types/spotify.js';
import { createLogger } from '../logger.js';

const logCleanup = createLogger('cleanup');
const logResolve = createLogger('resolve');
const now = () => new Date().toISOString();
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// normaliza nombres de artista para comparar ignorando mayúsculas y diacríticos /
// estilizaciones (p.ej. "Fito Páez" == "Fito Paez", "JAŸ-Z" == "JAY-Z"). Evita falsos
// "no resuelto" cuando Spotify devuelve el mismo artista con grafía distinta.
const normalizeArtistName = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

const RESOLVE_BATCH_LIMIT = 50;
const SEARCH_DELAY_MS = 500;

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
    logCleanup.info(`eliminados ${orphanArtists.changes} artistas y ${orphanAlbums.changes} álbumes import: huérfanos`);
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
  logCleanup.info(`eliminados ${trash.length} tracks no-música (${deletedPlays} plays)`);
}

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
  logResolve.info(`${pending.length} artistas import: por resolver...`);

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
    if (normalizeArtistName(found.name) !== normalizeArtistName(row.name)) {
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
      logResolve.error(`error resolviendo artista "${row.name}":`, err);
      await sleep(SEARCH_DELAY_MS);
      continue;
    }

    resolved++;
    await sleep(SEARCH_DELAY_MS);
  }

  logResolve.info(`${resolved}/${pending.length} artistas resueltos`);
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
  logResolve.info(`${pending.length} álbumes import: por resolver...`);

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
      const foundArtistIds = found.artists?.map(a => a.id).filter(Boolean) ?? [];
      if (existing) {
        // re-apuntar tracks al álbum real y eliminar import:
        db.run(sql`UPDATE tracks SET album_id = ${found.id} WHERE album_id = ${row.spotify_id}`);
        db.run(sql`DELETE FROM albums WHERE spotify_id = ${row.spotify_id}`);
        // actualizar imagen y artist_ids si el real no los tiene
        if (imageUrl) {
          db.run(sql`UPDATE albums SET image_url = ${imageUrl}, updated_at = ${now()} WHERE spotify_id = ${found.id} AND (image_url IS NULL OR image_url = '')`);
          db.run(sql`INSERT OR IGNORE INTO album_covers (album_id, image_url, source) VALUES (${found.id}, ${imageUrl}, 'spotify')`);
        }
        if (foundArtistIds.length) {
          db.run(sql`UPDATE albums SET artist_ids = ${JSON.stringify(foundArtistIds)}, updated_at = ${now()} WHERE spotify_id = ${found.id} AND artist_ids IS NULL`);
        }
      } else {
        // crear álbum con ID real, migrar tracks, eliminar import:
        db.insert(albums)
          .values({
            spotifyId: found.id,
            name: found.name,
            imageUrl,
            artistIds: foundArtistIds.length ? foundArtistIds : null,
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
      logResolve.error(`error resolviendo álbum "${row.name}":`, err);
      await sleep(SEARCH_DELAY_MS);
      continue;
    }

    resolved++;
    await sleep(SEARCH_DELAY_MS);
  }

  logResolve.info(`${resolved}/${pending.length} álbumes resueltos`);
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
            artistIds: apiTrack.album.artists?.length ? apiTrack.album.artists.map(a => a.id) : null,
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

  if (fixed > 0) logResolve.info(`${fixed} tracks reasignados al álbum correcto`);
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
  logResolve.info(`verificando artistas de ${candidates.length} tracks...`);

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

  if (fixed > 0) logResolve.info(`${fixed} tracks con artistas actualizados`);
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
  logCleanup.info(`${groups.length} tracks import: con equivalente real`);

  let merged = 0;
  for (const { import_id, real_id, track_name } of groups) {
    try {
      reassignTrackRefs(db, import_id, real_id);
      merged++;
    } catch (err) {
      logCleanup.error(`error unificando "${track_name}":`, err);
    }
  }

  if (merged > 0) logCleanup.info(`${merged} tracks import: unificados con reales`);
}
