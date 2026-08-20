import { eq, sql } from 'drizzle-orm';
import { getDb } from '../../db/connection.js';
import { dbRead } from '../../db/read-pool.js';
import { RECORDS_LIMIT, SESSION_GAP_MS, RECENT_CHANGES_DEFAULT_DAYS, RECENT_CHANGES_MAX_DAYS, RANKINGS_BATCH_LIMIT } from '../../constants.js';
import { getCachedRecords, getEntityAccolades } from '../../services/records-cache.js';
import { getRecentRankChangesCached, readRankLimits } from '../../services/recent-changes-cache.js';
import { computeProjectedRankingsBatch } from '../../db/queries/index.js';
import { pollingState, tracks, artists, trackArtists, albums } from '../../db/schema.js';
import { fetchEntityMetadata } from '../../db/queries/charts.js';
import type { ProjectionResult, ProjectedRankingsResponse, CrossoverEntity, EntityType, RecentRankChangesResponse } from '@sis/shared';
import { statsRouter, parseWeekStart, parseSort, parseRecordsUnique, toEntityType } from './_shared.js';

const records = statsRouter();

records.get('/records', async (c) => {
  const userId = c.get('userId');
  const weekStart = parseWeekStart(c);
  const sort = parseSort(c);
  const unique = parseRecordsUnique(c);
  const limit = Math.min(parseInt(c.req.query('limit') || String(RECORDS_LIMIT)), 50);
  const rawType = c.req.query('type');
  const type = rawType ? toEntityType(rawType) : undefined;

  const cached = getCachedRecords(userId, weekStart, sort, limit, type, unique);
  if (cached) return c.json(cached);
  return c.json(await dbRead('getRecords', weekStart, sort, limit, type, userId, unique));
});

records.get('/accolades/:type/:id', (c) => {
  const userId = c.get('userId');
  const entityType = c.req.param('type') as EntityType;
  const id = c.req.param('id');
  return c.json(getEntityAccolades(entityType, id, userId));
});

records.get('/rankings/:type/:id', async (c) => {
  const entityType = c.req.param('type') as EntityType;
  const id = c.req.param('id');
  const userId = c.get('userId');
  return c.json(await dbRead('computeRankings', entityType, id, parseSort(c), userId));
});

// ranking all-time por lotes: posición global de cada entidad listada en una vista
// de detalle (top tracks/albums del artista, tracks del álbum) con un solo scan.
records.get('/rankings-batch', async (c) => {
  const userId = c.get('userId');
  const type = c.req.query('type');
  if (type !== 'track' && type !== 'album') return c.json({ error: 'invalid type' }, 400);
  const ids = (c.req.query('ids') ?? '').split(',').filter(Boolean).slice(0, RANKINGS_BATCH_LIMIT);
  if (ids.length === 0) return c.json({});
  return c.json(await dbRead('computeRankingsBatch', type, ids, parseSort(c), userId));
});

records.get('/ranking-history/:type/:id', async (c) => {
  const entityType = c.req.param('type') as EntityType;
  const id = c.req.param('id');
  const userId = c.get('userId');
  const fn = c.req.query('crossovers') === 'true' ? 'getRankingHistoryWithCrossovers' : 'getRankingHistory';
  return c.json(await dbRead(fn, entityType, id, parseSort(c), userId));
});

// cambios de posición recientes: ranking actual vs hace N días, por tipo de entidad.
// mismo espíritu que projected-rankings pero permanente (no depende de la sesión).
// respeta los mismos límites de rank que la session card y sirve desde la cache SWR.
records.get('/recent-rank-changes', async (c) => {
  const userId = c.get('userId');
  const spotifyId = c.get('spotifyId');
  const sort = parseSort(c);
  const rawDays = parseInt(c.req.query('days') || String(RECENT_CHANGES_DEFAULT_DAYS), 10);
  const days = Math.min(Math.max(Number.isNaN(rawDays) ? RECENT_CHANGES_DEFAULT_DAYS : rawDays, 1), RECENT_CHANGES_MAX_DAYS);

  const data = await getRecentRankChangesCached(userId, spotifyId, days, sort);
  return c.json(data satisfies RecentRankChangesResponse);
});

