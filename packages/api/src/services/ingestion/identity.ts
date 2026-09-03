// identidad multi-fuente: cosecha de IDs externos estables (isrc de spotify,
// mbid/isrc de musicbrainz) y convergencia de tracks sintéticos (import:/local:)
// con su entidad real cuando comparten ID. los IDs externos son EVIDENCIA, no
// claves: la clave canónica sigue siendo el espacio spotify_id + sintéticos.
// convención de centinela: NULL = no consultado, '' = consultado sin resultado.
import { sql } from 'drizzle-orm';
import { getDb } from '../../db/connection.js';
import { reassignTrackRefs } from './upsert.js';
import { normalizeArtistName } from './imports.js';
import { spotifyFetch } from '../spotify-client.js';
import type { SpotifyTracksBatchResponse } from '../../types/spotify.js';
import {
  MB_API_BASE, MB_USER_AGENT, MB_DELAY_MS, MB_MIN_SCORE,
  ISRC_HARVEST_BATCH_SIZE, ISRC_HARVEST_MAX_BATCHES, MB_IDENTITY_MAX_PER_CYCLE,
} from '../../constants.js';
import { createLogger } from '../logger.js';

const log = createLogger('identity');
const now = () => new Date().toISOString();
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// cosechar isrcs de tracks reales vía /tracks de spotify (50 por petición). los
// plays nuevos ya llegan con isrc desde upsertTrack; esto cubre el catálogo previo
// y los tracks entrados por tracklist (simplified, sin external_ids). ORDER BY
// RANDOM: los delistados (spotify no los devuelve) conservan NULL y se reintentan,
// y un orden fijo dejaría que acaparasen la ventana capada de cada ciclo.
export async function harvestTrackIsrcs(userId: number): Promise<void> {
  const db = getDb();
  const missing = db.all(sql`
    SELECT spotify_id FROM tracks
    WHERE isrc IS NULL
      AND spotify_id NOT LIKE 'local:%' AND spotify_id NOT LIKE 'import:%'
    ORDER BY RANDOM()
    LIMIT ${ISRC_HARVEST_BATCH_SIZE * ISRC_HARVEST_MAX_BATCHES}
  `) as { spotify_id: string }[];

  if (missing.length === 0) return;
  log.info(`${missing.length} tracks sin isrc, cosechando de spotify...`);

  let updated = 0;
  for (let i = 0; i < missing.length; i += ISRC_HARVEST_BATCH_SIZE) {
    const ids = missing.slice(i, i + ISRC_HARVEST_BATCH_SIZE).map(t => t.spotify_id).join(',');
    const data = await spotifyFetch<SpotifyTracksBatchResponse>('/tracks', { userId, params: { ids } });
    if (!data?.tracks) continue;

    for (const track of data.tracks) {
      if (!track) continue; // delistado: conserva NULL, reintento el próximo ciclo
      db.run(sql`UPDATE tracks SET isrc = ${track.external_ids?.isrc ?? ''}, updated_at = ${now()} WHERE spotify_id = ${track.id}`);
      if (track.external_ids?.isrc) updated++;
    }
  }

  log.info(`${updated} isrcs cosechados`);
}

// respuesta de búsqueda /recording de musicbrainz (search no incluye isrcs; esos
// requieren el lookup por mbid con inc=isrcs)
interface MbRecordingSearch {
  recordings?: {
    id: string;
    score: number;
    'artist-credit'?: { name?: string; artist?: { id?: string; name?: string } }[];
  }[];
}

async function mbFetch<T>(path: string): Promise<T | null> {
  const res = await fetch(`${MB_API_BASE}${path}`, {
    headers: { 'User-Agent': MB_USER_AGENT, 'Accept': 'application/json' },
  });
  if (!res.ok) return null;
  return await res.json() as T;
}

