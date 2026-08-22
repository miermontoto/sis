// cuentas last.fm vinculadas y sincronización de scrobbles. last.fm actúa de
// puente: a los usuarios con spotify les rellena los huecos que el cap de 50
// de recently-played pierde (offline, downtime), y para usuarios solo-last.fm
// es la fuente completa de historial. la ingesta reutiliza importHistory
// (dedup por nombre + ventana temporal, IDs sintéticos import: resolubles).
import { eq, sql } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { lastfmAccounts, pollingState } from '../db/schema.js';
import { importHistory, upsertScrobbleTrack } from './history-import.js';
import { getStoredTokens } from './token-manager.js';
import { getUserById } from './user-manager.js';
import { checkChartClosings, checkDailyEvents } from './notification-events.js';
import { getRecentTracks, type LastfmRecentTrack } from './lastfm-client.js';
import { LASTFM_SYNC_MAX_PAGES, LASTFM_SYNC_GRACE_MS } from '../constants.js';
import { createLogger } from './logger.js';

const log = createLogger('lastfm');
export interface LastfmAccount {
  userId: number;
  username: string;
  sessionKey: string | null;
  lastScrobbleUts: number | null;
  backfillDone: boolean;
}

function mapAccount(row: typeof lastfmAccounts.$inferSelect): LastfmAccount {
  return {
    userId: row.userId,
    username: row.username,
    sessionKey: row.sessionKey,
    lastScrobbleUts: row.lastScrobbleUts,
    backfillDone: !!row.backfillDone,
  };
}

export function getLastfmAccount(userId: number): LastfmAccount | null {
  const db = getDb();
  const row = db.select().from(lastfmAccounts).where(eq(lastfmAccounts.userId, userId)).get();
  return row ? mapAccount(row) : null;
}

export function findLastfmAccountByUsername(username: string): LastfmAccount | null {
  const db = getDb();
  const row = db.select().from(lastfmAccounts)
    .where(sql`LOWER(${lastfmAccounts.username}) = LOWER(${username})`)
    .get();
  return row ? mapAccount(row) : null;
}

export function getAllLastfmAccounts(): LastfmAccount[] {
  const db = getDb();
  // solo cuentas de usuarios activos. sqlite devuelve backfill_done como 0/1; el
  // resto de columnas ya llegan con el nombre del DTO por los alias del SELECT
  return db.all(sql`
    SELECT la.user_id AS userId, la.username, la.session_key AS sessionKey,
           la.last_scrobble_uts AS lastScrobbleUts, la.backfill_done AS backfillDone
    FROM lastfm_accounts la
    JOIN users u ON u.id = la.user_id
    WHERE u.is_active = 1
  `).map(r => {
    const row = r as Omit<LastfmAccount, 'backfillDone'> & { backfillDone: number };
    return { ...row, backfillDone: !!row.backfillDone };
  });
}

export function upsertLastfmAccount(userId: number, username: string, sessionKey: string | null): void {
  const db = getDb();
  const now = new Date().toISOString();
  // el cursor arranca en "ahora": el histórico previo entra por el backfill
  // explícito, no por el sync incremental
  db.insert(lastfmAccounts)
    .values({
      userId,
      username,
      sessionKey,
      lastScrobbleUts: Math.floor(Date.now() / 1000),
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: lastfmAccounts.userId,
      set: { username, sessionKey: sessionKey ?? sql`session_key`, updatedAt: now },
    })
    .run();
  log.info(`cuenta ${username} vinculada al usuario ${userId}`);
}

export function deleteLastfmAccount(userId: number): void {
  const db = getDb();
  db.delete(lastfmAccounts).where(eq(lastfmAccounts.userId, userId)).run();
}

function updateCursor(userId: number, uts: number): void {
  const db = getDb();
  db.update(lastfmAccounts)
    .set({ lastScrobbleUts: uts, updatedAt: new Date().toISOString() })
    .where(eq(lastfmAccounts.userId, userId))
    .run();
}

