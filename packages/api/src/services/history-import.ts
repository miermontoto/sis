import { sql } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { artists, albums, tracks, trackArtists, listeningHistory } from '../db/schema.js';
import { syntheticId } from './ids.js';

// umbral mínimo de reproducción (30s = Spotify Wrapped threshold)
const MIN_PLAYED_MS = 30_000;
const BATCH_SIZE = 500;
// ventana de dedup: si ya existe un play del mismo track dentro de este rango, se considera duplicado
const DEDUP_WINDOW_SECONDS = 180;

const IMPORT_PREFIX = 'import:';

interface ExtendedEntry {
  ts: string;
  master_metadata_track_name: string | null;
  master_metadata_album_artist_name: string | null;
  master_metadata_album_album_name: string | null;
  spotify_track_uri: string | null;
  ms_played: number;
}

interface BasicEntry {
  endTime: string;
  trackName: string;
  artistName: string;
  msPlayed: number;
}

export interface ImportResult {
  total: number;
  imported: number;
  duplicates: number;
  skipped: number;
}

// genera un ID determinístico para entradas sin URI de spotify
function importId(a: string, b: string): string {
  return syntheticId(IMPORT_PREFIX, a, b);
}

// detecta formato y normaliza las entradas a un formato común
interface NormalizedEntry {
  playedAt: string;
  trackName: string;
  artistName: string;
  albumName: string | null;
  trackId: string;
  artistId: string;
  albumId: string | null;
  msPlayed: number;
}

function normalizeEntries(data: unknown[]): NormalizedEntry[] {
  if (data.length === 0) return [];

  const first = data[0] as Record<string, unknown>;
  const isExtended = 'ts' in first;

  return data
    .map((raw) => {
      if (isExtended) {
        const entry = raw as ExtendedEntry;
        const trackName = entry.master_metadata_track_name;
        const artistName = entry.master_metadata_album_artist_name;
        if (!trackName || !artistName) return null;
        if (entry.ms_played < MIN_PLAYED_MS) return null;

        // extraer ID de spotify del URI (spotify:track:abc123 → abc123)
        const trackId = entry.spotify_track_uri
          ? entry.spotify_track_uri.split(':').pop()!
          : importId(artistName, trackName);

        const albumName = entry.master_metadata_album_album_name;

        return {
          playedAt: new Date(entry.ts).toISOString(),
          trackName,
          artistName,
          albumName,
          trackId,
          artistId: importId(artistName, artistName),
          albumId: albumName ? importId(artistName, albumName) : null,
          msPlayed: entry.ms_played,
        };
      } else {
        const entry = raw as BasicEntry;
        if (!entry.trackName || !entry.artistName) return null;
        if (entry.msPlayed < MIN_PLAYED_MS) return null;

        // formato básico: "2024-01-15 14:30" → ISO
        const playedAt = new Date(entry.endTime.replace(' ', 'T') + 'Z').toISOString();

        return {
          playedAt,
          trackName: entry.trackName,
          artistName: entry.artistName,
          albumName: null,
          trackId: importId(entry.artistName, entry.trackName),
          artistId: importId(entry.artistName, entry.artistName),
          albumId: null,
          msPlayed: entry.msPlayed,
        };
      }
    })
    .filter((e): e is NormalizedEntry => e !== null);
}

export function importHistory(data: unknown[]): ImportResult {
  const entries = normalizeEntries(data);
  const result: ImportResult = { total: data.length, imported: 0, duplicates: 0, skipped: data.length - entries.length };

  const db = getDb();

  // procesar en lotes dentro de transacciones
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    const now = new Date().toISOString();

    db.transaction((tx) => {
      for (const entry of batch) {
        // crear artista si no existe
        tx.run(sql`
          INSERT INTO artists (spotify_id, name, genres, updated_at)
          VALUES (${entry.artistId}, ${entry.artistName}, '[]', ${now})
          ON CONFLICT (spotify_id) DO NOTHING
        `);

        // crear álbum si existe
        if (entry.albumId && entry.albumName) {
          tx.run(sql`
            INSERT INTO albums (spotify_id, name, updated_at)
            VALUES (${entry.albumId}, ${entry.albumName}, ${now})
            ON CONFLICT (spotify_id) DO NOTHING
          `);
        }

        // crear track si no existe
        tx.run(sql`
          INSERT INTO tracks (spotify_id, name, album_id, duration_ms, updated_at)
          VALUES (${entry.trackId}, ${entry.trackName}, ${entry.albumId}, ${entry.msPlayed}, ${now})
          ON CONFLICT (spotify_id) DO NOTHING
        `);

        // relación track-artista
        tx.run(sql`
          INSERT INTO track_artists (track_id, artist_id, position)
          VALUES (${entry.trackId}, ${entry.artistId}, 0)
          ON CONFLICT (track_id, artist_id) DO NOTHING
        `);

        // dedup: buscar un play del mismo track (o track con mismo nombre) en ventana de ±3 min
        const windowStart = new Date(new Date(entry.playedAt).getTime() - DEDUP_WINDOW_SECONDS * 1000).toISOString();
        const windowEnd = new Date(new Date(entry.playedAt).getTime() + DEDUP_WINDOW_SECONDS * 1000).toISOString();
        const existing = tx.get(sql`
          SELECT lh.id FROM listening_history lh
          JOIN tracks t ON t.spotify_id = lh.track_id
          WHERE (lh.track_id = ${entry.trackId} OR t.name = ${entry.trackName})
            AND lh.played_at >= ${windowStart}
            AND lh.played_at <= ${windowEnd}
          LIMIT 1
        `);

        if (existing) {
          result.duplicates++;
        } else {
          const insertResult = tx.run(sql`
            INSERT INTO listening_history (track_id, played_at, duration_played_ms)
            VALUES (${entry.trackId}, ${entry.playedAt}, ${entry.msPlayed})
            ON CONFLICT (played_at) DO NOTHING
          `);

          if (insertResult.changes > 0) {
            result.imported++;
          } else {
            result.duplicates++;
          }
        }
      }
    });
  }

  console.log(`[import] total: ${result.total}, importados: ${result.imported}, duplicados: ${result.duplicates}, omitidos: ${result.skipped}`);
  return result;
}
