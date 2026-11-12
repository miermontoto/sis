<script lang="ts">
  // el siguiente hito de plays all-time (la escalera de las pushes de milestones):
  // cuánto falta, una barra desde el hito anterior y, al ritmo de las dos últimas
  // semanas, cuándo llegará. medium añade el total y la fecha estimada
  import { nextMilestone, previousMilestone } from '@sis/shared';
  import { statFlashStore } from '$lib/stores/stat-flash.svelte';
  import { formatNumber, formatCalendarDate } from '$lib/utils/format';
  import { dailyData, FLASH_KEY_TOTALS } from '../daily-data.svelte';
  import type { WidgetProps } from '../components';

  let { size }: WidgetProps = $props();

  const DAY_MS = 86_400_000;
  const PCT = 100;

  $effect(() => { dailyData.ensure('health', 'days'); });

  let total = $derived(dailyData.health?.totalPlays ?? 0);
  let next = $derived(nextMilestone(total));
  let prev = $derived(previousMilestone(total));
  let pct = $derived(next > prev ? ((total - prev) / (next - prev)) * PCT : PCT);
  // ritmo: plays por día de la ventana de catorce días
  let perDay = $derived(dailyData.days.length > 0 ? dailyData.days.reduce((a, d) => a + d.plays, 0) / dailyData.days.length : 0);
  let daysLeft = $derived(perDay > 0 ? Math.ceil((next - total) / perDay) : null);
  let eta = $derived(daysLeft !== null ? new Date(Date.now() + daysLeft * DAY_MS).toISOString().slice(0, 10) : null);
  let loading = $derived(dailyData.loading('health'));
</script>

<div class="ms" class:ms--wide={size === 'medium'}>
  <div class="ms-main">
    <span class="w-caption">Next milestone</span>
    {#if loading}
      <span class="w-ghost ms-ghost"></span>
    {:else}
      <span class="w-figure ms-value" class:stat-flash={statFlashStore.isFlashing(FLASH_KEY_TOTALS)}>{formatNumber(next - total)}</span>
      <span class="w-sub">plays to {formatNumber(next)}</span>
    {/if}
  </div>
  <div class="ms-side">
    <div class="ms-bar" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={PCT} aria-label="Progress to {formatNumber(next)} plays">
      <span class="ms-fill" style:width="{loading ? 0 : pct}%"></span>
    </div>
    {#if !loading}
      {#if size === 'medium'}
        <span class="w-sub">{formatNumber(total)} plays all time</span>
        {#if eta}<span class="w-sub">around {formatCalendarDate(eta)} at your pace</span>{/if}
      {:else if daysLeft !== null}
        <span class="w-sub">~{daysLeft} {daysLeft === 1 ? 'day' : 'days'}</span>
      {/if}
    {/if}
  </div>
</div>

<style>
  .ms {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 0.6rem;
    text-align: center;
  }
  .ms--wide {
    flex-direction: row;
    align-items: center;
    text-align: left;
    gap: 1rem;
  }
  .ms-main, .ms-side {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
  }
  .ms--wide .ms-main, .ms--wide .ms-side { flex: 1; }
  .ms-value { font-size: clamp(1.2rem, 14cqi, 2.2rem); }
  .ms-ghost { width: 4rem; height: 1.6rem; align-self: center; }
  .ms--wide .ms-ghost { align-self: flex-start; }
  .ms-bar {
    height: 0.45rem;
    border-radius: 0.25rem;
    background: var(--fg-a08);
    overflow: hidden;
  }
  .ms-fill {
    display: block;
    height: 100%;
    background: var(--accent);
    transition: width 0.4s ease;
  }
  @media (prefers-reduced-motion: reduce) {
    .ms-fill { transition: none; }
  }
</style>