// timestamp del scrobble más reciente de un lote (ignora nowplaying, sin date)
function maxUts(tracks: LastfmRecentTrack[]): number | null {
  return tracks.reduce<number | null>((max, t) => {
    const uts = t.date?.uts ? parseInt(t.date.uts, 10) : null;
    return uts && (!max || uts > max) ? uts : max;
  }, null);
}

// escribe polling_state con el now-playing de una fuente externa (last.fm o el
// endpoint de scrobbling) para que /now-playing y el feed de amigos lo muestren.
// estas fuentes no dan progreso ni duración fiables → tarjeta sin barra, read-only.
// exportada: la usa también el playing_now del endpoint compatible listenbrainz.
export function setExternalNowPlaying(userId: number, trackId: string | null): void {
  const db = getDb();
  const existing = db.select().from(pollingState).where(eq(pollingState.userId, userId)).get();

  if (!trackId) {
    // sin nowplaying: marcar como pausado (la ruta ya filtra por frescura). no
    // se borra el track para no cortar una lectura en curso; caduca solo.
    if (existing) db.run(sql`UPDATE polling_state SET is_playing = 0 WHERE user_id = ${userId}`);
    return;
  }

  const nowIso = new Date().toISOString();
  if (existing) {
    db.update(pollingState)
      .set({ lastCurrentlyPlayingTrackId: trackId, lastCurrentlyPlayingAt: nowIso })
      .where(eq(pollingState.userId, userId))
      .run();
  } else {
    db.insert(pollingState)
      .values({ userId, lastCurrentlyPlayingTrackId: trackId, lastCurrentlyPlayingAt: nowIso })
      .run();
  }
  // is_playing/progress_ms son columnas raw (fuera del schema drizzle)
  db.run(sql`UPDATE polling_state SET is_playing = 1, progress_ms = NULL WHERE user_id = ${userId}`);
}

// now-playing de usuarios solo-last.fm: el track sin `date` con @attr.nowplaying
function updateNowPlaying(userId: number, track: LastfmRecentTrack | null): void {
  if (!track) return setExternalNowPlaying(userId, null);
  const trackId = upsertScrobbleTrack(track);
  if (trackId) setExternalNowPlaying(userId, trackId);
}

// --- sync incremental (tick de polling) ---

export async function syncRecentScrobbles(userId: number): Promise<number> {
  const account = getLastfmAccount(userId);
  if (!account) return 0;

  // spotify tiene prioridad como fuente (timestamps de fin, duración, IDs
  // reales): si el usuario tiene tokens, los scrobbles recientes se retienen
  // hasta que su play de spotify haya tenido tiempo de registrarse — el
  // scrobble solo entra (dedup mediante) si spotify no lo cubrió
  const hasSpotify = !!getStoredTokens(userId);
  const grace = hasSpotify ? LASTFM_SYNC_GRACE_MS : 0;
  const from = account.lastScrobbleUts ?? Math.floor(Date.now() / 1000);
  const to = Math.floor((Date.now() - grace) / 1000);
  if (to <= from) return 0; // todo dentro del periodo de gracia todavía

  const collected: LastfmRecentTrack[] = [];
  let nowPlaying: LastfmRecentTrack | null = null;
  let page = 1;
  let totalPages = 1;

  do {
    const res = await getRecentTracks(account.username, { from, to, page });
    // el track nowplaying (sin date) viene al principio de la página 1
    if (page === 1) nowPlaying = res.tracks.find(t => t['@attr']?.nowplaying === 'true') ?? null;
    collected.push(...res.tracks.filter(t => t.date?.uts));
    totalPages = Math.min(res.totalPages, LASTFM_SYNC_MAX_PAGES);
    page++;
  } while (page <= totalPages);

  // now-playing solo para usuarios solo-last.fm (los híbridos lo tienen vía spotify)
  if (!hasSpotify) updateNowPlaying(userId, nowPlaying);

  if (collected.length === 0) return 0;

  const result = importHistory(collected, userId, 'lastfm');
  const cursor = maxUts(collected);
  if (cursor) updateCursor(userId, cursor);
  log.child(userId).info(`${result.imported} scrobbles nuevos (${result.duplicates} ya registrados)`);
  return result.imported;
}

