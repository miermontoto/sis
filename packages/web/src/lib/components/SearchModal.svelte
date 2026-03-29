<script lang="ts">
  import { goto } from '$app/navigation';
  import { api, type SearchResults } from '$lib/api';

  let { show = $bindable(false) }: { show: boolean } = $props();

  let query = $state('');
  let results = $state<SearchResults | null>(null);
  let loading = $state(false);
  let selectedIndex = $state(-1);
  let inputEl: HTMLInputElement | undefined = $state();
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  // items planos para navegación con teclado
  let flatItems = $derived.by(() => {
    if (!results) return [];
    const items: { type: 'artist' | 'album' | 'track'; id: string }[] = [];
    for (const a of results.artists) items.push({ type: 'artist', id: a.id });
    for (const a of results.albums) items.push({ type: 'album', id: a.id });
    for (const t of results.tracks) items.push({ type: 'track', id: t.id });
    return items;
  });

  function close() {
    show = false;
    query = '';
    results = null;
    selectedIndex = -1;
  }

  function navigate(type: string, id: string) {
    close();
    goto(`/${type}/${encodeURIComponent(id)}`);
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, flatItems.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, -1);
    } else if (e.key === 'Enter' && selectedIndex >= 0 && flatItems[selectedIndex]) {
      e.preventDefault();
      const item = flatItems[selectedIndex];
      navigate(item.type, item.id);
    }
  }

  function doSearch(q: string) {
    if (q.length < 2) {
      results = null;
      loading = false;
      return;
    }
    loading = true;
    const currentQuery = q;
    api.search(q, 5).then((data) => {
      // descartar si el query cambió mientras esperábamos
      if (query !== currentQuery) return;
      results = data;
      selectedIndex = -1;
      loading = false;
    }).catch(() => {
      loading = false;
    });
  }

  $effect(() => {
    if (show && inputEl) {
      // pequeño delay para que el DOM renderice
      setTimeout(() => inputEl?.focus(), 10);
    }
  });

  $effect(() => {
    const q = query;
    clearTimeout(debounceTimer);
    if (q.length < 2) {
      results = null;
      return;
    }
    loading = true;
    debounceTimer = setTimeout(() => doSearch(q), 250);
  });

  // índice flat acumulado para mapear a selectedIndex
  function flatIndex(section: 'artists' | 'albums' | 'tracks', i: number): number {
    if (!results) return -1;
    if (section === 'artists') return i;
    if (section === 'albums') return results.artists.length + i;
    return results.artists.length + results.albums.length + i;
  }

  let hasResults = $derived(
    results && (results.artists.length > 0 || results.albums.length > 0 || results.tracks.length > 0)
  );

  let noResults = $derived(
    results && results.artists.length === 0 && results.albums.length === 0 && results.tracks.length === 0
  );
</script>

