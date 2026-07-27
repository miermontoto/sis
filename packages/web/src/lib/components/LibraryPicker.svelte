<script lang="ts">
  // selector de elementos sueltos de la biblioteca: búsqueda libre o
  // discografía completa de un artista. lo comparten los generators que dejan
  // montar un campo a mano (tier list, march madness)
  import { api, type SearchResults } from '$lib/api';
  import { itemKey, type LibraryItem } from '$lib/utils/library-items';
  import { formatNumber } from '$lib/utils/format';

  const SEARCH_DEBOUNCE_MS = 250;
  const SEARCH_LIMIT = 8;
  // la discografía se pide entera: el álbumLimit por defecto se queda corto
  const DISCOGRAPHY_ALBUM_LIMIT = 200;

  type PickerMode = 'search' | 'artist';

  let { onadd, mode = $bindable('search' as PickerMode) }: {
    onadd: (items: LibraryItem[]) => void;
    mode?: PickerMode;
  } = $props();

  let query = $state('');
  let results = $state<SearchResults | null>(null);
  let searching = $state(false);
  let includeAlbums = $state(true);
  let includeSingles = $state(true);
  let loadingArtist = $state<string | null>(null);
  let searchTimer: ReturnType<typeof setTimeout> | null = null;

  $effect(() => () => { if (searchTimer) clearTimeout(searchTimer); });

  function runSearch() {
    if (searchTimer) clearTimeout(searchTimer);
    const q = query.trim();
    if (!q) { results = null; return; }
    searchTimer = setTimeout(async () => {
      searching = true;
      try {
        results = await api.search(q, SEARCH_LIMIT);
      } catch {
        results = null;
      } finally {
        searching = false;
      }
    }, SEARCH_DEBOUNCE_MS);
  }

  // añade toda la discografía escuchada de un artista: releases trae álbumes y
  // singles, y topAlbums aporta las escuchas que a ReleaseEvent le faltan
  async function addDiscography(artistId: string) {
    loadingArtist = artistId;
    try {
      const detail = await api.artistDetail(artistId, 'all', { albumLimit: DISCOGRAPHY_ALBUM_LIMIT });
      const stats = new Map(detail.topAlbums.map((a) => [a.albumId, { playCount: a.playCount, totalMs: a.totalMs }]));
      onadd(detail.releases
        .filter((r) => (r.albumType === 'single' ? includeSingles : includeAlbums))
        .map<LibraryItem>((r) => ({
          key: itemKey('album', r.id), kind: 'album', id: r.id, name: r.name,
          subtitle: `${detail.artist.name}${r.date ? ` · ${r.date.slice(0, 4)}` : ''}`,
          imageUrl: r.imageUrl,
          playCount: stats.get(r.id)?.playCount ?? 0,
          totalMs: stats.get(r.id)?.totalMs ?? 0,
        })));
    } finally {
      loadingArtist = null;
    }
  }
</script>

