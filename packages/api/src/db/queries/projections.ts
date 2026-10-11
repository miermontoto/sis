// Sesión de escucha para las proyecciones de ranking (session card): inicio, plays,
// entidades tocadas y los datos con los que se pintan. Corre en un worker: antes era el
// cuerpo de GET /stats/projected-rankings, sobre getDb() en el main thread.
import { sql, eq } from 'drizzle-orm';
import { pollingState, tracks, trackArtists, albums, artists } from '../schema.js';
import { SESSION_GAP_MS } from '../../constants.js';
import type { Db } from './helpers.js';

export type ProjectionEntityType = 'track' | 'artist' | 'album';

export interface ProjectionSessionTarget {
  entityId: string;
  entityType: ProjectionEntityType;
  extraPlays: number;
  extraMs: number;
}

export interface ProjectionSession {
  sessionStart: string | null;
  sessionTrackCount: number;
  sessionTotalMs: number;
  // tracks de la sesión, luego sus álbumes, luego sus artistas (el orden de antes)
  targets: ProjectionSessionTarget[];
  // nombre e imagen de cada target, por `${entityType}:${entityId}`
  meta: Record<string, { name: string; imageUrl: string | null }>;
  // plays anteriores al inicio de la sesión: huella de la base cacheada, que cambia si
  // entra un scrobble atrasado, un import o un barrido de dedup borra plays
  preCount: number;
}

const metaKey = (entityType: ProjectionEntityType, entityId: string) => `${entityType}:${entityId}`;

export function getProjectionSession(db: Db, userId: number): ProjectionSession {
  const state = db.select().from(pollingState).where(eq(pollingState.userId, userId)).get();

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

  const empty: ProjectionSession = { sessionStart, sessionTrackCount: 0, sessionTotalMs: 0, targets: [], meta: {}, preCount: 0 };
  if (!sessionStart) return empty;

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

  const targets: ProjectionSessionTarget[] = [];
  const meta: ProjectionSession['meta'] = {};
  const artistAccum = new Map<string, { plays: number; ms: number }>();
  const albumAccum = new Map<string, { plays: number; ms: number }>();
  let sessionTotalMs = 0;

  for (const [trackId, accum] of trackAccum) {
    const t = db.select().from(tracks).where(eq(tracks.spotifyId, trackId)).get();
    if (!t) continue;
    sessionTotalMs += accum.totalMs;

    targets.push({ entityId: trackId, entityType: 'track', extraPlays: accum.count, extraMs: accum.totalMs });
    // el track no tiene imagen propia: usamos la portada de su álbum
    const cover = t.albumId ? db.select({ imageUrl: albums.imageUrl }).from(albums).where(eq(albums.spotifyId, t.albumId)).get() : undefined;
    meta[metaKey('track', trackId)] = { name: t.name, imageUrl: cover?.imageUrl ?? null };

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
    targets.push({ entityId: albumId, entityType: 'album', extraPlays: accum.plays, extraMs: accum.ms });
    const al = db.select().from(albums).where(eq(albums.spotifyId, albumId)).get();
    meta[metaKey('album', albumId)] = { name: al?.name ?? '', imageUrl: al?.imageUrl ?? null };
  }
  for (const [artistId, accum] of artistAccum) {
    targets.push({ entityId: artistId, entityType: 'artist', extraPlays: accum.plays, extraMs: accum.ms });
    const a = db.select().from(artists).where(eq(artists.spotifyId, artistId)).get();
    meta[metaKey('artist', artistId)] = { name: a?.name ?? '', imageUrl: a?.imageUrl ?? null };
  }

  const pre = db.get(sql`
    SELECT count(*) as n FROM listening_history WHERE user_id = ${userId} AND played_at < ${sessionStart}
  `) as { n: number };

  return { sessionStart, sessionTrackCount: sessionPlays.length, sessionTotalMs, targets, meta, preCount: pre.n };
}
