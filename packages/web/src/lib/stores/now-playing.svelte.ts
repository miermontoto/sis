import { api, type NowPlayingResponse } from '$lib/api';

let _data = $state<NowPlayingResponse | null>(null);
let _intervalId: ReturnType<typeof setInterval> | null = null;

async function poll() {
  try {
    _data = await api.nowPlaying();
  } catch {
    _data = null;
  }
}

async function pollLive() {
  try {
    _data = await api.nowPlayingLive();
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

export const nowPlayingStore = {
  get data() { return _data; },
  set data(v: NowPlayingResponse | null) { _data = v; },
  get trackId() { return _data?.playing && _data.isPlaying ? _data.track?.id ?? null : null; },
  get albumId() { return _data?.playing && _data.isPlaying ? _data.track?.album?.id ?? null : null; },
  get artistIds() { return _data?.playing && _data.isPlaying ? _data.track?.artists?.map(a => a.id) ?? [] : []; },
  get isPlaying() { return _data?.playing && _data.isPlaying ? true : false; },
  startPolling,
  stopPolling,
  pollLive,
};
