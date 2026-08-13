<script lang="ts">
  import { api, getRankingMetric, type RecentRankChangeItem } from '$lib/api';
  import IconTrack from '$lib/icons/IconTrack.svelte';
  import IconArtist from '$lib/icons/IconArtist.svelte';
  import IconAlbum from '$lib/icons/IconAlbum.svelte';

  // ventanas de comparación ofrecidas (días hacia atrás)
  const WINDOWS = [7, 14, 30];
  const RANGE_LABELS: Record<string, string> = { thisYear: 'YTD', all: 'ALL' };
  const TAB_MAP: Record<string, string> = { track: 'tracks', artist: 'artists', album: 'albums' };
  const GHOST_ROWS = 4;

  let days = $state(WINDOWS[0]);
  let items = $state<RecentRankChangeItem[]>([]);
  let loading = $state(true);

  type Change = RecentRankChangeItem['changes'][number];

  async function load(windowDays: number) {
    loading = true;
    try {
      const res = await api.recentRankChanges(windowDays, getRankingMetric());
      items = res.items;
    } catch {
      items = [];
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    load(days);
  });

  // mejor cambio de una entidad: mayor |delta|; si solo hay entradas nuevas, la mejor posición
  function bestChange(changes: Change[]): Change {
    const moved = changes.filter(c => c.delta !== null);
    if (moved.length > 0) {
      return moved.reduce((best, c) => Math.abs(c.delta!) > Math.abs(best.delta!) ? c : best);
    }
    return changes.reduce((best, c) => c.currentRank < best.currentRank ? c : best);
  }

  function rankingHref(item: RecentRankChangeItem, range: string): string {
    return `/top?tab=${TAB_MAP[item.entityType] ?? 'tracks'}&range=${range === 'thisYear' ? 'thisYear' : 'all'}&focus=${item.entityId}`;
  }
</script>

<div class="card changes-card">
  <div class="changes-header">
    <h3>Recent ranking changes</h3>
    <div class="changes-windows">
      {#each WINDOWS as w}
        <button class="window-btn" class:window-active={days === w} onclick={() => { days = w; }}>{w}d</button>
      {/each}
    </div>
  </div>

  {#if loading}
    <div class="changes-list">
      {#each Array(GHOST_ROWS) as _}
        <div class="change-row"><span class="ghost-text" style="width: 60%;"></span></div>
      {/each}
    </div>
  {:else if items.length === 0}
    <p class="changes-empty">No ranking changes in the last {days} days.</p>
  {:else}
    <div class="changes-list">
      {#each items as item (item.entityType + item.entityId)}
        {@const best = bestChange(item.changes)}
        <div class="change-row">
          <span class="change-thumb" class:change-thumb--art={item.imageUrl} class:change-thumb--round={item.entityType === 'artist'}>
            {#if item.imageUrl}
              <img class="change-thumb-img" src={item.imageUrl} alt="" loading="lazy" />
              <span class="change-thumb-badge" aria-hidden="true">
                {#if item.entityType === 'track'}<IconTrack size={8} />
                {:else if item.entityType === 'artist'}<IconArtist size={8} />
                {:else}<IconAlbum size={8} />
                {/if}
              </span>
            {:else if item.entityType === 'track'}<IconTrack size={12} />
            {:else if item.entityType === 'artist'}<IconArtist size={12} />
            {:else}<IconAlbum size={12} />
            {/if}
          </span>
          <span class="change-names">
            <a href="/{item.entityType}/{item.entityId}" class="change-name">{item.name}</a>
            {#if item.artistName}
              <span class="change-artist">{item.artistName}</span>
            {/if}
          </span>
          <a href={rankingHref(item, best.range)} class="change-badge" class:up={best.delta !== null && best.delta > 0} class:down={best.delta !== null && best.delta < 0} class:new={best.delta === null}>
            {RANGE_LABELS[best.range] ?? best.range}
            {#if best.delta === null}
              NEW #{best.currentRank}
            {:else}
              #{best.previousRank}→#{best.currentRank}
            {/if}
          </a>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .changes-card {
    margin-bottom: 1.5rem;
  }

  .changes-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.75rem;
  }

  .changes-header h3 {
    margin: 0;
  }

  .changes-windows {
    display: flex;
    gap: 0.25rem;
  }

  .window-btn {
    padding: 0.15rem 0.5rem;
    font-size: 0.7rem;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 999px;
    background: none;
    color: var(--text-secondary, #aaa);
    cursor: pointer;
  }

  .window-btn:hover {
    color: var(--text-primary, #fff);
  }

  .window-active {
    background: rgba(74, 158, 255, 0.15);
    border-color: rgba(74, 158, 255, 0.3);
    color: var(--text-primary, #fff);
  }

  .changes-empty {
    font-size: 0.8rem;
    color: var(--text-muted, #666);
    margin: 0;
  }

  .changes-list {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    /* ~8 filas visibles; más allá scroll interno */
    max-height: 16rem;
    overflow-y: auto;
    overflow-x: hidden;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.15) transparent;
  }

  .change-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.25rem 0;
    font-size: 0.8rem;
    color: var(--text-secondary, #aaa);
    min-width: 0;
  }

  .change-thumb {
    position: relative;
    flex-shrink: 0;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0.6; /* glifo de fallback atenuado */
  }

  .change-thumb--art {
    opacity: 1;
  }

  .change-thumb-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.05);
  }

  .change-thumb--round .change-thumb-img {
    border-radius: 50%;
  }

  .change-thumb-badge {
    position: absolute;
    right: -2px;
    bottom: -2px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 11px;
    height: 11px;
    border-radius: 50%;
    color: var(--text, #e0e8e8);
    background: var(--bg, #080a0c);
    box-shadow: 0 0 0 1.5px var(--bg-card, #0f1214);
  }

  .change-names {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
    overflow: hidden;
  }

  .change-name {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    text-decoration: none;
    color: inherit;
  }

  .change-name:hover {
    color: var(--text-primary, #fff);
  }

  .change-artist {
    flex-shrink: 1;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: 0.7rem;
    color: var(--text-muted, #666);
  }

  .change-badge {
    flex-shrink: 0;
    font-weight: 600;
    font-size: 0.7rem;
    font-variant-numeric: tabular-nums;
    text-decoration: none;
    color: var(--text-muted, #666);
  }

  .change-badge:hover {
    text-decoration: underline;
  }

  .change-badge.up {
    color: #1db954;
  }

  .change-badge.down {
    color: #e34234;
  }

  .change-badge.new {
    color: #4a9eff;
  }

  .ghost-text {
    display: inline-block;
    height: 0.8rem;
  }
</style>
