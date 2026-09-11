import { api, getNowPlayingUpNext, onNowPlayingUpNextChange, type NowPlayingResponse, type PlayContextRequest, type PlayContextResponse, type HistoryItem, type PlaybackQueueItem } from '$lib/api';
import { MIN_PLAY_MS } from '@sis/shared';
import { playUpdatesStore } from './play-updates.svelte';

let _data = $state<NowPlayingResponse | null>(null);
let _intervalId: ReturnType<typeof setInterval> | null = null;
let _isLiked = $state(false);
let _likeLoading = $state(false);
let _lastCheckedTrackId: string | null = null;
// marca de servidor (updatedAt) de la última lectura en vivo aplicada: las
// lecturas cacheadas medidas ANTES que ella son obsoletas y se descartan
let _liveInfoAtMs = 0;
let _liveGuardUntil = 0;
let _lastFinishedPlay = $state<HistoryItem | null>(null);
let _volumePercent = $state<number | null>(null);
// base de progreso del track: valor conocido + instante (reloj cliente) en que
// se conoció; el progreso mostrado se extrapola desde aquí mientras suena.
// infoAtMs = cuándo se midió la información (updatedAt del server o el seek
// local): solo se acepta una base nueva si su medición es más reciente
let _progress = $state<{ baseMs: number; baseAtMs: number; playing: boolean; infoAtMs: number } | null>(null);
let _queue = $state<PlaybackQueueItem[]>([]);
let _lastQueueTrackId: string | null = null;
type NpPlaylist = { id: number; spotifyId: string; name: string; imageUrl: string | null };
let _playlists = $state<NpPlaylist[]>([]);
let _lastPlaylistTrackId: string | null = null;
let _boundaryTimeout: ReturnType<typeof setTimeout> | null = null;
let _boundaryAttempts = 0;

// techo del guard de lectura en vivo: red de seguridad por si el servidor nunca
// llega a producir información más nueva. el desarme normal es por comparación
// de marcas de servidor, no por tiempo
const LIVE_GUARD_CEILING_MS = 35_000;
// refresco en el límite del track: con solo el tick de 10s un cambio natural
// tarda hasta ese tick en verse aunque el servidor ya lo sepa
const BOUNDARY_MARGIN_MS = 1_500;
const BOUNDARY_MAX_ATTEMPTS = 4;
// debounce de la llamada de seek (los arrows del teclado repiten en ráfaga)
const SEEK_DEBOUNCE_MS = 200;
// backoff de reintentos tras un comando de reproducción: spotify es
// eventualmente consistente y una lectura temprana suele devolver aún el
// estado anterior
const PLAY_REFRESH_DELAYS_MS = [500, 1000, 2000, 4000];

type NowPlayingSource = 'cached' | 'live' | 'local';

function trackIdOf(data: NowPlayingResponse | null): string | null {
  return data?.playing && data.track ? data.track.id : null;
}

