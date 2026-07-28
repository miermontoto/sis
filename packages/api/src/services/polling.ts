import { eq, sql } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { pollingState } from '../db/schema.js';
import { spotifyFetch } from './spotify-client.js';
import { insertPlay, insertLocalPlay, upsertTrack, enrichArtistMetadata, enrichAlbumMetadata, fixVideoCovers, recoverSingleCovers, enrichLocalAlbumCovers, enrichImportTrackDurations, resolveLocalFileIds, resolveImportArtists, resolveImportAlbums, fixTrackAlbumAssignments, fixTrackArtistAssociations, deduplicateTracks, deduplicateAlbums, deduplicateAlbumShells, deduplicateLocalAlbums, cleanOrphanImports, cleanDuplicatePlays, cleanBasicExtendedDuplicates, mergeImportTracks, cleanNonMusicImports } from './ingestion.js';
import { getStoredTokens } from './token-manager.js';
import { getAllActiveUsersWithTokens, getUserById } from './user-manager.js';
import { checkChartClosings } from './notification-events.js';
import {
  CURRENTLY_PLAYING_INTERVAL_MS,
  CURRENTLY_PLAYING_MIN_MS,
  CURRENTLY_PLAYING_MAX_MS,
  CURRENTLY_PLAYING_BUFFER_MS,
  CURRENTLY_PLAYING_PAUSED_MS,
  CURRENTLY_PLAYING_IDLE_MS,
  CURRENTLY_PLAYING_TRIGGER_MS,
  HISTORY_FLUSH_DELAYS_MS,
  RECENTLY_PLAYED_INTERVAL_MS,
  RECENTLY_PLAYED_LIMIT,
  METADATA_REFRESH_INTERVAL_MS,
  RESOLVE_INTERVAL_MS,
  ARTIST_FIX_INTERVAL_MS,
  RECORDS_CACHE_INTERVAL_MS,
  PLAYLIST_SYNC_INTERVAL_MS,
  AUTO_REGENERATE_CHECK_INTERVAL_MS,
  SESSION_GAP_MS,
  MIN_PLAY_MS,
} from '../constants.js';
import { syncAllUsersPlaylists } from './playlist-sync.js';
import { runDueRegenerations } from './playlist-auto-regenerate.js';
import { computeAndCacheRecords } from './records-cache.js';
import { resetDeferredState } from './deferred-startup.js';
import { isLastfmConfigured } from './lastfm-client.js';
import { syncAllLastfmAccounts } from './lastfm-sync.js';
import { enrichLastfmDurations, enrichLastfmGenres } from './lastfm-enrich.js';
import { LASTFM_POLL_INTERVAL_MS } from '../constants.js';
import type {
  SpotifyCurrentlyPlayingResponse,
  SpotifyRecentlyPlayedResponse,
} from '../types/spotify.js';

// timers por usuario
interface UserTimers {
  currentlyPlaying: ReturnType<typeof setTimeout> | null;
  recentlyPlayed: ReturnType<typeof setInterval>;
}

const userTimers = new Map<number, UserTimers>();

// estado del track activo por usuario (todos los tracks, no solo locales)
interface ActiveTrackState {
  id: string;
  startedAt: string;
  durationMs: number;
  lastProgressMs: number;
  isLocal: boolean;
}
const userActiveTrack = new Map<number, ActiveTrackState>();

// buffer de reproducciones completadas detectadas por currently-playing,
// pendientes de ser correlacionadas con recently-played
interface CompletedPlay {
  trackId: string;
  progressMs: number;
  endedAt: number;
}
const completedPlays = new Map<number, CompletedPlay[]>();
const COMPLETED_PLAY_TTL_MS = 10 * 60_000;

function pushCompletedPlay(userId: number, play: CompletedPlay) {
  if (!completedPlays.has(userId)) completedPlays.set(userId, []);
  const list = completedPlays.get(userId)!;
  list.push(play);
  // expirar entradas antiguas
  const cutoff = Date.now() - COMPLETED_PLAY_TTL_MS;
  const firstValid = list.findIndex(p => p.endedAt >= cutoff);
  if (firstValid > 0) list.splice(0, firstValid);
  scheduleHistoryFlush(userId);
}

