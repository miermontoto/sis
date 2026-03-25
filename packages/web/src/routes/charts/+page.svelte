<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { api, getRankingMetric, getWeekStart, type ChartResponse, type RankingMetric, type WeekStartOption } from '$lib/api';
  import { formatDuration, formatNumber } from '$lib/utils/format';
  import RankChange from '$lib/components/RankChange.svelte';
  import { medalColor } from '$lib/utils/medals';

  type EntityType = 'tracks' | 'albums' | 'artists';
  type Granularity = 'week' | 'month' | 'year';

  let metric = $state<RankingMetric>('time');
  let weekStart = $state<WeekStartOption>('monday');
  let activeType = $state<EntityType>('tracks');
  let granularity = $state<Granularity>('week');
  let selectedPeriod = $state('');
  let periods = $state<string[]>([]);
  let loading = $state(false);
  let periodsLoading = $state(false);

  // cache: `${type}:${granularity}:${period}:${metric}` → ChartResponse
  let cache = $state<Map<string, ChartResponse>>(new Map());
  let requestId = 0;

  function cacheKey() {
    return `${activeType}:${granularity}:${selectedPeriod}:${metric}`;
  }

  let currentData = $derived(cache.get(cacheKey()) ?? null);

  async function loadPeriods() {
    periodsLoading = true;
    try {
      const res = await api.chartPeriods(granularity, weekStart);
      periods = res.periods;
      if (periods.length > 0 && !periods.includes(selectedPeriod)) {
        selectedPeriod = periods[0];
      }
    } finally {
      periodsLoading = false;
    }
  }

  async function loadChart() {
    if (!selectedPeriod) return;
    const key = cacheKey();
    if (cache.has(key)) return;
    const thisRequest = ++requestId;
    loading = true;
    try {
      const result = await api.chart(activeType, granularity, selectedPeriod, weekStart, metric);
      if (thisRequest !== requestId) return;
      const next = new Map(cache);
      next.set(key, result);
      cache = next;
    } finally {
      if (thisRequest === requestId) loading = false;
    }
  }

  function entityLink(id: string): string {
    if (activeType === 'artists') return `/artist/${id}`;
    if (activeType === 'albums') return `/album/${id}`;
    return `/track/${id}`;
  }

  let currentIndex = $derived(periods.indexOf(selectedPeriod));
  let hasPrev = $derived(currentIndex < periods.length - 1); // periods sorted newest first
  let hasNext = $derived(currentIndex > 0);

  function goPrev() { if (hasPrev) selectedPeriod = periods[currentIndex + 1]; }
  function goNext() { if (hasNext) selectedPeriod = periods[currentIndex - 1]; }

  // calcular rango de fechas natural para el periodo seleccionado
  function periodDateRange(period: string, gran: Granularity, ws: WeekStartOption): string {
    if (gran === 'year') return period;
    if (gran === 'month') {
      const [y, m] = period.split('-').map(Number);
      const d = new Date(y, m - 1, 1);
      return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }
    // week: YYYY-WNN
    // SQLite %W: semanas empezando lunes, semana 00 = la que contiene ene 1
    // El lunes de la semana N es: ene 1 + (N * 7) - (díaDeSemana de ene 1, ajustado)
    const match = period.match(/^(\d{4})-W(\d{2})$/);
    if (!match) return period;
    const year = parseInt(match[1]);
    const wn = parseInt(match[2]);

    // encontrar el primer lunes del año o antes
    const jan1 = new Date(Date.UTC(year, 0, 1));
    const jan1Day = jan1.getUTCDay(); // 0=dom, 1=lun, ...
    // días hasta el lunes de esa semana: si ene 1 es lunes (1), offset=0; si martes (2), offset=-1; ...
    // SQLite %W: semana 00 empieza el lunes <= ene 1
    const daysToMonday = jan1Day === 0 ? -6 : 1 - jan1Day;
    const week0Monday = new Date(Date.UTC(year, 0, 1 + daysToMonday));
    const monday = new Date(week0Monday);
    monday.setUTCDate(monday.getUTCDate() + wn * 7);

    // ajustar según el weekStart configurado
    // el backend resta días antes de calcular %W, así que la "semana" real empieza en otro día
    const start = new Date(monday);
    if (ws === 'sunday') start.setUTCDate(start.getUTCDate() + 1); // el backend resta 1, nosotros sumamos 1 para compensar
    else if (ws === 'friday') start.setUTCDate(start.getUTCDate() + 4); // el backend resta 4

    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 6);

    const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    const y1 = start.getUTCFullYear();
    const y2 = end.getUTCFullYear();
    return y1 !== y2 ? `${fmt(start)}, ${y1} – ${fmt(end)}, ${y2}` : `${fmt(start)} – ${fmt(end)}, ${y1}`;
  }

  let dateRangeLabel = $derived(selectedPeriod ? periodDateRange(selectedPeriod, granularity, weekStart) : '');

  onMount(() => {
    metric = getRankingMetric();
    weekStart = getWeekStart();
    // leer query params para navegación desde chart-run o peak links
    const params = $page.url.searchParams;
    if (params.get('type')) activeType = params.get('type') as EntityType;
    if (params.get('granularity')) granularity = params.get('granularity') as Granularity;
    if (params.get('period')) selectedPeriod = params.get('period')!;
  });

  // cargar periodos cuando cambia granularidad o weekStart
  $effect(() => {
    void granularity;
    void weekStart;
    loadPeriods();
  });

  // cargar chart cuando cambia el periodo o tipo
  $effect(() => {
    void selectedPeriod;
    void activeType;
    void metric;
    if (selectedPeriod) loadChart();
  });
