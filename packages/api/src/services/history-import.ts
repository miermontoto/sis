import { sql } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { artists, albums, tracks, trackArtists, listeningHistory } from '../db/schema.js';
import { syntheticId } from './ids.js';
import { MIN_PLAY_MS } from '../constants.js';

// cache de resolución nombre → ID existente en DB
const artistIdCache = new Map<string, string>();
const albumIdCache = new Map<string, string>();
const trackIdCache = new Map<string, string>();

// buscar entidad existente por nombre (case-insensitive), con cache
function resolveArtistId(name: string): string {
  const key = name.toLowerCase();
  if (artistIdCache.has(key)) return artistIdCache.get(key)!;

  const db = getDb();
  // preferir IDs reales de spotify sobre sintéticos (import:/local:)
  const existing = db.get(
    sql`SELECT spotify_id FROM artists WHERE LOWER(name) = ${key}
        ORDER BY CASE
          WHEN spotify_id LIKE 'local:%' THEN 2
          WHEN spotify_id LIKE 'import:%' THEN 1
          ELSE 0
        END
        LIMIT 1`
  ) as { spotify_id: string } | undefined;

  const id = existing?.spotify_id ?? importId(name, name);
  artistIdCache.set(key, id);
  return id;
}

function resolveAlbumId(artistId: string, artistName: string, albumName: string): string {
  const key = `${artistName.toLowerCase()}|${albumName.toLowerCase()}`;
  if (albumIdCache.has(key)) return albumIdCache.get(key)!;

  const db = getDb();
  // match por nombre + mismo artista primario (via artist_ids[0] o track_artists position=0)
  // evita colapsar álbumes distintos con el mismo nombre de artistas distintos
  const existing = db.get(sql`
    SELECT spotify_id FROM albums
    WHERE LOWER(name) = ${albumName.toLowerCase()}
      AND (
        json_extract(artist_ids, '$[0]') = ${artistId}
        OR EXISTS (
          SELECT 1 FROM tracks t
          JOIN track_artists ta ON ta.track_id = t.spotify_id AND ta.position = 0
          WHERE t.album_id = albums.spotify_id AND ta.artist_id = ${artistId}
        )
      )
    ORDER BY
      (SELECT COUNT(*) FROM tracks WHERE album_id = albums.spotify_id) DESC,
      (SELECT COUNT(*) FROM listening_history lh JOIN tracks tr ON tr.spotify_id = lh.track_id WHERE tr.album_id = albums.spotify_id) DESC,
      spotify_id ASC
    LIMIT 1
  `) as { spotify_id: string } | undefined;

  const id = existing?.spotify_id ?? importId(artistName, albumName);
  albumIdCache.set(key, id);
  return id;
}

function resolveTrackId(artistName: string, trackName: string): string {
  const key = `${artistName.toLowerCase()}|${trackName.toLowerCase()}`;
  if (trackIdCache.has(key)) return trackIdCache.get(key)!;

  const db = getDb();
  const existing = db.get(
    sql`SELECT t.spotify_id FROM tracks t
        JOIN track_artists ta ON ta.track_id = t.spotify_id
        JOIN artists a ON a.spotify_id = ta.artist_id
        WHERE LOWER(t.name) = ${trackName.toLowerCase()}
          AND LOWER(a.name) = ${artistName.toLowerCase()}
        LIMIT 1`
  ) as { spotify_id: string } | undefined;

  const id = existing?.spotify_id ?? importId(artistName, trackName);
  trackIdCache.set(key, id);
  return id;
}


const MIN_PLAYED_MS = MIN_PLAY_MS;
const BATCH_SIZE = 500;
const DEDUP_WINDOW_S = 300;

// dedup de scrobbles: el play equivalente de spotify llega hasta una duración
// de track después del timestamp del scrobble — se mira hacia delante hasta
// este tope para no duplicar tracks más largos que DEDUP_WINDOW_S
const SCROBBLE_FORWARD_S = 20 * 60;

// umbral de entradas a partir del cual compensa construir el índice completo
// de plays en memoria; por debajo (ticks del sync) se consulta por SQL
const INDEX_BUILD_THRESHOLD = 200;

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
interface LastFmEntry {
  name: string;
  artist: { '#text': string; mbid?: string };
  album: { '#text': string; mbid?: string };
  date?: { uts: string; '#text'?: string };
  '@attr'?: { nowplaying: string };
}

interface NormalizedEntry {
  playedAt: string;
  trackName: string;
  artistName: string;
  albumName: string | null;
  trackId: string;
  artistId: string;
  albumId: string | null;
  msPlayed: number | null;
  // scrobbles de last.fm: timestamp de INICIO de reproducción (spotify y
  // extended usan fin) → activa la ventana de dedup asimétrica hacia delante
  isScrobble?: boolean;
}

