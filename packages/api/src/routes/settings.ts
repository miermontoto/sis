import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { toSessionInfos } from '@platform/auth';
import { deleteOtherSessions, listSessions } from '../services/session.js';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { userSettings } from '../db/schema.js';
import { invalidateRecordsCache, computeAndCacheRecords } from '../services/records-cache.js';
import type { AppVariables } from '../app.js';

const settings = new Hono<{ Variables: AppVariables }>();

const VALID_KEYS = ['rankingMetric', 'rankChangeLookback', 'weekStart', 'locale', 'albumTrackDisplay', 'albumShowDuration', 'albumShowAccolades', 'artistShowAlbumAccolades', 'artistShowTrackAccolades', 'sessionRankDisplay', 'sessionRankLimitYear', 'sessionRankLimitAll', 'nowPlayingDisplay', 'lastPeriodWeek', 'lastPeriodMonth', 'lastPeriodYear', 'socialVisibility'] as const;
const DEFAULTS: Record<string, string> = {
  rankingMetric: 'time',
  rankChangeLookback: 'disabled',
  weekStart: 'friday',
  locale: 'auto',
  albumTrackDisplay: 'fill',
  albumShowDuration: 'true',
  albumShowAccolades: 'true',
  artistShowAlbumAccolades: 'true',
  artistShowTrackAccolades: 'true',
  sessionRankDisplay: 'all+ytd',
  sessionRankLimitYear: '50',
  sessionRankLimitAll: '200',
  nowPlayingDisplay: 'auto',
  socialVisibility: 'visible',
};

settings.get('/', (c) => {
  const spotifyId = c.get('spotifyId') || 'default';
  const db = getDb();

  const rows = db.select().from(userSettings)
    .where(eq(userSettings.userId, spotifyId))
    .all();

  const result: Record<string, string> = { ...DEFAULTS };
  for (const row of rows) {
    result[row.key] = row.value;
  }

  return c.json(result);
});

settings.put('/', async (c) => {
  const spotifyId = c.get('spotifyId') || 'default';
  const db = getDb();
  const body = await c.req.json<Record<string, string>>();

  const now = new Date().toISOString();
  for (const key of VALID_KEYS) {
    if (body[key] !== undefined) {
      db.insert(userSettings)
        .values({ userId: spotifyId, key, value: String(body[key]), updatedAt: now })
        .onConflictDoUpdate({
          target: [userSettings.userId, userSettings.key],
          set: { value: String(body[key]), updatedAt: now },
        })
        .run();
    }
  }

  // recomputar records cache si cambiaron settings relevantes
  if (body.weekStart !== undefined || body.rankingMetric !== undefined) {
    invalidateRecordsCache();
    try { computeAndCacheRecords(); } catch { /* se recomputa en el siguiente ciclo */ }
  }

  return c.json({ ok: true });
});

// sesiones de login activas del usuario (token solo hasheado, ver @platform/auth)
settings.get('/sessions', (c) => {
  const currentToken = getCookie(c, 'sis_session') ?? '';
  return c.json({ sessions: toSessionInfos(listSessions(c.get('userId')), currentToken) });
});

// cierra las demás sesiones del usuario, preservando la actual
settings.post('/sessions/logout-others', (c) => {
  const currentToken = getCookie(c, 'sis_session');
  if (!currentToken) return c.json({ error: 'sin sesión activa' }, 401);
  const deleted = deleteOtherSessions(c.get('userId'), currentToken);
  return c.json({ ok: true, deleted });
});

export default settings;
