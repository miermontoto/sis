<script lang="ts">
  // collage de un top 5: el nº 1 ocupa un cuadrado de 2×2 y los otros cuatro
  // un cuadrado de 1×1 cada uno a su derecha (un cuarto del área), así el
  // conjunto es un rectángulo 2:1 y dos collages caben lado a lado. las
  // fotos de artista van cuadradas, no redondas: un mosaico con huecos
  // circulares no es un mosaico
  import { medalColor } from '$lib/utils/medals';
  import LiveEq from './LiveEq.svelte';

  export interface CollageItem {
    href: string;
    rank: number;
    imageUrl?: string | null;
    name: string;
    stat: string;
    isLive?: boolean;
    oncontextmenu?: (e: MouseEvent) => void;
  }

  let { items }: { items: CollageItem[] } = $props();

  // el collage está pensado para cinco: el primero grande y cuatro pequeños
  const COLLAGE_SIZE = 5;
</script>

<div class="collage">
  {#each items.slice(0, COLLAGE_SIZE) as item, i (item.href)}
    <a href={item.href} class="tile" class:tile--lead={i === 0} class:tile--live={item.isLive} oncontextmenu={item.oncontextmenu}>
      {#if item.imageUrl}
        <img class="tile-img" src={item.imageUrl} alt={item.name} loading="lazy" />
      {:else}
        <div class="tile-img tile-img--empty"></div>
      {/if}
      <span class="tile-rank" style:color={medalColor(item.rank)}>{item.rank}</span>
      {#if item.isLive}<LiveEq />{/if}
      <span class="tile-caption">
        <span class="tile-name">{item.name}</span>
        <span class="tile-stat">{item.stat}</span>
      </span>
    </a>
  {/each}
</div>

<style>
  .collage {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    grid-auto-rows: minmax(0, 1fr);
    gap: 0.4rem;
    aspect-ratio: 2 / 1;
  }
  .tile {
    position: relative;
    overflow: hidden;
    border-radius: var(--radius);
    background: var(--bg-elevated, #1e2a2a);
    text-decoration: none;
    color: inherit;
    /* la caption se ancla abajo y la celda es cuadrada: min 0 para que la
       imagen no estire la rejilla */
    min-width: 0;
    min-height: 0;
  }
  .tile--lead {
    grid-column: span 2;
    grid-row: span 2;
  }
  .tile-img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform 0.15s ease;
  }
  .tile:hover .tile-img {
    transform: scale(1.04);
  }
  .tile-img--empty {
    background: linear-gradient(135deg, #1e2a2a, #253030);
  }
  .tile-rank {
    position: absolute;
    top: 0.35rem;
    left: 0.45rem;
    font-family: var(--font-mono);
    font-size: 0.8rem;
    font-weight: 700;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9);
  }
  .tile--lead .tile-rank {
    font-size: 1.1rem;
  }
  /* sonando ahora: el ecualizador en la esquina superior derecha (abajo está
     la caption y a la izquierda el puesto) y el mismo anillo verde que las
     listas, pintado en un ::after porque la imagen tapa una sombra inset del
     propio tile */
  .tile :global(.live-eq) {
    top: 0.5rem;
    right: 0.55rem;
    bottom: auto;
    left: auto;
    height: 14px;
    filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.9));
  }
  .tile--live::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    box-shadow: inset 0 0 0 2px var(--accent);
    pointer-events: none;
  }
  .tile--live .tile-name {
    color: var(--accent);
  }
  /* nombre y cifra sobre un degradado en la base de la celda; en las celdas
     pequeñas la cifra se oculta y sólo queda el nombre */
  .tile-caption {
    position: absolute;
    inset: auto 0 0 0;
    padding: 1.4rem 0.5rem 0.4rem;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    background: linear-gradient(to top, rgba(0, 0, 0, 0.85), rgba(0, 0, 0, 0));
    color: #fff;
  }
  .tile-name {
    font-size: 0.75rem;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tile-stat {
    font-family: var(--font-mono);
    font-size: 0.65rem;
    color: rgba(255, 255, 255, 0.75);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tile--lead .tile-name {
    font-size: 0.95rem;
  }
  .tile--lead .tile-stat {
    font-size: 0.72rem;
  }
  .tile:hover .tile-name {
    color: var(--accent);
  }
</style>