function isLastFmEntry(item: unknown): item is LastFmEntry {
  const obj = item as Record<string, unknown>;
  return obj.artist !== null && typeof obj.artist === 'object' && '#text' in (obj.artist as Record<string, unknown>);
}

function normalizeEntries(data: unknown[]): NormalizedEntry[] {
  if (data.length === 0) return [];

  const first = data[0] as Record<string, unknown>;

  if (isLastFmEntry(first)) {
    return (data as LastFmEntry[])
      .map((entry): NormalizedEntry | null => {
        if (entry['@attr']?.nowplaying === 'true') return null;
        if (!entry.date?.uts) return null;
        if (!entry.name || !entry.artist['#text']) return null;

        const trackName = entry.name;
        const artistName = entry.artist['#text'];
        const albumName = entry.album?.['#text'] || null;
        const trackId = resolveTrackId(artistName, trackName);
        const playedAt = new Date(parseInt(entry.date!.uts) * 1000).toISOString();
        const artistId = resolveArtistId(artistName);
        return {
          playedAt,
          trackName,
          artistName,
          albumName,
          trackId,
          artistId,
          albumId: albumName ? resolveAlbumId(artistId, artistName, albumName) : null,
          msPlayed: null,
          isScrobble: true,
        };
      })
      .filter((e): e is NormalizedEntry => e !== null);
  }

  const isExtended = 'ts' in first;

  return data
    .map((raw): NormalizedEntry | null => {
      if (isExtended) {
        const entry = raw as ExtendedEntry;
        const trackName = entry.master_metadata_track_name;
        const artistName = entry.master_metadata_album_artist_name;
        if (!trackName || !artistName) return null;
        if (entry.ms_played < MIN_PLAYED_MS) return null;

        // extraer ID de spotify del URI (spotify:track:abc123 → abc123)
        const trackId = entry.spotify_track_uri
          ? entry.spotify_track_uri.split(':').pop()!
          : resolveTrackId(artistName, trackName);

        const albumName = entry.master_metadata_album_album_name;

        const artistId = resolveArtistId(artistName);
        return {
          playedAt: new Date(entry.ts).toISOString(),
          trackName,
          artistName,
          albumName,
          trackId,
          artistId,
          albumId: albumName ? resolveAlbumId(artistId, artistName, albumName) : null,
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
          trackId: resolveTrackId(entry.artistName, entry.trackName),
          artistId: resolveArtistId(entry.artistName),
          albumId: null,
          msPlayed: entry.msPlayed,
        };
      }
    })
    .filter((e): e is NormalizedEntry => e !== null);
}

function buildPlayIndex(userId: number): Map<string, number[]> {
  const db = getDb();
  const rows = db.all(sql`
    SELECT LOWER(t.name) as name, strftime('%s', lh.played_at) as ts
    FROM listening_history lh
    JOIN tracks t ON t.spotify_id = lh.track_id
    WHERE lh.user_id = ${userId}
  `) as { name: string; ts: string }[];

  const index = new Map<string, number[]>();
  for (const row of rows) {
    const arr = index.get(row.name);
    const ts = parseInt(row.ts);
    if (arr) arr.push(ts);
    else index.set(row.name, [ts]);
  }
  for (const arr of index.values()) arr.sort((a, b) => a - b);
  console.log(`[import] índice de dedup: ${rows.length} plays, ${index.size} tracks`);
  return index;
}

// ¿existe algún play del track en el rango [fromS, toS]? (búsqueda binaria)
function hasPlayInRange(index: Map<string, number[]>, trackName: string, fromS: number, toS: number): boolean {
  const arr = index.get(trackName.toLowerCase());
  if (!arr || arr.length === 0) return false;
  let lo = 0, hi = arr.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < fromS) lo = mid + 1;
    else hi = mid - 1;
  }
  return lo < arr.length && arr[lo] <= toS;
}

// variante puntual por SQL sobre idx (user_id, played_at): para batches
// pequeños (ticks del sync de last.fm) evita reconstruir el índice completo
// de plays del usuario (~350k filas ≈ 1s bloqueando el event loop por tick).
// las filas insertadas en la misma transacción son visibles (misma conexión)
function hasPlayInRangeSql(userId: number, trackName: string, fromS: number, toS: number): boolean {
  const db = getDb();
  const row = db.get(sql`
    SELECT 1 FROM listening_history lh
    JOIN tracks t ON t.spotify_id = lh.track_id
    WHERE lh.user_id = ${userId}
      AND lh.played_at >= ${new Date(fromS * 1000).toISOString()}
      AND lh.played_at <= ${new Date(toS * 1000).toISOString()}
      AND LOWER(t.name) = LOWER(${trackName})
    LIMIT 1
  `);
  return !!row;
}

function addToIndex(index: Map<string, number[]>, trackName: string, playedAtS: number) {
  const key = trackName.toLowerCase();
  const arr = index.get(key);
  if (arr) { arr.push(playedAtS); arr.sort((a, b) => a - b); }
  else index.set(key, [playedAtS]);
}

