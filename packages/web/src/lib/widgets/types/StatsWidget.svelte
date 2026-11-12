<script lang="ts">
  // las cifras de ritmo diario elegidas, en una rejilla que crece con el tamaño:
  // medium 3 en fila, large 2×3, xl hasta 8 en una o dos filas. Es la antigua barra
  // de stats del dashboard, que eran cinco cards sueltas
  import Figure from '../Figure.svelte';
  import type { WidgetProps } from '../components';
  import type { WidgetSize } from '../registry';

  let { size, settings }: WidgetProps = $props();

  const CAPACITY: Record<WidgetSize, number> = { small: 1, medium: 3, large: 6, xl: 8 };
  let figures = $derived((settings.figures as string[]).slice(0, CAPACITY[size]));
  // medium es una fila; large y xl miden dos filas de alto, así que las cifras van en
  // dos filas (en una sola, cinco cifras eran columnas de 330px con el número en medio)
  let cols = $derived(size === 'medium' || figures.length < 3 ? figures.length : size === 'large' ? 2 : Math.ceil(figures.length / 2));
</script>

<div class="stats" style:--stats-cols={cols}>
  {#each figures as figure (figure)}
    <div class="stats-cell"><Figure {figure} /></div>
  {/each}
</div>

<style>
  .stats {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: repeat(var(--stats-cols), minmax(0, 1fr));
    grid-auto-rows: minmax(0, 1fr);
    gap: 0.4rem;
  }
  .stats-cell {
    display: flex;
    flex-direction: column;
    justify-content: center;
    min-width: 0;
    min-height: 0;
    padding: 0.4rem 0.25rem;
    border-radius: var(--radius);
    background: var(--fg-a03);
  }
  .stats-cell > :global(*) { flex: 1; }
</style>
