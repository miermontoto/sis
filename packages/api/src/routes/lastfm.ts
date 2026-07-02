import { Hono } from 'hono';
import { isLastfmConfigured } from '../services/lastfm-client.js';
import { getLastfmAccount, deleteLastfmAccount, syncRecentScrobbles, backfillHistory, getBackfillProgress } from '../services/lastfm-sync.js';
import type { AppVariables } from '../app.js';

const lastfm = new Hono<{ Variables: AppVariables }>();

// estado de la integración para el usuario actual
lastfm.get('/', (c) => {
  const userId = c.get('userId');
  const account = getLastfmAccount(userId);
  return c.json({
    configured: isLastfmConfigured(),
    account: account
      ? {
          username: account.username,
          lastScrobbleUts: account.lastScrobbleUts,
          backfillDone: account.backfillDone,
          backfill: getBackfillProgress(userId),
        }
      : null,
  });
});

// sincronización manual inmediata de scrobbles nuevos
lastfm.post('/sync', async (c) => {
  const userId = c.get('userId');
  if (!getLastfmAccount(userId)) return c.json({ error: 'sin cuenta last.fm vinculada' }, 404);
  try {
    const imported = await syncRecentScrobbles(userId);
    return c.json({ ok: true, imported });
  } catch (err) {
    console.error(`[lastfm:${userId}] error en sync manual:`, err);
    return c.json({ error: 'error al sincronizar con last.fm' }, 502);
  }
});

// importar todo el historial de scrobbles (async; progreso vía GET /)
lastfm.post('/backfill', (c) => {
  const userId = c.get('userId');
  if (!getLastfmAccount(userId)) return c.json({ error: 'sin cuenta last.fm vinculada' }, 404);
  if (getBackfillProgress(userId)?.running) return c.json({ error: 'backfill ya en curso' }, 409);
  backfillHistory(userId).catch(() => { /* el error queda registrado en el progreso */ });
  return c.json({ ok: true });
});

// desvincular la cuenta (el historial ya importado se conserva)
lastfm.delete('/', (c) => {
  const userId = c.get('userId');
  deleteLastfmAccount(userId);
  return c.json({ ok: true });
});

export default lastfm;
