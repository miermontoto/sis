import { sql, inArray } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';
import { getDb } from '../../db/connection.js';
import { artists, albums, tracks } from '../../db/schema.js';
import { reconcileTrackArtists, pickAlbumCover, SPOTIFY_VIDEO_IMAGE_TYPE } from './upsert.js';
import { spotifyFetch } from '../spotify-client.js';
import type { SpotifyArtistsBatchResponse, SpotifyAlbumsBatchResponse, SpotifyAlbumTracksResponse, SpotifyArtistAlbumsResponse } from '../../types/spotify.js';
import { MB_API_BASE, MB_USER_AGENT, MB_DELAY_MS, MB_MIN_SCORE, ARTIST_IMAGE_MAX_PER_CYCLE, ARTIST_BATCH_SIZE } from '../../constants.js';
import { createLogger } from '../logger.js';

const log = createLogger('metadata');
const now = () => new Date().toISOString();
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// directorio para portadas descargadas
const COVERS_DIR = path.resolve(process.env.DATABASE_PATH || './data/sis.db', '..', 'covers');
fs.mkdirSync(COVERS_DIR, { recursive: true });

// asegurar que todos los tracks de un álbum están en la DB (fetch de Spotify si faltan)
export async function ensureFullAlbumTracks(albumId: string, totalTracks: number | null, userId: number): Promise<void> {
  if (!totalTracks || albumId.startsWith('local:') || albumId.startsWith('import:')) return;

  const db = getDb();
  // los tracks sintéticos (import:/local:) no cuentan como "disc pendiente": nunca vienen
  // en el tracklist de Spotify, así que contarlos hacía refetch en CADA visita del álbum
  const row = db.all(sql`
    SELECT count(*) as c,
           sum(CASE WHEN disc_number IS NULL
                     AND spotify_id NOT LIKE 'local:%' AND spotify_id NOT LIKE 'import:%'
               THEN 1 ELSE 0 END) as missing_disc
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

    reconcileTrackArtists(db, item.id, item.artists.filter(a => a.id).map(a => a.id));
  }

  let next = data.next;
  while (next) {
    const url = new URL(next);
    // `endpoint`, no `path`: ese nombre es el módulo 'path' importado arriba
    const endpoint = url.pathname.replace(/^\/v1/, '') + url.search;
    const page = await spotifyFetch<SpotifyAlbumTracksResponse>(endpoint, { userId });
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
      reconcileTrackArtists(db, item.id, item.artists.filter(a => a.id).map(a => a.id));
    }
    next = page.next;
  }
}

// refrescar fotos y metadata de artistas consultando /artists en lotes de 50.
// userId: cualquier usuario activo cuyo token se usa para la API
//
// barrido rotatorio, no "solo los que faltan": la foto de un artista cambia con el
// tiempo y la única fuente es este endpoint (recently-played no trae imágenes de
// artista), así que un filtro `image_url IS NULL` pedía cada artista UNA vez en su
// vida y el historial de artist_images se quedaba congelado. se ordena por
// image_checked_at ASC (NULL = nunca comprobado, primero) y se capa por ciclo: el
// catálogo entero rota en unos días sin gastar la cuota de golpe.
//
// image_url sigue con la convención de centinela ('' = consultado y spotify no tiene
// foto), pero ya no decide a quién se pide: los delistados —que spotify devuelve como
// null dentro del lote— también sellan image_checked_at para no atascar la cabeza de
// la cola ciclo tras ciclo.
export async function enrichArtistMetadata(userId: number) {
  const db = getDb();
  const pending = db.all(sql`
    SELECT spotify_id FROM artists
    WHERE spotify_id NOT LIKE 'local:%' AND spotify_id NOT LIKE 'import:%'
    ORDER BY image_checked_at ASC
    LIMIT ${ARTIST_IMAGE_MAX_PER_CYCLE}
  `) as { spotify_id: string }[];

  if (pending.length === 0) return;
  log.info(`refrescando fotos de ${pending.length} artistas...`);

  let changed = 0;

  for (let i = 0; i < pending.length; i += ARTIST_BATCH_SIZE) {
    const batch = pending.slice(i, i + ARTIST_BATCH_SIZE).map(a => a.spotify_id);
    const data = await spotifyFetch<SpotifyArtistsBatchResponse>('/artists', { userId, params: { ids: batch.join(',') } });

    // sin respuesta no se sella nada: el lote entero vuelve a la cola del siguiente ciclo
    if (!data?.artists) continue;
    db.update(artists).set({ imageCheckedAt: now() }).where(inArray(artists.spotifyId, batch)).run();

    for (const artist of data.artists) {
      if (!artist) continue;
      const image = artist.images[0]?.url ?? '';
      // historial: el UNIQUE(artist_id, image_url) hace la deduplicación, así que solo
      // deja fila cuando spotify sirve una foto que no habíamos visto nunca
      if (image) {
        const inserted = db.run(sql`INSERT OR IGNORE INTO artist_images (artist_id, image_url, source) VALUES (${artist.id}, ${image}, 'spotify')`);
        if (inserted.changes) changed++;
      }
      db.update(artists)
        .set({
          // una foto elegida a mano manda sobre la de spotify: sin esto el barrido
          // revertiría el pick del usuario en cuanto le tocara turno
          imageUrl: sql`CASE WHEN image_pinned = 1 THEN image_url ELSE ${image} END`,
          genres: artist.genres,
          popularity: artist.popularity,
          updatedAt: now(),
        })
        .where(sql`spotify_id = ${artist.id}`)
        .run();
    }
  }

  log.info(`${changed} fotos de artista nuevas`);
}

// enriquecer álbumes sin artist_ids consultando /albums en lotes de 20 (límite del
// endpoint). la atribución de artista es imprescindible para ligar singles a sus
// álbumes/artistas en las gráficas de detalle y para el dedupe de álbumes; de paso
// se rellenan fecha/tipo/tracks/portada si faltan. los álbumes que spotify ya no
// devuelve (delistados) conservan artist_ids NULL y se reintentan en el siguiente ciclo.
export async function enrichAlbumMetadata(userId: number) {
  const db = getDb();
  const missing = db.all(
    sql`SELECT spotify_id FROM albums WHERE artist_ids IS NULL AND spotify_id NOT LIKE 'local:%' AND spotify_id NOT LIKE 'import:%'`
  ) as { spotify_id: string }[];

  if (missing.length === 0) return;
  log.info(`${missing.length} álbumes sin artist_ids, enriqueciendo...`);

  const BATCH_SIZE = 20;
  let updated = 0;

  for (let i = 0; i < missing.length; i += BATCH_SIZE) {
    const ids = missing.slice(i, i + BATCH_SIZE).map(a => a.spotify_id).join(',');
    const data = await spotifyFetch<SpotifyAlbumsBatchResponse>('/albums', { userId, params: { ids } });

    if (!data?.albums) continue;

    for (const album of data.albums) {
      if (!album?.artists?.length) continue;
      db.update(albums)
        .set({
          artistIds: album.artists.map(a => a.id),
          releaseDate: sql`COALESCE(release_date, ${album.release_date ?? null})`,
          albumType: sql`COALESCE(album_type, ${album.album_type ?? null})`,
          totalTracks: sql`COALESCE(total_tracks, ${album.total_tracks ?? null})`,
          imageUrl: sql`COALESCE(image_url, ${pickAlbumCover(album.images)})`,
          updatedAt: now(),
        })
        .where(sql`spotify_id = ${album.id}`)
        .run();
      // asegurar filas de artista para los acreditados (enrichArtistMetadata les pone imagen)
      for (const a of album.artists) {
        if (!a.id || !a.name) continue;
        db.insert(artists)
          .values({ spotifyId: a.id, name: a.name, updatedAt: now() })
          .onConflictDoNothing()
          .run();
      }
      updated++;
    }
  }

  log.info(`${updated} álbumes con artist_ids completados`);
}

// reemplazar portadas de vídeo por el arte cuadrado del álbum. las variantes "vídeo"
// de un single traen una miniatura 16:9 (tipo de imagen ab6742d3) que se colaba como
// portada; se detectan por la URL y se refresca la portada propia vía /albums (en
// lotes de 20). si spotify solo ofrece miniatura de vídeo, se deja NULL (mejor sin
// portada que una de vídeo). limpia además el historial de portadas observadas.
export async function fixVideoCovers(userId: number) {
  const db = getDb();
  const likeVideo = `%/image/${SPOTIFY_VIDEO_IMAGE_TYPE}%`;

  // el historial de portadas nunca debe conservar miniaturas de vídeo
  db.run(sql`DELETE FROM album_covers WHERE image_url LIKE ${likeVideo}`);

  const affected = db.all(sql`
    SELECT spotify_id FROM albums
    WHERE image_url LIKE ${likeVideo}
      AND spotify_id NOT LIKE 'local:%' AND spotify_id NOT LIKE 'import:%'
  `) as { spotify_id: string }[];

  if (affected.length === 0) return;
  log.info(`${affected.length} álbumes con portada de vídeo, corrigiendo...`);

  const BATCH_SIZE = 20;
  let fixed = 0;

  for (let i = 0; i < affected.length; i += BATCH_SIZE) {
    const ids = affected.slice(i, i + BATCH_SIZE).map(a => a.spotify_id).join(',');
    const data = await spotifyFetch<SpotifyAlbumsBatchResponse>('/albums', { userId, params: { ids } });
    if (!data?.albums) continue;

    for (const album of data.albums) {
      if (!album?.id) continue;
      const cover = pickAlbumCover(album.images);
      db.update(albums)
        .set({ imageUrl: cover, updatedAt: now() })
        .where(sql`spotify_id = ${album.id}`)
        .run();
      if (cover) {
        db.run(sql`INSERT OR IGNORE INTO album_covers (album_id, image_url, source) VALUES (${album.id}, ${cover}, 'spotify')`);
        fixed++;
      }
    }
  }

  log.info(`${fixed} portadas de vídeo reemplazadas por arte del álbum`);
}

// paginación de /artists/{id}/albums
const ARTIST_ALBUMS_PAGE = 50;
const ARTIST_ALBUMS_MAX_PAGES = 10;

// artista principal (primer id) del JSON artist_ids de un álbum
function primaryArtistId(artistIdsJson: string | null): string | null {
  if (!artistIdsJson) return null;
  try {
    const arr = JSON.parse(artistIdsJson);
    return Array.isArray(arr) && arr[0] ? String(arr[0]) : null;
  } catch { return null; }
}

// clave de emparejamiento de lanzamientos hermanos: (nombre, fecha)
const coverKey = (name: string | null, date: string | null) => `${(name ?? '').toLowerCase()}|${date ?? ''}`;

// recuperar la portada de singles sin arte desde la discografía del artista. tras
// descartar las miniaturas de vídeo, un single "vídeo" queda sin portada aunque su
// variante de audio (mismo nombre y fecha) tenga arte cuadrado; se piden los álbumes
// del artista y se casa por (nombre, fecha). los que no tengan hermano con arte propio
// se marcan con image_url='' (buscado sin resultado, != NULL) para no reintentarlos
// cada ciclo (misma convención que enrichLocalAlbumCovers).
export async function recoverSingleCovers(userId: number) {
  const db = getDb();
  const missing = db.all(sql`
    SELECT spotify_id, name, release_date, artist_ids FROM albums
    WHERE album_type = 'single' AND image_url IS NULL AND artist_ids IS NOT NULL
      AND spotify_id NOT LIKE 'local:%' AND spotify_id NOT LIKE 'import:%'
  `) as { spotify_id: string; name: string | null; release_date: string | null; artist_ids: string }[];

  if (missing.length === 0) return;

  // agrupar por artista principal: una consulta de discografía por artista
  const byArtist = new Map<string, typeof missing>();
  for (const m of missing) {
    const artistId = primaryArtistId(m.artist_ids);
    if (!artistId) continue;
    const list = byArtist.get(artistId);
    if (list) list.push(m); else byArtist.set(artistId, [m]);
  }

  log.info(`recuperando portadas de ${missing.length} singles sin arte (${byArtist.size} artistas)...`);
  let recovered = 0;

  for (const [artistId, items] of byArtist) {
    // mapa (nombre|fecha) -> primera portada cuadrada hallada en la discografía
    const coverByKey = new Map<string, string>();
    let offset = 0;
    let fetchedOk = false;

    for (let page = 0; page < ARTIST_ALBUMS_MAX_PAGES; page++) {
      const res = await spotifyFetch<SpotifyArtistAlbumsResponse>(`/artists/${artistId}/albums`, {
        userId,
        params: { include_groups: 'album,single,compilation', limit: String(ARTIST_ALBUMS_PAGE), offset: String(offset) },
      });
      if (res === null) break; // error/rate-limit: no marcamos '' para reintentar luego
      fetchedOk = true;
      if (!res.items?.length) break;
      for (const al of res.items) {
        const cover = pickAlbumCover(al.images);
        if (!cover) continue;
        const k = coverKey(al.name, al.release_date);
        if (!coverByKey.has(k)) coverByKey.set(k, cover);
      }
      if (!res.next) break;
      offset += res.items.length;
    }

    if (!fetchedOk) continue; // no se pudo consultar: dejar NULL (reintento próximo ciclo)

    for (const m of items) {
      const cover = coverByKey.get(coverKey(m.name, m.release_date));
      if (cover) {
        db.update(albums).set({ imageUrl: cover, updatedAt: now() }).where(sql`spotify_id = ${m.spotify_id}`).run();
        db.run(sql`INSERT OR IGNORE INTO album_covers (album_id, image_url, source) VALUES (${m.spotify_id}, ${cover}, 'spotify')`);
        recovered++;
      } else {
        // sin hermano con arte propio: marcar buscado-sin-resultado para no reintentar
        db.update(albums).set({ imageUrl: '', updatedAt: now() }).where(sql`spotify_id = ${m.spotify_id}`).run();
      }
    }
  }

  log.info(`${recovered}/${missing.length} portadas de single recuperadas de la discografía del artista`);
}

// --- MusicBrainz + Cover Art Archive (portadas de álbumes locales / importados) ---

const CAA_BASE = 'https://coverartarchive.org';

async function fetchMusicBrainzCover(artistName: string, albumName: string, albumId: string): Promise<string | null> {
  // buscar release en MusicBrainz
  const query = `release:${albumName} AND artist:${artistName}`;
  const url = `${MB_API_BASE}/release?query=${encodeURIComponent(query)}&fmt=json&limit=1`;

  const res = await fetch(url, {
    headers: { 'User-Agent': MB_USER_AGENT, 'Accept': 'application/json' },
  });

  if (!res.ok) return null;

  const data = await res.json() as { releases?: { id: string; score: number }[] };
  const release = data.releases?.[0];
  if (!release || release.score < MB_MIN_SCORE) return null;

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
  log.info(`${missing.length} álbumes locales sin portada, buscando en MusicBrainz...`);

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
        log.info(`portada encontrada: ${artist.name} - ${album.name}`);
      }
    } catch (err) {
      log.error(`error buscando portada de "${album.name}":`, err);
    }

    await sleep(MB_DELAY_MS);
  }

  log.info(`${updated} álbumes locales actualizados con portada`);
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
  log.info(`${missing.length} tracks importados sin duración, buscando en MusicBrainz...`);

  let updated = 0;
  for (const track of missing) {
    const query = `recording:${track.name} AND artist:${track.artist_name}`;
    const url = `${MB_API_BASE}/recording?query=${encodeURIComponent(query)}&fmt=json&limit=1`;

    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': MB_USER_AGENT, 'Accept': 'application/json' },
      });

      if (res.ok) {
        const data = await res.json() as { recordings?: { id: string; score: number; length?: number }[] };
        const recording = data.recordings?.[0];
        const matched = recording && recording.score >= MB_MIN_SCORE ? recording : null;
        // identidad gratis: la búsqueda ya está pagada, capturar el mbid del match
        // aunque no traiga length (la acreción nunca pisa un mbid previo)
        if (matched) {
          db.run(sql`UPDATE tracks SET mbid = COALESCE(mbid, ${matched.id}) WHERE spotify_id = ${track.spotify_id}`);
        }
        if (matched?.length) {
          db.run(sql`UPDATE tracks SET duration_ms = ${matched.length}, updated_at = ${now()} WHERE spotify_id = ${track.spotify_id}`);
          updated++;
          log.info(`duración encontrada: ${track.artist_name} - ${track.name} (${Math.round(matched.length / 1000)}s)`);
        } else {
          db.run(sql`UPDATE tracks SET duration_ms = -1, updated_at = ${now()} WHERE spotify_id = ${track.spotify_id}`);
        }
      }
    } catch (err) {
      log.error(`error buscando duración de "${track.name}":`, err);
    }

    await sleep(MB_DELAY_MS);
  }

  log.info(`${updated} tracks importados actualizados con duración`);
}
