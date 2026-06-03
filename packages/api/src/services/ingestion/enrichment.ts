import { sql } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';
import { getDb } from '../../db/connection.js';
import { artists, albums, tracks, trackArtists } from '../../db/schema.js';
import { spotifyFetch } from '../spotify-client.js';
import type { SpotifyArtistsBatchResponse, SpotifyAlbumTracksResponse } from '../../types/spotify.js';

const now = () => new Date().toISOString();
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// directorio para portadas descargadas
const COVERS_DIR = path.resolve(process.env.DATABASE_PATH || './data/sis.db', '..', 'covers');
fs.mkdirSync(COVERS_DIR, { recursive: true });

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

// --- MusicBrainz + Cover Art Archive (portadas de álbumes locales / importados) ---

const MB_BASE = 'https://musicbrainz.org/ws/2';
const CAA_BASE = 'https://coverartarchive.org';
const MB_USER_AGENT = 'SIS/1.0 (https://sis.mier.info)';
const MB_DELAY_MS = 1100; // MusicBrainz pide ~1 req/s

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
