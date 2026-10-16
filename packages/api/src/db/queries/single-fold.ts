// plan del plegado automático de singles de adelanto en su álbum (ajuste autoMergeSingles).
// Carga lo justo del catálogo y decide con pickSingleFold (shared, con tests); corre en el
// pool de lectura y las escrituras las hace services/single-fold.ts en el main thread.
//
// Los candidatos son los singles que el usuario ha escuchado y que no tocó nunca a mano:
// ni source ni target de un merge de álbum, ni miembro de una colección (dentro de un merge
// el miembro dejaría de casar con sus plays, ver canonicalMemberId), ni plegados antes por
// este barrido (single_folds, que es lo que hace durar un unmerge). Los álbumes van por su
// grupo de merge: un single se pliega en el canónico, y sus temas cuentan los de todo el
// grupo (la deluxe mergeada en la estándar aporta sus bonus).
import { sql } from 'drizzle-orm';
import { pickSingleFold, inFoldWindow, type FoldRelease, type FoldTrack, type FoldTrackPair } from '@sis/shared';
import { creditBaseKey } from '../../services/versions.js';
import { isNonSpotifyId } from '../../services/ids.js';
import { ALBUM_TRACKLIST_RECHECK_MS, SINGLE_FOLD_MAX_LEAD_MS, TRACK_DEDUP_DURATION_TOLERANCE_MS } from '../../constants.js';
import type { Db } from './helpers.js';

// tope del IN de tracks por sentencia, por debajo del límite de variables de sqlite
const TRACK_LOOKUP_CHUNK = 500;

export interface SingleFoldPlan {
  folds: { singleId: string; singleName: string; albumId: string; albumName: string; trackPairs: FoldTrackPair[] }[];
  // álbumes de la ventana de algún single sin plegar cuyo tracklist local está a medias
  // y que ensureFullAlbumTracks volvería a pedir: los más recientes primero
  pendingTracklists: { albumId: string; totalTracks: number }[];
}

interface ReleaseRow { id: string; name: string; releaseDate: string; artistId: string }
interface AlbumRow extends ReleaseRow { totalTracks: number | null; checkedAt: string | null }
interface TrackRow { id: string; albumId: string; name: string; durationMs: number; isrc: string | null }

const chunks = <T>(xs: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(xs.length / size) }, (_, i) => xs.slice(i * size, (i + 1) * size));

const sourceToTarget = (db: Db, userId: number, type: 'album' | 'artist' | 'track') =>
  new Map((db.all(sql`
    SELECT source_id, target_id FROM merge_rules WHERE user_id = ${userId} AND entity_type = ${type}
  `) as { source_id: string; target_id: string }[]).map(r => [r.source_id, r.target_id]));