// sync secuencial de todas las cuentas activas (el throttle del cliente ya
// espacia las llamadas; secuencial evita solaparlas)
export async function syncAllLastfmAccounts(): Promise<void> {
  for (const account of getAllLastfmAccounts()) {
    // cierre de chart y eventos diarios (time-driven) para usuarios solo-last.fm:
    // los híbridos ya los reciben en el poll de recently-played de spotify. corren
    // cada tick aunque no haya scrobbles nuevos; aislados para que nunca rompan el sync.
    if (!getStoredTokens(account.userId)) {
      try {
        const spotifyId = getUserById(account.userId)?.spotifyId;
        if (spotifyId) {
          checkChartClosings(account.userId, spotifyId);
          checkDailyEvents(account.userId, spotifyId);
        }
      } catch (err) {
        log.child(account.userId).error(`error en eventos de notificación:`, err);
      }
    }
    try {
      await syncRecentScrobbles(account.userId);
    } catch (err) {
      log.child(account.userId).error(`error en sync:`, err);
    }
  }
}

// --- backfill del historial completo ---

export interface BackfillProgress {
  running: boolean;
  phase: 'fetching' | 'importing' | 'done' | 'error';
  page: number;
  totalPages: number;
  imported: number;
  error?: string;
}

const backfills = new Map<number, BackfillProgress>();

export function getBackfillProgress(userId: number): BackfillProgress | null {
  return backfills.get(userId) ?? null;
}

// descarga todas las páginas primero y hace UNA importación al final: el índice
// de dedup de importHistory se construye por llamada, y por-página sería O(n²)
export async function backfillHistory(userId: number): Promise<void> {
  const account = getLastfmAccount(userId);
  if (!account) throw new Error('sin cuenta last.fm vinculada');
  if (backfills.get(userId)?.running) return;

  const progress: BackfillProgress = { running: true, phase: 'fetching', page: 0, totalPages: 0, imported: 0 };
  backfills.set(userId, progress);
  log.child(userId).info(`iniciando backfill de ${account.username}...`);

  try {
    // `to` fijo: congela el snapshot durante la paginación (los scrobbles que
    // lleguen mientras tanto no desplazan páginas) y aplica el mismo periodo
    // de gracia que el sync incremental
    const to = Math.floor((Date.now() - (getStoredTokens(userId) ? LASTFM_SYNC_GRACE_MS : 0)) / 1000);
    const collected: LastfmRecentTrack[] = [];
    let page = 1;
    let totalPages = 1;
    do {
      const res = await getRecentTracks(account.username, { to, page });
      collected.push(...res.tracks.filter(t => t.date?.uts));
      totalPages = res.totalPages;
      progress.page = page;
      progress.totalPages = totalPages;
      page++;
    } while (page <= totalPages);

    progress.phase = 'importing';
    const result = importHistory(collected, userId, 'lastfm');
    progress.imported = result.imported;

    const db = getDb();
    db.update(lastfmAccounts)
      .set({ backfillDone: true, updatedAt: new Date().toISOString() })
      .where(eq(lastfmAccounts.userId, userId))
      .run();

    progress.phase = 'done';
    log.child(userId).info(`backfill completo: ${result.imported} importados, ${result.duplicates} duplicados de ${collected.length} scrobbles`);
  } catch (err) {
    progress.phase = 'error';
    progress.error = err instanceof Error ? err.message : String(err);
    log.child(userId).error(`error en backfill:`, err);
  } finally {
    progress.running = false;
  }
}