{#if show}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="search-overlay" onmousedown={(e) => { if (e.target === e.currentTarget) close(); }} onkeydown={onKeydown}>
    <div class="search-modal">
      <input
        bind:this={inputEl}
        bind:value={query}
        type="text"
        class="search-input"
        placeholder="Search artists, albums, tracks..."
        autocomplete="off"
        spellcheck="false"
      />

      {#if loading && !results}
        <div class="search-loading"><div class="spinner"></div></div>
      {/if}

      {#if hasResults}
        <div class="search-results">
          {#if results!.artists.length > 0}
            <div class="search-section">
              <div class="search-section-title">Artists</div>
              {#each results!.artists as artist, i}
                <button
                  class="search-result"
                  class:selected={selectedIndex === flatIndex('artists', i)}
                  onmousedown={() => navigate('artist', artist.id)}
                  onmouseenter={() => selectedIndex = flatIndex('artists', i)}
                >
                  {#if artist.imageUrl}
                    <img src={artist.imageUrl} alt="" class="search-thumb search-thumb--round" loading="lazy" width="40" height="40" />
                  {:else}
                    <div class="search-thumb search-thumb--round search-thumb--empty"></div>
                  {/if}
                  <div class="search-result-info">
                    <div class="search-result-name">{artist.name}</div>
                    <div class="search-result-sub">Artist</div>
                  </div>
                  {#if artist.playCount > 0}
                    <div class="search-result-plays">{artist.playCount} plays</div>
                  {/if}
                </button>
              {/each}
            </div>
          {/if}

          {#if results!.albums.length > 0}
            <div class="search-section">
              <div class="search-section-title">Albums</div>
              {#each results!.albums as album, i}
                <button
                  class="search-result"
                  class:selected={selectedIndex === flatIndex('albums', i)}
                  onmousedown={() => navigate('album', album.id)}
                  onmouseenter={() => selectedIndex = flatIndex('albums', i)}
                >
                  {#if album.imageUrl}
                    <img src={album.imageUrl} alt="" class="search-thumb" loading="lazy" width="40" height="40" />
                  {:else}
                    <div class="search-thumb search-thumb--empty"></div>
                  {/if}
                  <div class="search-result-info">
                    <div class="search-result-name">{album.name}</div>
                    <div class="search-result-sub">{album.artistName || 'Album'}</div>
                  </div>
                  {#if album.playCount > 0}
                    <div class="search-result-plays">{album.playCount} plays</div>
                  {/if}
                </button>
              {/each}
            </div>
          {/if}

          {#if results!.tracks.length > 0}
            <div class="search-section">
              <div class="search-section-title">Tracks</div>
              {#each results!.tracks as track, i}
                <button
                  class="search-result"
                  class:selected={selectedIndex === flatIndex('tracks', i)}
                  onmousedown={() => navigate('track', track.id)}
                  onmouseenter={() => selectedIndex = flatIndex('tracks', i)}
                >
                  {#if track.albumImageUrl}
                    <img src={track.albumImageUrl} alt="" class="search-thumb" loading="lazy" width="40" height="40" />
                  {:else}
                    <div class="search-thumb search-thumb--empty"></div>
                  {/if}
                  <div class="search-result-info">
                    <div class="search-result-name">{track.name}</div>
                    <div class="search-result-sub">{track.artistName || 'Track'}</div>
                  </div>
                  {#if track.playCount > 0}
                    <div class="search-result-plays">{track.playCount} plays</div>
                  {/if}
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {/if}

      {#if noResults && query.length >= 2}
        <div class="search-empty">No results for "{query}"</div>
      {/if}

      <div class="search-hint">
        <span><kbd>↑↓</kbd> navigate</span>
        <span><kbd>↵</kbd> select</span>
        <span><kbd>esc</kbd> close</span>
      </div>
    </div>
  </div>
{/if}

<style>
  .search-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    z-index: 200;
    display: flex;
    justify-content: center;
    padding-top: 15vh;
  }

  .search-modal {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 12px;
    width: 500px;
    max-width: calc(100% - 2rem);
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    align-self: flex-start;
    will-change: transform;
  }

  .search-input {
    width: 100%;
    padding: 1rem 1.25rem;
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--border);
    color: var(--text);
    font-size: 1rem;
    font-family: var(--font);
    outline: none;
  }

  .search-input::placeholder {
    color: var(--text-muted);
  }

  .search-results {
    overflow-y: auto;
    flex: 1;
  }

  .search-section {
    padding: 0.5rem 0;
  }

  .search-section-title {
    padding: 0.25rem 1.25rem;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-muted);
  }

  .search-result {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    padding: 0.5rem 1.25rem;
    border: none;
    background: transparent;
    color: var(--text);
    cursor: pointer;
    text-align: left;
    font-family: var(--font);
    transition: none;
  }

  .search-result:hover,
  .search-result.selected {
    background: var(--bg-hover);
  }

  .search-thumb {
    width: 40px;
    height: 40px;
    border-radius: 4px;
    object-fit: cover;
    flex-shrink: 0;
    background: var(--border);
  }

  .search-thumb--round {
    border-radius: 50%;
  }

  .search-thumb--empty {
    background: var(--border);
  }

  .search-result-info {
    flex: 1;
    min-width: 0;
  }

  .search-result-name {
    font-size: 0.9rem;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .search-result-sub {
    font-size: 0.8rem;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .search-result-plays {
    font-size: 0.8rem;
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .search-loading {
    padding: 2rem;
    text-align: center;
  }

  .search-empty {
    padding: 2rem;
    text-align: center;
    color: var(--text-muted);
    font-size: 0.9rem;
  }

  .search-hint {
    display: flex;
    gap: 1rem;
    padding: 0.5rem 1.25rem;
    border-top: 1px solid var(--border);
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .search-hint kbd {
    background: var(--bg-hover);
    border: 1px solid var(--border);
    border-radius: 3px;
    padding: 0 0.3rem;
    font-size: 0.7rem;
    font-family: var(--font);
  }
</style>
