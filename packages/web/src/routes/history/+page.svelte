<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { api, type HistoryItem } from '$lib/api';
  import { timeAgo, formatDate } from '$lib/utils/format';
  import { nowPlayingStore } from '$lib/stores/now-playing.svelte';
  import TrackList from '$lib/components/TrackList.svelte';

  let items = $state<HistoryItem[]>([]);
  let currentPage = $state(1);
  let hasMore = $state(true);
  let loading = $state(true);
  let loadingMore = $state(false);
  let sentinel = $state<HTMLElement | null>(null);
  let dateFilter = $state<string | null>(null);
  let albumFilter = $state<string | null>(null);
  let albumName = $state<string | null>(null);
  let trackFilter = $state<string | null>(null);
  let trackName = $state<string | null>(null);
  let artistFilter = $state<string | null>(null);
  let artistName = $state<string | null>(null);

  let hasFilters = $derived(!!dateFilter || !!albumFilter || !!trackFilter || !!artistFilter);
  let filterLabel = $derived(trackName ?? albumName ?? artistName ?? null);

  // edit mode
  let editMode = $state(false);
  let selected = $state<Set<number>>(new Set());
  let lastSelectedIndex = $state<number | null>(null);
  let deleting = $state(false);
  let showConfirm = $state(false);

  function currentFilters() {
    const f: Record<string, string> = {};
    if (dateFilter) f.date = dateFilter;
    if (albumFilter) f.album = albumFilter;
    if (trackFilter) f.track = trackFilter;
    if (artistFilter) f.artist = artistFilter;
    return Object.keys(f).length ? f : undefined;
  }

  async function loadPage(p: number) {
    const res = await api.history(p, 50, currentFilters());
    if (p === 1) {
      items = res.items;
    } else {
      items = [...items, ...res.items];
    }
    hasMore = res.hasMore;
    currentPage = p;
  }

  async function reload() {
    loading = true;
    selected = new Set();
    lastSelectedIndex = null;
    await loadPage(1);
    loading = false;
  }

  // polling: buscar nuevas reproducciones cada 15s (solo sin filtros)
  async function pollNewItems() {
    if (hasFilters || editMode) return;
    try {
      const res = await api.history(1, 50);
      if (res.items.length === 0 || items.length === 0) return;
      const latestId = items[0].id;
      const newItems = res.items.filter((i) => i.id > latestId);
      if (newItems.length > 0) {
        items = [...newItems, ...items];
      }
    } catch {}
  }

  function updateUrl() {
    const params = new URLSearchParams();
    if (dateFilter) params.set('date', dateFilter);
    if (albumFilter) params.set('album', albumFilter);
    if (trackFilter) params.set('track', trackFilter);
    if (artistFilter) params.set('artist', artistFilter);
    goto(params.toString() ? `/history?${params}` : '/history', { replaceState: true });
  }

  function clearFilters() {
    dateFilter = null;
    albumFilter = null;
    albumName = null;
    trackFilter = null;
    trackName = null;
    artistFilter = null;
    artistName = null;
    updateUrl();
    reload();
  }

  function clearDate() {
    dateFilter = null;
    updateUrl();
    reload();
  }

  function clearEntityFilter() {
    albumFilter = null;
    albumName = null;
    trackFilter = null;
    trackName = null;
    artistFilter = null;
    artistName = null;
    updateUrl();
    reload();
  }

  function setDate(d: string) {
    dateFilter = d;
    updateUrl();
    reload();
  }

  function formatDateLabel(d: string): string {
    return new Date(d + 'T00:00:00').toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
  }

  function toggleEdit() {
    editMode = !editMode;
    selected = new Set();
    lastSelectedIndex = null;
    showConfirm = false;
  }

  function handleItemClick(index: number, id: number, e: MouseEvent) {
    if (e.shiftKey && lastSelectedIndex !== null) {
      // shift+click: seleccionar rango
      const start = Math.min(lastSelectedIndex, index);
      const end = Math.max(lastSelectedIndex, index);
      const next = new Set(selected);
      for (let i = start; i <= end; i++) {
        if (items[i]?.track) next.add(items[i].id);
      }
      selected = next;
    } else {
      toggleSelect(id);
      lastSelectedIndex = index;
    }
  }

  function toggleSelect(id: number) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selected = next;
  }

  function selectAll() {
    if (selected.size === items.length) {
      selected = new Set();
    } else {
      selected = new Set(items.map(i => i.id));
    }
  }

  async function deleteSelected() {
    if (selected.size === 0) return;
    deleting = true;
    try {
      await api.deleteHistory([...selected]);
      showConfirm = false;
      await reload();
    } catch (e: any) {
      alert(e.message || 'Delete failed');
    } finally {
      deleting = false;
    }
  }

  let observer: IntersectionObserver | null = null;

  onMount(() => {
    const urlDate = $page.url.searchParams.get('date');
    const urlAlbum = $page.url.searchParams.get('album');
    const urlTrack = $page.url.searchParams.get('track');
    const urlArtist = $page.url.searchParams.get('artist');
    if (urlDate) dateFilter = urlDate;
    if (urlAlbum) albumFilter = urlAlbum;
    if (urlTrack) trackFilter = urlTrack;
    if (urlArtist) artistFilter = urlArtist;

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

  // resolver nombres de entidad desde items cargados
  $effect(() => {
    if (items.length === 0) return;
    const first = items[0];
    if (albumFilter && !albumName && first?.track?.album) albumName = first.track.album.name;
    if (trackFilter && !trackName && first?.track) trackName = first.track.name;
    if (artistFilter && !artistName && first?.track?.artists?.length) {
      const match = first.track.artists.find(a => a.id === artistFilter);
      if (match) artistName = match.name;
    }
  });

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

<div class="history-controls">
  <div class="controls-left">
    <input
      type="date"
      class="date-picker"
      value={dateFilter ?? ''}
      onchange={(e) => {
        const v = e.currentTarget.value;
        if (v) setDate(v);
        else clearDate();
      }}
    />
    <button class="edit-toggle" class:edit-toggle--active={editMode} onclick={toggleEdit}>
      {editMode ? 'Done' : 'Edit'}
    </button>
  </div>
  {#if editMode && items.length > 0}
    <div class="controls-right">
      <button class="toolbar-btn" onclick={selectAll}>
        {selected.size === items.length ? 'Deselect all' : 'Select all'}
      </button>
      <span class="toolbar-count">{selected.size} selected</span>
      {#if selected.size > 0}
        {#if showConfirm}
          <span class="confirm-prompt">Delete {selected.size} plays?</span>
          <button class="toolbar-btn toolbar-btn--danger" onclick={deleteSelected} disabled={deleting}>
            {deleting ? 'Deleting...' : 'Confirm'}
          </button>
          <button class="toolbar-btn" onclick={() => showConfirm = false}>Cancel</button>
        {:else}
          <button class="toolbar-btn toolbar-btn--danger" onclick={() => showConfirm = true}>
            Delete selected
          </button>
        {/if}
      {/if}
    </div>
  {/if}
</div>

{#if hasFilters}
  <div class="filter-bar">
    {#if dateFilter}
      <div class="filter-chip">
        <span>{formatDateLabel(dateFilter)}</span>
        <button class="filter-chip-clear" onclick={clearDate}>x</button>
      </div>
    {/if}
    {#if filterLabel}
      <div class="filter-chip">
        <span>{filterLabel}</span>
        <button class="filter-chip-clear" onclick={clearEntityFilter}>x</button>
      </div>
    {/if}
    {#if dateFilter && (albumFilter || trackFilter || artistFilter)}
      <button class="filter-clear-all" onclick={clearFilters}>Clear all</button>
    {/if}
  </div>
{/if}

{#if loading}
  <div class="loading">
    <div class="spinner"></div>
    Loading...
  </div>
{:else if items.length === 0}
  <div class="empty-state">{hasFilters ? 'No plays match these filters.' : 'No listening data yet.'}</div>
{:else if editMode}
  <div class="track-list">
    {#each items as item, idx}
      {#if item.track}
        <div
          class="track-item"
          class:track-item--selected={selected.has(item.id)}
          onclick={(e) => handleItemClick(idx, item.id, e)}
        >
          <input
            type="checkbox"
            class="edit-checkbox"
            checked={selected.has(item.id)}
            onclick={(e) => e.stopPropagation()}
            onchange={() => { toggleSelect(item.id); lastSelectedIndex = idx; }}
          />
          {#if item.track.album?.imageUrl}
            <img class="track-art" src={item.track.album.imageUrl} alt={item.track.album?.name ?? ''} />
          {:else}
            <div class="track-art"></div>
          {/if}
          <div class="track-info">
            <div class="track-name">
              {item.track.name}
              {#if item.track.id === nowPlayingStore.trackId}<span class="live-dot"></span>{/if}
            </div>
            <div class="track-artist">
              {item.track.artists.map(a => a.name).join(', ')}
            </div>
          </div>
          <div class="track-meta">
            <div class="track-time" title={formatDate(item.playedAt)}>{timeAgo(item.playedAt)}</div>
          </div>
        </div>
      {/if}
    {/each}
  </div>
{:else}
  <TrackList {items} showTime />
{/if}

{#if !loading && hasMore}
  <div bind:this={sentinel} style="min-height: 1px; padding: 2rem; display: flex; justify-content: center;">
    {#if loadingMore}
      <div class="spinner"></div>
    {/if}
  </div>
{/if}

<style>
  .history-controls {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 1rem;
    flex-wrap: wrap;
  }
  .controls-left {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .controls-right {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .date-picker {
    background: var(--bg-card);
    border: 1px solid var(--border);
    color: var(--text);
    font-size: 0.8rem;
    font-family: var(--font);
    padding: 0.3rem 0.6rem;
    border-radius: 6px;
    cursor: pointer;
    outline: none;
    color-scheme: dark;
  }
  .date-picker:focus {
    border-color: var(--accent);
  }

  .filter-bar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }
  .filter-chip {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.35rem 0.6rem;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 6px;
    font-size: 0.8rem;
    color: var(--text);
  }
  .filter-chip-clear {
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 0.8rem;
    cursor: pointer;
    padding: 0 0.15rem;
    line-height: 1;
    font-family: var(--font);
  }
  .filter-chip-clear:hover {
    color: var(--text);
  }
  .filter-clear-all {
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 0.75rem;
    cursor: pointer;
    font-family: var(--font);
    text-decoration: underline;
  }
  .filter-clear-all:hover {
    color: var(--text);
  }

  .edit-toggle {
    background: var(--bg-card);
    border: 1px solid var(--border);
    color: var(--text-muted);
    font-size: 0.8rem;
    font-family: var(--font);
    padding: 0.3rem 0.75rem;
    border-radius: 6px;
    cursor: pointer;
    transition: color 0.15s, border-color 0.15s;
  }
  .edit-toggle:hover {
    color: var(--text);
    border-color: var(--text-muted);
  }
  .edit-toggle--active {
    color: var(--accent);
    border-color: var(--accent);
  }
  .toolbar-btn {
    background: var(--bg-card);
    border: 1px solid var(--border);
    color: var(--text-muted);
    font-size: 0.75rem;
    font-family: var(--font);
    padding: 0.25rem 0.6rem;
    border-radius: 5px;
    cursor: pointer;
    transition: color 0.15s, border-color 0.15s;
  }
  .toolbar-btn:hover:not(:disabled) {
    color: var(--text);
    border-color: var(--text-muted);
  }
  .toolbar-btn--danger {
    color: var(--danger);
    border-color: rgba(231, 76, 60, 0.3);
  }
  .toolbar-btn--danger:hover:not(:disabled) {
    color: var(--danger);
    border-color: var(--danger);
    background: rgba(231, 76, 60, 0.08);
  }
  .toolbar-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .toolbar-count {
    font-size: 0.75rem;
    color: var(--text-muted);
  }
  .confirm-prompt {
    font-size: 0.8rem;
    color: var(--danger);
    font-weight: 500;
  }

  .edit-checkbox {
    accent-color: var(--accent);
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    cursor: pointer;
  }
  .track-item--selected {
    background: rgba(29, 185, 84, 0.06);
  }

</style>
