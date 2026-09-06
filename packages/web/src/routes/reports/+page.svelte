<script lang="ts">
  import { onMount } from 'svelte';
  import { api, createFetchController, getWeekStart, REPORT_INDEX_HISTORY, type Granularity, type WeekStartOption } from '$lib/api';
  import { isClosedPeriod } from '@sis/shared';
  import { isAbortError } from '$lib/utils/errors';
  import { periodLabel } from '$lib/utils/periods';
  import { GRANULARITIES, GRANULARITY_LABELS, GRANULARITY_NOUNS, latestClosedPeriod, periodDateRange } from '$lib/utils/report-periods';
  import IconChevronRight from '$lib/icons/IconChevronRight.svelte';

  let weekStart = $state<WeekStartOption>('friday');
  // periodos cerrados con datos, del más reciente al más antiguo, por granularidad
  let history = $state<Record<Granularity, string[]>>({ week: [], month: [], year: [] });
  let historyGran = $state<Granularity>('week');
  let showAll = $state(false);
  let loading = $state(true);
  const fetchCtrl = createFetchController();

  let latest = $derived(GRANULARITIES.map(g => ({ granularity: g, period: latestClosedPeriod(g, weekStart) })));
  let visibleHistory = $derived(showAll ? history[historyGran] : history[historyGran].slice(0, REPORT_INDEX_HISTORY));

  onMount(async () => {
    weekStart = getWeekStart();
    const signal = fetchCtrl.reset();
    try {
      const res = await Promise.all(GRANULARITIES.map(g => api.chartPeriods(g, weekStart, signal)));
      // los periodos de los charts incluyen el que está en curso, que aún no tiene report
      const closed = (periods: string[], g: Granularity) => periods.filter(p => isClosedPeriod(p, g, weekStart));
      history = { week: closed(res[0].periods, 'week'), month: closed(res[1].periods, 'month'), year: closed(res[2].periods, 'year') };
    } catch (e) {
      if (isAbortError(e)) return;
    } finally {
      if (!signal.aborted) loading = false;
    }
  });
</script>

<div class="page-header">
  <h1>Reports</h1>
  <p>Your weeks, months and years in music, once they close.</p>
</div>

<div class="report-latest">
  {#each latest as item (item.granularity)}
    {#if item.period}
      {@const label = periodLabel(item.period, item.granularity)}
      {@const range = periodDateRange(item.period, item.granularity, weekStart)}
      <a class="card report-latest-card" href="/reports/{item.granularity}/{item.period}">
        <span class="data-label">Last {GRANULARITY_NOUNS[item.granularity].toLowerCase()}</span>
        <span class="report-latest-title">{label}</span>
        <!-- en meses y años el rango de fechas es el propio título: no repetirlo -->
        {#if range !== label}<span class="report-latest-range">{range}</span>{/if}
        <span class="report-latest-cta">Open report <IconChevronRight /></span>
      </a>
    {/if}
  {/each}
</div>

<div class="section-header">
  <h2 class="section-title">Past reports</h2>
  <div class="time-range-selector report-history-tabs">
    {#each GRANULARITIES as g (g)}
      <button class="range-btn" class:active={historyGran === g} onclick={() => { historyGran = g; showAll = false; }}>{GRANULARITY_LABELS[g]}</button>
    {/each}
  </div>
</div>

{#if loading}
  <div class="loading"><div class="spinner"></div></div>
{:else if visibleHistory.length === 0}
  <div class="empty-state">No closed {historyGran}s with plays yet.</div>
{:else}
  <div class="card report-history">
    {#each visibleHistory as p (p)}
      {@const label = periodLabel(p, historyGran)}
      {@const range = periodDateRange(p, historyGran, weekStart)}
      <a class="report-history-row" href="/reports/{historyGran}/{p}">
        <span class="report-history-label">{label}</span>
        {#if range !== label}<span class="report-history-range data-count">{range}</span>{/if}
        <IconChevronRight />
      </a>
    {/each}
    {#if !showAll && history[historyGran].length > REPORT_INDEX_HISTORY}
      <button class="show-all-btn report-history-more" onclick={() => { showAll = true; }}>Show all {history[historyGran].length}</button>
    {/if}
  </div>
{/if}

<style>
  .report-latest {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1rem;
  }
  .report-latest-card {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    color: inherit;
    text-decoration: none;
    transition: border-color 0.05s;
  }
  .report-latest-card:hover {
    border-color: var(--accent);
    color: inherit;
  }
  .report-latest-title {
    font-size: 1.4rem;
    font-weight: 700;
    line-height: 1.2;
  }
  .report-latest-range {
    color: var(--text-muted);
    font-size: 0.85rem;
  }
  .report-latest-cta {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    margin-top: 0.5rem;
    font-family: var(--font-mono);
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--accent);
  }
  /* el selector global lleva margen inferior: aquí va alineado con el título de sección */
  .report-history-tabs {
    margin: 1.5rem 0 0.75rem;
  }
  .report-history {
    display: flex;
    flex-direction: column;
    padding: 0.25rem 0;
  }
  .report-history-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.55rem 1rem;
    color: inherit;
    text-decoration: none;
    border-bottom: 1px solid var(--border);
  }
  .report-history-row:last-of-type { border-bottom: none; }
  .report-history-row:hover { background: var(--bg-hover); color: inherit; }
  .report-history-label { flex: 1; }
  .report-history-range {
    color: var(--text-muted);
    font-size: 0.75rem;
  }
  .report-history-more {
    align-self: center;
    margin: 0.5rem 0;
  }
  @media (max-width: 768px) {
    .report-latest { grid-template-columns: 1fr; }
  }
</style>