// volcado anticipado a historial: al detectar que un track terminó no se espera
// al tick de RECENTLY_PLAYED_INTERVAL_MS (5 min) para insertarlo. recently-played
// tarda unos segundos en reflejar el play, así que se reintenta en escalera
// mientras queden completados sin correlacionar. rearmar reinicia la escalera,
// así que una ráfaga de skips se agrupa en un solo volcado.
const historyFlushTimers = new Map<number, ReturnType<typeof setTimeout>>();

function scheduleHistoryFlush(userId: number, step = 0) {
  if (step >= HISTORY_FLUSH_DELAYS_MS.length) return;
  const pending = historyFlushTimers.get(userId);
  if (pending) clearTimeout(pending);
  historyFlushTimers.set(userId, setTimeout(async () => {
    historyFlushTimers.delete(userId);
    const before = completedPlays.get(userId)?.length ?? 0;
    await pollRecentlyPlayed(userId);
    const after = completedPlays.get(userId)?.length ?? 0;
    // no se correlacionó nada: spotify aún no lo expone, reintentar más tarde.
    // si se consumió algo, lo que quede son plays que spotify nunca registrará
    // (demasiado cortos) y caducan solos por TTL
    if (after > 0 && after === before) scheduleHistoryFlush(userId, step + 1);
  }, HISTORY_FLUSH_DELAYS_MS[step]));
}

export function getCompletedPlayDuration(userId: number, trackId: string): number | null {
  const list = completedPlays.get(userId);
  if (!list) return null;
  // buscar la entrada más reciente para este track
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].trackId === trackId) {
      const play = list.splice(i, 1)[0];
      return play.progressMs;
    }
  }
  return null;
}

// timers compartidos (catálogo global)
let metadataRefreshTimer: ReturnType<typeof setInterval> | null = null;
let resolveImportsTimer: ReturnType<typeof setInterval> | null = null;
let artistFixTimer: ReturnType<typeof setInterval> | null = null;
let recordsCacheTimer: ReturnType<typeof setInterval> | null = null;
let playlistSyncTimer: ReturnType<typeof setInterval> | null = null;
let autoRegenerateTimer: ReturnType<typeof setInterval> | null = null;
let lastfmSyncTimer: ReturnType<typeof setInterval> | null = null;
let tokenlessEnrichTimer: ReturnType<typeof setInterval> | null = null;

// sync de scrobbles last.fm: loop global independiente del polling de spotify —
// las cuentas last.fm no requieren tokens de spotify (usuarios solo-last.fm)
function startLastfmPolling() {
  if (lastfmSyncTimer || !isLastfmConfigured()) return;
  const tick = () => syncAllLastfmAccounts().catch(err => console.error('[lastfm] error en sync:', err));
  lastfmSyncTimer = setInterval(tick, LASTFM_POLL_INTERVAL_MS);
  tick();
  console.log(`[poll] last.fm sync cada ${LASTFM_POLL_INTERVAL_MS / 1000}s`);
}

// enrichment que NO depende de un token de spotify: duraciones (last.fm →
// musicbrainz de fallback), portadas (musicbrainz) y géneros (last.fm). corre
// haya o no usuarios spotify, porque los tracks/artistas import: (scrobbles) se
// enriquecen desde estas fuentes. arranca una vez y se repite cada 24h.
function startTokenlessEnrichment() {
  if (tokenlessEnrichTimer) return;
  const run = async () => {
    // duraciones secuenciadas: last.fm (rápido) primero rellena lo que puede, el
    // resto lo intenta musicbrainz. ambas filtran duration_ms<=0, así que en
    // paralelo competirían por los mismos tracks.
    try {
      if (isLastfmConfigured()) await enrichLastfmDurations();
      await enrichImportTrackDurations();
    } catch (err) {
      console.error('[metadata] error duraciones:', err);
    }
    // portadas (musicbrainz) y géneros (last.fm) son independientes entre sí
    enrichLocalAlbumCovers().catch(err => console.error('[metadata] error portadas:', err));
    if (isLastfmConfigured()) enrichLastfmGenres().catch(err => console.error('[lastfm-meta] error géneros:', err));
  };
  run();
  tokenlessEnrichTimer = setInterval(run, METADATA_REFRESH_INTERVAL_MS);
  console.log('[poll] enrichment sin-token activo (musicbrainz + last.fm)');
}

function getPollingStateForUser(userId: number) {
  const db = getDb();
  return db.select().from(pollingState).where(eq(pollingState.userId, userId)).get();
}

