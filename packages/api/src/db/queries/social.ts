import { sql } from 'drizzle-orm';
import type { Db, AggregateRow } from './helpers.js';
import { rangeWhere, userFilter, playDuration } from './helpers.js';
import { getTopEntities } from './entity.js';
import { getStreakDays } from './inline.js';
import { COMPARE_TOP_LIMIT, SOCIAL_OVERLAP_WEIGHT_DECAY, OVERLAP_TYPE_WEIGHTS } from '../../constants.js';

// --- perfil ---

export interface ProfileSummaryRow {
  play_count: number;
  total_ms: number;
  distinct_artists: number;
  distinct_tracks: number;
  distinct_albums: number;
  first_played: string | null;
}

/** Agregados globales de la librería de un usuario (para perfil / share).
 *  Counts sobre IDs crudos (sin resolver merges) — suficiente para un resumen. */
export function getProfileSummary(db: Db, userId: number, rangeStart: string | null, rangeEnd: string | null | undefined): ProfileSummaryRow {
  const wr = rangeWhere(rangeStart, rangeEnd);
  const uf = userFilter(userId);

  return db.all(sql`
    SELECT
      count(*) as play_count,
      coalesce(sum(${playDuration()}), 0) as total_ms,
      count(DISTINCT (SELECT ta.artist_id FROM track_artists ta WHERE ta.track_id = lh.track_id AND ta.position = 0)) as distinct_artists,
      count(DISTINCT lh.track_id) as distinct_tracks,
      count(DISTINCT t.album_id) as distinct_albums,
      min(lh.played_at) as first_played
    FROM listening_history lh
    JOIN tracks t ON t.spotify_id = lh.track_id
    WHERE 1=1 ${wr} ${uf}
  `)[0] as ProfileSummaryRow;
}

// --- compare / blend ---

export interface SharedItemRow {
  id: string;
  name: string;
  imageUrl: string | null;
  myRank: number;
  theirRank: number;
}

export interface ComparisonResult {
  overlapPercent: number;
  overlapByType: { artists: number; tracks: number; albums: number };
  sharedArtists: SharedItemRow[];
  sharedTracks: SharedItemRow[];
  sharedAlbums: SharedItemRow[];
  myTopArtists: AggregateRow[];
  theirTopArtists: AggregateRow[];
  myTopTracks: AggregateRow[];
  theirTopTracks: AggregateRow[];
  myTopAlbums: AggregateRow[];
  theirTopAlbums: AggregateRow[];
}

/** Peso de un ítem según su rank (1-based): los favoritos altos pesan más. */
function rankWeight(rank: number): number {
  return Math.pow(SOCIAL_OVERLAP_WEIGHT_DECAY, rank - 1);
}

/** Solapamiento ponderado entre dos listas top (por entity_id).
 *  score = Σ min(wA, wB) sobre ítems compartidos / min(ΣwA, ΣwB), escalado a 0..100.
 *  Simétrico y normalizado por la lista "más corta" para no penalizar libreras pequeñas. */
