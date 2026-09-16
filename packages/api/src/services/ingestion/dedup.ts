import { sql } from 'drizzle-orm';
import { getDb } from '../../db/connection.js';
import { DEDUP_WINDOW_S, reassignTrackRefs, reassignAlbumRefs } from './upsert.js';
import { MIN_PLAY_MS, TRACK_DEDUP_DURATION_TOLERANCE_MS } from '../../constants.js';
import { createLogger } from '../logger.js';

const logDedup = createLogger('dedup');
const logCleanup = createLogger('cleanup');

interface TrackCandidate {
  spotify_id: string;
  is_merge_target: number;
  type_score: number;
  play_count: number;
  duration_ms: number;
  isrc: string | null;
}

// nombre + artista de posición 0 es la señal de identidad MÁS FLOJA que maneja el
// proyecto, y aquí cuelga del merge más destructivo (borra la fila). Sin este guard
// cualquier otra versión del mismo título se comía a la del álbum: el single de
// "Runaway" (50HCj9kEXIonBwRLXFWCr8, 5:39, isrc USUM71024424) desapareció dentro del
// corte de MBDTF (3DK6m7It6Pw857FcQftMds, 9:07, isrc USUM71027402) con sus 73 plays,
// y lo mismo con TRON: Legacy vs TRON: Legacy Reconfigured, o los skits de Eminem en
// su versión limpia. Se pide lo mismo que mergeDuplicateTracksByIsrc, que ya era
// estricto con una señal MÁS fuerte: duración dentro de tolerancia contra el canónico
// (no en cadena, la tolerancia no es transitiva) y, si ambos tienen isrc y difieren,
// son dos grabaciones registradas distintas y no se tocan. Duración desconocida
// (<= 0, pendiente de enrichment) se aplaza al siguiente ciclo en vez de mergear a
// ciegas, que es justo como se colaban estos.
const isSameRecording = (dupe: TrackCandidate, canonical: TrackCandidate) => {
  if (dupe.duration_ms <= 0 || canonical.duration_ms <= 0) return false;
  if (Math.abs(dupe.duration_ms - canonical.duration_ms) > TRACK_DEDUP_DURATION_TOLERANCE_MS) return false;
  return !(dupe.isrc && canonical.isrc && dupe.isrc !== canonical.isrc);
};

// orden de preferencia del canónico entre duplicados de un mismo tema, igual que el
// canonicalFirst de la UI de admin. is_merge_target va primero porque las merge rules
// son un merge *lógico* y no mueven plays al canónico que eligió el usuario: desempatar
// por play_count elegía justo el otro lado y borraba ese canónico, dejando la regla
// apuntando a un id inexistente (invisible en la UI y bloqueando volver a mergear)
const beatsCanonical = (a: TrackCandidate, b: TrackCandidate) =>
  a.is_merge_target !== b.is_merge_target ? a.is_merge_target > b.is_merge_target
    : a.type_score !== b.type_score ? a.type_score < b.type_score
      : a.play_count > b.play_count;
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
  logDedup.info(`${groups.length} grupos de tracks duplicados`);

  let merged = 0;

  for (const group of groups) {
    if (!group.artist_id) continue;
    const ids = group.ids.split(',');

    // elegir canónico: preferir el que el usuario ya marcó como target, luego album >
    // single, luego más plays (ver beatsCanonical)
    const candidates: TrackCandidate[] = [];
    let best: TrackCandidate | null = null;
    for (const id of ids) {
      const row = db.get(sql`
        SELECT t.spotify_id, t.duration_ms, t.isrc,
               EXISTS(SELECT 1 FROM merge_rules
                 WHERE entity_type = 'track' AND target_id = t.spotify_id) as is_merge_target,
               CASE WHEN a.album_type = 'album' THEN 0 WHEN a.album_type IS NULL THEN 1
                    WHEN a.album_type = 'compilation' THEN 2 ELSE 3 END as type_score,
               COALESCE((SELECT count(*) FROM listening_history WHERE track_id = t.spotify_id), 0) as play_count
        FROM tracks t
        LEFT JOIN albums a ON a.spotify_id = t.album_id
        WHERE t.spotify_id = ${id}
      `) as TrackCandidate | undefined;
      if (!row) continue;
      candidates.push(row);
      if (!best || beatsCanonical(row, best)) best = row;
    }

    if (!best) continue;
    const canonical = best;
    // mismo título y mismo artista NO es la misma grabación: sólo se absorbe lo que
    // además cuadra en duración e isrc (ver isSameRecording)
    const dupes = candidates.filter(c => c.spotify_id !== canonical.spotify_id && isSameRecording(c, canonical));
    if (dupes.length === 0) continue;

    try {
      // reassignTrackRefs re-apunta historial/créditos/playlists al canónico y
      // hereda la evidencia isrc/mbid del duplicado antes de borrarlo
      for (const dupe of dupes) {
        reassignTrackRefs(db, dupe.spotify_id, canonical.spotify_id);
      }
      merged++;
    } catch (err) {
      logDedup.error(`error deduplicando "${group.track_name}":`, err);
    }
  }

  if (merged > 0) logDedup.info(`${merged} grupos de tracks unificados`);
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
  logDedup.info(`${groups.length} grupos de álbumes duplicados`);

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
        reassignAlbumRefs(db, dupe, canonical);
      }
      merged++;
    } catch (err) {
      logDedup.error(`error deduplicando álbum "${group.album_name}":`, err);
    }
  }

  if (merged > 0) logDedup.info(`${merged} grupos de álbumes unificados`);
}