function updatePollingStateForUser(userId: number, data: Partial<typeof pollingState.$inferInsert>) {
  const db = getDb();
  const existing = getPollingStateForUser(userId);
  if (existing) {
    db.update(pollingState).set(data).where(eq(pollingState.userId, userId)).run();
  } else {
    db.insert(pollingState).values({ userId, ...data }).run();
  }
}

function computeNextPollDelay(data: SpotifyCurrentlyPlayingResponse | null): number {
  if (!data || !data.item) return CURRENTLY_PLAYING_IDLE_MS;
  if (!data.is_playing) return CURRENTLY_PLAYING_PAUSED_MS;

  const remaining = data.item.duration_ms - (data.progress_ms ?? 0);
  return Math.max(CURRENTLY_PLAYING_MIN_MS, Math.min(remaining + CURRENTLY_PLAYING_BUFFER_MS, CURRENTLY_PLAYING_MAX_MS));
}

async function pollCurrentlyPlaying(userId: number): Promise<number> {
  try {
    const data = await spotifyFetch<SpotifyCurrentlyPlayingResponse>('/me/player/currently-playing', { userId });

    if (!data || !data.item || data.currently_playing_type !== 'track') {
      const lastActive = userActiveTrack.get(userId);
      if (lastActive) {
        if (lastActive.isLocal && lastActive.lastProgressMs >= MIN_PLAY_MS) {
          insertLocalPlay(lastActive.id, lastActive.startedAt, userId, lastActive.lastProgressMs);
          console.log(`[poll:${userId}] registrada reproducción local: ${lastActive.id}`);
        } else if (!lastActive.isLocal) {
          pushCompletedPlay(userId, { trackId: lastActive.id, progressMs: lastActive.lastProgressMs, endedAt: Date.now() });
        }
        userActiveTrack.delete(userId);
      }
      const state = getPollingStateForUser(userId);
      const db = getDb();
      const lastPlayAt = state?.lastCurrentlyPlayingAt ? new Date(state.lastCurrentlyPlayingAt).getTime() : 0;
      const idleMs = lastPlayAt ? Date.now() - lastPlayAt : Infinity;

      if (idleMs >= SESSION_GAP_MS) {
        updatePollingStateForUser(userId, {
          lastCurrentlyPlayingTrackId: null,
          lastCurrentlyPlayingAt: null,
        });
        db.run(sql`UPDATE polling_state SET is_playing = 0, session_started_at = NULL, progress_ms = NULL WHERE user_id = ${userId}`);
      } else {
        updatePollingStateForUser(userId, {
          lastCurrentlyPlayingTrackId: null,
        });
        db.run(sql`UPDATE polling_state SET is_playing = 0, progress_ms = NULL WHERE user_id = ${userId}`);
      }
      return CURRENTLY_PLAYING_IDLE_MS;
    }

    // resolver IDs sintéticos para archivos locales antes de comparar
    resolveLocalFileIds(data.item);

    const state = getPollingStateForUser(userId);
    const trackChanged = state?.lastCurrentlyPlayingTrackId !== data.item.id;

    // detectar loop: mismo track pero el progreso retrocedió (reinició)
    const progressMs = data.progress_ms ?? 0;
    const lastActive = userActiveTrack.get(userId);
    const loopDetected = !trackChanged
      && lastActive
      && lastActive.id === data.item.id
      && progressMs < lastActive.lastProgressMs;

    if (trackChanged || loopDetected) {
      if (lastActive) {
        if (lastActive.isLocal && lastActive.lastProgressMs >= MIN_PLAY_MS) {
          insertLocalPlay(lastActive.id, lastActive.startedAt, userId, lastActive.lastProgressMs);
          console.log(`[poll:${userId}] registrada reproducción local: ${lastActive.id}`);
        } else if (!lastActive.isLocal) {
          pushCompletedPlay(userId, { trackId: lastActive.id, progressMs: lastActive.lastProgressMs, endedAt: Date.now() });
        }
      }

      if (trackChanged) {
        upsertTrack(data.item);
        const nextDelay = computeNextPollDelay(data);
        console.log(`[poll:${userId}] reproduciendo: ${data.item.artists[0]?.name} - ${data.item.name} (siguiente poll en ${Math.round(nextDelay / 1000)}s)`);
      }

      userActiveTrack.set(userId, { id: data.item.id, startedAt: new Date().toISOString(), durationMs: data.item.duration_ms, lastProgressMs: progressMs, isLocal: !!data.item.is_local });
    } else if (lastActive) {
      lastActive.lastProgressMs = progressMs;
    }

    updatePollingStateForUser(userId, {
      lastCurrentlyPlayingTrackId: data.item.id,
      lastCurrentlyPlayingAt: new Date().toISOString(),
    });
    const db = getDb();
    db.run(sql`UPDATE polling_state SET is_playing = ${data.is_playing ? 1 : 0}, progress_ms = ${progressMs} WHERE user_id = ${userId}`);

    // nueva sesión: si el track anterior era null (idle → playing)
    if (trackChanged && !state?.lastCurrentlyPlayingTrackId) {
      db.run(sql`UPDATE polling_state SET session_started_at = ${new Date().toISOString()} WHERE user_id = ${userId}`);
    }
    return computeNextPollDelay(data);
  } catch (err) {
    console.error(`[poll:${userId}] error en currently playing:`, err);
    return CURRENTLY_PLAYING_INTERVAL_MS;
  }
}

