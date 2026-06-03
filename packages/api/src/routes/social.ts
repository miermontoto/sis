import { Hono } from 'hono';
import crypto from 'crypto';
import { sql, eq, and } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { follows, shareLinks } from '../db/schema.js';
import { dbRead } from '../db/read-pool.js';
import { getRangeStart } from '../db/queries/index.js';
import type { ComparisonResult } from '../db/queries/index.js';
import { findUserBySpotifyId, getUserById } from '../services/user-manager.js';
import { isUserHidden, hiddenSpotifyIdsSubquery, getSocialNowPlaying, buildProfile, parseTimeRange, publicBase } from '../services/social.js';
import { SHARE_TOKEN_BYTES, FEED_RECENT_DAYS, FEED_PLAYS_LIMIT, TIME_RANGES } from '../constants.js';
import type { TimeRange } from '../constants.js';
import type { AppVariables } from '../app.js';
import type { DirectoryUser, FollowListResponse, FeedItem, FeedPlayItem, FeedResponse, ShareLink, CreateShareLinkRequest, CompareResponse } from '@sis/shared';

const social = new Hono<{ Variables: AppVariables }>();

// resuelve el usuario objetivo de un param :spotifyId aplicando visibilidad.
// devuelve null si no existe, está inactivo o está oculto (y no es el propio viewer).
function resolveVisibleTarget(spotifyId: string, viewerSpotifyId: string) {
  const target = findUserBySpotifyId(spotifyId);
  if (!target || !target.isActive) return null;
  if (target.spotifyId !== viewerSpotifyId && isUserHidden(target.spotifyId)) return null;
  return target;
}

// --- directorio de usuarios ---

social.get('/users', async (c) => {
  const userId = c.get('userId');
  const db = getDb();

  const rows = db.all(sql`
    SELECT
      u.id,
      u.spotify_id AS spotifyId,
      u.display_name AS displayName,
      u.image_url AS imageUrl,
      EXISTS(SELECT 1 FROM follows f WHERE f.follower_id = ${userId} AND f.followed_id = u.id) AS isFollowing,
      EXISTS(SELECT 1 FROM follows f WHERE f.follower_id = u.id AND f.followed_id = ${userId}) AS followsYou
    FROM users u
    WHERE u.id != ${userId}
      AND u.is_active = 1
      AND u.spotify_id NOT IN (${hiddenSpotifyIdsSubquery()})
    ORDER BY u.display_name COLLATE NOCASE ASC
  `) as any[];

  if (rows.length === 0) return c.json([]);

  // vistazo de actividad: top artist del último mes + total de plays all-time
  const monthAgo = getRangeStart('month');
  const ids = rows.map(r => r.id as number);
  const [activity, counts] = await Promise.all([
    dbRead<any[]>('getFeedActivity', ids, monthAgo),
    Promise.all(ids.map(id => dbRead<number>('getUserPlayCount', id))),
  ]);
  const activityMap = new Map(activity.map(a => [a.userId, a]));
  const countMap = new Map(ids.map((id, i) => [id, counts[i]]));

  const result: DirectoryUser[] = rows.map(r => ({
    spotifyId: r.spotifyId,
    displayName: r.displayName,
    imageUrl: r.imageUrl,
    isFollowing: !!r.isFollowing,
    followsYou: !!r.followsYou,
    totalPlays: countMap.get(r.id) ?? 0,
    nowPlaying: getSocialNowPlaying(r.id),
    topArtist: activityMap.get(r.id)?.topArtist ?? null,
  }));
  return c.json(result);
});

// --- perfil ---

social.get('/profile/:spotifyId', async (c) => {
  const target = resolveVisibleTarget(c.req.param('spotifyId'), c.get('spotifyId'));
  if (!target) return c.json({ error: 'perfil no disponible' }, 404);

  const range = parseTimeRange(c.req.query('range'));
  const profile = await buildProfile(target, range);

  const db = getDb();
  const isFollowing = !!db.select().from(follows)
    .where(and(eq(follows.followerId, c.get('userId')), eq(follows.followedId, target.id)))
    .get();

  return c.json({ ...profile, isFollowing });
});

// --- compare / blend ---

// nº de ítems por lista en los tops lado a lado de compare
const COMPARE_SIDE_LIMIT = 10;

