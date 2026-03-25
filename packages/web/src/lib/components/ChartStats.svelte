<script lang="ts">
  import { goto } from '$app/navigation';
  import { api, getWeekStart, getRankingMetric, type ChartHistoryResponse } from '$lib/api';
  import { medalColor } from '$lib/utils/medals';

  let {
    entityType,
    entityId,
    chartData = $bindable(null),
  }: {
    entityType: 'tracks' | 'albums' | 'artists';
    entityId: string;
    chartData?: ChartHistoryResponse | null;
  } = $props();

  let loading = $state(true);

  async function load() {
    loading = true;
    try {
      chartData = await api.chartHistory(entityType, entityId, getWeekStart(), getRankingMetric());
    } catch {
      chartData = null;
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void entityId;
    load();
  });

  let data = $derived(chartData);

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
      <button class="cs-badge cs-badge--clickable" onclick={goToPeak} title="View peak chart ({data.peakPeriod})">
        <span class="cs-val" style:color={medalColor(data.peakRank) ?? 'var(--accent)'}>#{data.peakRank}{#if data.timesAtPeak > 1} <span class="cs-times">×{data.timesAtPeak}</span>{/if}</span>
        <span class="cs-label">Peak</span>
      </button>
      <div class="cs-badge">
        <span class="cs-val">{data.weeksOnChart}</span>
        <span class="cs-label">Weeks</span>
      </div>
    </div>

    {#if runCells.length > 0}
      <div class="chart-run">
        {#each runCells as cell}
          {#if cell.rank != null}
            <button
              class="run-cell"
              class:run-cell--peak={cell.isPeak}
              style:color={medalColor(cell.rank) ?? 'var(--accent)'}
              style:border-color={cell.isPeak ? (medalColor(cell.rank) ?? 'var(--accent)') : undefined}
              title="{cell.period}: #{cell.rank}"
              onclick={() => goToWeek(cell.period)}
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
  .run-cell:hover:not(.run-cell--gap) {
    background: var(--bg-hover);
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
