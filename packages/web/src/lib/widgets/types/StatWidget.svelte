<script lang="ts">
  // una cifra. tile: compacta; small: grande. band y medium añaden al lado lo que
  // le da contexto: las barras de la semana para las cifras de días, la racha como
  // puntos de los últimos catorce días, el total como barra hacia el siguiente hito
  import { nextMilestone, previousMilestone } from '@sis/shared';
  import Figure from '../Figure.svelte';
  import { dailyData } from '../daily-data.svelte';
  import type { WidgetProps } from '../components';

  let { size, settings }: WidgetProps = $props();

  const PCT = 100;
  let figure = $derived(String(settings.figure));
  let kind = $derived(figure === 'streak' ? 'streak' : figure === 'totalPlays' ? 'total' : figure.endsWith('Year') ? 'none' : 'bars');
  let byPlays = $derived(figure.startsWith('plays'));

  // band y medium llevan la gráfica al lado
  let wide = $derived(size === 'band' || size === 'medium');
  $effect(() => {
    if (!wide) return;
    if (kind === 'bars' || kind === 'streak') dailyData.ensure('days');
    if (kind === 'total') dailyData.ensure('health');
  });

  let week = $derived(dailyData.week);
  let max = $derived(Math.max(1, ...week.map(d => byPlays ? d.plays : d.ms)));
  let total = $derived(dailyData.health?.totalPlays ?? 0);
  // progreso desde el hito anterior (o cero) hasta el siguiente
  let milestonePct = $derived.by(() => {
    const next = nextMilestone(total);
    const prev = previousMilestone(total);
    return next > prev ? ((total - prev) / (next - prev)) * PCT : PCT;
  });
</script>

<div class="stat" class:stat--wide={wide && kind !== 'none'}>
  <Figure {figure} variant={size === 'tile' || size === 'band' ? 'compact' : 'hero'} />
  {#if wide && kind === 'bars'}
    <div class="stat-bars" aria-hidden="true">
      {#each week as d, i (d.key)}
        <span class="stat-bar" class:stat-bar--today={i === week.length - 1} style:height="{Math.max(4, ((byPlays ? d.plays : d.ms) / max) * PCT)}%"></span>
      {/each}
    </div>
  {:else if wide && kind === 'streak'}
    <div class="stat-dots" aria-hidden="true">
      {#each dailyData.days as d (d.key)}
        <span class="stat-dot" class:stat-dot--on={d.plays > 0}></span>
      {/each}
    </div>
  {:else if wide && kind === 'total'}
    <div class="stat-progress" role="progressbar" aria-valuenow={Math.round(milestonePct)} aria-valuemin={0} aria-valuemax={PCT} aria-label="Progress to the next milestone">
      <span class="stat-progress-fill" style:width="{milestonePct}%"></span>
    </div>
  {/if}
</div>

<style>
  .stat {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
  .stat > :global(.fig) { flex: 1; }
  .stat--wide {
    flex-direction: row;
    align-items: center;
    gap: 1rem;
  }
  .stat--wide > :global(.fig) { flex: 1 1 50%; }
  .stat-bars {
    flex: 1 1 50%;
    align-self: stretch;
    display: flex;
    align-items: flex-end;
    gap: 3px;
    padding: 0.5rem 0;
  }
  .stat-bar {
    flex: 1;
    border-radius: 2px 2px 0 0;
    background: var(--accent-a25);
  }
  .stat-bar--today { background: var(--accent); }
  .stat-dots {
    flex: 1 1 50%;
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 4px;
  }
  /* en una banda (media fila) dos filas de siete no caben: una de catorce */
  @container widget (max-height: 4.5rem) {
    .stat-dots { grid-template-columns: repeat(14, 1fr); gap: 2px; }
  }
  .stat-dot {
    aspect-ratio: 1;
    border-radius: 2px;
    background: var(--fg-a08);
  }
  .stat-dot--on { background: var(--accent); }
  .stat-progress {
    flex: 1 1 50%;
    height: 0.5rem;
    border-radius: 0.25rem;
    background: var(--fg-a05);
    overflow: hidden;
  }
  .stat-progress-fill {
    display: block;
    height: 100%;
    background: var(--accent);
  }
</style>
