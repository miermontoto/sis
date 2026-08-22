import { sql } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { syntheticId } from './ids.js';
import { MIN_PLAY_MS } from '../constants.js';
import { createLogger } from './logger.js';

const log = createLogger('import');
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

// IDs externos que puede traer un evento (scrobble/import): evidencia de identidad
// que resuelve ANTES que el nombre. '' y undefined se normalizan a null.
interface ExternalTrackIds {
  isrc?: string | null;
  mbid?: string | null;
}

// lookup indexado por ID externo (isrc/mbid), prefiriendo entidades reales sobre
// sintéticas y desempatando por plays (mismo criterio que el resto de resolvers)
function findTrackByExternalId(column: 'isrc' | 'mbid', value: string): string | null {
  const db = getDb();
  const row = db.get(sql`
    SELECT spotify_id FROM tracks
    WHERE ${sql.raw(column)} = ${value}
    ORDER BY CASE
      WHEN spotify_id LIKE 'local:%' THEN 2
      WHEN spotify_id LIKE 'import:%' THEN 1
      ELSE 0
    END,
    (SELECT COUNT(*) FROM listening_history WHERE track_id = tracks.spotify_id) DESC
    LIMIT 1
  `) as { spotify_id: string } | undefined;
  return row?.spotify_id ?? null;
}

// escalera de resolución: isrc → mbid → nombre (artista PRINCIPAL) → sintético.
// los IDs que asserta el servicio/industria van antes que la igualdad de strings.
// el match por nombre exige position = 0: casar por cualquier artista acreditado
// hacía que tracks homónimos "sangraran" artistas equivocados entre sí (y de paso
// duplicaba posiciones 0 en track_artists al estampar al artista del scrobble).
function resolveTrackId(artistName: string, trackName: string, ids?: ExternalTrackIds): string {
  const isrc = ids?.isrc || null;
  const mbid = ids?.mbid || null;

  for (const [prefix, value] of [['isrc', isrc], ['mbid', mbid]] as const) {
    if (!value) continue;
    const cacheKey = `${prefix}:${value}`;
    if (trackIdCache.has(cacheKey)) return trackIdCache.get(cacheKey)!;
    const found = findTrackByExternalId(prefix, value);
    if (found) {
      trackIdCache.set(cacheKey, found);
      return found;
    }
  }

  const key = `${artistName.toLowerCase()}|${trackName.toLowerCase()}`;
  if (trackIdCache.has(key)) return trackIdCache.get(key)!;

  const db = getDb();
  const existing = db.get(
    sql`SELECT t.spotify_id FROM tracks t
        JOIN track_artists ta ON ta.track_id = t.spotify_id AND ta.position = 0
        JOIN artists a ON a.spotify_id = ta.artist_id
        WHERE LOWER(t.name) = ${trackName.toLowerCase()}
          AND LOWER(a.name) = ${artistName.toLowerCase()}
        ORDER BY CASE
          WHEN t.spotify_id LIKE 'local:%' THEN 2
          WHEN t.spotify_id LIKE 'import:%' THEN 1
          ELSE 0
        END
        LIMIT 1`
  ) as { spotify_id: string } | undefined;

  const id = existing?.spotify_id ?? importId(artistName, trackName);
  trackIdCache.set(key, id);
  return id;
}


// upsert de las entidades (artist/album/track) de un scrobble SIN registrar
// reproducción: lo usa el now-playing de last.fm, que necesita que el track
// exista en el catálogo para renderizarlo pero no es un play completado (no toca
// listening_history). devuelve el trackId resuelto o null si faltan datos.
export function upsertScrobbleTrack(track: {
  name: string;
  mbid?: string;
  artist: { '#text': string; mbid?: string };
  album?: { '#text'?: string; mbid?: string };
}): string | null {
  const trackName = track.name;
  const artistName = track.artist['#text'];
  if (!trackName || !artistName) return null;

  const albumName = track.album?.['#text'] || null;
  const artistId = resolveArtistId(artistName);
  const trackId = resolveTrackId(artistName, trackName, { mbid: track.mbid });
  const albumId = albumName ? resolveAlbumId(artistId, artistName, albumName) : null;
  const now = new Date().toISOString();
  const db = getDb();

  // acreción de evidencia: los mbid del scrobble rellenan huecos en entidades ya
  // existentes (el WHERE del upsert evita escrituras sin nada que aportar)
  db.run(sql`
    INSERT INTO artists (spotify_id, name, genres, mbid, updated_at)
    VALUES (${artistId}, ${artistName}, '[]', ${track.artist.mbid || null}, ${now})
    ON CONFLICT (spotify_id) DO UPDATE SET mbid = excluded.mbid
    WHERE artists.mbid IS NULL AND excluded.mbid IS NOT NULL
  `);
  if (albumId && albumName) {
    db.run(sql`
      INSERT INTO albums (spotify_id, name, mbid, updated_at)
      VALUES (${albumId}, ${albumName}, ${track.album?.mbid || null}, ${now})
      ON CONFLICT (spotify_id) DO UPDATE SET mbid = excluded.mbid
      WHERE albums.mbid IS NULL AND excluded.mbid IS NOT NULL
    `);
  }
  db.run(sql`
    INSERT INTO tracks (spotify_id, name, album_id, duration_ms, mbid, updated_at)
    VALUES (${trackId}, ${trackName}, ${albumId}, 0, ${track.mbid || null}, ${now})
    ON CONFLICT (spotify_id) DO UPDATE SET mbid = excluded.mbid
    WHERE tracks.mbid IS NULL AND excluded.mbid IS NOT NULL
  `);
  insertPrimaryArtistIfMissing(db, trackId, artistId);
  return trackId;
}