export function planSingleFolds(db: Db, userId: number): SingleFoldPlan {
  const artistCanon = sourceToTarget(db, userId, 'artist');
  const canonArtist = (id: string) => artistCanon.get(id) ?? id;
  const albumTarget = sourceToTarget(db, userId, 'album');
  const trackTarget = sourceToTarget(db, userId, 'track');
  const trackTargets = new Set(trackTarget.values());

  const albumRuleIds = new Set([...albumTarget.keys(), ...albumTarget.values()]);
  const folded = new Set((db.all(sql`SELECT single_id FROM single_folds WHERE user_id = ${userId}`) as { single_id: string }[])
    .map(r => r.single_id));
  const collectionMembers = new Set((db.all(sql`
    SELECT member_id FROM album_collection_members WHERE user_id = ${userId} AND member_type = 'album'
  `) as { member_id: string }[]).map(r => r.member_id));

  // CROSS JOIN fija el orden: tracks del single por idx_tracks_album_id y de ahí al
  // historial por idx_lh_user_track, en vez de recorrer el historial del usuario
  const singles = (db.all(sql`
    SELECT s.spotify_id AS id, s.name, s.release_date AS releaseDate, json_extract(s.artist_ids, '$[0]') AS artistId
    FROM albums s
    WHERE s.album_type = 'single' AND s.release_date IS NOT NULL
      AND json_extract(s.artist_ids, '$[0]') IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM tracks t CROSS JOIN listening_history lh ON lh.track_id = t.spotify_id
        WHERE t.album_id = s.spotify_id AND lh.user_id = ${userId})
  `) as ReleaseRow[])
    .filter(s => !isNonSpotifyId(s.id) && !albumRuleIds.has(s.id) && !folded.has(s.id) && !collectionMembers.has(s.id));
  if (singles.length === 0) return { folds: [], pendingTracklists: [] };

  const albumRows = (db.all(sql`
    SELECT a.spotify_id AS id, a.name, a.release_date AS releaseDate, a.total_tracks AS totalTracks,
           a.tracklist_checked_at AS checkedAt, json_extract(a.artist_ids, '$[0]') AS artistId
    FROM albums a
    WHERE a.album_type = 'album' AND a.release_date IS NOT NULL AND json_extract(a.artist_ids, '$[0]') IS NOT NULL
  `) as AlbumRow[]).filter(a => !isNonSpotifyId(a.id));
  const albumById = new Map(albumRows.map(a => [a.id, a]));

  // grupos de merge de álbum por canónico. Sólo cuentan los grupos cuyo canónico es un
  // álbum de verdad: plegar un single dentro de otro single (o de un grupo que el usuario
  // ancló en un single) no es "el single a su álbum"
  const membersByCanonical = new Map<string, string[]>();
  for (const [source, target] of albumTarget) membersByCanonical.set(target, [...(membersByCanonical.get(target) ?? []), source]);
  const groupMembers = (canonical: string) => [canonical, ...(membersByCanonical.get(canonical) ?? [])];

  const singleArtists = new Set(singles.map(s => canonArtist(s.artistId)));
  const groupsByArtist = new Map<string, Set<string>>();
  for (const a of albumRows) {
    const artist = canonArtist(a.artistId);
    const canonical = albumTarget.get(a.id) ?? a.id;
    if (!singleArtists.has(artist) || !albumById.has(canonical)) continue;
    groupsByArtist.set(artist, (groupsByArtist.get(artist) ?? new Set()).add(canonical));
  }

  // fecha del grupo = la de su primer álbum: es el lanzamiento al que adelantaba el single
  const groupDate = (canonical: string) => groupMembers(canonical)
    .map(id => albumById.get(id)?.releaseDate)
    .filter((d): d is string => !!d)
    .sort()[0] ?? '';
  const windowGroups = new Map(singles.map(s => {
    const single = { id: s.id, releaseDate: s.releaseDate, tracks: [] };
    const groups = [...(groupsByArtist.get(canonArtist(s.artistId)) ?? [])]
      .filter(g => inFoldWindow(single, { id: g, releaseDate: groupDate(g), tracks: [] }, SINGLE_FOLD_MAX_LEAD_MS));
    return [s.id, groups] as const;
  }));

  const candidates = singles.filter(s => windowGroups.get(s.id)!.length > 0);
  const neededAlbums = [...new Set([
    ...candidates.map(s => s.id),
    ...candidates.flatMap(s => windowGroups.get(s.id)!.flatMap(groupMembers)),
  ])];
  const tracksByAlbum = new Map<string, TrackRow[]>();
  for (const ids of chunks(neededAlbums, TRACK_LOOKUP_CHUNK)) {
    const rows = db.all(sql`
      SELECT spotify_id AS id, album_id AS albumId, name, duration_ms AS durationMs, NULLIF(isrc, '') AS isrc
      FROM tracks WHERE album_id IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})
    `) as TrackRow[];
    for (const t of rows) tracksByAlbum.set(t.albumId, [...(tracksByAlbum.get(t.albumId) ?? []), t]);
  }

  // un sintético nunca entra en un merge nuevo (ni de source ni de target); del lado del
  // single tampoco lo que ya está mergeado, y del lado del álbum lo que ya es alias de otro
  const asFoldTrack = (t: TrackRow, locked: boolean): FoldTrack =>
    ({ id: t.id, key: creditBaseKey(t.name), durationMs: t.durationMs, isrc: t.isrc, locked: locked || isNonSpotifyId(t.id) });
  const singleRelease = (s: ReleaseRow): FoldRelease => ({
    id: s.id, releaseDate: s.releaseDate,
    tracks: (tracksByAlbum.get(s.id) ?? []).map(t => asFoldTrack(t, trackTarget.has(t.id) || trackTargets.has(t.id))),
  });
  const groupRelease = (canonical: string): FoldRelease => ({
    id: canonical, releaseDate: groupDate(canonical),
    tracks: groupMembers(canonical).flatMap(id => tracksByAlbum.get(id) ?? []).map(t => asFoldTrack(t, trackTarget.has(t.id))),
  });

  const opts = { maxLeadMs: SINGLE_FOLD_MAX_LEAD_MS, durationToleranceMs: TRACK_DEDUP_DURATION_TOLERANCE_MS };
  const decisions = candidates.map(s => ({ s, fold: pickSingleFold(singleRelease(s), windowGroups.get(s.id)!.map(groupRelease), opts) }));

  const folds = decisions.flatMap(({ s, fold }) => fold
    ? [{ singleId: s.id, singleName: s.name, albumId: fold.albumId, albumName: albumById.get(fold.albumId)!.name, trackPairs: fold.trackPairs }]
    : []);

  // un single sin álbum puede ser uno cuyo gemelo isrc se plegó en SU track y dejó al
  // álbum sin fila para ese tema: rellenar el tracklist lo devuelve para la pasada siguiente
  const recheckBefore = Date.now() - ALBUM_TRACKLIST_RECHECK_MS;
  const pendingTracklists = [...new Map(decisions
    .filter(d => !d.fold)
    .flatMap(({ s }) => windowGroups.get(s.id)!.flatMap(groupMembers))
    .map(id => albumById.get(id))
    .filter((a): a is AlbumRow => !!a && !!a.totalTracks
      && (tracksByAlbum.get(a.id)?.length ?? 0) < a.totalTracks
      && (!a.checkedAt || Date.parse(a.checkedAt) < recheckBefore))
    .map(a => [a.id, a] as const)).values()]
    .sort((a, b) => b.releaseDate.localeCompare(a.releaseDate))
    .map(a => ({ albumId: a.id, totalTracks: a.totalTracks! }));

  return { folds, pendingTracklists };
}
