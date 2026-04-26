import { api, type NowPlayingResponse, type PlayContextRequest, type PlayContextResponse } from '$lib/api';

let _data = $state<NowPlayingResponse | null>(null);
let _intervalId: ReturnType<typeof setInterval> | null = null;
let _isLiked = $state(false);
let _lastCheckedTrackId: string | null = null;
let _liveTrackGuardUntil = 0;
let _liveTrackGuardId: string | null = null;

const LIVE_TRACK_GUARD_MS = 35_000;

type NowPlayingSource = 'cached' | 'live' | 'local';

function trackIdOf(data: NowPlayingResponse | null): string | null {
  return data?.playing && data.track ? data.track.id : null;
}

function applyNowPlaying(data: NowPlayingResponse | null, source: NowPlayingSource) {
  const nextTrackId = trackIdOf(data);

  if (source === 'cached' && _liveTrackGuardId && Date.now() < _liveTrackGuardUntil) {
    if (nextTrackId === _liveTrackGuardId) {
      _liveTrackGuardId = null;
      _liveTrackGuardUntil = 0;
    } else {
      return;
    }
  }

  _data = data;

  if (source === 'live') {
    _liveTrackGuardId = nextTrackId;
    _liveTrackGuardUntil = nextTrackId ? Date.now() + LIVE_TRACK_GUARD_MS : 0;
  }
}

async function checkLiked(trackId: string | undefined) {
  if (!trackId) { _isLiked = false; _lastCheckedTrackId = null; return; }
  if (trackId === _lastCheckedTrackId) return;
  _lastCheckedTrackId = trackId;
  try {
    const { isLiked } = await api.checkTrackLiked(trackId);
    if (_lastCheckedTrackId === trackId) _isLiked = isLiked;
  } catch {
    _isLiked = false;
  }
}

async function poll() {
  try {
    applyNowPlaying(await api.nowPlaying(), 'cached');
    checkLiked(_data?.track?.id);
  } catch {
    applyNowPlaying(null, 'cached');
  }
}

async function pollLive() {
  try {
    applyNowPlaying(await api.nowPlayingLive(), 'live');
    checkLiked(_data?.track?.id);
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

async function playContext(opts: PlayContextRequest): Promise<PlayContextResponse | null> {
  try {
    const result = await api.playbackPlayContext(opts);
    if (result?.success) {
      setTimeout(() => pollLive(), 500);
    }
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

export const nowPlayingStore = {
  get data() { return _data; },
  set data(v: NowPlayingResponse | null) { applyNowPlaying(v, 'local'); },
  get trackId() { return _data?.playing && _data.isPlaying ? _data.track?.id ?? null : null; },
  get albumId() { return _data?.playing && _data.isPlaying ? _data.track?.album?.id ?? null : null; },
  get artistIds() { return _data?.playing && _data.isPlaying ? _data.track?.artists?.map(a => a.id) ?? [] : []; },
  get isPlaying() { return _data?.playing && _data.isPlaying ? true : false; },
  get isLiked() { return _isLiked; },
  set isLiked(v: boolean) { _isLiked = v; },
  startPolling,
  stopPolling,
  pollLive,
  playContext,
  toggleLike,
  checkLiked: (trackId: string) => { _lastCheckedTrackId = null; checkLiked(trackId); },
};
