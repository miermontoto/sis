<script lang="ts">
  import { medalColor } from '$lib/utils/medals';

  interface CoverItem {
    href: string;
    rank?: number;
    imageUrl?: string | null;
    name: string;
    stat: string;
    isLive?: boolean;
    round?: boolean;
  }

  let { items }: { items: CoverItem[] } = $props();
</script>

<div class="cover-row">
  {#each items as item, i}
    <a href={item.href} class="cover-item" title="{item.name} — {item.stat}">
      {#if item.rank != null}
        <span class="cover-rank" style:color={medalColor(item.rank)}>{item.rank}</span>
      {/if}
      {#if item.imageUrl}
        <img class="cover-img" class:cover-img--round={item.round} src={item.imageUrl} alt={item.name} />
      {:else}
        <div class="cover-img cover-img--empty" class:cover-img--round={item.round}></div>
      {/if}
      <div class="cover-name">{item.name}{#if item.isLive} <span class="live-dot"></span>{/if}</div>
      <div class="cover-stat">{item.stat}</div>
    </a>
  {/each}
</div>

<style>
  .cover-row {
    display: flex;
    gap: 0.75rem;
    overflow-x: auto;
    padding-bottom: 0.25rem;
  }
  .cover-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    flex: 1 1 0;
    min-width: 0;
    text-decoration: none;
    color: inherit;
    position: relative;
  }
  .cover-item:hover .cover-name {
    color: var(--accent);
  }
  .cover-rank {
    font-family: var(--font-mono);
    position: absolute;
    top: 2px;
    left: 2px;
    font-variant-numeric: tabular-nums;
    font-size: 0.65rem;
    font-weight: 700;
    background: rgba(0, 0, 0, 0.6);
    border-radius: var(--radius);
    padding: 0 4px;
    z-index: 1;
  }
  .cover-img {
    width: 100%;
    aspect-ratio: 1;
    object-fit: cover;
    border-radius: var(--radius);
  }
  .cover-img--empty {
    background: var(--border);
  }
  .cover-img--round {
    border-radius: 50%;
  }
  .cover-name {
    font-size: 0.75rem;
    font-weight: 600;
    margin-top: 0.35rem;
    text-align: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    width: 100%;
  }
  .cover-name .live-dot {
    margin-left: 0.2rem;
    vertical-align: middle;
  }
  .cover-stat {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: 0.65rem;
    color: var(--text-dim);
    text-align: center;
  }
</style>
