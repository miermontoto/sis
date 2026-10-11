// Sesión de escucha para las proyecciones de ranking (session card): inicio y totales. Corre en un worker: antes era el
// cuerpo de GET /stats/projected-rankings, sobre getDb() en el main thread.
import { sql, eq } from 'drizzle-orm';
import { pollingState } from '../schema.js';
import { SESSION_GAP_MS } from '../../constants.js';
import type { Db } from './helpers.js';

export type ProjectionEntityType = 'track' | 'artist' | 'album';

export interface ProjectionSession {
  sessionStart: string | null;
  sessionTrackCount: number;
  sessionTotalMs: number;
  // plays anteriores al inicio de la sesión: huella de la base cacheada, que cambia si
  // entra un scrobble atrasado, un import o un barrido de dedup borra plays
  preCount: number;
}

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

  if (!sessionStart) return { sessionStart, sessionTrackCount: 0, sessionTotalMs: 0, preCount: 0 };

  // las entidades de la sesión ya NO salen de aquí: las da el delta de cada tipo
  // (scanProjectionDelta), resueltas con los mismos merges, colecciones y créditos que
  // los scores. Con los ids crudos del play (su track, su álbum, sus créditos de
  // catálogo) un miembro de colección, un alias o un artista con créditos corregidos
  // no casaba con su score y nunca tenía proyección
  const totals = db.get(sql`
    SELECT count(*) as n, coalesce(sum(COALESCE(lh.duration_played_ms, t.duration_ms)), 0) as ms
    FROM listening_history lh
    JOIN tracks t ON t.spotify_id = lh.track_id
    WHERE lh.user_id = ${userId} AND lh.played_at >= ${sessionStart}
  `) as { n: number; ms: number };

  const pre = db.get(sql`
    SELECT count(*) as n FROM listening_history WHERE user_id = ${userId} AND played_at < ${sessionStart}
  `) as { n: number };

  return { sessionStart, sessionTrackCount: totals.n, sessionTotalMs: totals.ms, preCount: pre.n };
}
