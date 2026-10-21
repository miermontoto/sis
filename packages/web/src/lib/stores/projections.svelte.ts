import { getRankingMetric, getSessionRankDisplay, apiBase, type ProjectedRankingsResponse } from '$lib/api';
import { rankMoments, type RankMoment } from '$lib/utils/session-ranks';
import { nowPlayingStore } from './now-playing.svelte';

let _data = $state<ProjectedRankingsResponse | null>(null);
let _loading = $state(false);
let _lastFetchedTrackId: string | null = null;
let _pendingTrackId: string | null = null;
let _controller: AbortController | null = null;
// subidas entre la respuesta anterior y ésta (la tarjeta de momentos del móvil);
// la secuencia deja al consumidor distinguir un lote nuevo de una relectura
let _moments = $state<{ seq: number; items: RankMoment[] } | null>(null);
let _momentSeq = 0;

// force: la relectura tras un play confirmado va para el mismo track que ya está
// en vuelo o leído, y es la única que trae el play recién aterrizado
async function fetchProjections(force = false) {
  const trackId = nowPlayingStore.data?.track?.id ?? null;
  if (!force && _pendingTrackId === trackId && _loading) return;
  _controller?.abort();
  _controller = new AbortController();
  _loading = true;
  _pendingTrackId = trackId;

  try {
    // apiBase() (no url relativa): en el apk el webview corre en https://localhost
    // y una ruta relativa iría a ese origen sin api → la sesión no proyecta nada.
    const url = `${apiBase()}/stats/projected-rankings?sort=${getRankingMetric()}`;
    const res = await fetch(url, { signal: _controller.signal });
    if (!res.ok) return;
    const result: ProjectedRankingsResponse = await res.json();
    // con la pestaña oculta la respuesta sólo avanza la línea base: al volver no
    // tiene que llover lo que pasó mientras nadie miraba
    const items = document.visibilityState === 'visible' ? rankMoments(_data, result, getSessionRankDisplay()) : [];
    if (items.length > 0) _moments = { seq: ++_momentSeq, items };
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
  get moments() { return _moments; },
  get sessionStartedAt() { return _data?.sessionStartedAt ?? null; },
  get hasChanges() {
    return _data !== null && (_data.nowPlaying.length > 0 || _data.session.length > 0);
  },
  startPolling() { _lastFetchedTrackId = null; _pendingTrackId = null; },
  stopPolling() { _controller?.abort(); },
  onTrackChange,
  refresh: () => fetchProjections(true),
};