<div class="picker">
  <div class="picker-head">
    <div class="toggle-group">
      <button class="toggle-btn" class:active={mode === 'search'} onclick={() => mode = 'search'}>Search</button>
      <button class="toggle-btn" class:active={mode === 'artist'} onclick={() => mode = 'artist'}>Discography</button>
    </div>

    {#if mode === 'artist'}
      <div class="check-row">
        <label><input type="checkbox" bind:checked={includeAlbums} /> Albums</label>
        <label><input type="checkbox" bind:checked={includeSingles} /> Singles</label>
      </div>
    {/if}
  </div>

  <input
    class="search-input"
    type="search"
    placeholder={mode === 'artist' ? 'Search an artist to pull their releases…' : 'Search artists, albums or tracks…'}
    bind:value={query}
    oninput={runSearch}
  />

  {#if searching}
    <div class="hint">Searching…</div>
  {:else if results}
    <div class="results">
      {#if mode === 'artist'}
        {#each results.artists as a (a.id)}
          <button class="result" onclick={() => addDiscography(a.id)} disabled={loadingArtist === a.id}>
            {#if a.imageUrl}<img src={a.imageUrl} alt="" />{:else}<div class="result-ph">{a.name.charAt(0)}</div>{/if}
            <span class="result-name">{a.name}</span>
            <span class="result-meta">{loadingArtist === a.id ? 'loading…' : `${formatNumber(a.playCount)} plays`}</span>
          </button>
        {:else}
          <div class="hint">No artists found.</div>
        {/each}
      {:else}
        {#each results.artists as a (a.id)}
          <button class="result" onclick={() => onadd([{ key: itemKey('artist', a.id), kind: 'artist', id: a.id, name: a.name, subtitle: 'artist', imageUrl: a.imageUrl, playCount: a.playCount, totalMs: 0 }])}>
            {#if a.imageUrl}<img src={a.imageUrl} alt="" />{:else}<div class="result-ph">{a.name.charAt(0)}</div>{/if}
            <span class="result-name">{a.name}</span>
            <span class="result-meta">artist</span>
          </button>
        {/each}
        {#each results.albums as al (al.id)}
          <button class="result" onclick={() => onadd([{ key: itemKey('album', al.id), kind: 'album', id: al.id, name: al.name, subtitle: al.artistName ?? '', imageUrl: al.imageUrl, playCount: al.playCount, totalMs: 0 }])}>
            {#if al.imageUrl}<img src={al.imageUrl} alt="" />{:else}<div class="result-ph">{al.name.charAt(0)}</div>{/if}
            <span class="result-name">{al.name}</span>
            <span class="result-meta">{al.artistName ?? 'album'}</span>
          </button>
        {/each}
        {#each results.tracks as t (t.id)}
          <button class="result" onclick={() => onadd([{ key: itemKey('track', t.id), kind: 'track', id: t.id, name: t.name, subtitle: t.artistName ?? '', imageUrl: t.albumImageUrl, playCount: t.playCount, totalMs: 0 }])}>
            {#if t.albumImageUrl}<img src={t.albumImageUrl} alt="" />{:else}<div class="result-ph">{t.name.charAt(0)}</div>{/if}
            <span class="result-name">{t.name}</span>
            <span class="result-meta">{t.artistName ?? 'track'}</span>
          </button>
        {/each}
      {/if}
    </div>
  {/if}
</div>

<style>
  .picker {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .picker-head {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    align-items: center;
  }

  .toggle-group { display: flex; gap: 0.2rem; }

  .toggle-btn {
    padding: 0.3rem 0.65rem;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 0.8rem;
    transition: all 0.05s;
  }

  .toggle-btn:hover { border-color: var(--text-muted); color: var(--text); }
  .toggle-btn.active { background: var(--accent); border-color: var(--accent); color: #000; }

  .check-row { display: flex; gap: 0.75rem; }

  .check-row label {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.85rem;
    color: var(--text-muted);
    cursor: pointer;
  }

  .search-input {
    width: 100%;
    padding: 0.5rem 0.75rem;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text);
    font: inherit;
  }

  .search-input:focus { outline: none; border-color: var(--accent); }

  .results {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 0.35rem;
    max-height: 260px;
    overflow-y: auto;
  }

  .result {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.35rem 0.5rem;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text);
    cursor: pointer;
    text-align: left;
    font: inherit;
    transition: border-color 0.05s;
  }

  .result:hover:not(:disabled) { border-color: var(--accent); }
  .result:disabled { opacity: 0.5; cursor: progress; }

  .result img, .result-ph {
    width: 32px;
    height: 32px;
    border-radius: 4px;
    object-fit: cover;
    flex-shrink: 0;
  }

  .result-ph {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-card);
    color: var(--text-muted);
    font-weight: 600;
  }

  .result-name {
    flex: 1;
    font-size: 0.85rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .result-meta {
    font-size: 0.72rem;
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .hint {
    color: var(--text-muted);
    font-size: 0.85rem;
    padding: 0.5rem 0;
  }
</style>
