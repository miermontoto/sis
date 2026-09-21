<script lang="ts">
  // recent plays en el rail: siembra con los plays iniciales (los 10 más
  // recientes) y pagina el resto vía /stats/history con scroll infinito. con
  // entidad filtra el historial por ella; sin entidad (dashboard) pagina el
  // historial completo. dedupe por id porque el seed y la primera página del
  // history se solapan (y el filtro por artista puede repetir un play por cada
  // artista coincidente). el contenedor tiene scroll propio y, en dos columnas,
  // crece para terminar justo donde acaba la columna principal (nunca la sobrepasa).
  //
  // cuando el seed cambia sin cambiar de entidad (el padre antepone un play que
  // acaba de terminar) se funde por delante en vez de resetear: resetear
  // tiraría las páginas ya cargadas y el scroll cada vez que termina una canción.
  import { api, type HistoryItem } from '$lib/api';
  import TrackList from './TrackList.svelte';

  let { entityType = null, entityId = '', initial, historyHref, compact = false, sessionStartedAt = null, sessionTotalTracks = 0 }: {
    entityType?: 'artist' | 'album' | 'track' | null;
    entityId?: string;
    initial: HistoryItem[];
    historyHref: string;
    compact?: boolean;
    sessionStartedAt?: string | null;
    sessionTotalTracks?: number;
  } = $props();

  // el detail devuelve los 10 más recientes; si llegan menos, no hay más que paginar
  const SEED_LIMIT = 10;
  const PAGE_LIMIT = 50;

  // se inicializa con el seed para no parpadear vacío en el primer render. las
  // lecturas no reactivas de `initial` son deliberadas: el $effect de más abajo
  // resincroniza items/seen/nextPage/hasMore cuando el prop cambia.
  // svelte-ignore state_referenced_locally
  let items = $state<HistoryItem[]>([...initial]);
  // svelte-ignore state_referenced_locally
  let seen = new Set<number>(initial.map((i) => i.id));
  let nextPage = 1;
  // svelte-ignore state_referenced_locally
  let hasMore = $state(initial.length >= SEED_LIMIT);
  let loadingMore = $state(false);
  let scrollEl = $state<HTMLElement | null>(null);
  let sentinel = $state<HTMLElement | null>(null);
  let firstRun = true;
  // svelte-ignore state_referenced_locally
  let lastEntity = entityId;

  // reset al cambiar de entidad; con la misma entidad, los plays nuevos del seed
  // se anteponen. el primer disparo del efecto ya está cubierto por la
  // inicialización de arriba.
  $effect(() => {
    const seed = initial;
    const entity = entityId;
    if (firstRun) { firstRun = false; return; }
    if (entity === lastEntity) {
      const fresh = seed.filter((i) => !seen.has(i.id));
      for (const i of fresh) seen.add(i.id);
      if (fresh.length) items = [...fresh, ...items];
      return;
    }
    lastEntity = entity;
    items = [...seed];
    seen = new Set(seed.map((i) => i.id));
    nextPage = 1;
    hasMore = seed.length >= SEED_LIMIT;
    if (scrollEl) scrollEl.scrollTop = 0;
  });

  async function loadMore() {
    if (loadingMore || !hasMore) return;
    loadingMore = true;
    try {
      const filters =
        entityType === 'artist' ? { artist: entityId }
        : entityType === 'album' ? { album: entityId }
        : entityType === 'track' ? { track: entityId }
        : undefined;
      const res = await api.history(nextPage, PAGE_LIMIT, filters);
      const fresh = res.items.filter((i) => !seen.has(i.id));
      for (const i of fresh) seen.add(i.id);
      if (fresh.length) items = [...items, ...fresh];
      nextPage += 1;
      hasMore = res.hasMore;
    } catch {
      // silencioso: el observer reintenta al re-scrollear
    } finally {
      loadingMore = false;
    }
  }

  // observer sobre el sentinel dentro del contenedor con scroll; se re-crea
  // cuando aparece/desaparece el sentinel (depende de hasMore)
  $effect(() => {
    const root = scrollEl;
    const target = sentinel;
    if (!root || !target) return;
    const obs = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) void loadMore(); },
      { root, rootMargin: '300px' },
    );
    obs.observe(target);
    return () => obs.disconnect();
  });
</script>

<h2 class="section-title"><a href={historyHref} class="section-link">Recent plays</a></h2>
<div class="recent-scroll" bind:this={scrollEl}>
  <TrackList {items} showTime {compact} {sessionStartedAt} {sessionTotalTracks} />
  {#if hasMore}
    <div class="recent-sentinel" bind:this={sentinel}>
      {#if loadingMore}<div class="spinner spinner--inline"></div>{/if}
    </div>
  {/if}
</div>

<style>
  .recent-sentinel {
    min-height: 1px;
    display: flex;
    justify-content: center;
    padding: 0.75rem 0;
  }
  .spinner--inline {
    width: 20px;
    height: 20px;
    border-width: 2px;
    margin: 0;
  }
</style>
