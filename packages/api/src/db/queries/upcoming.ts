// lecturas de los álbumes que vienen (services/upcoming-albums.ts): qué singles de un
// usuario van dentro de un álbum anunciado, y de qué fuentes sale el siguiente a buscar.
// Corren en el pool; las escrituras son del servicio, en el main thread.
//
// Un single sólo entra si el usuario no lo ha tocado: ni merge de álbum, ni plegado ya en
// su álbum (single_folds), ni en una colección. Es el mismo filtro que planSingleFolds, y
// por la misma razón: una decisión del usuario manda sobre un barrido. De un EP con
// canciones que el disco no lleva entran sólo los temas compartidos, como temas sueltos
// de la colección (que no estén ya en otra ni mergeados en otro tema).
import { sql } from 'drizzle-orm';
import { upcomingMatch, type FoldRelease, type FoldTrack, type UpcomingTrack } from '@sis/shared';
import { creditBaseKey } from '../../services/versions.js';
import { artistMergeGroup, isEligibleMember } from './collections.js';
import { SINGLE_FOLD_MAX_LEAD_MS, TRACK_DEDUP_DURATION_TOLERANCE_MS } from '../../constants.js';
import type { Db } from './helpers.js';

export interface UpcomingFoldPlan {
  upcomingId: number;
  artistId: string;
  name: string;
  imageUrl: string | null;
  // la colección que ya tiene (se amplía con singles nuevos) o null (hay que crearla)
  collectionId: number | null;
  // lanzamientos enteros y temas sueltos (los compartidos de un EP con canciones de fuera)
  singleIds: string[];
  trackIds: string[];
}

interface UpcomingRow { id: number; artist_id: string; name: string; release_date: string; image_url: string | null; tracks: string }
interface SingleRow { id: string; releaseDate: string; artistId: string; totalTracks: number | null }
interface TrackRow { id: string; albumId: string; name: string; durationMs: number }

const idList = (ids: readonly (string | number)[]) => sql.join(ids.map(id => sql`${id}`), sql`, `);

const asFoldTrack = (t: { id?: string; name: string; durationMs: number }): FoldTrack =>
  ({ id: t.id ?? '', key: creditBaseKey(t.name), durationMs: t.durationMs, isrc: null });

/** Singles de este usuario que van dentro de cada álbum que viene y aún no están en su
 *  colección. Un álbum cuya colección borró el usuario (o que ya se disolvió) no vuelve. */
export function planUpcomingFolds(db: Db, userId: number): UpcomingFoldPlan[] {
  const upcoming = db.all(sql`
    SELECT id, artist_id, name, release_date, image_url, tracks FROM upcoming_albums WHERE state = 'upcoming'
  `) as UpcomingRow[];
  if (upcoming.length === 0) return [];

  const folds = new Map((db.all(sql`
    SELECT uf.upcoming_id, uf.collection_id, ac.id AS alive
    FROM upcoming_folds uf
    LEFT JOIN album_collections ac ON ac.id = uf.collection_id AND ac.user_id = uf.user_id
    WHERE uf.user_id = ${userId}
  `) as { upcoming_id: number; collection_id: number | null; alive: number | null }[]).map(f => [f.upcoming_id, f]));
  const live = upcoming.filter(u => folds.get(u.id)?.alive !== null);
  if (live.length === 0) return [];

  // el álbum es del canónico del artista: sus alias también firman sus singles
  const canon = new Map((db.all(sql`
    SELECT source_id, target_id FROM merge_rules WHERE user_id = ${userId} AND entity_type = 'artist'
  `) as { source_id: string; target_id: string }[]).map(r => [r.source_id, r.target_id]));
  const canonical = (id: string) => canon.get(id) ?? id;
  const groups = new Map(live.map(u => [u.id, artistMergeGroup(db, canonical(u.artist_id), userId)]));
  const artistIds = [...new Set([...groups.values()].flat())];

  // CROSS JOIN fija el orden: tracks del single por idx_tracks_album_id y de ahí al
  // historial por idx_lh_user_track, en vez de recorrer el historial del usuario
  const taken = sql`
    SELECT source_id FROM merge_rules WHERE user_id = ${userId} AND entity_type = 'album'
    UNION SELECT target_id FROM merge_rules WHERE user_id = ${userId} AND entity_type = 'album'
    UNION SELECT single_id FROM single_folds WHERE user_id = ${userId}
    UNION SELECT member_id FROM album_collection_members WHERE user_id = ${userId} AND member_type = 'album'`;
  const singles = db.all(sql`
    SELECT s.spotify_id AS id, s.release_date AS releaseDate, json_extract(s.artist_ids, '$[0]') AS artistId,
           s.total_tracks AS totalTracks
    FROM albums s
    WHERE s.album_type = 'single' AND s.release_date IS NOT NULL
      AND json_extract(s.artist_ids, '$[0]') IN (${idList(artistIds)})
      AND s.spotify_id NOT IN (${taken})
      AND EXISTS (
        SELECT 1 FROM tracks t CROSS JOIN listening_history lh ON lh.track_id = t.spotify_id
        WHERE t.album_id = s.spotify_id AND lh.user_id = ${userId})
  `) as SingleRow[];
  if (singles.length === 0) return [];

  const tracks = db.all(sql`
    SELECT spotify_id AS id, album_id AS albumId, name, duration_ms AS durationMs
    FROM tracks WHERE album_id IN (${idList(singles.map(s => s.id))})
  `) as TrackRow[];
  const release = (s: SingleRow): FoldRelease => ({
    id: s.id, releaseDate: s.releaseDate,
    tracks: tracks.filter(t => t.albumId === s.id).map(asFoldTrack),
  });
  const opts = { maxLeadMs: SINGLE_FOLD_MAX_LEAD_MS, durationToleranceMs: TRACK_DEDUP_DURATION_TOLERANCE_MS };

  // temas que no pueden entrar sueltos: ya en una colección, o parte de un merge de track
  const takenTracks = new Set((db.all(sql`
    SELECT member_id AS id FROM album_collection_members WHERE user_id = ${userId} AND member_type = 'track'
    UNION SELECT source_id FROM merge_rules WHERE user_id = ${userId} AND entity_type = 'track'
    UNION SELECT target_id FROM merge_rules WHERE user_id = ${userId} AND entity_type = 'track'
  `) as { id: string }[]).map(r => r.id));

  return live.flatMap(u => {
    const group = groups.get(u.id)!;
    const album = { releaseDate: u.release_date, tracks: (JSON.parse(u.tracks) as UpcomingTrack[]).map(t => asFoldTrack({ ...t, id: t.trackId })) };
    const matches = singles
      .filter(s => group.includes(s.artistId))
      .map(s => ({ s, m: upcomingMatch(release(s), s.totalTracks, album, opts) }));
    const singleIds = matches
      .filter(({ s, m }) => m?.kind === 'release' && isEligibleMember(db, 'album', s.id, group, userId))
      .map(({ s }) => s.id);
    const trackIds = matches
      .flatMap(({ m }) => m?.kind === 'tracks' ? m.trackIds : [])
      .filter(id => !takenTracks.has(id) && isEligibleMember(db, 'track', id, group, userId));
    const collectionId = folds.get(u.id)?.collection_id ?? null;
    return singleIds.length + trackIds.length === 0 ? []
      : [{ upcomingId: u.id, artistId: group[0], name: u.name, imageUrl: u.image_url, collectionId, singleIds, trackIds }];
  });
}

