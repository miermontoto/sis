<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { api, type HistoryItem } from '$lib/api';
  import TrackList from '$lib/components/TrackList.svelte';

  let items = $state<HistoryItem[]>([]);
  let currentPage = $state(1);
  let hasMore = $state(true);
  let loading = $state(true);
  let loadingMore = $state(false);
  let sentinel = $state<HTMLElement | null>(null);
  let dateFilter = $state<string | null>(null);

  async function loadPage(p: number) {
    const res = await api.history(p, 50, dateFilter ?? undefined);
    if (p === 1) {
      items = res.items;
    } else {
      items = [...items, ...res.items];
    }
    hasMore = res.hasMore;
    currentPage = p;
  }

  // polling: buscar nuevas reproducciones cada 15s (solo sin filtro de fecha)
  async function pollNewItems() {
    if (dateFilter) return;
    try {
      const res = await api.history(1, 50);
      if (res.items.length === 0 || items.length === 0) return;
      const latestId = items[0].id;
      const newItems = res.items.filter((i) => i.id > latestId);
      if (newItems.length > 0) {
        items = [...newItems, ...items];
      }
    } catch {
      // silenciar errores de polling
    }
  }

  function clearDate() {
    dateFilter = null;
    goto('/history', { replaceState: true });
    loading = true;
    loadPage(1).finally(() => { loading = false; });
  }

  function formatDateLabel(d: string): string {
    return new Date(d + 'T00:00:00').toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
  }

  let observer: IntersectionObserver | null = null;

  onMount(() => {
    const urlDate = $page.url.searchParams.get('date');
    if (urlDate) dateFilter = urlDate;

    observer = new IntersectionObserver(
      async (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore) {
          loadingMore = true;
          try {
            await loadPage(currentPage + 1);
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

{#if dateFilter}
  <div class="date-filter-bar">
    <span>{formatDateLabel(dateFilter)}</span>
    <button class="date-filter-clear" onclick={clearDate}>Clear filter</button>
  </div>
{/if}

{#if loading}
  <div class="loading">
    <div class="spinner"></div>
    Loading...
  </div>
{:else if items.length === 0}
  <div class="empty-state">{dateFilter ? 'No plays on this day.' : 'No listening data yet.'}</div>
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

<style>
  .date-filter-bar {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem 0.75rem;
    margin-bottom: 1rem;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    font-size: 0.85rem;
    color: var(--text);
  }
  .date-filter-clear {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-muted);
    font-size: 0.75rem;
    font-family: var(--font);
    padding: 0.2rem 0.5rem;
    border-radius: 5px;
    cursor: pointer;
    transition: color 0.15s, border-color 0.15s;
  }
  .date-filter-clear:hover {
    color: var(--text);
    border-color: var(--text-muted);
  }
</style>
