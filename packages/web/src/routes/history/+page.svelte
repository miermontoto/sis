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

  onMount(async () => {
    try {
      await loadPage(1);
    } finally {
      loading = false;
    }

    // infinite scroll con IntersectionObserver
    const observer = new IntersectionObserver(
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

    if (sentinel) observer.observe(sentinel);
    return () => observer.disconnect();
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
    <div bind:this={sentinel} class="loading" style="padding: 2rem;">
      {#if loadingMore}
        <div class="spinner"></div>
      {/if}
    </div>
  {/if}
{/if}
