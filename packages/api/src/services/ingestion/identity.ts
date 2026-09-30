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
import { mbRecordingQuery, sameTitle } from '@sis/shared';
import type { SpotifyTracksBatchResponse } from '../../types/spotify.js';
import {
  MB_API_BASE, MB_DELAY_MS, MB_MIN_SCORE, MB_SEARCH_LIMIT, MB_MIN_STUDIO_RELEASES,
  ISRC_HARVEST_BATCH_SIZE, ISRC_HARVEST_MAX_BATCHES, MB_IDENTITY_MAX_PER_CYCLE,
  TRACK_DEDUP_DURATION_TOLERANCE_MS, ISRC_DEDUP_MAX_PER_CYCLE,
} from '../../constants.js';
import { createLogger } from '../logger.js';
import { serviceUserAgent } from '../public-origin.js';

const log = createLogger('identity');
const now = () => new Date().toISOString();
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// tracks sintéticos candidatos a identidad: import:/local: que NO estén en un álbum
// local:. un álbum local: es un contenedor del usuario (setlist, bootleg,
// recopilación): sus temas llevan el título original y el artista real, así que la
// evidencia isrc/mbid los hace converger con el tema de estudio y vacía el álbum
// (un festival pasó de 20 temas a 9). la identidad existe para que un import:
// converja con su entidad real, no para deshacer contenedores del usuario
const identityCandidate = (alias: string) => sql.raw(
  `(${alias}.spotify_id LIKE 'import:%' OR ${alias}.spotify_id LIKE 'local:%')
   AND (${alias}.album_id IS NULL OR ${alias}.album_id NOT LIKE 'local:%')`
);

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
interface MbRecording {
  id: string;
  title: string;
  score: number;
  length?: number;
  video?: boolean;
  disambiguation?: string;
  'artist-credit'?: { name?: string; artist?: { id?: string; name?: string } }[];
  releases?: { status?: string; 'release-group'?: { 'primary-type'?: string; 'secondary-types'?: string[] } }[];
}
interface MbRecordingSearch {
  recordings?: MbRecording[];
}

async function mbFetch<T>(path: string): Promise<T | null> {
  const res = await fetch(`${MB_API_BASE}${path}`, {
    headers: { 'User-Agent': serviceUserAgent(), 'Accept': 'application/json' },
  });
  if (!res.ok) return null;
  return await res.json() as T;
}

// búsqueda /recording de (título, artista) con el match verificado. el score no basta:
// una query sin citar devolvía otro tema al 100, y un mbid equivocado arrastra un isrc
// equivocado y con él un merge físico en un tema que no es. sólo vale un resultado cuyo
// título Y artista son los nuestros. el crédito se busca por nombre porque el primero es
// a menudo otro acto (un "J Balvin, Bad Bunny" dejó a Bad Bunny con el mbid de J Balvin,
// y la búsqueda de bolos por ese mbid devolvía la gira de J Balvin).
//
// y aun verificado, título + crédito no identifica la GRABACIÓN: "Lisztomania" de Phoenix
// devuelve 43 recordings (12 empatados al score 100, en un orden que cambia entre consultas
// y con directos por delante del estudio) y "Enter Sandman" 761.
// De los verificados vale el que acumula más lanzamientos de estudio (oficiales, álbum /
// single / EP, sin tipo secundario: live, compilation, dj-mix, demo…), con al menos
// MB_MIN_STUDIO_RELEASES, y nunca uno cuya desambiguación lo marca como versión: un
// directo de B-side sale en singles de estudio (el "Enter Sandman" de Irvine Meadows 1996
// ganaba así con 498s). Medido el 2026-09-30 sobre 54 temas de spotify de duración
// conocida: 17 aciertos y 3 fallos (dos a menos de 30s, otra edición del tema), contra 20/9
// del primer verificado y 33/11 del top-1 sin citar. Los que se quedan sin match no
// cuestan nada; un recording equivocado acaba en un merge.
// null = sin respuesta (reintentar); `recording` undefined = respondida sin match fiable
const MB_STUDIO_PRIMARY_TYPES = new Set(['Album', 'Single', 'EP']);
const MB_VARIANT_DISAMBIGUATION = /\b(live|demo|remix|instrumental|acoustic|a ?cappella|karaoke)\b/i;
const studioReleaseCount = (r: MbRecording) => r.releases?.filter(rel =>
  rel.status === 'Official'
  && MB_STUDIO_PRIMARY_TYPES.has(rel['release-group']?.['primary-type'] ?? '')
  && !rel['release-group']?.['secondary-types']?.length).length ?? 0;