// generación del ciclo de currently-playing por usuario: un re-poll forzado
// invalida el ciclo en curso para que un poll que ya estaba en vuelo no pise
// con su propio delay el timer recién programado
const pollGeneration = new Map<number, number>();

function scheduleNextCurrentlyPlaying(userId: number, delayMs: number) {
  const timers = userTimers.get(userId);
  if (!timers) return;
  if (timers.currentlyPlaying) clearTimeout(timers.currentlyPlaying);
  const gen = (pollGeneration.get(userId) ?? 0) + 1;
  pollGeneration.set(userId, gen);
  timers.currentlyPlaying = setTimeout(async () => {
    const delay = await pollCurrentlyPlaying(userId);
    if (pollGeneration.get(userId) !== gen) return; // reprogramado mientras leíamos
    scheduleNextCurrentlyPlaying(userId, delay);
  }, delayMs);
}

// fuerza una lectura de currently-playing adelantando el timer del ciclo. lo
// llaman las rutas de playback (next/prev/play/pause/transferencia de
// dispositivo): sin esto polling_state conserva el track anterior hasta
// CURRENTLY_PLAYING_MAX_MS y la tarjeta se queda (o vuelve) al track viejo.
export function triggerCurrentlyPlayingPoll(userId: number, delayMs = CURRENTLY_PLAYING_TRIGGER_MS) {
  if (!userTimers.has(userId)) return;
  scheduleNextCurrentlyPlaying(userId, delayMs);
}

async function pollRecentlyPlayed(userId: number) {
  // cierre de chart (time-driven): debe correr cada ciclo aún sin datos nuevos, por eso
  // va antes del early-return de recently-played. guardado para que nunca rompa el polling.
  try {
    const spotifyId = getUserById(userId)?.spotifyId;
    if (spotifyId) checkChartClosings(userId, spotifyId);
  } catch (err) {
    console.error(`[poll:${userId}] error en checkChartClosings:`, err);
  }

  try {
    const state = getPollingStateForUser(userId);
    const params: Record<string, string> = {
      limit: String(RECENTLY_PLAYED_LIMIT),
    };

    // usar cursor para obtener solo tracks nuevos
    if (state?.lastRecentlyPlayedCursor) {
      params.after = state.lastRecentlyPlayedCursor;
    }

    const data = await spotifyFetch<SpotifyRecentlyPlayedResponse>(
      '/me/player/recently-played',
      { userId, params },
    );

    if (!data?.items?.length) return;

    let inserted = 0;
    for (const item of data.items) {
      const estimatedMs = getCompletedPlayDuration(userId, item.track.id);
      if (insertPlay(item, userId, estimatedMs ?? undefined)) inserted++;
    }

    // actualizar cursor para la siguiente poll
    if (data.cursors?.after) {
      updatePollingStateForUser(userId, {
        lastRecentlyPlayedCursor: data.cursors.after,
        lastPollAt: new Date().toISOString(),
      });
    }

    if (inserted > 0) {
      console.log(`[poll:${userId}] ${inserted} nuevas reproducciones registradas`);
    }
  } catch (err) {
    console.error(`[poll:${userId}] error en recently played:`, err);
  }
}