// deduplicar "shells" de lanzamientos: spotify sirve el mismo lanzamiento como varias
// entidades álbum (audio + vídeo + variantes de mercado) con idéntico nombre/fecha/
// tipo/artista. la mayoría no tienen tracks ingestados —los plays se atribuyen a una
// sola entidad— así que deduplicateAlbums, que exige JOIN a tracks, no ve las vacías y
// quedan duplicadas en secciones y marcadores de lanzamiento. aquí se agrupan por
// (nombre, fecha, tipo, artist_ids) —clave que no depende de tener tracks— y se
// colapsan a un canónico. album_type va en la clave: cubre singles Y álbumes sin
// fusionar un single con el álbum homónimo del mismo día (lanzamientos distintos).
export function deduplicateAlbumShells() {
  const db = getDb();

  const groups = db.all(sql`
    SELECT LOWER(name) as lname, release_date, album_type, artist_ids,
           GROUP_CONCAT(spotify_id) as ids, count(*) as cnt
    FROM albums
    WHERE spotify_id NOT LIKE 'import:%'
      AND spotify_id NOT LIKE 'local:%'
      AND artist_ids IS NOT NULL
      -- exigir nombre y fecha reales: nombre vacío o fecha placeholder ('0000') son
      -- metadata basura que agruparía lanzamientos DISTINTOS solo por compartir huecos
      AND name IS NOT NULL AND name != ''
      AND release_date IS NOT NULL AND (release_date LIKE '19%' OR release_date LIKE '20%')
    GROUP BY lname, release_date, album_type, artist_ids
    HAVING cnt > 1
  `) as { lname: string; release_date: string; album_type: string | null; artist_ids: string; ids: string }[];

  if (groups.length === 0) return;
  logDedup.info(`${groups.length} grupos de lanzamientos duplicados`);

  let merged = 0;

  for (const group of groups) {
    const ids = group.ids.split(',');

    // canónico: preferir con tracks ingestados, luego con portada, luego más
    // total_tracks, y finalmente id menor (determinista)
    let best: { id: string; ntracks: number; imgScore: number; totalTracks: number } | null = null;
    for (const id of ids) {
      const row = db.get(sql`
        SELECT a.spotify_id,
               (SELECT count(*) FROM tracks t WHERE t.album_id = a.spotify_id) AS ntracks,
               CASE WHEN (a.image_url IS NOT NULL AND a.image_url != '')
                         OR EXISTS (SELECT 1 FROM album_covers ac WHERE ac.album_id = a.spotify_id)
                    THEN 0 ELSE 1 END AS img_score,
               COALESCE(a.total_tracks, 0) AS total_tracks
        FROM albums a WHERE a.spotify_id = ${id}
      `) as { spotify_id: string; ntracks: number; img_score: number; total_tracks: number } | undefined;
      if (!row) continue;
      if (!best
        || row.ntracks > best.ntracks
        || (row.ntracks === best.ntracks && row.img_score < best.imgScore)
        || (row.ntracks === best.ntracks && row.img_score === best.imgScore && row.total_tracks > best.totalTracks)
        || (row.ntracks === best.ntracks && row.img_score === best.imgScore && row.total_tracks === best.totalTracks && row.spotify_id < best.id)) {
        best = { id: row.spotify_id, ntracks: row.ntracks, imgScore: row.img_score, totalTracks: row.total_tracks };
      }
    }

    if (!best) continue;
    const canonical = best.id;
    const dupes = ids.filter(id => id !== canonical);
    if (dupes.length === 0) continue;

    try {
      for (const dupe of dupes) {
        reassignAlbumRefs(db, dupe, canonical);
      }
      merged++;
    } catch (err) {
      logDedup.error(`error deduplicando lanzamiento "${group.lname}":`, err);
    }
  }

  if (merged > 0) logDedup.info(`${merged} grupos de lanzamientos unificados`);
}