records.get('/projected-rankings', (c) => {
  const userId = c.get('userId');
  const spotifyId = c.get('spotifyId');
  const sort = parseSort(c);
  const db = getDb();

  const rankLimits = readRankLimits(spotifyId);

  const state = db.select().from(pollingState).where(eq(pollingState.userId, userId)).get();

  // --- recopilar targets de session ---
  type TargetInfo = { entityId: string; entityType: 'track' | 'artist' | 'album'; extraPlays: number; extraMs: number };
  const sessionTargets: TargetInfo[] = [];

  // session: plays desde session_started_at (o derivado del último gap en listening_history)
  const sessionRow = db.get(sql`SELECT session_started_at FROM polling_state WHERE user_id = ${userId}`) as { session_started_at: string | null } | undefined;
  let sessionStart = sessionRow?.session_started_at ?? null;

  if (!sessionStart && state?.lastCurrentlyPlayingTrackId) {
    // derivar solo si hay reproducción activa (session_started_at puede perderse tras restart)
    const BUFFER_MS = 2 * 60_000;
    const recentPlays = db.all(sql`
      SELECT lh.played_at, t.duration_ms
      FROM listening_history lh
      JOIN tracks t ON t.spotify_id = lh.track_id
      WHERE lh.user_id = ${userId}
      ORDER BY lh.played_at DESC
      LIMIT 100
    `) as { played_at: string; duration_ms: number }[];

    if (recentPlays.length > 0) {
      sessionStart = recentPlays[0].played_at;
      for (let i = 0; i < recentPlays.length - 1; i++) {
        const cur = new Date(recentPlays[i].played_at).getTime();
        const prev = new Date(recentPlays[i + 1].played_at).getTime();
        const prevDuration = recentPlays[i + 1].duration_ms ?? 0;
        const threshold = Math.max(SESSION_GAP_MS, prevDuration + BUFFER_MS);
        if (cur - prev > threshold) {
          sessionStart = recentPlays[i].played_at;
          break;
        }
        sessionStart = recentPlays[i + 1].played_at;
      }
    }
  }

  let sessionTrackCount = 0;
  let sessionTotalMs = 0;
  const trackNameMap = new Map<string, string>();
  if (sessionStart) {
    const sessionPlays = db.all(sql`
      SELECT lh.track_id as trackId, COALESCE(lh.duration_played_ms, t.duration_ms) as playMs
      FROM listening_history lh
      JOIN tracks t ON t.spotify_id = lh.track_id
      WHERE lh.user_id = ${userId} AND lh.played_at >= ${sessionStart}
    `) as { trackId: string; playMs: number }[];

    const trackAccum = new Map<string, { count: number; totalMs: number }>();
    for (const p of sessionPlays) {
      const prev = trackAccum.get(p.trackId) || { count: 0, totalMs: 0 };
      trackAccum.set(p.trackId, { count: prev.count + 1, totalMs: prev.totalMs + p.playMs });
    }
    sessionTrackCount = sessionPlays.length;

    const artistAccum = new Map<string, { plays: number; ms: number }>();
    const albumAccum = new Map<string, { plays: number; ms: number }>();

    for (const [trackId, accum] of trackAccum) {
      const t = db.select().from(tracks).where(eq(tracks.spotifyId, trackId)).get();
      if (!t) continue;
      sessionTotalMs += accum.totalMs;
      trackNameMap.set(trackId, t.name);

      sessionTargets.push({ entityId: trackId, entityType: 'track', extraPlays: accum.count, extraMs: accum.totalMs });

      if (t.albumId) {
        const prev = albumAccum.get(t.albumId) || { plays: 0, ms: 0 };
        albumAccum.set(t.albumId, { plays: prev.plays + accum.count, ms: prev.ms + accum.totalMs });
      }

      const tArtists = db.select({ artistId: trackArtists.artistId }).from(trackArtists).where(eq(trackArtists.trackId, trackId)).all();
      for (const ta of tArtists) {
        const prev = artistAccum.get(ta.artistId) || { plays: 0, ms: 0 };
        artistAccum.set(ta.artistId, { plays: prev.plays + accum.count, ms: prev.ms + accum.totalMs });
      }
    }

    for (const [albumId, accum] of albumAccum) {
      sessionTargets.push({ entityId: albumId, entityType: 'album', extraPlays: accum.plays, extraMs: accum.ms });
    }
    for (const [artistId, accum] of artistAccum) {
      sessionTargets.push({ entityId: artistId, entityType: 'artist', extraPlays: accum.plays, extraMs: accum.ms });
    }
  }

  // --- batch: session (con sessionStart), pre-sesión como "current", post-sesión como "projected" ---
  const sessByType = new Map<string, { entityId: string; extraPlays: number; extraMs: number }[]>();
  for (const t of sessionTargets) {
    const list = sessByType.get(t.entityType) || [];
    if (!list.some(x => x.entityId === t.entityId)) {
      list.push({ entityId: t.entityId, extraPlays: 0, extraMs: 0 });
    }
    sessByType.set(t.entityType, list);
  }

  type RankResult = Record<string, { current: number | null; projected: number | null; displaced: string[] }>;
  const sessRankResults = new Map<string, Map<string, RankResult>>();
  for (const [entityType, targets] of sessByType) {
    sessRankResults.set(entityType, computeProjectedRankingsBatch(db, entityType as 'track' | 'artist' | 'album', targets, sort, userId, sessionStart, rankLimits));
  }

  // batch-fetch displaced entity metadata per entity type
  const displacedMetaByType = new Map<string, Map<string, { name: string; imageUrl: string | null; artistName: string | null }>>();
  for (const [entityType, rankMap] of sessRankResults) {
    const allIds = new Set<string>();
    for (const ranks of rankMap.values()) {
      for (const v of Object.values(ranks)) {
        for (const id of v.displaced) allIds.add(id);
      }
    }
    if (allIds.size > 0) {
      displacedMetaByType.set(entityType, fetchEntityMetadata(db, entityType as 'track' | 'artist' | 'album', [...allIds]));
    }
  }

  // --- construir resultados ---
  function buildResult(target: TargetInfo, resultsMap: Map<string, Map<string, RankResult>>): ProjectionResult | null {
    const typeResults = resultsMap.get(target.entityType);
    if (!typeResults) return null;

    const ranks = typeResults.get(target.entityId);
    if (!ranks) return null;

    const metaMap = displacedMetaByType.get(target.entityType);

    const changes = Object.entries(ranks)
      .filter(([, v]) => v.current !== null && v.projected !== null && v.current !== v.projected)
      .map(([range, v]) => ({
        range,
        currentRank: v.current!,
        projectedRank: v.projected!,
        delta: v.current! - v.projected!,
        displaced: v.displaced.map(id => {
          const meta = metaMap?.get(id);
          return { id, name: meta?.name ?? '', imageUrl: meta?.imageUrl ?? null, artistName: meta?.artistName ?? null } satisfies CrossoverEntity;
        }),
      }));

    if (changes.length === 0) return null;

    let entityName = '';
    let imageUrl: string | null = null;

    if (target.entityType === 'track') {
      entityName = trackNameMap.get(target.entityId) ?? '';
      // el track no tiene imagen propia: usamos la portada de su álbum
      const t = db.select({ albumId: tracks.albumId }).from(tracks).where(eq(tracks.spotifyId, target.entityId)).get();
      if (t?.albumId) {
        const al = db.select({ imageUrl: albums.imageUrl }).from(albums).where(eq(albums.spotifyId, t.albumId)).get();
        imageUrl = al?.imageUrl ?? null;
      }
    } else if (target.entityType === 'artist') {
      const a = db.select().from(artists).where(eq(artists.spotifyId, target.entityId)).get();
      entityName = a?.name ?? '';
      imageUrl = a?.imageUrl ?? null;
    } else {
      const al = db.select().from(albums).where(eq(albums.spotifyId, target.entityId)).get();
      entityName = al?.name ?? '';
      imageUrl = al?.imageUrl ?? null;
    }

    return { entityId: target.entityId, entityType: target.entityType, entityName, imageUrl, changes };
  }

  const sessionResults: ProjectionResult[] = [];
  for (const t of sessionTargets) {
    const r = buildResult(t, sessRankResults);
    if (r) sessionResults.push(r);
  }

  const entityOrder: Record<string, number> = { artist: 0, album: 1, track: 2 };
  sessionResults.sort((a, b) => {
    const typeA = entityOrder[a.entityType] ?? 3;
    const typeB = entityOrder[b.entityType] ?? 3;
    if (typeA !== typeB) return typeA - typeB;
    const bestRankA = Math.min(...a.changes.map(ch => ch.projectedRank));
    const bestRankB = Math.min(...b.changes.map(ch => ch.projectedRank));
    return bestRankA - bestRankB;
  });

  return c.json({ nowPlaying: [], session: sessionResults, sessionTrackCount, sessionTotalMs, sessionStartedAt: sessionStart } satisfies ProjectedRankingsResponse);
});

export default records;