// identidad musicbrainz de tracks sintéticos, en dos fases capadas por ciclo:
// 1) búsqueda por (artista, título) → mbid del recording (+ mbid del artista,
//    acreción gratis del mismo resultado)
// 2) lookup del recording con inc=isrcs → isrc, el puente que permite converger
//    con la entidad real de spotify aunque los nombres no coincidan
export async function enrichImportTrackIdentity(): Promise<void> {
  const db = getDb();
  let budget = MB_IDENTITY_MAX_PER_CYCLE;

  // fase 1: mbid por búsqueda
  const noMbid = db.all(sql`
    SELECT t.spotify_id, t.name, ta.artist_id, a.name as artist_name
    FROM tracks t
    JOIN track_artists ta ON ta.track_id = t.spotify_id AND ta.position = 0
    JOIN artists a ON a.spotify_id = ta.artist_id
    WHERE t.mbid IS NULL AND (t.spotify_id LIKE 'import:%' OR t.spotify_id LIKE 'local:%')
    LIMIT ${budget}
  `) as { spotify_id: string; name: string; artist_id: string; artist_name: string }[];

  if (noMbid.length > 0) log.info(`${noMbid.length} tracks sintéticos sin mbid, consultando musicbrainz...`);

  let found = 0;
  for (const track of noMbid) {
    budget--;
    try {
      const query = `recording:${track.name} AND artist:${track.artist_name}`;
      const data = await mbFetch<MbRecordingSearch>(`/recording?query=${encodeURIComponent(query)}&fmt=json&limit=1`);
      const recording = data?.recordings?.[0];
      if (recording && recording.score >= MB_MIN_SCORE) {
        db.run(sql`UPDATE tracks SET mbid = ${recording.id}, updated_at = ${now()} WHERE spotify_id = ${track.spotify_id}`);
        // el mbid de artista se acreta sólo del crédito que ES nuestro artista:
        // la búsqueda casa por recording y el primer crédito es a menudo otro (un
        // "J Balvin, Bad Bunny" dejó a Bad Bunny con el mbid de J Balvin, y la
        // búsqueda de bolos por ese mbid devolvía la gira de J Balvin)
        const wanted = normalizeArtistName(track.artist_name);
        const artistMbid = recording['artist-credit']
          ?.find(c => normalizeArtistName(c.artist?.name ?? c.name ?? '') === wanted)
          ?.artist?.id;
        if (artistMbid) {
          db.run(sql`UPDATE artists SET mbid = COALESCE(mbid, ${artistMbid}) WHERE spotify_id = ${track.artist_id}`);
        }
        found++;
      } else if (data) {
        // búsqueda respondida sin match fiable: centinela para no repetirla
        db.run(sql`UPDATE tracks SET mbid = '', updated_at = ${now()} WHERE spotify_id = ${track.spotify_id}`);
      }
    } catch (err) {
      log.error(`error buscando mbid de "${track.name}":`, err);
    }
    await sleep(MB_DELAY_MS);
  }
  if (noMbid.length > 0) log.info(`${found} mbids encontrados`);

  if (budget <= 0) return;

  // fase 2: isrc por lookup del recording
  const noIsrc = db.all(sql`
    SELECT spotify_id, name, mbid FROM tracks
    WHERE isrc IS NULL AND mbid IS NOT NULL AND mbid != ''
      AND (spotify_id LIKE 'import:%' OR spotify_id LIKE 'local:%')
    LIMIT ${budget}
  `) as { spotify_id: string; name: string; mbid: string }[];

  if (noIsrc.length === 0) return;
  log.info(`${noIsrc.length} tracks sintéticos con mbid sin isrc, consultando musicbrainz...`);

  let resolved = 0;
  for (const track of noIsrc) {
    try {
      const data = await mbFetch<{ isrcs?: string[] }>(`/recording/${track.mbid}?inc=isrcs&fmt=json`);
      // 404 (mbid viejo de last.fm ya fusionado/borrado) o sin isrcs registrados:
      // centinela '' para no reconsultar un dato que musicbrainz no tiene
      const isrc = data?.isrcs?.[0] ?? '';
      db.run(sql`UPDATE tracks SET isrc = ${isrc}, updated_at = ${now()} WHERE spotify_id = ${track.spotify_id}`);
      if (isrc) resolved++;
    } catch (err) {
      log.error(`error buscando isrc de "${track.name}":`, err);
    }
    await sleep(MB_DELAY_MS);
  }
  log.info(`${resolved} isrcs resueltos vía musicbrainz`);
}

// converger tracks sintéticos con su entidad real cuando comparten isrc o mbid:
// atrapa los casos que el merge por nombre (mergeImportTracks) no ve — renombres,
// "(feat. X)" vs sin sufijo, grafías distintas entre servicios. dos SELECT
// separados (no OR en el JOIN) para que cada uno use su índice.
export function mergeTracksByIdentity(): void {
  const db = getDb();

  const pairs = db.all(sql`
    SELECT i.spotify_id AS import_id, r.spotify_id AS real_id, i.name AS track_name,
           (SELECT COUNT(*) FROM listening_history WHERE track_id = r.spotify_id) AS plays
    FROM tracks i
    JOIN tracks r ON r.isrc = i.isrc
    WHERE (i.spotify_id LIKE 'import:%' OR i.spotify_id LIKE 'local:%')
      AND i.isrc IS NOT NULL AND i.isrc != ''
      AND r.spotify_id NOT LIKE 'import:%' AND r.spotify_id NOT LIKE 'local:%'
    UNION
    SELECT i.spotify_id, r.spotify_id, i.name,
           (SELECT COUNT(*) FROM listening_history WHERE track_id = r.spotify_id)
    FROM tracks i
    JOIN tracks r ON r.mbid = i.mbid
    WHERE (i.spotify_id LIKE 'import:%' OR i.spotify_id LIKE 'local:%')
      AND i.mbid IS NOT NULL AND i.mbid != ''
      AND r.spotify_id NOT LIKE 'import:%' AND r.spotify_id NOT LIKE 'local:%'
  `) as { import_id: string; real_id: string; track_name: string; plays: number }[];

  if (pairs.length === 0) return;

  // varios reales pueden compartir isrc (versión de álbum vs single): elegir el
  // más escuchado por cada sintético, con desempate determinista por id
  const bestBySynthetic = new Map<string, { import_id: string; real_id: string; track_name: string; plays: number }>();
  for (const pair of pairs) {
    const current = bestBySynthetic.get(pair.import_id);
    if (!current || pair.plays > current.plays || (pair.plays === current.plays && pair.real_id < current.real_id)) {
      bestBySynthetic.set(pair.import_id, pair);
    }
  }

  log.info(`${bestBySynthetic.size} tracks sintéticos con equivalente real por isrc/mbid`);

  let merged = 0;
  for (const { import_id, real_id, track_name } of bestBySynthetic.values()) {
    try {
      reassignTrackRefs(db, import_id, real_id);
      merged++;
    } catch (err) {
      log.error(`error unificando "${track_name}":`, err);
    }
  }

  if (merged > 0) log.info(`${merged} tracks sintéticos unificados por identidad`);
}
