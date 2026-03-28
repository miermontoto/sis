<script lang="ts">
  import { goto } from '$app/navigation';
  import { api, createFetchController, getWeekStart, getRankingMetric, type ChartHistoryResponse } from '$lib/api';
  import { medalColor } from '$lib/utils/medals';
  import PeakSelector from './PeakSelector.svelte';

  let {
    entityType,
    entityId,
    chartData = $bindable(null),
    highlightedMonth = $bindable(''),
  }: {
    entityType: 'tracks' | 'albums' | 'artists';
    entityId: string;
    chartData?: ChartHistoryResponse | null;
    highlightedMonth?: string;
  } = $props();

  // extraer YYYY-MM de un periodo semanal (YYYY-WNN → usar la fecha del lunes de esa semana)
  function periodToMonth(period: string): string {
    const m = period.match(/^(\d{4})-W(\d{2})$/);
    if (!m) return period.slice(0, 7);
    const year = parseInt(m[1]);
    const week = parseInt(m[2]);
    // lunes de la semana W (ISO: semana empieza lunes, W01 contiene ene 4)
    const jan4 = new Date(year, 0, 4);
    const dayOfWeek = jan4.getDay() || 7;
    const monday = new Date(jan4);
    monday.setDate(jan4.getDate() - dayOfWeek + 1 + (week - 1) * 7);
    return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}`;
  }

  let loading = $state(true);
  let hoveredWeek = $state('');
  const fetchCtrl = createFetchController();

  $effect(() => {
    void entityId;
    const signal = fetchCtrl.reset();
    loading = true;
    api.chartHistory(entityType, entityId, getWeekStart(), getRankingMetric(), signal)
      .then(r => { if (!signal.aborted) { chartData = r; loading = false; } })
      .catch(() => { if (!signal.aborted) { chartData = null; loading = false; } });
    return () => fetchCtrl.abort();
  });

  let data = $derived(chartData);

  // racha consecutiva actual: contar hacia atrás desde el final mientras rank != null
  let consecutiveWeeks = $derived.by(() => {
    if (!data?.history.length) return 0;
    let count = 0;
    for (let i = data.history.length - 1; i >= 0; i--) {
      if (data.history[i].rank != null) count++;
      else break;
    }
    return count;
  });

  function goToPeak() {
    if (!data) return;
    goto(`/charts?type=${entityType}&granularity=week&period=${data.peakPeriod}`);
  }

  function goToWeek(period: string) {
    goto(`/charts?type=${entityType}&granularity=week&period=${period}`);
  }

  // construir celdas del chart-run: agrupar rachas consecutivas en la misma posición
  interface RunCell {
    rank: number | null;
    count: number;
    period: string; // primer periodo de la racha
    isPeak: boolean;
  }

  let runCells = $derived.by<RunCell[]>(() => {
    if (!data?.history.length) return [];
    const cells: RunCell[] = [];
    let gapCell: RunCell | null = null;

    for (const h of data.history) {
      if (h.rank == null) {
        // semana sin chart: colapsar gaps consecutivos
        if (gapCell) {
          gapCell.count++;
        } else {
          gapCell = { rank: null, count: 1, period: h.period, isPeak: false };
          cells.push(gapCell);
        }
      } else {
        // semana con chart: siempre celda individual
        gapCell = null;
        cells.push({ rank: h.rank, count: 1, period: h.period, isPeak: h.rank === data!.peakRank });
      }
    }
    return cells;
  });
</script>

{#if loading}
  <div class="chart-stats-row">
    <div class="cs-badge cs-badge--loading"><div class="cs-shimmer"></div></div>
    <div class="cs-badge cs-badge--loading"><div class="cs-shimmer"></div></div>
    <div class="cs-badge cs-badge--loading"><div class="cs-shimmer"></div></div>
  </div>
{:else if data && data.weeksOnChart > 0}
  <div class="chart-stats-section">
    <div class="chart-stats-row">
      <div class="cs-badge">
        <span class="cs-val" class:cs-val--muted={data.currentRank == null} style:color={data.currentRank ? medalColor(data.currentRank) : undefined}>{data.currentRank != null ? `#${data.currentRank}` : '—'}</span>
        <span class="cs-label">Current</span>
      </div>
      {#if data.timesAtPeak > 1 && data.peakPeriods?.length > 1}
        <div class="cs-badge">
          <PeakSelector peakRank={data.peakRank} peakPeriods={data.peakPeriods} onselect={(p) => goToWeek(p)} />
          <span class="cs-label">Peak</span>
        </div>
      {:else}
        <button class="cs-badge cs-badge--clickable" onclick={goToPeak} title="View peak chart ({data.peakPeriod})">
          <span class="cs-val" style:color={medalColor(data.peakRank) ?? 'var(--accent)'}>#{data.peakRank}</span>
          <span class="cs-label">Peak</span>
        </button>
      {/if}
      <div class="cs-badge" title="{data.weeksOnChart} total, {consecutiveWeeks} consecutive">
        <span class="cs-val">{data.weeksOnChart}{#if consecutiveWeeks > 0} <span class="cs-total">({consecutiveWeeks})</span>{/if}</span>
        <span class="cs-label">Weeks</span>
      </div>
    </div>

    {#if runCells.length > 0}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="chart-run" onmouseleave={() => { hoveredWeek = ''; highlightedMonth = ''; }}>
        {#each runCells as cell}
          {#if cell.rank != null}
            <button
              class="run-cell"
              class:run-cell--peak={cell.isPeak}
              class:run-cell--highlighted={hoveredWeek ? cell.period === hoveredWeek : (highlightedMonth && periodToMonth(cell.period) === highlightedMonth)}
              style:color={medalColor(cell.rank) ?? 'var(--accent)'}
              style:border-color={cell.isPeak ? (medalColor(cell.rank) ?? 'var(--accent)') : undefined}
              title="{cell.period}: #{cell.rank}"
              onclick={() => goToWeek(cell.period)}
              onmouseenter={() => { hoveredWeek = cell.period; highlightedMonth = periodToMonth(cell.period); }}
            >{cell.rank}{#if cell.count > 1}<span class="run-times">×{cell.count}</span>{/if}</button>
          {:else}
            <div class="run-cell run-cell--gap" title="{cell.period}: off chart">{#if cell.count > 1}<span class="run-gap-count">{cell.count}</span>{/if}</div>
          {/if}
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .chart-stats-section {
    margin-bottom: 1.5rem;
  }
  .chart-stats-row {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }
  .cs-badge {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.1rem;
    padding: 0.5rem 0.75rem;
    border-radius: 10px;
    background: var(--bg-card);
    border: 1px solid #2a2a2a;
  }
  button.cs-badge--clickable {
    cursor: pointer;
    font-family: var(--font);
    font-size: inherit;
    line-height: inherit;
    color: inherit;
    -webkit-appearance: none;
    appearance: none;
    text-align: center;
    margin: 0;
    transition: border-color 0.15s;
  }
  button.cs-badge--clickable:hover {
    border-color: var(--accent);
  }
  .cs-badge--loading {
    height: 3rem;
    overflow: hidden;
    position: relative;
  }
  .cs-shimmer {
    width: 100%;
    height: 100%;
    background: linear-gradient(90deg, #2a2a2a 25%, #3a3a3a 50%, #2a2a2a 75%);
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite;
  }
  @keyframes shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }
  .cs-val {
    font-size: 1.1rem;
    font-weight: 700;
    color: var(--text);
  }
  .cs-val--muted {
    color: var(--text-muted);
  }
  .cs-times {
    font-size: 0.7rem;
    font-weight: 500;
    opacity: 0.7;
  }
  .cs-total {
    font-size: 0.8rem;
    font-weight: 500;
    color: var(--text-muted);
    margin-left: 0.15em;
  }
  .cs-label {
    font-size: 0.65rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  /* chart-run grid */
  .chart-run {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
    margin-top: 0.5rem;
  }
  .run-cell {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 1px;
    min-width: 2rem;
    height: 2rem;
    padding: 0 0.3rem;
    border-radius: 5px;
    background: var(--bg-card);
    border: 1px solid #2a2a2a;
    font-size: 0.75rem;
    font-weight: 700;
    font-family: var(--font);
    cursor: pointer;
    transition: background 0.1s;
    -webkit-appearance: none;
    appearance: none;
  }
  .run-cell:hover:not(.run-cell--gap),
  .run-cell--highlighted {
    background: var(--bg-hover);
    border-color: currentColor;
  }
  .run-cell--peak {
    border-width: 2px;
  }
  .run-cell--gap {
    color: #333;
    cursor: default;
    border-color: transparent;
    background: rgba(255,255,255,0.02);
  }
  .run-times {
    font-size: 0.6rem;
    font-weight: 500;
    opacity: 0.6;
  }
  .run-gap-count {
    font-size: 0.6rem;
    color: #444;
  }
</style>