// shells de lanzamiento VACÍOS: la misma entidad duplicada de deduplicateAlbumShells,
// pero cuando spotify además discrepa en la fecha. "Hurry Up Tomorrow" existe como
// 6iyZdO… (2025-01-30) y 3Oxfa… (2025-01-31), y release_date forma parte de la clave de
// agrupación de allí, así que ese par no colapsa nunca. la fecha no puede salir de
// aquella clave sin fusionar lanzamientos distintos, pero cuando uno de los dos no tiene
// NINGÚN track ingestado no hay nada que preservar: una deluxe y su estándar tienen
// tracks las dos, un shell vacío es solo la otra cara del mismo disco. se colapsa sobre
// la hermana poblada del mismo nombre/tipo/artista, ignorando la fecha.
export function deduplicateEmptyAlbumShells() {
  const db = getDb();

  // una sola pasada plana sobre albums y el agrupado en JS. la forma natural —un
  // subquery correlado que busca la hermana poblada de cada shell— es O(n²): no hay
  // índice sobre LOWER(name), así que cada uno de los 2.3k shells vacíos escaneaba los
  // 26k álbumes enteros. 13s de main thread bloqueado contra los 60ms de esto.
  const keyed = db.all(sql`
    SELECT a.spotify_id AS id, a.name, LOWER(a.name) AS lname, a.album_type AS atype, a.artist_ids AS aids,
           (SELECT COUNT(*) FROM tracks t WHERE t.album_id = a.spotify_id) AS ntracks
    FROM albums a
    WHERE a.spotify_id NOT LIKE 'import:%'
      AND a.spotify_id NOT LIKE 'local:%'
      -- mismas guardas que deduplicateAlbumShells: nombre vacío o artist_ids ausente son
      -- metadata basura que agruparía lanzamientos distintos solo por compartir huecos
      AND a.name IS NOT NULL AND a.name != ''
      AND a.artist_ids IS NOT NULL
  `) as { id: string; name: string; lname: string; atype: string | null; aids: string; ntracks: number }[];

  const groups = new Map<string, typeof keyed>();
  for (const a of keyed) {
    const key = `${a.lname}\u0000${a.atype ?? ''}\u0000${a.aids}`;
    groups.set(key, [...(groups.get(key) ?? []), a]);
  }

  // dentro de cada grupo, la hermana poblada con más tracks absorbe a las vacías
  const pairs = [...groups.values()].flatMap(group => {
    const populated = group.filter(a => a.ntracks > 0)
      .sort((a, b) => b.ntracks - a.ntracks || a.id.localeCompare(b.id))[0];
    return populated ? group.filter(a => a.ntracks === 0).map(empty => ({ empty, populated })) : [];
  });

  if (pairs.length === 0) return;
  logDedup.info(`${pairs.length} shells de lanzamiento vacíos con hermana poblada`);

  let merged = 0;
  for (const { empty, populated } of pairs) {
    try {
      reassignAlbumRefs(db, empty.id, populated.id);
      merged++;
    } catch (err) {
      logDedup.error(`error absorbiendo shell vacío "${empty.name}":`, err);
    }
  }

  if (merged > 0) logDedup.info(`${merged} shells vacíos absorbidos`);
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
  logDedup.info(`${groups.length} grupos de álbumes locales duplicados`);

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
            // track duplicado: mover history/créditos/playlists y eliminar
            reassignTrackRefs(db, dt.spotify_id, existing.spotify_id);
          } else {
            // track único: mover al álbum canónico
            db.run(sql`UPDATE tracks SET album_id = ${canonical} WHERE spotify_id = ${dt.spotify_id}`);
          }
        }
        reassignAlbumRefs(db, dupe, canonical);
      }
      merged++;
    } catch (err) {
      logDedup.error(`error deduplicando álbum local "${group.album_name}":`, err);
    }
  }

  if (merged > 0) logDedup.info(`${merged} grupos de álbumes locales unificados`);
}

export function cleanDuplicatePlays() {
  const db = getDb();
  // encontrar el ID a eliminar en cada par de duplicados (mismo track, ±DEDUP_WINDOW_S)
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
  logCleanup.info(`eliminados ${ids.length} plays duplicados (±${DEDUP_WINDOW_S}s)`);
}

