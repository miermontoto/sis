<script lang="ts">
  // una barra por día de la última semana (la tira de siempre, ahora del alto del
  // slot); large y xl añaden el total de la semana frente a la anterior. En band
  // (media fila, junto a las cifras de Today) no hay cabecera: las etiquetas de los
  // días y el "today" de la tira ya dicen qué es
  import WeekStrip from '$lib/components/WeekStrip.svelte';
  import ReportDelta from '$lib/components/reports/ReportDelta.svelte';
  import { statFlashStore } from '$lib/stores/stat-flash.svelte';
  import { formatDuration, formatNumber } from '$lib/utils/format';
  import WidgetHeader from '../WidgetHeader.svelte';
  import { dailyData, FLASH_KEY_TIME } from '../daily-data.svelte';
  import { widgetMetric } from '../util';
  import type { WidgetProps } from '../components';

  let { size, settings }: WidgetProps = $props();

  $effect(() => { dailyData.ensure('days'); });

  let metric = $derived(widgetMetric(settings));
  let sum = (days: typeof dailyData.week) => days.reduce((a, d) => a + (metric === 'plays' ? d.plays : d.ms), 0);
  let week = $derived(sum(dailyData.week));
  let prev = $derived(sum(dailyData.prevWeek));
  let total = $derived(metric === 'plays' ? `${formatNumber(week)} plays` : formatDuration(week));
</script>

{#if size !== 'band'}
  <WidgetHeader title="Last 7 days" href="/insights">
    {#snippet actions()}
      {#if size !== 'medium' && !dailyData.loading('days')}
        <span class="data-label ws-total">{total} <ReportDelta value={week} previous={prev} /></span>
      {/if}
    {/snippet}
  </WidgetHeader>
{/if}
<div class="ws-fill" class:ws-fill--band={size === 'band'} role="group" aria-label="Last 7 days">
  {#if dailyData.loading('days')}
    <div class="w-ghost w-ghost--fill"></div>
  {:else}
    <WeekStrip days={dailyData.week} {metric} flash={statFlashStore.isFlashing(FLASH_KEY_TIME)} />
  {/if}
</div>

<style>
  .ws-fill {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .ws-fill :global(.week-strip) {
    flex: 1;
    min-height: 0;
    height: auto;
  }
  /* en media fila la línea de cifras (invisible salvo la de hoy) se comía el alto de
     las barras: fuera, las cifras ya están en los tiles de al lado */
  .ws-fill--band :global(.week-value) { display: none; }
  .ws-total {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    white-space: nowrap;
  }
</style>