function weightedOverlap(a: AggregateRow[], b: AggregateRow[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const rankA = new Map(a.map((r, i) => [r.entity_id, i + 1]));
  const rankB = new Map(b.map((r, i) => [r.entity_id, i + 1]));

  let shared = 0;
  for (const [id, ra] of rankA) {
    const rb = rankB.get(id);
    if (rb !== undefined) shared += Math.min(rankWeight(ra), rankWeight(rb));
  }

  const sum = (n: number) => Array.from({ length: n }, (_, i) => rankWeight(i + 1)).reduce((s, w) => s + w, 0);
  const denom = Math.min(sum(a.length), sum(b.length));
  return denom > 0 ? Math.round((shared / denom) * 100) : 0;
}

/** Ítems compartidos entre dos listas top, con el rank en cada una. */
function sharedItems(a: AggregateRow[], b: AggregateRow[]): { id: string; myRank: number; theirRank: number }[] {
  const rankB = new Map(b.map((r, i) => [r.entity_id, i + 1]));
  const out: { id: string; myRank: number; theirRank: number }[] = [];
  a.forEach((r, i) => {
    const theirRank = rankB.get(r.entity_id);
    if (theirRank !== undefined) out.push({ id: r.entity_id, myRank: i + 1, theirRank });
  });
  // ordenar por suma de ranks: lo más compartido-y-alto primero
  out.sort((x, y) => (x.myRank + x.theirRank) - (y.myRank + y.theirRank));
  return out;
}

/** Enriquecer ids de artista con nombre + imagen. */
function enrichArtists(db: Db, items: { id: string; myRank: number; theirRank: number }[]): SharedItemRow[] {
  return items.map((it) => {
    const row = db.get(sql`SELECT name, image_url as imageUrl FROM artists WHERE spotify_id = ${it.id}`) as { name: string; imageUrl: string | null } | undefined;
    return { ...it, name: row?.name ?? it.id, imageUrl: row?.imageUrl ?? null };
  });
}

/** Enriquecer ids de track con nombre + portada del álbum. */
function enrichTracks(db: Db, items: { id: string; myRank: number; theirRank: number }[]): SharedItemRow[] {
  return items.map((it) => {
    const row = db.get(sql`
      SELECT t.name, a.image_url as imageUrl
      FROM tracks t LEFT JOIN albums a ON a.spotify_id = t.album_id
      WHERE t.spotify_id = ${it.id}
    `) as { name: string; imageUrl: string | null } | undefined;
    return { ...it, name: row?.name ?? it.id, imageUrl: row?.imageUrl ?? null };
  });
}

/** Enriquecer ids de álbum con nombre + portada. */
function enrichAlbums(db: Db, items: { id: string; myRank: number; theirRank: number }[]): SharedItemRow[] {
  return items.map((it) => {
    const row = db.get(sql`SELECT name, image_url as imageUrl FROM albums WHERE spotify_id = ${it.id}`) as { name: string; imageUrl: string | null } | undefined;
    return { ...it, name: row?.name ?? it.id, imageUrl: row?.imageUrl ?? null };
  });
}

/** Comparación de gustos entre dos usuarios: tops independientes + intersección en JS.
 *  Evita un JOIN cruzado entre los historiales; barato a escala de instancia. */
export function getUserComparison(db: Db, userIdA: number, userIdB: number, rangeStart: string | null, rangeEnd: string | null | undefined): ComparisonResult {
  const topArtistsA = getTopEntities(db, 'artist', rangeStart, 'time', COMPARE_TOP_LIMIT, rangeEnd, userIdA);
  const topArtistsB = getTopEntities(db, 'artist', rangeStart, 'time', COMPARE_TOP_LIMIT, rangeEnd, userIdB);
  const topTracksA = getTopEntities(db, 'track', rangeStart, 'time', COMPARE_TOP_LIMIT, rangeEnd, userIdA);
  const topTracksB = getTopEntities(db, 'track', rangeStart, 'time', COMPARE_TOP_LIMIT, rangeEnd, userIdB);
  const topAlbumsA = getTopEntities(db, 'album', rangeStart, 'time', COMPARE_TOP_LIMIT, rangeEnd, userIdA);
  const topAlbumsB = getTopEntities(db, 'album', rangeStart, 'time', COMPARE_TOP_LIMIT, rangeEnd, userIdB);

  // overlap por tipo + combinado ponderado (artistas = gusto general)
  const overlapByType = {
    artists: weightedOverlap(topArtistsA, topArtistsB),
    tracks: weightedOverlap(topTracksA, topTracksB),
    albums: weightedOverlap(topAlbumsA, topAlbumsB),
  };
  const overlapPercent = Math.round(
    overlapByType.artists * OVERLAP_TYPE_WEIGHTS.artists
    + overlapByType.tracks * OVERLAP_TYPE_WEIGHTS.tracks
    + overlapByType.albums * OVERLAP_TYPE_WEIGHTS.albums
  );

  return {
    overlapPercent,
    overlapByType,
    sharedArtists: enrichArtists(db, sharedItems(topArtistsA, topArtistsB)),
    sharedTracks: enrichTracks(db, sharedItems(topTracksA, topTracksB)),
    sharedAlbums: enrichAlbums(db, sharedItems(topAlbumsA, topAlbumsB)),
    myTopArtists: topArtistsA,
    theirTopArtists: topArtistsB,
    myTopTracks: topTracksA,
    theirTopTracks: topTracksB,
    myTopAlbums: topAlbumsA,
    theirTopAlbums: topAlbumsB,
  };
}

// --- streaks ---

export interface StreaksRow {
  currentStreak: number;
  longestStreak: number;
  totalDays: number;
}

const DAY_MS = 86_400_000;

/** Rachas de escucha de un usuario (días consecutivos con plays).
 *  Computa en el worker para devolver 3 números en vez de serializar todos los días. */
export function getUserStreaks(db: Db, userId: number): StreaksRow {
  const days = getStreakDays(db, userId);
  if (days.length === 0) return { currentStreak: 0, longestStreak: 0, totalDays: 0 };

  let longestStreak = 1;
  let tempStreak = 1;
  for (let i = 1; i < days.length; i++) {
    const diffDays = (new Date(days[i].day).getTime() - new Date(days[i - 1].day).getTime()) / DAY_MS;
    if (diffDays === 1) tempStreak++;
    else tempStreak = 1;
    longestStreak = Math.max(longestStreak, tempStreak);
  }

  // la racha actual sigue viva si el último día es hoy o ayer
  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - DAY_MS).toISOString().split('T')[0];
  const lastDay = days[days.length - 1].day;
  let currentStreak = 0;
  if (lastDay === today || lastDay === yesterday) {
    currentStreak = 1;
    for (let i = days.length - 2; i >= 0; i--) {
      const diff = (new Date(days[i + 1].day).getTime() - new Date(days[i].day).getTime()) / DAY_MS;
      if (diff === 1) currentStreak++;
      else break;
    }
  }

  return { currentStreak, longestStreak, totalDays: days.length };
}

