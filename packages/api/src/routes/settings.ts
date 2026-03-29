import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { userSettings } from '../db/schema.js';
import { invalidateRecordsCache, computeAndCacheRecords } from '../services/records-cache.js';
import type { AppVariables } from '../app.js';

const settings = new Hono<{ Variables: AppVariables }>();

const VALID_KEYS = ['rankingMetric', 'showRankChanges', 'weekStart'] as const;
const DEFAULTS: Record<string, string> = {
  rankingMetric: 'time',
  showRankChanges: 'true',
  weekStart: 'friday',
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

export default settings;
