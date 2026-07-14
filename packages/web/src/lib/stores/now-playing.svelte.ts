import { api, type NowPlayingResponse, type PlayContextRequest, type PlayContextResponse, type HistoryItem } from '$lib/api';
import { MIN_PLAY_MS } from '@sis/shared';

let _data = $state<NowPlayingResponse | null>(null);
let _intervalId: ReturnType<typeof setInterval> | null = null;
let _isLiked = $state(false);
let _likeLoading = $state(false);
let _lastCheckedTrackId: string | null = null;
let _liveTrackGuardUntil = 0;
let _liveTrackGuardId: string | null = null;
let _trackStartedAt = 0;
let _lastFinishedPlay = $state<HistoryItem | null>(null);
let _volumePercent = $state<number | null>(null);
type NpPlaylist = { id: number; spotifyId: string; name: string; imageUrl: string | null };
let _playlists = $state<NpPlaylist[]>([]);
let _lastPlaylistTrackId: string | null = null;

const LIVE_TRACK_GUARD_MS = 35_000;
// backoff de reintentos tras un comando de reproducción: spotify es
// eventualmente consistente y una lectura temprana suele devolver aún el
// estado anterior
const PLAY_REFRESH_DELAYS_MS = [500, 1000, 2000, 4000];

type NowPlayingSource = 'cached' | 'live' | 'local';

function trackIdOf(data: NowPlayingResponse | null): string | null {
  return data?.playing && data.track ? data.track.id : null;
}

function applyNowPlaying(data: NowPlayingResponse | null, source: NowPlayingSource) {
  const prevTrackId = trackIdOf(_data);
  const nextTrackId = trackIdOf(data);

  if (source === 'cached' && _liveTrackGuardId && Date.now() < _liveTrackGuardUntil) {
    if (nextTrackId === _liveTrackGuardId) {
      _liveTrackGuardId = null;
      _liveTrackGuardUntil = 0;
    } else {
      return;
    }
  }

  if (nextTrackId !== prevTrackId) {
    if (prevTrackId && _data?.track && _trackStartedAt > 0 && Date.now() - _trackStartedAt >= MIN_PLAY_MS) {
      _lastFinishedPlay = {
        id: Date.now(),
        playedAt: new Date().toISOString(),
        contextType: null,
        track: _data.track,
      };
    }
    _trackStartedAt = nextTrackId ? Date.now() : 0;
  }

  _data = data;
  if (data?.volumePercent != null) _volumePercent = data.volumePercent;

  if (source === 'live') {
    _liveTrackGuardId = nextTrackId;
    _liveTrackGuardUntil = nextTrackId ? Date.now() + LIVE_TRACK_GUARD_MS : 0;
  }
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

async function poll() {
  try {
    applyNowPlaying(await api.nowPlaying(), 'cached');
    checkLiked(_data?.track?.id);
    checkPlaylists(_data?.track?.id);
  } catch {
    applyNowPlaying(null, 'cached');
  }
}

async function pollLive() {
  try {
    applyNowPlaying(await api.nowPlayingLive(), 'live');
    checkLiked(_data?.track?.id);
    checkPlaylists(_data?.track?.id);
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
      const live = await api.nowPlayingLive();
      const changed = trackIdOf(live) !== prevTrackId || (!!live?.isPlaying && !prevIsPlaying);
      if (!changed) continue;
      applyNowPlaying(live, 'live');
      checkLiked(_data?.track?.id);
      checkPlaylists(_data?.track?.id);
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
  get isPlaying() { return _data?.playing && _data.isPlaying ? true : false; },
  get isLiked() { return _isLiked; },
  set isLiked(v: boolean) { _isLiked = v; },
  get likeLoading() { return _likeLoading; },
  get lastFinishedPlay() { return _lastFinishedPlay; },
  get volumePercent() { return _volumePercent; },
  get playlists() { return _playlists; },
  set playlists(v: NpPlaylist[]) { _playlists = v; },
  startPolling,
  stopPolling,
  pollLive,
  playContext,
  toggleLike,
  setVolume,
  checkLiked: (trackId: string) => { _lastCheckedTrackId = null; checkLiked(trackId); },
};