// eliminar duplicados Basic/Extended: el mismo play aparece como entrada Basic (sin
// duración, timestamp = inicio) y Extended (con duración, timestamp = fin). Se detectan
// porque el inicio de la Extended (played_at − ms_played reproducidos) coincide (±15s)
// con el played_at de la Basic. Usar la duración REALMENTE reproducida (no la del track)
// captura también reproducciones parciales que el criterio antiguo (±duración del track)
// dejaba fuera.
export function cleanBasicExtendedDuplicates() {
  const db = getDb();
  const toDelete = db.all(sql`
    SELECT a.id
    FROM listening_history a
    JOIN listening_history b ON a.user_id = b.user_id AND a.track_id = b.track_id AND a.id != b.id
    WHERE a.duration_played_ms IS NULL
      AND b.duration_played_ms IS NOT NULL
      AND abs(
        strftime('%s', a.played_at)
        - (strftime('%s', b.played_at) - b.duration_played_ms / 1000.0)
      ) <= 15
  `) as { id: number }[];

  if (toDelete.length === 0) return;

  const ids = [...new Set(toDelete.map(r => r.id))];
  for (let i = 0; i < ids.length; i += 500) {
    const batch = ids.slice(i, i + 500);
    db.run(sql`DELETE FROM listening_history WHERE id IN (${sql.join(batch.map(id => sql`${id}`), sql`, `)})`);
  }
  logCleanup.info(`eliminados ${ids.length} duplicados Basic/Extended`);
}

// ventana de tolerancia al comparar el hueco entre plays con la duración del track
const FULL_PLAY_TOLERANCE_S = 15;

// reparar duraciones fantasma: hasta el arreglo de la extrapolación en polling, un
// track cubierto por un solo poll de currently-playing se guardaba con el progreso
// que tenía al detectarlo, no con el final. se detectan porque el hueco respecto al
// play anterior del usuario coincide con la duración COMPLETA del track: sonó entero,
// así que la duración guardada (<MIN_PLAY_MS) es un artefacto de medición.
// se pone a NULL en vez de borrar la fila: playDuration() hace COALESCE a la duración
// del track, que es justo lo que se escuchó. idempotente (tras pasar ya no casan).
export function cleanStaleShortDurations() {
  const db = getDb();
  const toNull = db.all(sql`
    SELECT lh.id
    FROM listening_history lh
    JOIN tracks t ON t.spotify_id = lh.track_id
    WHERE lh.duration_played_ms IS NOT NULL
      AND lh.duration_played_ms < ${MIN_PLAY_MS}
      AND t.duration_ms > 0
      AND abs(
        (strftime('%s', lh.played_at) - (
          SELECT strftime('%s', p.played_at) FROM listening_history p
          WHERE p.user_id = lh.user_id AND p.played_at < lh.played_at
          ORDER BY p.played_at DESC LIMIT 1
        )) - t.duration_ms / 1000.0
      ) < ${FULL_PLAY_TOLERANCE_S}
  `) as { id: number }[];

  if (toNull.length === 0) return;

  const ids = toNull.map(r => r.id);
  for (let i = 0; i < ids.length; i += 500) {
    const batch = ids.slice(i, i + 500);
    db.run(sql`UPDATE listening_history SET duration_played_ms = NULL WHERE id IN (${sql.join(batch.map(id => sql`${id}`), sql`, `)})`);
  }
  logCleanup.info(`${ids.length} duraciones fantasma (<${MIN_PLAY_MS / 1000}s en plays completos) puestas a NULL`);
}

// limpiar del índice FTS las entradas de entidades ya borradas. no se hace dentro de
// reassignTrackRefs/reassignAlbumRefs porque entity_id es UNINDEXED en la tabla fts5:
// un DELETE sin MATCH la recorre entera (24ms sobre 89k filas), y por merge eso convertía
// un barrido de 400 duplicados en 10s de main thread bloqueado. batched sale a una sola
// pasada por ciclo. la búsqueda parte de la tabla de la entidad, así que una entrada
// huérfana nunca se vio: esto es higiene, no un bug de cara al usuario.
export function pruneOrphanSearchIndex() {
  const db = getDb();
  const removed = ['track', 'album', 'artist'].reduce((n, type) => n + db.run(sql`
    DELETE FROM search_index WHERE entity_type = ${type}
      AND entity_id NOT IN (SELECT spotify_id FROM ${sql.raw(type === 'artist' ? 'artists' : type + 's')})
  `).changes, 0);

  if (removed > 0) logDedup.info(`${removed} entradas huérfanas purgadas del índice FTS`);
}
