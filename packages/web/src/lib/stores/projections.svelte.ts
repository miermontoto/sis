import { getRankingMetric, API_BASE, type ProjectedRankingsResponse } from '$lib/api';
import { nowPlayingStore } from './now-playing.svelte';

let _data = $state<ProjectedRankingsResponse | null>(null);
let _loading = $state(false);
let _lastFetchedTrackId: string | null = null;
let _pendingTrackId: string | null = null;
let _controller: AbortController | null = null;

async function fetchProjections() {
  const trackId = nowPlayingStore.data?.track?.id ?? null;
  if (_pendingTrackId === trackId && _loading) return;
  _controller?.abort();
  _controller = new AbortController();
  _loading = true;
  _pendingTrackId = trackId;

  try {
    // API_BASE (no url relativa): en el apk el webview corre en https://localhost
    // y una ruta relativa iría a ese origen sin api → la sesión no proyecta nada.
    const url = `${API_BASE}/stats/projected-rankings?sort=${getRankingMetric()}`;
    const res = await fetch(url, { signal: _controller.signal });
    if (!res.ok) return;
    const result: ProjectedRankingsResponse = await res.json();
    _data = result;
    _lastFetchedTrackId = trackId;
  } catch {
  } finally {
    _loading = false;
  }
}

function onTrackChange() {
  const trackId = nowPlayingStore.data?.track?.id ?? null;
  if (trackId !== _lastFetchedTrackId && trackId !== _pendingTrackId) {
    fetchProjections();
  }
}

export const projectionsStore = {
  get data() { return _data; },
  get loading() { return _loading; },
  get sessionStartedAt() { return _data?.sessionStartedAt ?? null; },
  get hasChanges() {
    return _data !== null && (_data.nowPlaying.length > 0 || _data.session.length > 0);
  },
  startPolling() { _lastFetchedTrackId = null; _pendingTrackId = null; },
  stopPolling() { _controller?.abort(); },
  onTrackChange,
  refresh: fetchProjections,
};