social.get('/compare/:spotifyId', async (c) => {
  const viewerId = c.get('userId');
  const target = resolveVisibleTarget(c.req.param('spotifyId'), c.get('spotifyId'));
  if (!target) return c.json({ error: 'perfil no disponible' }, 404);
  if (target.id === viewerId) return c.json({ error: 'no puedes compararte contigo mismo' }, 400);

  const range = parseTimeRange(c.req.query('range'), 'all');
  const rangeStart = getRangeStart(range);

  const viewer = getUserById(viewerId);
  if (!viewer) return c.json({ error: 'no autorizado' }, 401);

  // resúmenes y rachas siempre all-time (tarjeta de identidad); el range
  // sólo afecta a tops y compartidos
  const [comparison, myProfile, theirProfile, myStreaks, theirStreaks] = await Promise.all([
    dbRead<ComparisonResult>('getUserComparison', viewerId, target.id, rangeStart, null),
    dbRead<any>('getProfileSummary', viewerId, null, null),
    dbRead<any>('getProfileSummary', target.id, null, null),
    dbRead<any>('getUserStreaks', viewerId),
    dbRead<any>('getUserStreaks', target.id),
  ]);

  const formatSide = (rows: { entity_id: string; play_count: number; total_ms: number }[], fn: string, batch = false) => {
    const top = rows.slice(0, COMPARE_SIDE_LIMIT);
    return batch
      ? dbRead<any[]>(fn, top)
      : Promise.all(top.map(row => dbRead<any>(fn, row)));
  };

  const [myTopArtists, theirTopArtists, myTopTracks, theirTopTracks, myTopAlbums, theirTopAlbums] = await Promise.all([
    formatSide(comparison.myTopArtists, 'formatTopArtistRow'),
    formatSide(comparison.theirTopArtists, 'formatTopArtistRow'),
    formatSide(comparison.myTopTracks, 'formatTopTrackRows', true),
    formatSide(comparison.theirTopTracks, 'formatTopTrackRows', true),
    formatSide(comparison.myTopAlbums, 'formatTopAlbumRow'),
    formatSide(comparison.theirTopAlbums, 'formatTopAlbumRow'),
  ]);

  const summaryOf = (u: { spotifyId: string; displayName: string | null; imageUrl: string | null }, s: any) => ({
    spotifyId: u.spotifyId,
    displayName: u.displayName,
    imageUrl: u.imageUrl,
    totalPlays: s.play_count,
    totalMs: s.total_ms,
    distinctArtists: s.distinct_artists,
    distinctTracks: s.distinct_tracks,
    distinctAlbums: s.distinct_albums,
    firstPlayedAt: s.first_played,
  });

  const noRankChange = { rankChange: null, previousRank: null, isNew: false };
  const withNoRankChange = (items: any[]) => items.map(i => ({ ...i, ...noRankChange }));

  const result: CompareResponse = {
    me: summaryOf(viewer, myProfile),
    them: summaryOf(target, theirProfile),
    range,
    overlapPercent: comparison.overlapPercent,
    overlapByType: comparison.overlapByType,
    sharedArtists: comparison.sharedArtists,
    sharedTracks: comparison.sharedTracks,
    sharedAlbums: comparison.sharedAlbums,
    myTopArtists: withNoRankChange(myTopArtists),
    theirTopArtists: withNoRankChange(theirTopArtists),
    myTopTracks: withNoRankChange(myTopTracks),
    theirTopTracks: withNoRankChange(theirTopTracks),
    myTopAlbums: withNoRankChange(myTopAlbums),
    theirTopAlbums: withNoRankChange(theirTopAlbums),
    myStreaks,
    theirStreaks,
  };
  return c.json(result);
});

// --- follows ---

social.get('/follows', (c) => {
  const userId = c.get('userId');
  const db = getDb();

  const mapRows = (rows: any[]) => rows.map(r => ({
    spotifyId: r.spotifyId,
    displayName: r.displayName,
    imageUrl: r.imageUrl,
    followedAt: r.followedAt,
  }));

  const following = db.all(sql`
    SELECT u.spotify_id AS spotifyId, u.display_name AS displayName, u.image_url AS imageUrl, f.created_at AS followedAt
    FROM follows f JOIN users u ON u.id = f.followed_id
    WHERE f.follower_id = ${userId} AND u.is_active = 1
      AND u.spotify_id NOT IN (${hiddenSpotifyIdsSubquery()})
    ORDER BY f.created_at DESC
  `) as any[];

  const followers = db.all(sql`
    SELECT u.spotify_id AS spotifyId, u.display_name AS displayName, u.image_url AS imageUrl, f.created_at AS followedAt
    FROM follows f JOIN users u ON u.id = f.follower_id
    WHERE f.followed_id = ${userId} AND u.is_active = 1
      AND u.spotify_id NOT IN (${hiddenSpotifyIdsSubquery()})
    ORDER BY f.created_at DESC
  `) as any[];

  const result: FollowListResponse = { following: mapRows(following), followers: mapRows(followers) };
  return c.json(result);
});

social.post('/follows/:spotifyId', (c) => {
  const userId = c.get('userId');
  const target = resolveVisibleTarget(c.req.param('spotifyId'), c.get('spotifyId'));
  // 404 también para ocultos: no confirmar existencia
  if (!target) return c.json({ error: 'usuario no disponible' }, 404);
  if (target.id === userId) return c.json({ error: 'no puedes seguirte a ti mismo' }, 400);

  const db = getDb();
  db.insert(follows)
    .values({ followerId: userId, followedId: target.id, createdAt: new Date().toISOString() })
    .onConflictDoNothing()
    .run();
  return c.json({ success: true, following: true });
});

