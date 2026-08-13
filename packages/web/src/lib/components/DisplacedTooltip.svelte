<script lang="ts">
  import type { CrossoverEntity } from '$lib/api';

  // tooltip compartido de entidades desplazadas en un cambio de ranking (session
  // card y recent ranking changes). fixed: escapa el overflow/scroll del contenedor.
  interface Props {
    entityType: string;
    items: CrossoverEntity[];
    x: number;
    y: number;
    onenter?: () => void;
    onleave?: () => void;
  }

  let { entityType, items, x, y, onenter, onleave }: Props = $props();

  const DISPLACED_LIMIT = 5; // máximo de desplazados listados
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- el tooltip es una mejora solo-hover: los enlaces internos siguen siendo accesibles vía la entidad -->
<div
  class="displaced-tooltip"
  style="left: {x}px; top: {y}px;"
  onmouseenter={onenter}
  onmouseleave={onleave}
>
  {#each items.slice(0, DISPLACED_LIMIT) as d}
    <div class="displaced-row">
      <span class="displaced-arrow">▲</span>
      {#if d.imageUrl}<img class="displaced-img" src={d.imageUrl} alt="" />{/if}
      <a href="/{entityType}/{d.id}" class="displaced-name">{d.name}</a>
    </div>
  {/each}
  {#if items.length > DISPLACED_LIMIT}
    <div class="displaced-more">+{items.length - DISPLACED_LIMIT} más</div>
  {/if}
</div>

<style>
  /* fixed + translateX(-100%): ancla el borde derecho en la coordenada x del cambio,
     escapando el overflow del contenedor y de cualquier scroll interno */
  .displaced-tooltip {
    position: fixed;
    transform: translateX(-100%);
    z-index: 1000;
    padding: 0.4rem 0.5rem;
    background: var(--bg-elevated, #1e1e1e);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    white-space: nowrap;
    min-width: max-content;
  }

  .displaced-row {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.1rem 0;
    font-size: 0.6rem;
    color: var(--text-secondary, #aaa);
  }

  .displaced-arrow {
    color: #1db954;
    font-size: 0.5rem;
    flex-shrink: 0;
  }

  .displaced-img {
    width: 16px;
    height: 16px;
    border-radius: 2px;
    object-fit: cover;
    flex-shrink: 0;
  }

  .displaced-name {
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 160px;
    text-decoration: none;
    color: inherit;
  }

  .displaced-name:hover {
    color: var(--text-primary, #fff);
  }

  .displaced-more {
    font-size: 0.55rem;
    color: var(--text-muted, #666);
    padding-top: 0.1rem;
  }
</style>
