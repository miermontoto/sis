import { sql } from 'drizzle-orm';
import { getDb } from '../../db/connection.js';
import { DEDUP_WINDOW_S, mergeTrackArtists } from './upsert.js';

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
  console.log(`[dedup] ${groups.length} grupos de tracks duplicados`);

  let merged = 0;

  for (const group of groups) {
    if (!group.artist_id) continue;
    const ids = group.ids.split(',');

    // elegir canónico: preferir album > single, luego más plays
    let best: { id: string; score: number; plays: number } | null = null;
    for (const id of ids) {
      const row = db.get(sql`
        SELECT t.spotify_id,
               CASE WHEN a.album_type = 'album' THEN 0 WHEN a.album_type IS NULL THEN 1
                    WHEN a.album_type = 'compilation' THEN 2 ELSE 3 END as type_score,
               COALESCE((SELECT count(*) FROM listening_history WHERE track_id = t.spotify_id), 0) as play_count
        FROM tracks t
        LEFT JOIN albums a ON a.spotify_id = t.album_id
        WHERE t.spotify_id = ${id}
      `) as { spotify_id: string; type_score: number; play_count: number } | undefined;
      if (!row) continue;
      if (!best || row.type_score < best.score || (row.type_score === best.score && row.play_count > best.plays)) {
        best = { id: row.spotify_id, score: row.type_score, plays: row.play_count };
      }
    }

    if (!best) continue;
    const canonical = best.id;
    const dupes = ids.filter(id => id !== canonical);
    if (dupes.length === 0) continue;

    try {
      for (const dupe of dupes) {
        // re-apuntar listening_history (ignorar conflictos por played_at UNIQUE)
        db.run(sql`UPDATE OR IGNORE listening_history SET track_id = ${canonical} WHERE track_id = ${dupe}`);
        db.run(sql`DELETE FROM listening_history WHERE track_id = ${dupe}`);
        // fusionar artistas en el canónico sin colisionar posiciones ni arrastrar
        // feats. de grabaciones homónimas distintas (ver mergeTrackArtists)
        mergeTrackArtists(db, dupe, canonical);
        // re-apuntar playlist references (generated + spotify library)
        db.run(sql`UPDATE OR IGNORE generated_playlist_tracks SET track_id = ${canonical} WHERE track_id = ${dupe}`);
        db.run(sql`DELETE FROM generated_playlist_tracks WHERE track_id = ${dupe}`);
        db.run(sql`UPDATE OR IGNORE spotify_playlist_tracks SET track_id = ${canonical} WHERE track_id = ${dupe}`);
        db.run(sql`DELETE FROM spotify_playlist_tracks WHERE track_id = ${dupe}`);
        // eliminar track duplicado
        db.run(sql`DELETE FROM tracks WHERE spotify_id = ${dupe}`);
      }
      merged++;
    } catch (err) {
      console.error(`[dedup] error deduplicando "${group.track_name}":`, err);
    }
  }

  if (merged > 0) console.log(`[dedup] ${merged} grupos de tracks unificados`);
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
  console.log(`[dedup] ${groups.length} grupos de álbumes duplicados`);

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
        db.run(sql`UPDATE tracks SET album_id = ${canonical} WHERE album_id = ${dupe}`);
        db.run(sql`DELETE FROM albums WHERE spotify_id = ${dupe}`);
      }
      merged++;
    } catch (err) {
      console.error(`[dedup] error deduplicando álbum "${group.album_name}":`, err);
    }
  }

  if (merged > 0) console.log(`[dedup] ${merged} grupos de álbumes unificados`);
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
  console.log(`[dedup] ${groups.length} grupos de lanzamientos duplicados`);

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
        // repuntar cualquier track del dupe al canónico y limpiar sus portadas antes de borrarlo
        db.run(sql`UPDATE tracks SET album_id = ${canonical} WHERE album_id = ${dupe}`);
        db.run(sql`DELETE FROM album_covers WHERE album_id = ${dupe}`);
        db.run(sql`DELETE FROM albums WHERE spotify_id = ${dupe}`);
      }
      merged++;
    } catch (err) {
      console.error(`[dedup] error deduplicando lanzamiento "${group.lname}":`, err);
    }
  }

  if (merged > 0) console.log(`[dedup] ${merged} grupos de lanzamientos unificados`);
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
  console.log(`[dedup] ${groups.length} grupos de álbumes locales duplicados`);

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
            // track duplicado: mover history y eliminar
            db.run(sql`UPDATE OR IGNORE listening_history SET track_id = ${existing.spotify_id} WHERE track_id = ${dt.spotify_id}`);
            db.run(sql`DELETE FROM listening_history WHERE track_id = ${dt.spotify_id}`);
            mergeTrackArtists(db, dt.spotify_id, existing.spotify_id);
            db.run(sql`UPDATE OR IGNORE generated_playlist_tracks SET track_id = ${existing.spotify_id} WHERE track_id = ${dt.spotify_id}`);
            db.run(sql`DELETE FROM generated_playlist_tracks WHERE track_id = ${dt.spotify_id}`);
            db.run(sql`UPDATE OR IGNORE spotify_playlist_tracks SET track_id = ${existing.spotify_id} WHERE track_id = ${dt.spotify_id}`);
            db.run(sql`DELETE FROM spotify_playlist_tracks WHERE track_id = ${dt.spotify_id}`);
            db.run(sql`DELETE FROM tracks WHERE spotify_id = ${dt.spotify_id}`);
          } else {
            // track único: mover al álbum canónico
            db.run(sql`UPDATE tracks SET album_id = ${canonical} WHERE spotify_id = ${dt.spotify_id}`);
          }
        }
        db.run(sql`DELETE FROM albums WHERE spotify_id = ${dupe}`);
      }
      merged++;
    } catch (err) {
      console.error(`[dedup] error deduplicando álbum local "${group.album_name}":`, err);
    }
  }

  if (merged > 0) console.log(`[dedup] ${merged} grupos de álbumes locales unificados`);
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
  console.log(`[cleanup] eliminados ${ids.length} plays duplicados (±${DEDUP_WINDOW_S}s)`);
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
  console.log(`[cleanup] eliminados ${ids.length} duplicados Basic/Extended`);
}