// --- feed ---

export interface FeedActivityRow {
  userId: number;
  recentPlays: number;
  recentMs: number;
  topArtist: { id: string; name: string; imageUrl: string | null } | null;
  topTrack: { id: string; name: string; albumImageUrl: string | null } | null;
}

export interface FeedPlayRow {
  userId: number;
  playedAt: string;
  trackId: string;
  trackName: string;
  albumImageUrl: string | null;
  artistNames: string | null;
}

/** Stream cronológico de plays de un conjunto de usuarios (feed). */
export function getRecentPlaysForUsers(db: Db, userIds: number[], limit: number): FeedPlayRow[] {
  if (userIds.length === 0) return [];
  const ids = sql.join(userIds.map(id => sql`${id}`), sql`, `);

  return db.all(sql`
    SELECT
      lh.user_id AS userId,
      lh.played_at AS playedAt,
      t.spotify_id AS trackId,
      t.name AS trackName,
      a.image_url AS albumImageUrl,
      (SELECT GROUP_CONCAT(a2.name, ', ')
       FROM track_artists ta2
       JOIN artists a2 ON a2.spotify_id = ta2.artist_id
       WHERE ta2.track_id = t.spotify_id
       ORDER BY ta2.position) AS artistNames
    FROM listening_history lh
    JOIN tracks t ON t.spotify_id = lh.track_id
    LEFT JOIN albums a ON a.spotify_id = t.album_id
    WHERE lh.user_id IN (${ids})
    ORDER BY lh.played_at DESC
    LIMIT ${limit}
  `) as FeedPlayRow[];
}

/** Total de plays all-time de un usuario (barato: índice por user_id). */
export function getUserPlayCount(db: Db, userId: number): number {
  const row = db.get(sql`SELECT count(*) as c FROM listening_history WHERE user_id = ${userId}`) as { c: number } | undefined;
  return row?.c ?? 0;
}

/** Actividad reciente de un conjunto de usuarios (para el feed de follows).
 *  Loop por usuario: pocos follows a escala de instancia, queries simples. */
export function getFeedActivity(db: Db, userIds: number[], sinceIso: string): FeedActivityRow[] {
  return userIds.map((userId) => {
    const totals = db.get(sql`
      SELECT count(*) as play_count, coalesce(sum(${playDuration()}), 0) as total_ms
      FROM listening_history lh
      JOIN tracks t ON t.spotify_id = lh.track_id
      WHERE lh.user_id = ${userId} AND lh.played_at >= ${sinceIso}
    `) as { play_count: number; total_ms: number } | undefined;

    const topArtistRow = getTopEntities(db, 'artist', sinceIso, 'time', 1, null, userId)[0];
    const topTrackRow = getTopEntities(db, 'track', sinceIso, 'time', 1, null, userId)[0];

    const topArtist = topArtistRow
      ? (() => {
          const a = db.get(sql`SELECT name, image_url as imageUrl FROM artists WHERE spotify_id = ${topArtistRow.entity_id}`) as { name: string; imageUrl: string | null } | undefined;
          return { id: topArtistRow.entity_id, name: a?.name ?? topArtistRow.entity_id, imageUrl: a?.imageUrl ?? null };
        })()
      : null;

    const topTrack = topTrackRow
      ? (() => {
          const t = db.get(sql`
            SELECT t.name, a.image_url as albumImageUrl
            FROM tracks t LEFT JOIN albums a ON a.spotify_id = t.album_id
            WHERE t.spotify_id = ${topTrackRow.entity_id}
          `) as { name: string; albumImageUrl: string | null } | undefined;
          return { id: topTrackRow.entity_id, name: t?.name ?? topTrackRow.entity_id, albumImageUrl: t?.albumImageUrl ?? null };
        })()
      : null;

    return {
      userId,
      recentPlays: totals?.play_count ?? 0,
      recentMs: totals?.total_ms ?? 0,
      topArtist,
      topTrack,
    };
  });
}