function startPollingForUser(userId: number) {
  if (userTimers.has(userId)) return; // ya activo

  const tokens = getStoredTokens(userId);
  if (!tokens) {
    console.log(`[poll:${userId}] sin tokens, saltando`);
    return;
  }

  console.log(`[poll:${userId}] iniciando polling...`);

  const timers: UserTimers = {
    currentlyPlaying: null,
    recentlyPlayed: setInterval(() => pollRecentlyPlayed(userId), RECENTLY_PLAYED_INTERVAL_MS),
  };
  userTimers.set(userId, timers);

  // ejecutar inmediatamente y encadenar con scheduling dinámico
  pollRecentlyPlayed(userId);
  pollCurrentlyPlaying(userId).then(delay => {
    // si un trigger externo ya reprogramó durante esta primera lectura (login
    // seguido de una acción de playback), respetar su timer
    if (pollGeneration.has(userId)) return;
    scheduleNextCurrentlyPlaying(userId, delay);
  });
}

function stopPollingForUser(userId: number) {
  const timers = userTimers.get(userId);
  if (!timers) return;
  if (timers.currentlyPlaying) clearTimeout(timers.currentlyPlaying);
  clearInterval(timers.recentlyPlayed);
  const flush = historyFlushTimers.get(userId);
  if (flush) clearTimeout(flush);
  historyFlushTimers.delete(userId);
  userTimers.delete(userId);
  userActiveTrack.delete(userId);
  pollGeneration.delete(userId);
}

// obtener el primer userId con tokens (para operaciones globales de catálogo)
function getAnyActiveUserId(): number | null {
  const users = getAllActiveUsersWithTokens();
  return users.length > 0 ? users[0].userId : null;
}

export function startPolling() {
  // arranca aunque no haya usuarios spotify: las cuentas last.fm van aparte
  startLastfmPolling();

  const activeUsers = getAllActiveUsersWithTokens();
  if (activeUsers.length === 0) {
    // sin usuarios spotify el catálogo aún se enriquece desde fuentes sin token
    // (scrobbles de usuarios solo-last.fm)
    console.log('[poll] sin usuarios spotify; solo enrichment sin-token');
    startTokenlessEnrichment();
    return;
  }

  console.log(`[poll] iniciando polling para ${activeUsers.length} usuario(s)...`);

  // polling per-user
  for (const { userId } of activeUsers) {
    startPollingForUser(userId);
  }

  // operaciones globales de catálogo (usan cualquier token activo)
  const globalUserId = activeUsers[0].userId;

  cleanOrphanImports();
  cleanDuplicatePlays();
  cleanBasicExtendedDuplicates();
  mergeImportTracks();
  cleanNonMusicImports();

  // duraciones/portadas/géneros sin token (musicbrainz + last.fm) — corre en su
  // propio timer, compartido con el escenario solo-last.fm
  startTokenlessEnrichment();

  // imágenes/géneros de artistas y artist_ids de álbumes con IDs reales vía spotify api (requiere token)
  enrichArtistMetadata(globalUserId).catch(err => console.error('[metadata] error:', err));
  enrichAlbumMetadata(globalUserId).catch(err => console.error('[metadata] error:', err));
  // portadas: quitar miniaturas de vídeo y recuperar el arte del hermano de audio
  fixVideoCovers(globalUserId)
    .then(() => recoverSingleCovers(globalUserId))
    .catch(err => console.error('[metadata] error portadas de vídeo:', err));

  metadataRefreshTimer = setInterval(() => {
    const uid = getAnyActiveUserId();
    if (!uid) return;
    enrichArtistMetadata(uid).catch(err => console.error('[metadata] error:', err));
    enrichAlbumMetadata(uid).catch(err => console.error('[metadata] error:', err));
    fixVideoCovers(uid)
      .then(() => recoverSingleCovers(uid))
      .catch(err => console.error('[metadata] error portadas de vídeo:', err));
  }, METADATA_REFRESH_INTERVAL_MS);

  // resolución de entidades import:
  const runResolve = (uid: number) => {
    resolveImportArtists(uid).catch(err => console.error('[resolve] error artistas:', err));
    resolveImportAlbums(uid).catch(err => console.error('[resolve] error álbumes:', err));
    fixTrackAlbumAssignments(uid).catch(err => console.error('[resolve] error álbumes tracks:', err));
  };
  runResolve(globalUserId);
  resolveImportsTimer = setInterval(() => {
    const uid = getAnyActiveUserId();
    if (!uid) return;
    runResolve(uid);
  }, RESOLVE_INTERVAL_MS);

  fixTrackArtistAssociations(globalUserId)
    .then(() => { deduplicateTracks(); deduplicateAlbums(); deduplicateAlbumShells(); deduplicateLocalAlbums(); })
    .catch(err => console.error('[resolve] error artistas:', err));
  artistFixTimer = setInterval(() => {
    const uid = getAnyActiveUserId();
    if (!uid) return;
    fixTrackArtistAssociations(uid)
      .then(() => { deduplicateTracks(); deduplicateAlbums(); deduplicateAlbumShells(); deduplicateLocalAlbums(); })
      .catch(err => console.error('[resolve] error artistas:', err));
  }, ARTIST_FIX_INTERVAL_MS);

  // records cache — la primera computación se delega al login/navegación del usuario
  recordsCacheTimer = setInterval(
    () => { try { computeAndCacheRecords(); } catch (err) { console.error('[records-cache] error:', err); } },
    RECORDS_CACHE_INTERVAL_MS,
  );

  // playlist sync (6h) — la primera sync se delega al login/navegación del usuario
  playlistSyncTimer = setInterval(() => {
    syncAllUsersPlaylists()
      .then(() => { try { computeAndCacheRecords(); } catch {} })
      .catch(err => console.error('[playlist-sync] error:', err));
  }, PLAYLIST_SYNC_INTERVAL_MS);

  // auto-regeneración de playlists generadas (check horario; la cadencia real por
  // playlist la fija su regenerate_interval_ms). solo por intervalo, sin run inicial.
  autoRegenerateTimer = setInterval(() => {
    runDueRegenerations().catch(err => console.error('[auto-regen] error:', err));
  }, AUTO_REGENERATE_CHECK_INTERVAL_MS);

  console.log(`[poll] currently playing con scheduling dinámico (${CURRENTLY_PLAYING_MIN_MS / 1000}s–${CURRENTLY_PLAYING_MAX_MS / 1000}s)`);
  console.log(`[poll] recently played cada ${RECENTLY_PLAYED_INTERVAL_MS / 1000}s`);
}

