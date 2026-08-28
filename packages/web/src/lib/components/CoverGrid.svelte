<script lang="ts">
  import { medalColor } from '$lib/utils/medals';
  import LiveEq from './LiveEq.svelte';

  interface CoverItem {
    href: string;
    rank?: number;
    imageUrl?: string | null;
    name: string;
    stat: string;
    isLive?: boolean;
    round?: boolean;
    oncontextmenu?: (e: MouseEvent) => void;
  }

  let { items }: { items: CoverItem[] } = $props();
</script>

<div class="cover-row">
  {#each items as item, i}
    <a href={item.href} class="cover-item" class:cover-item--live={item.isLive} title="{item.name} — {item.stat}" oncontextmenu={item.oncontextmenu}>
      <div class="cover-img-wrap">
        {#if item.rank != null}
          <span class="cover-rank" style:color={medalColor(item.rank)}>{item.rank}</span>
        {/if}
        {#if item.imageUrl}
          <img class="cover-img" class:cover-img--round={item.round} src={item.imageUrl} alt={item.name} />
        {:else}
          <div class="cover-img cover-img--empty" class:cover-img--round={item.round}></div>
        {/if}
        {#if item.isLive}<LiveEq round={item.round} />{/if}
      </div>
      <div class="cover-name">{item.name}</div>
      <div class="cover-stat">{item.stat}</div>
    </a>
  {/each}
</div>

<style>
  /* el gap compensa el padding de las tarjetas: el hueco visible entre
     carátulas sigue siendo ~0.9rem */
  .cover-row {
    display: flex;
    gap: 0.3rem;
    overflow-x: auto;
    padding-bottom: 0.25rem;
  }
  .cover-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    flex: 1 1 0;
    min-width: 0;
    padding: 0.3rem;
    border-radius: var(--radius);
    text-decoration: none;
    color: inherit;
  }
  .cover-item:hover .cover-name {
    color: var(--accent);
  }
  /* tarjeta sonando ahora: mismo contenedor verde que en las listas */
  .cover-item--live {
    background: var(--live-bg);
    box-shadow: var(--live-ring);
  }
  .cover-img-wrap {
    position: relative;
    width: 100%;
    line-height: 0;
  }
  /* la carátula es mucho mayor que la de una fila, el ecualizador crece con ella */
  .cover-img-wrap :global(.live-eq) {
    height: 16px;
    bottom: 5px;
    left: 5px;
    gap: 3px;
  }
  .cover-img-wrap :global(.live-eq--round) {
    left: 50%;
    bottom: 8%;
  }
  .cover-img-wrap :global(.live-eq span) {
    width: 3px;
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
  .cover-stat {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: 0.65rem;
    color: var(--text-dim);
    text-align: center;
  }
</style>