export async function searchVerifiedRecording(title: string, artistName: string): Promise<{ recording?: MbRecording; artistMbid?: string } | null> {
  const query = mbRecordingQuery(title, artistName);
  const data = await mbFetch<MbRecordingSearch>(`/recording?query=${encodeURIComponent(query)}&fmt=json&limit=${MB_SEARCH_LIMIT}`);
  if (!data) return null;
  const wanted = normalizeArtistName(artistName);
  const ownCredit = (r: MbRecording) =>
    r['artist-credit']?.find(c => normalizeArtistName(c.artist?.name ?? c.name ?? '') === wanted);
  const [recording] = (data.recordings ?? [])
    .filter(r => !r.video && !MB_VARIANT_DISAMBIGUATION.test(r.disambiguation ?? '')
      && r.score >= MB_MIN_SCORE && sameTitle(r.title, title) && ownCredit(r) !== undefined)
    .map(r => ({ r, studio: studioReleaseCount(r) }))
    .filter(c => c.studio >= MB_MIN_STUDIO_RELEASES)
    .sort((a, b) => b.studio - a.studio)
    .map(c => c.r);
  return { recording, artistMbid: recording && ownCredit(recording)?.artist?.id };
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
    WHERE t.mbid IS NULL AND ${identityCandidate('t')}
    LIMIT ${budget}
  `) as { spotify_id: string; name: string; artist_id: string; artist_name: string }[];

  if (noMbid.length > 0) log.info(`${noMbid.length} tracks sintéticos sin mbid, consultando musicbrainz...`);

  let found = 0;
  for (const track of noMbid) {
    budget--;
    try {
      const result = await searchVerifiedRecording(track.name, track.artist_name);
      if (result?.recording) {
        db.run(sql`UPDATE tracks SET mbid = ${result.recording.id}, updated_at = ${now()} WHERE spotify_id = ${track.spotify_id}`);
        // el mbid de artista se acreta del mismo crédito, ya verificado
        if (result.artistMbid) {
          db.run(sql`UPDATE artists SET mbid = COALESCE(mbid, ${result.artistMbid}) WHERE spotify_id = ${track.artist_id}`);
        }
        found++;
      } else if (result) {
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
    SELECT t.spotify_id, t.name, t.mbid FROM tracks t
    WHERE t.isrc IS NULL AND t.mbid IS NOT NULL AND t.mbid != ''
      AND ${identityCandidate('t')}
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
    WHERE ${identityCandidate('i')}
      AND i.isrc IS NOT NULL AND i.isrc != ''
      AND r.spotify_id NOT LIKE 'import:%' AND r.spotify_id NOT LIKE 'local:%'
    UNION
    SELECT i.spotify_id, r.spotify_id, i.name,
           (SELECT COUNT(*) FROM listening_history WHERE track_id = r.spotify_id)
    FROM tracks i
    JOIN tracks r ON r.mbid = i.mbid
    WHERE ${identityCandidate('i')}
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

// converger tracks REALES que son la misma grabación: mismo isrc y prácticamente la
// misma duración. spotify publica un id por cada shell de álbum del lanzamiento y el
// gemelo entra como fila propia; resolveDuplicateTrackId ya redirige los plays nuevos,
// pero el isrc puede llegar DESPUÉS (harvestTrackIsrcs, tracklists simplified que no
// traen external_ids) y para entonces el par ya existe. a diferencia de
// mergeTracksByIdentity —sintético → real— aquí los dos lados son reales, así que el
// canónico es el más escuchado y el merge es físico en ambos sentidos.
//
// el isrc SOLO no vale para borrar una fila: hay isrcs de sello compartidos por temas
// distintos ("Saint Laurent" / "777", dos movimientos de la misma serenata). la
// duración es lo que los separa. el nombre no entra en la clave: el mismo máster se
// publica con créditos distintos ("CARNIVAL" / "CARNIVAL (feat. Rich The Kid, Playboi
// Carti)") y ese es justo el duplicado que antes había que aprobar a mano en el scan.
export function mergeDuplicateTracksByIsrc(): void {
  const db = getDb();

  const rows = db.all(sql`
    SELECT t.isrc, t.spotify_id AS id, t.name, t.duration_ms AS duration,
           (SELECT COUNT(*) FROM listening_history lh WHERE lh.track_id = t.spotify_id) AS plays
    FROM tracks t
    JOIN (
      SELECT isrc FROM tracks
      WHERE isrc IS NOT NULL AND isrc != '' AND duration_ms > 0
        AND spotify_id NOT LIKE 'import:%' AND spotify_id NOT LIKE 'local:%'
      GROUP BY isrc HAVING COUNT(*) > 1
    ) dup ON dup.isrc = t.isrc
    WHERE t.duration_ms > 0
      AND t.spotify_id NOT LIKE 'import:%' AND t.spotify_id NOT LIKE 'local:%'
  `) as { isrc: string; id: string; name: string; duration: number; plays: number }[];

  if (rows.length === 0) return;

  const byIsrc = new Map<string, typeof rows>();
  for (const row of rows) byIsrc.set(row.isrc, [...(byIsrc.get(row.isrc) ?? []), row]);

  // la tolerancia de duración no es transitiva (100s ~ 104s ~ 108s, pero 100s ≁ 108s):
  // se compara contra el canónico, no en cadena, igual que autoDedupTracks
  const pairs = [...byIsrc.values()].flatMap(group => {
    const [canonical, ...rest] = [...group].sort((a, b) => b.plays - a.plays || a.id.localeCompare(b.id));
    return rest
      .filter(t => Math.abs(t.duration - canonical.duration) <= TRACK_DEDUP_DURATION_TOLERANCE_MS)
      .map(t => ({ dupe: t, canonical }));
  });

  if (pairs.length === 0) return;
  const batch = pairs.slice(0, ISRC_DEDUP_MAX_PER_CYCLE);
  log.info(`${pairs.length} tracks reales duplicados por isrc+duración, unificando ${batch.length}`);

  let merged = 0;
  for (const { dupe, canonical } of batch) {
    try {
      reassignTrackRefs(db, dupe.id, canonical.id);
      merged++;
    } catch (err) {
      log.error(`error unificando "${dupe.name}" en "${canonical.name}":`, err);
    }
  }

  if (merged > 0) log.info(`${merged} tracks reales unificados por isrc+duración`);
}