export function stopPolling() {
  // detener timers por usuario
  for (const [userId] of userTimers) {
    stopPollingForUser(userId);
  }

  // detener timers compartidos
  if (metadataRefreshTimer) clearInterval(metadataRefreshTimer);
  if (resolveImportsTimer) clearInterval(resolveImportsTimer);
  if (artistFixTimer) clearInterval(artistFixTimer);
  if (recordsCacheTimer) clearInterval(recordsCacheTimer);
  if (playlistSyncTimer) clearInterval(playlistSyncTimer);
  if (autoRegenerateTimer) clearInterval(autoRegenerateTimer);
  if (lastfmSyncTimer) clearInterval(lastfmSyncTimer);
  if (tokenlessEnrichTimer) clearInterval(tokenlessEnrichTimer);
  metadataRefreshTimer = null;
  resolveImportsTimer = null;
  artistFixTimer = null;
  recordsCacheTimer = null;
  playlistSyncTimer = null;
  autoRegenerateTimer = null;
  lastfmSyncTimer = null;
  tokenlessEnrichTimer = null;
  console.log('[poll] polling detenido');
}

// re-iniciar polling (útil después de OAuth de nuevo usuario).
// solo asegura los timers por usuario: el mantenimiento global de catálogo
// (dedup, cleanup, enrichment) ya corre desde el arranque y es síncrono y
// costoso — re-ejecutarlo aquí bloqueaba el callback de OAuth ~20s por login.
export function restartPolling() {
  resetDeferredState();

  // cuentas last.fm recién vinculadas (no-op si el loop ya corre)
  startLastfmPolling();

  // bootstrap: si el server arrancó sin usuarios, el polling global nunca se
  // inició — arrancarlo completo (DB recién creada, los cleanups son baratos)
  if (!metadataRefreshTimer) {
    startPolling();
    return;
  }

  for (const { userId } of getAllActiveUsersWithTokens()) {
    startPollingForUser(userId); // no-op para usuarios ya activos
  }
}