</script>

<div class="page-header">
  <h1>Charts</h1>
  <p>Browse ranked charts by period</p>
</div>

{#if dateRangeLabel}
  <div class="period-date-range">{dateRangeLabel}</div>
{/if}

<div class="charts-controls">
  <div class="charts-tabs">
    <button class="ch-tab" class:ch-tab--active={activeType === 'tracks'} onclick={() => activeType = 'tracks'}>Tracks</button>
    <button class="ch-tab" class:ch-tab--active={activeType === 'albums'} onclick={() => activeType = 'albums'}>Albums</button>
    <button class="ch-tab" class:ch-tab--active={activeType === 'artists'} onclick={() => activeType = 'artists'}>Artists</button>
  </div>

  <div class="charts-selectors">
    <div class="charts-tabs">
      <button class="ch-tab ch-tab--sm" class:ch-tab--active={granularity === 'week'} onclick={() => granularity = 'week'}>Week</button>
      <button class="ch-tab ch-tab--sm" class:ch-tab--active={granularity === 'month'} onclick={() => granularity = 'month'}>Month</button>
      <button class="ch-tab ch-tab--sm" class:ch-tab--active={granularity === 'year'} onclick={() => granularity = 'year'}>Year</button>
    </div>

    <div class="period-nav">
      <button class="period-arrow" disabled={!hasPrev || periodsLoading} onclick={goPrev} title="Previous period">&lsaquo;</button>
      <select class="period-select" bind:value={selectedPeriod} disabled={periodsLoading}>
        {#each periods as p}
          <option value={p}>{p}</option>
        {/each}
      </select>
      <button class="period-arrow" disabled={!hasNext || periodsLoading} onclick={goNext} title="Next period">&rsaquo;</button>
    </div>
  </div>
</div>

{#if (loading && !currentData) || periodsLoading}
  <div class="loading"><div class="spinner"></div></div>
{:else if currentData && currentData.entries.length > 0}
  <div class="chart-list">
    {#each currentData.entries as entry}
      <a href={entityLink(entry.entityId)} class="chart-item">
        <div class="chart-rank-col">
          <span class="chart-rank" style:color={medalColor(entry.rank)}>{entry.rank}</span>
          <RankChange rankChange={entry.rankChange} isNew={entry.isNew} isReentry={entry.isReentry} />
        </div>
        {#if entry.imageUrl}
          <img class="chart-art" class:chart-art--round={activeType === 'artists'} src={entry.imageUrl} alt="" />
        {:else}
          <div class="chart-art" class:chart-art--round={activeType === 'artists'}></div>
        {/if}
        <div class="chart-info">
          <div class="chart-name">{entry.name}</div>
          {#if entry.artistName}
            <div class="chart-artist">{entry.artistName}</div>
          {/if}
        </div>
        <div class="chart-stats">
          {#if entry.rank <= entry.peakRank && entry.peakPeriod === selectedPeriod}
            <div class="chart-peak-badge">PEAK</div>
          {:else}
            <button class="chart-stat chart-stat--peak" title="Go to peak chart ({entry.peakPeriod})" onclick={(e) => { e.preventDefault(); e.stopPropagation(); selectedPeriod = entry.peakPeriod; }}>
              <span class="chart-stat-val" style:color={medalColor(entry.peakRank)}>#{entry.peakRank}{#if entry.timesAtPeak > 1} <span class="chart-stat-times">×{entry.timesAtPeak}</span>{/if}</span>
              <span class="chart-stat-label">peak</span>
            </button>
          {/if}
          {#if granularity === 'week'}
            <div class="chart-stat" title="{entry.consecutiveWeeks} consecutive, {entry.weeksOnChart} total">
              <span class="chart-stat-val">{entry.consecutiveWeeks}<span class="chart-stat-total">/{entry.weeksOnChart}</span></span>
              <span class="chart-stat-label">wks</span>
            </div>
          {/if}
        </div>
        <div class="chart-meta">
          <div class="chart-primary">{metric === 'plays' ? `${formatNumber(entry.plays)} plays` : formatDuration(entry.totalMs)}</div>
          <div class="chart-secondary">{metric === 'plays' ? formatDuration(entry.totalMs) : `${formatNumber(entry.plays)} plays`}</div>
        </div>
      </a>
    {/each}
  </div>
{:else if currentData}
  <div class="card" style="text-align: center; color: var(--text-muted); padding: 2rem;">No data for this period.</div>
{/if}

<style>
  .charts-controls {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 0.75rem;
    margin-bottom: 1.25rem;
  }
  .charts-selectors {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .charts-tabs {
    display: flex;
    gap: 0.25rem;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 3px;
    width: fit-content;
  }
  .ch-tab {
    padding: 0.4rem 1rem;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text-muted);
    font-size: 0.85rem;
    font-family: var(--font);
    cursor: pointer;
    transition: all 0.15s;
  }
  .ch-tab--sm {
    padding: 0.3rem 0.7rem;
    font-size: 0.8rem;
  }
  .ch-tab:hover:not(.ch-tab--active) {
    color: var(--text);
  }
  .ch-tab--active {
    background: var(--accent);
    color: #000;
    font-weight: 500;
  }
  .period-nav {
    display: flex;
    align-items: center;
    gap: 0.2rem;
  }
  .period-arrow {
    background: var(--bg-card);
    border: 1px solid var(--border);
    color: var(--text-muted);
    font-size: 1.2rem;
    line-height: 1;
    width: 1.8rem;
    height: 1.8rem;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    cursor: pointer;
    transition: color 0.15s, border-color 0.15s;
    font-family: var(--font);
    padding: 0;
  }
  .period-arrow:hover:not(:disabled) {
    color: var(--text);
    border-color: var(--text-muted);
  }
  .period-arrow:disabled {
    opacity: 0.3;
    cursor: default;
  }
  .period-select {
    background: var(--bg-card);
    border: 1px solid var(--border);
    color: var(--text);
    font-size: 0.85rem;
    font-family: var(--font);
    padding: 0.35rem 0.6rem;
    border-radius: 6px;
    cursor: pointer;
    outline: none;
  }
  .period-select:focus {
    border-color: var(--accent);
  }
  .period-date-range {
    font-size: 0.85rem;
    color: var(--text-muted);
    margin-bottom: 0.75rem;
  }
  .chart-list {
    background: var(--bg-card);
    border-radius: 10px;
    overflow: hidden;
  }
  .chart-item {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.55rem 0.75rem;
    text-decoration: none;
    color: var(--text);
    transition: background 0.1s;
    border-bottom: 1px solid var(--border);
  }
  .chart-item:last-child {
    border-bottom: none;
  }
  .chart-item:hover {
    background: var(--bg-hover);
  }
  .chart-rank-col {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.1rem;
    width: 2.5rem;
    flex-shrink: 0;
  }
  .chart-rank {
    font-size: 0.9rem;
    font-weight: 700;
    color: var(--text);
  }
  .chart-art {
    width: 40px;
    height: 40px;
    border-radius: 4px;
    object-fit: cover;
    flex-shrink: 0;
    background: var(--border);
  }
  .chart-art--round {
    border-radius: 50%;
  }
  .chart-info {
    flex: 1;
    min-width: 0;
  }
  .chart-name {
    font-size: 0.9rem;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .chart-artist {
    font-size: 0.8rem;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .chart-stats {
    display: flex;
    gap: 0.4rem;
    flex-shrink: 0;
  }
  .chart-stat {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.05rem;
    min-width: 2.5rem;
    height: 2.2rem;
  }
  .chart-stat-val {
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--text);
    line-height: 1.1;
  }
  .chart-stat-label {
    font-size: 0.6rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .chart-stat-times {
    font-size: 0.65rem;
    font-weight: 500;
    opacity: 0.7;
  }
  .chart-stat-total {
    font-size: 0.7rem;
    font-weight: 500;
    color: var(--text-muted);
  }
  .chart-stat--peak {
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    border-radius: 6px;
    font-family: var(--font);
    transition: background 0.15s;
  }
  .chart-stat--peak:hover {
    background: rgba(29, 185, 84, 0.12);
  }
  .chart-stat--peak .chart-stat-val {
    color: var(--accent);
  }
  .chart-peak-badge {
    font-size: 0.6rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    color: #f0c040;
    background: rgba(240, 192, 64, 0.12);
    border: 1px solid rgba(240, 192, 64, 0.3);
    padding: 0.2rem 0.4rem;
    border-radius: 5px;
    min-width: 2.5rem;
    height: 2.2rem;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .chart-meta {
    text-align: right;
    flex-shrink: 0;
  }
  .chart-primary {
    font-size: 0.85rem;
    font-weight: 500;
  }
  .chart-secondary {
    font-size: 0.75rem;
    color: var(--text-muted);
  }
  @media (max-width: 640px) {
    .charts-controls {
      flex-direction: column;
      align-items: stretch;
    }
    .charts-selectors {
      justify-content: space-between;
    }
  }
</style>