// instante (reloj del servidor) en que se midió la información de la respuesta
function serverInfoAtMs(data: NowPlayingResponse | null): number {
  const parsed = data?.updatedAt ? Date.parse(data.updatedAt) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

// progreso extrapolado en el instante nowMs, acotado a la duración del track
function progressMsAt(nowMs: number): number | null {
  if (!_progress || !_data?.playing || !_data.track) return null;
  const raw = _progress.playing ? _progress.baseMs + (nowMs - _progress.baseAtMs) : _progress.baseMs;
  return Math.max(0, Math.min(raw, _data.track.durationMs));
}

function applyNowPlaying(data: NowPlayingResponse | null, source: NowPlayingSource) {
  const prevTrackId = trackIdOf(_data);
  const nextTrackId = trackIdOf(data);

  // ambas marcas las genera el servidor, así que la comparación no depende del
  // reloj del cliente. en cuanto su poll produce información más nueva que la
  // lectura en vivo, el guard se desarma: no hay ventana ciega fija
  if (source === 'cached' && _liveInfoAtMs && Date.now() < _liveGuardUntil) {
    if (serverInfoAtMs(data) > _liveInfoAtMs) {
      _liveInfoAtMs = 0;
      _liveGuardUntil = 0;
    } else {
      return;
    }
  }

  if (nextTrackId !== prevTrackId && prevTrackId && _data?.track) {
    const finished = _data.track;
    // ms escuchados del track saliente: el progreso extrapolado justo en el
    // corte (aquí _data y _progress todavía apuntan al track que termina),
    // capado a su duración. Es la misma cifra que el poller manda como
    // duration_played_ms, así que el parche optimista suma lo que sumará la
    // relectura en vez de asumir siempre el track entero.
    //
    // Y es también el umbral: se mide CUÁNTO SONÓ el track, no cuánto lleva el
    // cliente mirándolo. Contra el reloj de observación, abrir la app (o
    // recargar la página) a mitad de canción no emitía nada — el play aterrizaba
    // en el servidor y ninguna vista se enteraba. Al revés, pausar a los 10s y
    // volver media hora después emitía un play que el servidor descarta.
    // Sin base de progreso (usuarios solo-last.fm) se asume el track entero
    const playedMs = Math.min(progressMsAt(Date.now()) ?? finished.durationMs, finished.durationMs);
    if (playedMs >= MIN_PLAY_MS) {
      const playedAt = new Date().toISOString();
      _lastFinishedPlay = {
        id: Date.now(),
        playedAt,
        contextType: null,
        track: finished,
      };
      playUpdatesStore.emitOptimistic({
        trackId: finished.id,
        albumId: finished.album?.id ?? null,
        artistIds: finished.artists.map(a => a.id),
        playedMs,
        playedAt,
      });
    }
  }

  _data = data;
  playUpdatesStore.applyHistoryTail(data?.historyWatermark, data?.landedPlays);
  if (data?.volumePercent != null) _volumePercent = data.volumePercent;

  // progreso: live/cached traen base fresca (extrapolada por la edad de
  // updatedAt), pero solo si su medición es más nueva que la base actual —
  // tras un seek optimista, una lectura cacheada previa retrocedería la
  // barra. los updates locales (pause/resume) arrastran un progressMs
  // obsoleto, así que congelan el valor extrapolado actual en su lugar
  if (!data?.playing || !data.track) {
    _progress = null;
  } else if (typeof data.progressMs === 'number' && source !== 'local') {
    const parsedUpdatedAt = data.updatedAt ? Date.parse(data.updatedAt) : NaN;
    const infoAtMs = Number.isFinite(parsedUpdatedAt) ? parsedUpdatedAt : Date.now();
    const sameBase = nextTrackId === prevTrackId && _progress != null;
    if (!sameBase || infoAtMs > _progress!.infoAtMs) {
      const ageMs = Math.max(0, Date.now() - infoAtMs);
      _progress = { baseMs: data.progressMs + (data.isPlaying ? ageMs : 0), baseAtMs: Date.now(), playing: !!data.isPlaying, infoAtMs };
    } else if (_progress!.playing !== !!data.isPlaying) {
      // medición vieja pero el flag de reproducción cambió: congela/reanuda
      _progress = { baseMs: progressMsAt(Date.now()) ?? _progress!.baseMs, baseAtMs: Date.now(), playing: !!data.isPlaying, infoAtMs: _progress!.infoAtMs };
    }
  } else if (_progress) {
    _progress = { baseMs: progressMsAt(Date.now()) ?? _progress.baseMs, baseAtMs: Date.now(), playing: !!data.isPlaying, infoAtMs: _progress.infoAtMs };
  }

  if (source === 'live') {
    _liveInfoAtMs = nextTrackId ? serverInfoAtMs(data) || Date.now() : 0;
    _liveGuardUntil = nextTrackId ? Date.now() + LIVE_GUARD_CEILING_MS : 0;
  }

  scheduleBoundaryRefresh();
}

// programa un poll cacheado justo después del final previsto del track. el
// servidor ya ha releído para entonces (su timer apunta al final + buffer), así
// que basta la lectura barata; se reintenta unas pocas veces por si aún no ha
// llegado, y el contador se reinicia al alejarse del final (track nuevo, loop
// o seek hacia atrás)
function scheduleBoundaryRefresh() {
  if (_boundaryTimeout) { clearTimeout(_boundaryTimeout); _boundaryTimeout = null; }
  if (!_intervalId || !_data?.playing || !_data.track || !_progress?.playing) return;

  const remaining = Math.max(0, _data.track.durationMs - (progressMsAt(Date.now()) ?? 0));
  if (remaining > BOUNDARY_MARGIN_MS) _boundaryAttempts = 0;
  if (_boundaryAttempts >= BOUNDARY_MAX_ATTEMPTS) return;

  _boundaryTimeout = setTimeout(() => {
    _boundaryTimeout = null;
    _boundaryAttempts++;
    poll();
  }, remaining + BOUNDARY_MARGIN_MS);
}

async function checkLiked(trackId: string | undefined) {
  if (!trackId) { _isLiked = false; _likeLoading = false; _lastCheckedTrackId = null; return; }
  if (trackId === _lastCheckedTrackId) return;
  _lastCheckedTrackId = trackId;
  _likeLoading = true;
  try {
    const { isLiked } = await api.checkTrackLiked(trackId);
    if (_lastCheckedTrackId === trackId) _isLiked = isLiked;
  } catch {
    _isLiked = false;
  } finally {
    if (_lastCheckedTrackId === trackId) _likeLoading = false;
  }
}

async function checkPlaylists(trackId: string | undefined) {
  if (!trackId) { _playlists = []; _lastPlaylistTrackId = null; return; }
  if (trackId === _lastPlaylistTrackId) return;
  _lastPlaylistTrackId = trackId;
  try {
    const { playlists } = await api.trackPlaylists(trackId);
    if (_lastPlaylistTrackId === trackId) _playlists = playlists;
  } catch {
    _playlists = [];
  }
}

// la cola es una llamada en vivo a spotify, así que se pide una vez por tema
// (mismo guard por trackId que checkLiked/checkPlaylists) y no en cada tick.
// La respuesta puede venir medida justo antes del corte y traer el tema actual
// en cabeza; quien la pinta salta esa cabecera en vez de retrasar la petición.
// El ajuste nowPlayingUpNext se comprueba aquí y no al pintar: su única
// consumidora es la fila del siguiente tema, así que apagado no hay nada que
// pedir y la llamada se ahorra entera
async function checkQueue(trackId: string | undefined) {
  if (!trackId || _data?.controllable === false || !getNowPlayingUpNext()) { _queue = []; _lastQueueTrackId = null; return; }
  if (trackId === _lastQueueTrackId) return;
  _lastQueueTrackId = trackId;
  try {
    const { queue } = await api.playbackQueue();
    if (_lastQueueTrackId === trackId) _queue = queue;
  } catch {
    _queue = [];
  }
}

// el guard por trackId haría que encender el ajuste a mitad de tema no pidiera
// nada hasta el siguiente corte; apagarlo entra por la misma puerta y checkQueue
// vacía la cola
onNowPlayingUpNextChange(() => { _lastQueueTrackId = null; checkQueue(_data?.track?.id); });

async function poll() {
  try {
    applyNowPlaying(await api.nowPlaying(playUpdatesStore.watermark), 'cached');
    checkLiked(_data?.track?.id);
    checkPlaylists(_data?.track?.id);
    checkQueue(_data?.track?.id);
  } catch {
    applyNowPlaying(null, 'cached');
  }
}

async function pollLive() {
  try {
    applyNowPlaying(await api.nowPlayingLive(playUpdatesStore.watermark), 'live');
    checkLiked(_data?.track?.id);
    checkPlaylists(_data?.track?.id);
    checkQueue(_data?.track?.id);
  } catch {
    await poll();
  }
}

function startPolling() {
  poll();
  _intervalId = setInterval(poll, 10_000);
}

function stopPolling() {
  if (_intervalId) {
    clearInterval(_intervalId);
    _intervalId = null;
  }
  if (_boundaryTimeout) {
    clearTimeout(_boundaryTimeout);
    _boundaryTimeout = null;
  }
}

// tras lanzar reproducción, reintenta la lectura en vivo hasta observar un
// cambio real respecto al estado previo. las lecturas que aún muestran el
// estado anterior se descartan sin aplicar: aplicarlas como 'live' armaba el
// guard con el track viejo y bloqueaba el update cacheado correcto durante 35s
async function refreshAfterPlayback() {
  const prevTrackId = trackIdOf(_data);
  const prevIsPlaying = !!(_data?.playing && _data.isPlaying);
  for (const delayMs of PLAY_REFRESH_DELAYS_MS) {
    await new Promise(r => setTimeout(r, delayMs));
    try {
      const live = await api.nowPlayingLive(playUpdatesStore.watermark);
      const changed = trackIdOf(live) !== prevTrackId || (!!live?.isPlaying && !prevIsPlaying);
      if (!changed) continue;
      applyNowPlaying(live, 'live');
      checkLiked(_data?.track?.id);
      checkPlaylists(_data?.track?.id);
      checkQueue(_data?.track?.id);
      return;
    } catch {
      // error puntual: siguiente intento
    }
  }
  // sin cambio observado (p.ej. replay del mismo track): aplicar la verdad actual
  await pollLive();
}

async function playContext(opts: PlayContextRequest): Promise<PlayContextResponse | null> {
  try {
    const result = await api.playbackPlayContext(opts);
    if (result?.success) refreshAfterPlayback();
    return result;
  } catch {
    return null;
  }
}

async function toggleLike() {
  const trackId = _data?.track?.id;
  if (!trackId) return;
  const wasLiked = _isLiked;
  _isLiked = !wasLiked;
  try {
    if (wasLiked) {
      await api.unlikeTrack(trackId);
    } else {
      await api.likeTrack(trackId);
    }
  } catch {
    _isLiked = wasLiked;
  }
}

let _seekTimeout: ReturnType<typeof setTimeout> | null = null;

// salta a una posición del track: base optimista inmediata + llamada debounced
function seek(positionMs: number) {
  const durationMs = _data?.playing ? _data.track?.durationMs : undefined;
  if (!durationMs) return;
  const clamped = Math.max(0, Math.min(Math.round(positionMs), durationMs));
  _progress = { baseMs: clamped, baseAtMs: Date.now(), playing: !!_data!.isPlaying, infoAtMs: Date.now() };
  if (_seekTimeout) clearTimeout(_seekTimeout);
  _seekTimeout = setTimeout(async () => {
    try { await api.playbackSeek(clamped); } catch {}
  }, SEEK_DEBOUNCE_MS);
}

let _volumeTimeout: ReturnType<typeof setTimeout> | null = null;

async function setVolume(percent: number) {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  _volumePercent = clamped;
  if (_volumeTimeout) clearTimeout(_volumeTimeout);
  _volumeTimeout = setTimeout(async () => {
    try { await api.playbackVolume(clamped); } catch {}
  }, 150);
}

export const nowPlayingStore = {
  get data() { return _data; },
  set data(v: NowPlayingResponse | null) { applyNowPlaying(v, 'local'); },
  get trackId() { return _data?.playing && _data.isPlaying ? _data.track?.id ?? null : null; },
  get albumId() { return _data?.playing && _data.isPlaying ? _data.track?.album?.id ?? null : null; },
  get artistIds() { return _data?.playing && _data.isPlaying ? _data.track?.artists?.map(a => a.id) ?? [] : []; },
  get isPlaying() { return !!(_data?.playing && _data.isPlaying); },
  get isLiked() { return _isLiked; },
  set isLiked(v: boolean) { _isLiked = v; },
  get likeLoading() { return _likeLoading; },
  get lastFinishedPlay() { return _lastFinishedPlay; },
  get volumePercent() { return _volumePercent; },
  progressMsAt,
  seek,
  get playlists() { return _playlists; },
  set playlists(v: NpPlaylist[]) { _playlists = v; },
  get queue() { return _queue; },
  // encolar mueve la cabeza de la cola (spotify pone lo encolado justo detrás
  // del tema actual), así que el "next" del sidebar miente hasta releerla
  refreshQueue: () => { _lastQueueTrackId = null; checkQueue(_data?.track?.id); },
  startPolling,
  stopPolling,
  pollLive,
  playContext,
  toggleLike,
  setVolume,
  checkLiked: (trackId: string) => { _lastCheckedTrackId = null; checkLiked(trackId); },
};