// estampa al artista del evento como principal SOLO si el track no tiene ya un
// position 0: la PK de track_artists es (track_id, artist_id) con posición no
// única, así que el insert incondicional dejaba dos artistas en la posición 0
// cuando un track homónimo resolvía a una entidad de otro artista
function insertPrimaryArtistIfMissing(db: Pick<ReturnType<typeof getDb>, 'run'>, trackId: string, artistId: string) {
  db.run(sql`
    INSERT INTO track_artists (track_id, artist_id, position)
    SELECT ${trackId}, ${artistId}, 0
    WHERE NOT EXISTS (SELECT 1 FROM track_artists WHERE track_id = ${trackId} AND position = 0)
    ON CONFLICT (track_id, artist_id) DO NOTHING
  `);
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
  mbid?: string;
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
  // evidencia de identidad del evento (mbid de recording/artist/release e isrc),
  // para acreción sobre las entidades resueltas
  trackMbid?: string | null;
  artistMbid?: string | null;
  albumMbid?: string | null;
  isrc?: string | null;
  // duración del TRACK según el cliente (≠ msPlayed, que es la del play): solo
  // siembra tracks sin duración conocida (0 o -1 de musicbrainz agotado)
  durationMs?: number | null;
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
        const trackId = resolveTrackId(artistName, trackName, { mbid: entry.mbid });
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
          trackMbid: entry.mbid || null,
          artistMbid: entry.artist.mbid || null,
          albumMbid: entry.album?.mbid || null,
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
  log.info(`índice de dedup: ${rows.length} plays, ${index.size} tracks`);
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

// procedencia con la que se registran los plays de esta importación
export type PlaySource = 'import' | 'lastfm' | 'listenbrainz';

export function importHistory(data: unknown, userId: number, source: PlaySource = 'import'): ImportResult {
  let flat: unknown[];
  if (Array.isArray(data) && data.length > 0 && Array.isArray(data[0])) {
    flat = (data as unknown[][]).flat();
  } else if (Array.isArray(data)) {
    flat = data;
  } else {
    throw new Error('formato de datos no reconocido');
  }

  return ingestNormalized(normalizeEntries(flat), userId, source, flat.length);
}

// evento de listen ya estructurado (endpoint compatible listenbrainz y futuros
// clientes push): nombres + toda la evidencia de identidad que el cliente conozca
export interface ListenEvent {
  playedAt: string;
  trackName: string;
  artistName: string;
  albumName?: string | null;
  spotifyTrackId?: string | null;
  isrc?: string | null;
  trackMbid?: string | null;
  artistMbid?: string | null;
  albumMbid?: string | null;
  durationMs?: number | null;
}

// ingesta de eventos push: resuelve cada evento por la escalera de identidad
// (spotify id directo → isrc/mbid → nombre) y entra por el mismo núcleo de
// dedup/insert que los imports de fichero y el sync de last.fm. un spotify id
// desconocido crea la fila real con metadata mínima: fixTrackAlbumAssignments/
// fixTrackArtistAssociations la verifican después contra la API (verified_*).
export function importListenEvents(events: ListenEvent[], userId: number, source: PlaySource): ImportResult {
  const entries = events.map((ev): NormalizedEntry => {
    const artistId = resolveArtistId(ev.artistName);
    const trackId = ev.spotifyTrackId
      ?? resolveTrackId(ev.artistName, ev.trackName, { isrc: ev.isrc, mbid: ev.trackMbid });
    return {
      playedAt: ev.playedAt,
      trackName: ev.trackName,
      artistName: ev.artistName,
      albumName: ev.albumName || null,
      trackId,
      artistId,
      albumId: ev.albumName ? resolveAlbumId(artistId, ev.artistName, ev.albumName) : null,
      msPlayed: null,
      isScrobble: true,
      trackMbid: ev.trackMbid || null,
      artistMbid: ev.artistMbid || null,
      albumMbid: ev.albumMbid || null,
      isrc: ev.isrc || null,
      durationMs: ev.durationMs && ev.durationMs > 0 ? Math.round(ev.durationMs) : null,
    };
  });
  return ingestNormalized(entries, userId, source, events.length);
}

// núcleo compartido de ingesta: dedup temporal + upsert de entidades + insert de
// plays sobre entradas ya normalizadas/resueltas. `total` son las entradas crudas
// de la fuente (para reportar como skipped lo que la normalización descartó).
function ingestNormalized(entries: NormalizedEntry[], userId: number, source: PlaySource, total: number): ImportResult {
  const result: ImportResult = { total, imported: 0, duplicates: 0, skipped: total - entries.length };

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

        // acreción de evidencia: los mbid del evento rellenan huecos en entidades
        // existentes. el WHERE del upsert limita la escritura al caso con algo que
        // aportar (sin él, cada entrada de un import masivo re-escribiría su fila)
        if (entry.artistName) {
          tx.run(sql`
            INSERT INTO artists (spotify_id, name, genres, mbid, updated_at)
            VALUES (${entry.artistId}, ${entry.artistName}, '[]', ${entry.artistMbid ?? null}, ${now})
            ON CONFLICT (spotify_id) DO UPDATE SET mbid = excluded.mbid
            WHERE artists.mbid IS NULL AND excluded.mbid IS NOT NULL
          `);
        }

        if (entry.albumId && entry.albumName) {
          tx.run(sql`
            INSERT INTO albums (spotify_id, name, mbid, updated_at)
            VALUES (${entry.albumId}, ${entry.albumName}, ${entry.albumMbid ?? null}, ${now})
            ON CONFLICT (spotify_id) DO UPDATE SET mbid = excluded.mbid
            WHERE albums.mbid IS NULL AND excluded.mbid IS NOT NULL
          `);
        }

        // NO sembrar duration_ms con msPlayed: es la duración de UN play (a menudo
        // parcial), no la del track. Hacerlo marcaba como "over-long" todos los demás
        // plays más largos. Se siembra solo durationMs (duración del track según el
        // cliente push) y si no, 0 para que lo rellene el enrichment. el WHERE del
        // upsert limita la escritura a cuando algún campo tiene algo que aportar;
        // los COALESCE/CASE mantienen la acreción por-columna dentro de ese update.
        tx.run(sql`
          INSERT INTO tracks (spotify_id, name, album_id, duration_ms, isrc, mbid, updated_at)
          VALUES (${entry.trackId}, ${entry.trackName}, ${entry.albumId}, ${entry.durationMs ?? 0}, ${entry.isrc ?? null}, ${entry.trackMbid ?? null}, ${now})
          ON CONFLICT (spotify_id) DO UPDATE SET
            mbid = COALESCE(tracks.mbid, excluded.mbid),
            isrc = COALESCE(tracks.isrc, excluded.isrc),
            duration_ms = CASE WHEN tracks.duration_ms <= 0 AND excluded.duration_ms > 0
                               THEN excluded.duration_ms ELSE tracks.duration_ms END
          WHERE (tracks.mbid IS NULL AND excluded.mbid IS NOT NULL)
             OR (tracks.isrc IS NULL AND excluded.isrc IS NOT NULL)
             OR (tracks.duration_ms <= 0 AND excluded.duration_ms > 0)
        `);

        insertPrimaryArtistIfMissing(tx, entry.trackId, entry.artistId);

        const insertResult = tx.run(sql`
          INSERT INTO listening_history (track_id, played_at, user_id, duration_played_ms, source)
          VALUES (${entry.trackId}, ${entry.playedAt}, ${userId}, ${entry.msPlayed}, ${source})
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
      log.info(`progreso: ${Math.min(i + BATCH_SIZE, entries.length)}/${entries.length}`);
    }
  }

  log.info(`total: ${result.total}, importados: ${result.imported}, duplicados: ${result.duplicates}, omitidos: ${result.skipped}`);
  return result;
}
