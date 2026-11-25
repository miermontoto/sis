import { getRankingMetric, getSessionRankDisplay, apiBase, invalidateRankingHistory, type ProjectedRankingsResponse } from '$lib/api';
import { MOMENTS_PER_UPDATE, movedEntities, rankMoments, type RankMoment } from '$lib/utils/session-ranks';
import { nowPlayingStore } from './now-playing.svelte';

// tras volver a la app, lo que aterrice en este margen también pasó sin nadie mirando:
// los plays de la ausencia llegan confirmados en la primera lectura de /now-playing
const AWAY_GRACE_MS = 10_000;

let _data = $state<ProjectedRankingsResponse | null>(null);
let _loading = $state(false);
let _lastFetchedTrackId: string | null = null;
let _pendingTrackId: string | null = null;
let _controller: AbortController | null = null;
// subidas entre la respuesta anterior y ésta (la tarjeta de momentos del móvil);
// la secuencia deja al consumidor distinguir un lote nuevo de una relectura
let _moments = $state<{ seq: number; items: RankMoment[] } | null>(null);
let _momentSeq = 0;
// subidas que llegaron sin nadie mirando (app oculta o recién vuelta): no llueven
// como tarjetas al volver, se cuentan, y el mini player lo dice una vez y deja una
// marca en su chip hasta que se abre la hoja. `away` es el lote, con su secuencia
let _unseen = $state(0);
let _away = $state<{ seq: number; count: number } | null>(null);
let _awaySeq = 0;
let _visibleAt = 0;

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') _visibleAt = Date.now();
  });
}

const isAway = () => document.visibilityState !== 'visible' || Date.now() - _visibleAt < AWAY_GRACE_MS;

// force: la relectura tras un play confirmado va para el mismo track que ya está
// en vuelo o leído, y es la única que trae el play recién aterrizado
async function fetchProjections(force = false) {
  const trackId = nowPlayingStore.data?.track?.id ?? null;
  if (!force && _pendingTrackId === trackId && _loading) return;
  _controller?.abort();
  _controller = new AbortController();
  const signal = _controller.signal;
  _loading = true;
  _pendingTrackId = trackId;

  try {
    // apiBase() (no url relativa): en el apk el webview corre en https://localhost
    // y una ruta relativa iría a ese origen sin api → la sesión no proyecta nada.
    const url = `${apiBase()}/stats/projected-rankings?sort=${getRankingMetric()}`;
    const res = await fetch(url, { signal });
    if (!res.ok) return;
    const result: ProjectedRankingsResponse = await res.json();
    // lo que esta respuesta mueve no puede abrirse con su historial de ranking de
    // antes del play: se purga ANTES de pintarla, que es cuando se puede pinchar
    await invalidateRankingHistory(movedEntities(_data, result));
    // relevada durante la purga: la lectura nueva compara contra el mismo _data
    if (signal.aborted) return;
    // con la pestaña oculta (o recién vuelta) la respuesta avanza la línea base y lo
    // que subió se cuenta: al volver no tiene que llover lo que pasó mientras nadie
    // miraba, pero tampoco perderse
    const moved = rankMoments(_data, result, getSessionRankDisplay(), Infinity);
    if (moved.length > 0 && isAway()) {
      _unseen += moved.length;
      _away = { seq: ++_awaySeq, count: _unseen };
    } else if (moved.length > 0) {
      _moments = { seq: ++_momentSeq, items: moved.slice(0, MOMENTS_PER_UPDATE) };
    }
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
  get unseen() { return _unseen; },
  get away() { return _away; },
  // abrir la hoja es ver la sesión: la marca del chip se va
  markSeen() { _unseen = 0; },
  get sessionStartedAt() { return _data?.sessionStartedAt ?? null; },
  get hasChanges() {
    return _data !== null && (_data.nowPlaying.length > 0 || _data.session.length > 0);
  },
  startPolling() { _lastFetchedTrackId = null; _pendingTrackId = null; },
  stopPolling() { _controller?.abort(); },
  onTrackChange,
  refresh: () => fetchProjections(true),
};