export function importHistory(data: unknown, userId: number): ImportResult {
  let flat: unknown[];
  if (Array.isArray(data) && data.length > 0 && Array.isArray(data[0])) {
    flat = (data as unknown[][]).flat();
  } else if (Array.isArray(data)) {
    flat = data;
  } else {
    throw new Error('formato de datos no reconocido');
  }

  const entries = normalizeEntries(flat);
  const result: ImportResult = { total: flat.length, imported: 0, duplicates: 0, skipped: flat.length - entries.length };

  // por debajo del umbral las consultas puntuales indexadas ganan de largo al
  // escaneo completo; por encima (imports masivos) el índice se amortiza
  const playIndex = entries.length > INDEX_BUILD_THRESHOLD ? buildPlayIndex(userId) : null;
  const hasPlay = (name: string, fromS: number, toS: number): boolean =>
    playIndex ? hasPlayInRange(playIndex, name, fromS, toS) : hasPlayInRangeSql(userId, name, fromS, toS);

  const db = getDb();

  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    const now = new Date().toISOString();

    db.transaction((tx) => {
      for (const entry of batch) {
        const playedAtS = Math.floor(new Date(entry.playedAt).getTime() / 1000);
        if (hasPlay(entry.trackName, playedAtS - DEDUP_WINDOW_S, playedAtS + DEDUP_WINDOW_S)) {
          result.duplicates++;
          continue;
        }
        // scrobble (ts de inicio) vs play de spotify (ts de fin): el play
        // equivalente cae hasta una duración de track por delante
        if (entry.isScrobble && hasPlay(entry.trackName, playedAtS + DEDUP_WINDOW_S, playedAtS + SCROBBLE_FORWARD_S)) {
          result.duplicates++;
          continue;
        }
        // Basic endTime ≈ Extended ts + duration → comprobar también desplazado
        if (entry.msPlayed && entry.msPlayed > 0) {
          const offsetS = Math.round(entry.msPlayed / 1000);
          if (hasPlay(entry.trackName, playedAtS - offsetS - DEDUP_WINDOW_S, playedAtS - offsetS + DEDUP_WINDOW_S) ||
              hasPlay(entry.trackName, playedAtS + offsetS - DEDUP_WINDOW_S, playedAtS + offsetS + DEDUP_WINDOW_S)) {
            result.duplicates++;
            continue;
          }
        }
        // en la vía SQL no hace falta: las filas insertadas ya son visibles
        if (playIndex) addToIndex(playIndex, entry.trackName, playedAtS);

        if (entry.artistName) {
          tx.run(sql`
            INSERT INTO artists (spotify_id, name, genres, updated_at)
            VALUES (${entry.artistId}, ${entry.artistName}, '[]', ${now})
            ON CONFLICT (spotify_id) DO NOTHING
          `);
        }

        if (entry.albumId && entry.albumName) {
          tx.run(sql`
            INSERT INTO albums (spotify_id, name, updated_at)
            VALUES (${entry.albumId}, ${entry.albumName}, ${now})
            ON CONFLICT (spotify_id) DO NOTHING
          `);
        }

        // NO sembrar duration_ms con msPlayed: es la duración de UN play (a menudo
        // parcial), no la del track. Hacerlo marcaba como "over-long" todos los demás
        // plays más largos. Se deja 0 y lo rellena el enrichment (import:→MusicBrainz,
        // IDs reales→al reproducir vía polling).
        tx.run(sql`
          INSERT INTO tracks (spotify_id, name, album_id, duration_ms, updated_at)
          VALUES (${entry.trackId}, ${entry.trackName}, ${entry.albumId}, 0, ${now})
          ON CONFLICT (spotify_id) DO NOTHING
        `);

        tx.run(sql`
          INSERT INTO track_artists (track_id, artist_id, position)
          VALUES (${entry.trackId}, ${entry.artistId}, 0)
          ON CONFLICT (track_id, artist_id) DO NOTHING
        `);

        const insertResult = tx.run(sql`
          INSERT INTO listening_history (track_id, played_at, user_id, duration_played_ms)
          VALUES (${entry.trackId}, ${entry.playedAt}, ${userId}, ${entry.msPlayed})
          ON CONFLICT (user_id, played_at) DO NOTHING
        `);

        if (insertResult.changes > 0) {
          result.imported++;
        } else {
          result.duplicates++;
        }
      }
    });

    if ((i + BATCH_SIZE) % 10000 < BATCH_SIZE) {
      console.log(`[import] progreso: ${Math.min(i + BATCH_SIZE, entries.length)}/${entries.length}`);
    }
  }

  console.log(`[import] total: ${result.total}, importados: ${result.imported}, duplicados: ${result.duplicates}, omitidos: ${result.skipped}`);
  return result;
}
