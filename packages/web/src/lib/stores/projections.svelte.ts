import { getRankingMetric, type ProjectedRankingsResponse } from '$lib/api';
import { nowPlayingStore } from './now-playing.svelte';

let _data = $state<ProjectedRankingsResponse | null>(null);
let _loading = $state(false);
let _lastFetchedTrackId: string | null = null;
let _controller: AbortController | null = null;

async function fetchProjections() {
  _controller?.abort();
  _controller = new AbortController();
  _loading = true;

  try {
    const url = `/api/stats/projected-rankings?sort=${getRankingMetric()}`;
    const res = await fetch(url, { signal: _controller.signal });
    if (!res.ok) return;
    const result: ProjectedRankingsResponse = await res.json();
    _data = result;
    _lastFetchedTrackId = nowPlayingStore.data?.track?.id ?? null;
  } catch {
  } finally {
    _loading = false;
  }
}

function onTrackChange() {
  const trackId = nowPlayingStore.data?.track?.id ?? null;
  if (trackId !== _lastFetchedTrackId) {
    fetchProjections();
  }
}

export const projectionsStore = {
  get data() { return _data; },
  get loading() { return _loading; },
  get hasChanges() {
    return _data !== null && (_data.nowPlaying.length > 0 || _data.session.length > 0);
  },
  startPolling() { fetchProjections(); },
  stopPolling() { _controller?.abort(); },
  onTrackChange,
  refresh: fetchProjections,
};