/** Artistas a preguntar a iTunes en esta pasada: los de algún single escuchado desde
 *  `since` (fecha de salida). Primero los que traen señal nueva —nunca preguntados, o con
 *  un single posterior a la última pregunta, que es justo lo que precede a un álbum— y,
 *  dentro, el single más reciente delante: con 567 candidatos en prod y un orden sin
 *  criterio, la primera vuelta tardaba ~6 días y Leoniden, con un single de hacía dos
 *  semanas y el álbum anunciado, no salió en la primera pasada (habría ido el 24º).
 *  Después, los que tocan por antigüedad (`recheckBefore`). */
export function upcomingCandidateArtists(db: Db, userIds: number[], since: string, recheckBefore: string, limit: number) {
  if (userIds.length === 0) return [];
  return db.all(sql`
    SELECT ar.spotify_id AS id, ar.name
    FROM (
      SELECT json_extract(s.artist_ids, '$[0]') AS artist_id, MAX(s.release_date) AS latest
      FROM albums s
      WHERE s.album_type = 'single' AND s.release_date >= ${since} AND instr(s.spotify_id, ':') = 0
        AND EXISTS (
          SELECT 1 FROM tracks t CROSS JOIN listening_history lh ON lh.track_id = t.spotify_id
          WHERE t.album_id = s.spotify_id AND lh.user_id IN (${idList(userIds)}))
      GROUP BY 1
    ) c
    JOIN artists ar ON ar.spotify_id = c.artist_id
    LEFT JOIN upcoming_artist_checks uc ON uc.artist_id = c.artist_id
    WHERE uc.checked_at IS NULL OR uc.checked_at < ${recheckBefore} OR c.latest > substr(uc.checked_at, 1, 10)
    ORDER BY (uc.checked_at IS NULL OR c.latest > substr(uc.checked_at, 1, 10)) DESC, c.latest DESC
    LIMIT ${limit}
  `) as { id: string; name: string }[];
}

/** Álbumes desde cuya página sonó algo que no es suyo y que la biblioteca no conoce: la
 *  única pista de spotify de un álbum futuro (sus temas ya publicados son los singles).
 *  Casi siempre son discos ya publicados (otra edición, relinking): los descarta quien
 *  pregunta por ellos. `context_uri` es `spotify:album:<id>`. */
export function upcomingContextCandidates(db: Db, userIds: number[], since: string, limit: number) {
  if (userIds.length === 0) return [];
  return db.all(sql`
    SELECT substr(lh.context_uri, 15) AS albumId, MIN(lh.user_id) AS userId
    FROM listening_history lh
    JOIN tracks t ON t.spotify_id = lh.track_id
    WHERE lh.user_id IN (${idList(userIds)}) AND lh.played_at >= ${since} AND lh.context_type = 'album'
      AND substr(lh.context_uri, 15) <> t.album_id
      AND NOT EXISTS (SELECT 1 FROM albums a WHERE a.spotify_id = substr(lh.context_uri, 15))
      AND NOT EXISTS (SELECT 1 FROM upcoming_albums u WHERE u.spotify_album_id = substr(lh.context_uri, 15))
    GROUP BY 1
    ORDER BY MAX(lh.played_at) DESC
    LIMIT ${limit}
  `) as { albumId: string; userId: number }[];
}