social.delete('/follows/:spotifyId', (c) => {
  const userId = c.get('userId');
  // unfollow no requiere visibilidad: si se ocultó después de seguirle, poder dejar de seguir
  const target = findUserBySpotifyId(c.req.param('spotifyId'));
  if (!target) return c.json({ error: 'usuario no disponible' }, 404);

  const db = getDb();
  db.delete(follows)
    .where(and(eq(follows.followerId, userId), eq(follows.followedId, target.id)))
    .run();
  return c.json({ success: true, following: false });
});

// --- feed de actividad ---

social.get('/feed', async (c) => {
  const userId = c.get('userId');
  const db = getDb();

  // usuarios seguidos, filtrando ocultos a tiempo de lectura
  const followed = db.all(sql`
    SELECT u.id, u.spotify_id AS spotifyId, u.display_name AS displayName, u.image_url AS imageUrl
    FROM follows f JOIN users u ON u.id = f.followed_id
    WHERE f.follower_id = ${userId} AND u.is_active = 1
      AND u.spotify_id NOT IN (${hiddenSpotifyIdsSubquery()})
    ORDER BY f.created_at DESC
  `) as { id: number; spotifyId: string; displayName: string | null; imageUrl: string | null }[];

  if (followed.length === 0) return c.json({ users: [], recentPlays: [] } satisfies FeedResponse);

  const followedIds = followed.map(u => u.id);
  const since = new Date(Date.now() - FEED_RECENT_DAYS * 86_400_000).toISOString();
  const [activity, plays] = await Promise.all([
    dbRead<any[]>('getFeedActivity', followedIds, since),
    dbRead<any[]>('getRecentPlaysForUsers', followedIds, FEED_PLAYS_LIMIT),
  ]);
  const activityMap = new Map(activity.map(a => [a.userId, a]));
  const userMap = new Map(followed.map(u => [u.id, { spotifyId: u.spotifyId, displayName: u.displayName, imageUrl: u.imageUrl }]));

  const users: FeedItem[] = followed.map(u => {
    const a = activityMap.get(u.id);
    return {
      user: userMap.get(u.id)!,
      recentPlays: a?.recentPlays ?? 0,
      recentMs: a?.recentMs ?? 0,
      topArtist: a?.topArtist ?? null,
      topTrack: a?.topTrack ?? null,
      nowPlaying: getSocialNowPlaying(u.id),
    };
  });

  // los que están escuchando ahora primero, luego por actividad reciente
  users.sort((x, y) => Number(!!y.nowPlaying) - Number(!!x.nowPlaying) || y.recentPlays - x.recentPlays);

  const recentPlays: FeedPlayItem[] = plays.map(p => ({
    user: userMap.get(p.userId)!,
    track: { id: p.trackId, name: p.trackName, artists: p.artistNames || '', albumImageUrl: p.albumImageUrl },
    playedAt: p.playedAt,
  }));

  return c.json({ users, recentPlays } satisfies FeedResponse);
});

// --- share links ---

function mapShareLink(row: typeof shareLinks.$inferSelect): ShareLink {
  return {
    token: row.token,
    kind: row.kind as 'profile',
    range: (row.range as TimeRange | null) ?? null,
    label: row.label,
    createdAt: row.createdAt,
    revokedAt: row.revokedAt,
    lastAccessedAt: row.lastAccessedAt,
    url: `${publicBase()}/s/${row.token}`,
  };
}

social.get('/share-links', (c) => {
  const userId = c.get('userId');
  const db = getDb();
  const rows = db.select().from(shareLinks)
    .where(eq(shareLinks.userId, userId))
    .all()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return c.json(rows.map(mapShareLink));
});

social.post('/share-links', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<CreateShareLinkRequest>().catch(() => ({} as CreateShareLinkRequest));

  // range opcional: si viene, debe ser un TimeRange válido (queda congelado en el enlace)
  const range = body.range != null
    ? (body.range in TIME_RANGES ? body.range : undefined)
    : null;
  if (range === undefined) return c.json({ error: 'range inválido' }, 400);

  const token = crypto.randomBytes(SHARE_TOKEN_BYTES).toString('hex');
  const db = getDb();
  const row = db.insert(shareLinks).values({
    token,
    userId,
    kind: 'profile',
    range,
    label: body.label?.slice(0, 100) ?? null,
    createdAt: new Date().toISOString(),
  }).returning().get();

  return c.json(mapShareLink(row), 201);
});

social.delete('/share-links/:token', (c) => {
  const userId = c.get('userId');
  const db = getDb();
  const result = db.update(shareLinks)
    .set({ revokedAt: new Date().toISOString() })
    .where(and(eq(shareLinks.token, c.req.param('token')), eq(shareLinks.userId, userId)))
    .run();
  if (result.changes === 0) return c.json({ error: 'enlace no encontrado' }, 404);
  return c.json({ success: true });
});

export default social;
