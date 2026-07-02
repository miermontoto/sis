<script lang="ts">
  // recent plays en el rail de detalle: siembra con los plays iniciales del
  // endpoint detail (los 10 más recientes) y pagina el resto vía /stats/history
  // con scroll infinito. dedupe por id porque el seed y la primera página del
  // history se solapan (y el filtro por artista puede repetir un play por cada
  // artista coincidente). el contenedor tiene scroll propio y, en dos columnas,
  // crece para terminar justo donde acaba la columna principal (nunca la sobrepasa).
  import { api, type HistoryItem } from '$lib/api';
  import TrackList from './TrackList.svelte';

  let { entityType, entityId, initial, historyHref }: {
    entityType: 'artist' | 'album' | 'track';
    entityId: string;
    initial: HistoryItem[];
    historyHref: string;
  } = $props();

  // el detail devuelve los 10 más recientes; si llegan menos, no hay más que paginar
  const SEED_LIMIT = 10;
  const PAGE_LIMIT = 50;

  // se inicializa con el seed para no parpadear vacío en el primer render
  let items = $state<HistoryItem[]>([...initial]);
  let seen = new Set<number>(initial.map((i) => i.id));
  let nextPage = 1;
  let hasMore = $state(initial.length >= SEED_LIMIT);
  let loadingMore = $state(false);
  let scrollEl = $state<HTMLElement | null>(null);
  let sentinel = $state<HTMLElement | null>(null);
  let firstRun = true;

  // reset al cambiar de entidad (o al recargarse el detail por cambio de métrica).
  // el primer disparo del efecto ya está cubierto por la inicialización de arriba.
  $effect(() => {
    const seed = initial;
    void entityId;
    if (firstRun) { firstRun = false; return; }
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
        : { track: entityId };
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
  <TrackList {items} showTime />
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
