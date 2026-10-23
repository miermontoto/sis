<script lang="ts">
  // espejo de la biblioteca de playlists de spotify. El generador que vivía aquí como
  // pestaña "Generate" es ahora /generators/playlist: la pestaña vieja redirige allí con su
  // estrategia para que los enlaces guardados sigan funcionando
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api, type LibraryPlaylist } from '$lib/api';
  import { getQueryParam } from '$lib/utils/query-state';
  import IconPlus from '$lib/icons/IconPlus.svelte';

  const GENERATOR_HREF = '/generators/playlist';

  let playlists = $state<LibraryPlaylist[]>([]);
  let loading = $state(true);
  let syncing = $state(false);

  async function load() {
    loading = true;
    try {
      playlists = (await api.libraryPlaylists(200)).items;
    } catch { /* la lista vacía ya enseña el estado */ }
    loading = false;
  }

  async function sync() {
    syncing = true;
    try {
      await api.syncLibrary();
      await load();
    } catch { /* el botón vuelve a su estado y el usuario reintenta */ }
    syncing = false;
  }

  onMount(() => {
    if (getQueryParam('tab', '') === 'generate') {
      const strategy = getQueryParam('strategy', '');
      goto(strategy ? `${GENERATOR_HREF}?strategy=${encodeURIComponent(strategy)}` : GENERATOR_HREF, { replaceState: true });
      return;
    }
    load();
  });
</script>

<div class="library-header">
  <span class="library-count">{playlists.length} playlists</span>
  <div class="library-actions">
    <a href={GENERATOR_HREF} class="range-btn range-btn--playlist"><IconPlus /> Generate</a>
    <button class="range-btn" onclick={sync} disabled={syncing}>{syncing ? 'Syncing…' : 'Sync now'}</button>
  </div>
</div>

{#if loading}
  <div class="loading"><div class="spinner"></div></div>
{:else if playlists.length === 0}
  <div class="card empty">No playlists synced yet. Sync now to import your Spotify playlists.</div>
{:else}
  <div class="library-grid">
    {#each playlists as pl (pl.id)}
      <a href="/playlists/{pl.id}" class="library-card">
        {#if pl.imageUrl}
          <img class="library-img" src={pl.imageUrl} alt={pl.name} />
        {:else}
          <div class="library-img placeholder"></div>
        {/if}
        <div class="library-info">
          <div class="library-name">{pl.name}</div>
          <div class="library-meta">
            {#if pl.isAlgorithmic}<span class="badge algo">Algorithmic</span>{/if}
            <span>{pl.trackCount} tracks</span>
            {#if pl.ownerName}<span class="library-owner">by {pl.ownerName}</span>{/if}
          </div>
        </div>
      </a>
    {/each}
  </div>
{/if}

<style>
  .library-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }

  .library-actions {
    display: flex;
    gap: 0.25rem;
  }
  .library-actions .range-btn { margin-left: 0; text-decoration: none; }

  .library-count {
    font-variant-numeric: tabular-nums;
    color: var(--text-muted);
    font-size: var(--fs-sm);
  }

  .library-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 1rem;
  }

  .library-card {
    display: flex;
    gap: 0.75rem;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.75rem;
    text-decoration: none;
    color: var(--text);
    transition: border-color 0.05s;
  }

  .library-card:hover {
    border-color: var(--text-muted);
  }

  .library-img {
    width: 64px;
    height: 64px;
    border-radius: var(--radius);
    object-fit: cover;
    flex-shrink: 0;
  }

  .library-img.placeholder {
    background: var(--bg-hover);
  }

  .library-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .library-name {
    font-weight: 500;
    font-size: var(--fs-md);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .library-meta {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: var(--fs-sm);
    color: var(--text-muted);
  }

  .library-owner {
    opacity: 0.7;
  }

  .badge.algo {
    background: color-mix(in srgb, var(--warning) 15%, transparent);
    color: var(--warning);
    padding: 0.1rem 0.4rem;
    border-radius: 999px;
    font-size: var(--fs-xs);
  }

  .empty {
    color: var(--text-muted);
    text-align: center;
    padding: 3rem;
  }
</style>
