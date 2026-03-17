<script lang="ts">
  import { onMount } from 'svelte';
  import { api, type HistoryItem } from '$lib/api';
  import TrackList from '$lib/components/TrackList.svelte';

  let items = $state<HistoryItem[]>([]);
  let page = $state(1);
  let hasMore = $state(true);
  let loading = $state(true);
  let loadingMore = $state(false);
  let sentinel = $state<HTMLElement | null>(null);

  async function loadPage(p: number) {
    const res = await api.history(p, 50);
    if (p === 1) {
      items = res.items;
    } else {
      items = [...items, ...res.items];
    }
    hasMore = res.hasMore;
    page = p;
  }

  // polling: buscar nuevas reproducciones cada 15s
  async function pollNewItems() {
    try {
      const res = await api.history(1, 50);
      if (res.items.length === 0 || items.length === 0) return;
      // insertar items más recientes que el primero actual
      const latestId = items[0].id;
      const newItems = res.items.filter((i) => i.id > latestId);
      if (newItems.length > 0) {
        items = [...newItems, ...items];
      }
    } catch {
      // silenciar errores de polling
    }
  }

  let observer: IntersectionObserver | null = null;

  onMount(() => {
    observer = new IntersectionObserver(
      async (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore) {
          loadingMore = true;
          try {
            await loadPage(page + 1);
          } finally {
            loadingMore = false;
          }
        }
      },
      { threshold: 0.1 },
    );

    loadPage(1).finally(() => { loading = false; });

    const pollInterval = setInterval(pollNewItems, 15_000);
    return () => {
      clearInterval(pollInterval);
      observer!.disconnect();
    };
  });

  // observar sentinel cuando aparece en el DOM
  $effect(() => {
    if (sentinel && observer) {
      observer.observe(sentinel);
    }
  });
</script>

<div class="page-header">
  <h1>Listening History</h1>
  <p>Every track you've played</p>
</div>

{#if loading}
  <div class="loading">
    <div class="spinner"></div>
    Loading...
  </div>
{:else if items.length === 0}
  <div class="empty-state">No listening data yet.</div>
{:else}
  <TrackList {items} showTime />

  {#if hasMore}
    <div bind:this={sentinel} style="min-height: 1px; padding: 2rem; display: flex; justify-content: center;">
      {#if loadingMore}
        <div class="spinner"></div>
      {/if}
    </div>
  {/if}
{/if}
