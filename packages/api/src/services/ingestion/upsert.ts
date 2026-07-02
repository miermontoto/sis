import { sql } from 'drizzle-orm';
import { getDb } from '../../db/connection.js';
import { artists, albums, tracks, trackArtists, listeningHistory } from '../../db/schema.js';
import { syntheticId } from '../ids.js';
import type { SpotifyTrack, SpotifyPlayHistoryItem } from '../../types/spotify.js';

const now = () => new Date().toISOString();
const LOCAL_PREFIX = 'local:';

// ventana (segundos) en la que dos plays del mismo track se consideran el mismo
export const DEDUP_WINDOW_S = 30;

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

// fusiona la relación track-artistas de un track origen en uno destino al unificar
// duplicados. el destino (canónico) es la fuente de verdad de sus artistas: solo se
// heredan los del origen si el destino no tiene ninguno (defensivo). así se evita el
// bug de arrastrar artistas de grabaciones homónimas distintas (p.ej. una versión en
// directo con feats. distintos) al canónico —que además colisionaban en la posición,
// no única en la PK (track_id, artist_id)—. reutiliza la conexión/transacción del
// llamante (no llama a getDb).
export function mergeTrackArtists(db: ReturnType<typeof getDb>, sourceTrackId: string, targetTrackId: string) {
  const targetCount = (db.get(
    sql`SELECT COUNT(*) as c FROM track_artists WHERE track_id = ${targetTrackId}`
  ) as { c: number }).c;

  // destino sin artistas: heredar los del origen con posiciones consecutivas limpias
  if (targetCount === 0) {
    const sourceArtists = db.all(
      sql`SELECT artist_id FROM track_artists WHERE track_id = ${sourceTrackId} ORDER BY position`
    ) as { artist_id: string }[];
    sourceArtists.forEach((a, i) => {
      db.run(sql`INSERT OR IGNORE INTO track_artists (track_id, artist_id, position)
        VALUES (${targetTrackId}, ${a.artist_id}, ${i})`);
    });
  }

  db.run(sql`DELETE FROM track_artists WHERE track_id = ${sourceTrackId}`);
}

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

  // capar al largo real del track: ms_played nunca debería superar la duración del track
  if (durationPlayedMs != null && item.track.duration_ms > 0) {
    durationPlayedMs = Math.min(durationPlayedMs, item.track.duration_ms);
  }

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
