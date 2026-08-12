<script lang="ts">
  import { isAbortError } from '$lib/utils/errors';
  import { onMount, onDestroy } from 'svelte';
  import { api, createFetchController, getWeekStart, type ListeningTimeItem, type HeatmapItem, type GenreItem, type StreaksData, type DiscoveryItem, type MonthlyDistributionItem, type DateRangeParams } from '$lib/api';
  import { getQueryParam, setQueryParams } from '$lib/utils/query-state';
  import TimeRangeSelector from '$lib/components/TimeRangeSelector.svelte';
  import BaseChart from '$lib/components/charts/BaseChart.svelte';
  import { formatHours, formatDurationAs, DURATION_UNITS, type DurationUnit, getLocalizedDayNames, getLocalizedMonthNames } from '$lib/utils/format';
  import { GRID, TOOLTIP_BASE, AXIS_LINE, AXIS_LABEL, SPLIT_LINE, categoryAxis, valueAxis, secondaryValueAxis, dualAxisGrid, lineSeries, barSeries, cumulativeLineSeries, areaGradient, linearRegression, trendSeries, PIE_TOOLTIP, PIE_COLORS, GREEN, tooltipPoint, tooltipPoints, tooltipTuplePoint, type TooltipParams } from '$lib/utils/chart';
  import type { EChartsOption } from 'echarts';
  import { shortcutStore } from '$lib/stores/keyboard-shortcuts.svelte';

  let range = $state('all');
  let startDate = $state('');
  let endDate = $state('');
  let listeningData = $state<ListeningTimeItem[]>([]);
  let heatmap = $state<HeatmapItem[]>([]);
  let genres = $state<GenreItem[]>([]);
  let streaks = $state<StreaksData | null>(null);
  let discovery = $state<DiscoveryItem[]>([]);
  let monthlyDist = $state<MonthlyDistributionItem[]>([]);
  let discoveryEntity = $state<'track' | 'album' | 'artist'>('track');
  let listeningUnit = $state<DurationUnit>('hours');
  let loading = $state(true);
  let discoveryLoading = $state(false);
  const fetchCtrl = createFetchController();

  let pulseDim = $state(false);
  let pulseInterval: ReturnType<typeof setInterval> | null = null;

  function pulseData(values: number[], currentIdx: number): (number | { value: number; itemStyle: { opacity: number } })[] {
    if (currentIdx < 0 || currentIdx >= values.length) return values;
    return values.map((v, i) => i === currentIdx ? { value: v, itemStyle: { opacity: pulseDim ? 0.35 : 1 } } : v);
  }

  function pulseHeatmapData(data: number[][], currentIdx: number): (number[] | { value: number[]; itemStyle: { opacity: number } })[] {
    if (currentIdx < 0) return data;
    return data.map((v, i) => i === currentIdx ? { value: v, itemStyle: { opacity: pulseDim ? 0.35 : 1 } } : v);
  }

  function granularityForRange(r: string): string {
    if (r === 'custom' && startDate && endDate) {
      const days = Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24));
      if (days <= 30) return 'day';
      if (days <= 180) return 'week';
      return 'month';
    }
    if (r === 'week' || r === 'month') return 'day';
    if (r === '3months' || r === '6months') return 'week';
    return 'month';
  }

  function getCustomDates(): DateRangeParams | undefined {
    if (range === 'custom' && startDate && endDate) return { startDate, endDate };
    return undefined;
  }

  async function loadData() {
    const signal = fetchCtrl.reset();
    loading = true;
    try {
      const dates = getCustomDates();
      const gran = granularityForRange(range);
      [listeningData, heatmap, genres, streaks, monthlyDist] = await Promise.all([
        api.listeningTime(range, gran, dates, signal),
        api.heatmap(range, dates, signal),
        api.topGenres(range, 10, dates, signal),
        api.streaks(signal),
        api.monthlyDistribution(range, dates, signal),
      ]);
    } catch (e) {
      if (isAbortError(e)) return;
      throw e;
    } finally {
      if (!signal.aborted) loading = false;
    }
    loadDiscovery();
  }

  async function loadDiscovery() {
    discoveryLoading = true;
    try {
      const dates = getCustomDates();
      discovery = await api.discovery(range, granularityForRange(range), discoveryEntity, dates);
    } catch { /* ignore */ }
    discoveryLoading = false;
  }

  function setRange(r: string) {
    range = r;
    if (r !== 'custom') {
      startDate = '';
      endDate = '';
      setQueryParams({ range: r, startDate: null, endDate: null });
    } else {
      if (!startDate || !endDate) {
        const now = new Date();
        endDate = now.toISOString().split('T')[0];
        const start = new Date(now);
        start.setDate(start.getDate() - 30);
        startDate = start.toISOString().split('T')[0];
      }
      setQueryParams({ range: r, startDate, endDate });
    }
  }

  function setCustomDates(s: string, e: string) {
    startDate = s;
    endDate = e;
    setQueryParams({ startDate: s, endDate: e });
  }

  let initialized = false;

  onMount(() => {
    range = getQueryParam('range', 'all');
    startDate = getQueryParam('startDate', '');
    endDate = getQueryParam('endDate', '');
    initialized = true;
    pulseInterval = setInterval(() => { pulseDim = !pulseDim; }, 1500);
  });

  const RANGES = ['week', 'month', '3months', '6months', 'year', 'thisYear', 'all'];
  shortcutStore.registerPageShortcuts(
    [
      { key: '[', description: 'Previous range', category: 'page' },
      { key: ']', description: 'Next range', category: 'page' },
    ],
    (e) => {
      if (e.key === '[' || e.key === ']') {
        const idx = RANGES.indexOf(range);
        if (idx < 0) return false;
        const next = e.key === '[' ? idx - 1 : idx + 1;
        if (next >= 0 && next < RANGES.length) { e.preventDefault(); setRange(RANGES[next]); }
        return true;
      }
      return false;
    },
  );
  onDestroy(() => { shortcutStore.unregisterPageShortcuts(); if (pulseInterval) clearInterval(pulseInterval); });

  $effect(() => {
    void range;
    void startDate;
    void endDate;
    if (initialized) loadData();
  });

  let totalMs = $derived(listeningData.reduce((s, d) => s + d.total_ms, 0));
  let totalPlays = $derived(listeningData.reduce((s, d) => s + d.play_count, 0));
  let dayCount = $derived.by(() => {
    if (listeningData.length === 0) return 1;
    const first = listeningData[0].period;
    const last = listeningData[listeningData.length - 1].period;
    const gran = granularityForRange(range);
    if (gran === 'day') return listeningData.length;
    // para week/month, calcular días reales entre primer y último periodo
    const start = new Date(first + (first.length <= 7 ? '-01' : ''));
    const end = new Date(last + (last.length <= 7 ? '-01' : ''));
    const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + (gran === 'month' ? 30 : 7));
    return days;
  });
  let avgDailyMs = $derived(listeningData.length > 0 ? totalMs / dayCount : 0);
  let maxHeatmapValue = $derived(Math.max(...heatmap.map(h => h.play_count), 1));
  const weekStartOffset: Record<string, number> = { sunday: 0, monday: 1, friday: 5 };
  let wsOffset = $derived(weekStartOffset[getWeekStart()] ?? 1);
  let allDayNames = $derived(getLocalizedDayNames());
  let dayNames = $derived([...allDayNames.slice(wsOffset), ...allDayNames.slice(0, wsOffset)]);
  let monthNames = $derived(getLocalizedMonthNames());

  let hourDistribution = $derived(
    Array.from({ length: 24 }, (_, h) =>
      heatmap.filter(item => item.hour === h).reduce((sum, item) => sum + item.play_count, 0)
    )
  );
  let dayDistribution = $derived(
    Array.from({ length: 7 }, (_, i) => {
      const dow = (i + wsOffset) % 7;
      return heatmap.filter(item => item.day_of_week === dow).reduce((sum, item) => sum + item.play_count, 0);
    })
  );
  let monthDistribution = $derived(
    Array.from({ length: 12 }, (_, i) => monthlyDist.find(m => m.month === i + 1)?.play_count ?? 0)
  );

  const periodLabel = (data: typeof listeningData) => ({
    rotate: data.length > 14 ? 45 : 0,
    formatter: (v: string) => v.length > 5 ? v.slice(5) : v,
  });

  let yearlyData = $derived.by(() => {
    const byYear = new Map<string, number>();
    for (const d of listeningData) {
      const year = d.period.slice(0, 4);
      byYear.set(year, (byYear.get(year) ?? 0) + d.total_ms);
    }
    return [...byYear.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  });

  let playsRegression = $derived(linearRegression(listeningData.map(d => d.play_count)));
  let timeRegression = $derived(linearRegression(listeningData.map(d => d.total_ms)));
  let yearlyRegression = $derived(linearRegression(yearlyData.map(d => d[1])));
  let discoveryRegression = $derived(linearRegression(discovery.map(d => d.distinct_count)));

  let currentYearIdx = $derived(yearlyData.findIndex(d => d[0] === String(new Date().getFullYear())));
  let currentHour = new Date().getHours();
  // derived: wsOffset cambia con la preferencia de inicio de semana y heatmapMapped
  // se remapea con ella, así que el índice del día actual debe seguirla
  let currentDayIdx = $derived((new Date().getDay() - wsOffset + 7) % 7);
  let currentMonth = new Date().getMonth();
  let heatmapMapped = $derived(heatmap.map(h => [h.hour, (h.day_of_week - wsOffset + 7) % 7, h.play_count]));
  let currentHeatmapIdx = $derived(heatmapMapped.findIndex(d => d[0] === currentHour && d[1] === currentDayIdx));

  const PULSE_ANIM = { animationDurationUpdate: 800, animationEasingUpdate: 'cubicInOut' as const };

  let lineChartOption = $derived<EChartsOption>({
    ...PULSE_ANIM,
    grid: { ...GRID },
    tooltip: { ...TOOLTIP_BASE, formatter: (params: TooltipParams) => { const p = tooltipPoint(params); return `${p.axisValue}<br/>Plays: <b>${p.value}</b>`; } },
    xAxis: categoryAxis(listeningData.map(d => d.period), { axisLabel: { ...AXIS_LABEL, ...periodLabel(listeningData) } }),
    yAxis: valueAxis(),
    series: [lineSeries(pulseData(listeningData.map(d => d.play_count), listeningData.length - 1), { areaStyle: areaGradient() }), trendSeries(playsRegression.line)],
  });

  let barChartOption = $derived<EChartsOption>({
    ...PULSE_ANIM,
    grid: { ...GRID },
    tooltip: { ...TOOLTIP_BASE, formatter: (params: TooltipParams) => { const p = tooltipPoint(params); return `${p.axisValue}<br/>Listening: <b>${(p.value / 3_600_000).toFixed(1)}h</b>`; } },
    xAxis: categoryAxis(listeningData.map(d => d.period), { axisLabel: { ...AXIS_LABEL, ...periodLabel(listeningData) } }),
    yAxis: valueAxis({ axisLabel: { ...AXIS_LABEL, formatter: (v: number) => `${(v / 3_600_000).toFixed(0)}h` } }),
    series: [barSeries(pulseData(listeningData.map(d => d.total_ms), listeningData.length - 1)), trendSeries(timeRegression.line)],
  });

  let yearlyChartOption = $derived<EChartsOption>({
    ...PULSE_ANIM,
    grid: { ...GRID },
    tooltip: { ...TOOLTIP_BASE, formatter: (params: TooltipParams) => { const p = tooltipPoint(params); return `${p.axisValue}<br/>Listening: <b>${(p.value / 3_600_000).toFixed(1)}h</b>`; } },
    xAxis: categoryAxis(yearlyData.map(d => d[0]), { axisLabel: { ...AXIS_LABEL } }),
    yAxis: valueAxis({ axisLabel: { ...AXIS_LABEL, formatter: (v: number) => `${(v / 3_600_000).toFixed(0)}h` } }),
    series: [barSeries(pulseData(yearlyData.map(d => d[1]), currentYearIdx)), trendSeries(yearlyRegression.line)],
  });

  let heatmapOption = $derived<EChartsOption>({
    ...PULSE_ANIM,
    tooltip: { ...TOOLTIP_BASE, trigger: 'item', formatter: (params: TooltipParams) => { const p = tooltipTuplePoint(params); const [hour, day] = p.value; return `${dayNames[day]} ${hour}:00<br/>Plays: <b>${p.value[2]}</b>`; } },
    grid: { ...GRID },
    xAxis: { type: 'category', data: Array.from({ length: 24 }, (_, i) => `${i}`), splitArea: { show: true }, axisLabel: { ...AXIS_LABEL }, axisLine: { ...AXIS_LINE } },
    yAxis: { type: 'category', data: dayNames, inverse: true, splitArea: { show: true }, axisLabel: { ...AXIS_LABEL }, axisLine: { ...AXIS_LINE } },
    visualMap: { min: 0, max: maxHeatmapValue, show: false, inRange: { color: ['#0f1214', '#0d3320', '#1a6b3f', '#1db954'] } },
    series: [{ type: 'heatmap', data: pulseHeatmapData(heatmapMapped, currentHeatmapIdx) as any, itemStyle: { borderRadius: 1 } }],
  });

  const polarBase = {
    polar: { radius: ['12%', '75%'] },
    radiusAxis: { axisLabel: { show: false }, axisLine: { show: false }, splitLine: { lineStyle: { color: '#1e2a2a' } } },
    tooltip: { ...TOOLTIP_BASE, trigger: 'item' as const, formatter: (params: TooltipParams) => { const p = tooltipPoint(params); return `${p.name}<br/>Plays: <b>${p.value}</b>`; } },
  };
  const polarAngle = (data: string[], n: number, overrides?: Record<string, any>) => ({
    type: 'category' as const, data, startAngle: 90 + 180 / n, axisLabel: { ...AXIS_LABEL }, axisLine: { ...AXIS_LINE }, ...overrides,
  });
  const polarSeries = (data: number[], currentIdx: number) => [{ type: 'bar' as const, coordinateSystem: 'polar' as const, data: pulseData(data, currentIdx) as any, itemStyle: { color: GREEN, borderRadius: 2 } }];

  let hourPolarOption = $derived<EChartsOption>({
    ...PULSE_ANIM, ...polarBase,
    angleAxis: polarAngle(Array.from({ length: 24 }, (_, i) => `${i}:00`), 24, { axisLabel: { ...AXIS_LABEL, fontSize: 10 } }),
    series: polarSeries(hourDistribution, currentHour),
  });

  let dayPolarOption = $derived<EChartsOption>({
    ...PULSE_ANIM, ...polarBase,
    angleAxis: polarAngle(dayNames, 7),
    series: polarSeries(dayDistribution, currentDayIdx),
  });

  let monthPolarOption = $derived<EChartsOption>({
    ...PULSE_ANIM, ...polarBase,
    angleAxis: polarAngle(monthNames, 12),
    series: polarSeries(monthDistribution, currentMonth),
  });

  const entityLabels = { track: 'Tracks', album: 'Albums', artist: 'Artists' } as const;
  const entityColors = { track: '#1db954', album: '#3498db', artist: '#e74c3c' } as const;

  let discoveryOption = $derived<EChartsOption>({
    ...PULSE_ANIM,
    grid: dualAxisGrid(),
    tooltip: {
      ...TOOLTIP_BASE,
      formatter: (params: TooltipParams) => {
        const ps = tooltipPoints(params);
        let s = ps[0].axisValue;
        for (const p of ps) s += `<br/>${p.seriesName}: <b>${p.value}</b>`;
        return s;
      },
    },
    xAxis: categoryAxis(discovery.map(d => d.period), { axisLabel: { ...AXIS_LABEL, ...periodLabel(discovery as any) } }),
    yAxis: [valueAxis(), secondaryValueAxis()],
    series: [
      barSeries(pulseData(discovery.map(d => d.distinct_count), discovery.length - 1), {
        name: 'Distinct', yAxisIndex: 0,
        itemStyle: { color: entityColors[discoveryEntity] + '99', borderRadius: [1, 1, 0, 0] },
      }),
      cumulativeLineSeries(discovery.map(d => d.cumulative), {
        name: 'Cumulative',
        lineStyle: { color: entityColors[discoveryEntity], width: 2 },
        itemStyle: { color: entityColors[discoveryEntity] },
      }),
      trendSeries(discoveryRegression.line, { yAxisIndex: 0 }),
    ],
  });

  let pieOption = $derived<EChartsOption>({
    tooltip: { ...PIE_TOOLTIP },
    series: [{
      type: 'pie', radius: ['40%', '70%'], avoidLabelOverlap: true,
      itemStyle: { borderRadius: 2, borderColor: '#0f1214', borderWidth: 2 },
      label: { ...AXIS_LABEL },
      data: genres.map((g, i) => ({ name: g.genre, value: g.play_count, itemStyle: { color: PIE_COLORS[i % PIE_COLORS.length] } })),
    }],
  });

</script>

<div class="page-header">
  <h1>Insights</h1>
  <p>Listening patterns and habits</p>
</div>

<TimeRangeSelector value={range} onchange={setRange} {startDate} {endDate} ondatechange={setCustomDates} />

{#if loading}
  <div class="stats-grid" style="margin-bottom: 1.5rem;">
    {#each ['Total listening', 'Total plays', 'Daily average', 'Current streak'] as label}
      <div class="card stat-card">
        <div class="stat-value"><span class="ghost-text ghost-stat"></span></div>
        <div class="stat-label">{label}</div>
      </div>
    {/each}
  </div>

  <div class="charts-row">
    <div class="card chart-half">
      <h3>Plays</h3>
      <div class="ghost-chart" style="height: 220px;"></div>
    </div>
    <div class="card chart-half">
      <h3>Genre distribution</h3>
      <div class="ghost-chart" style="height: 220px;"></div>
    </div>
  </div>

  <div class="charts-row">
    <div class="card chart-half">
      <h3>Listening time</h3>
      <div class="ghost-chart" style="height: 220px;"></div>
    </div>
    <div class="card chart-half">
      <h3>Listening time by year</h3>
      <div class="ghost-chart" style="height: 220px;"></div>
    </div>
  </div>

  <div class="card" style="margin-bottom: 1.5rem;">
    <div class="chart-header">
      <h3>Library growth</h3>
      <div class="entity-toggle ghost-text" style="width: 10rem; height: 1.5rem;"></div>
    </div>
    <div class="ghost-chart" style="height: 220px;"></div>
  </div>

  <div class="card" style="margin-bottom: 1.5rem;">
    <h3 style="margin-bottom: 0.5rem;">Listening heatmap</h3>
    <div class="ghost-chart" style="height: 220px;"></div>
  </div>

  <div class="charts-row charts-row--triple">
    {#each ['By hour', 'By day', 'By month'] as label}
      <div class="card chart-third">
        <h3>{label}</h3>
        <div class="ghost-chart" style="height: 280px;"></div>
      </div>
    {/each}
  </div>
{:else}
  <div class="stats-grid" style="margin-bottom: 1.5rem;">
    <button type="button" class="card stat-card stat-card--clickable" onclick={() => { listeningUnit = DURATION_UNITS[(DURATION_UNITS.indexOf(listeningUnit) + 1) % DURATION_UNITS.length]; }}>
      <div class="stat-value">{formatDurationAs(totalMs, listeningUnit)}</div>
      <div class="stat-label">Total listening</div>
    </button>
    <div class="card stat-card">
      <div class="stat-value">{totalPlays}</div>
      <div class="stat-label">Total plays</div>
    </div>
    <div class="card stat-card">
      <div class="stat-value">{formatHours(avgDailyMs)}</div>
      <div class="stat-label">Daily average</div>
    </div>
    {#if streaks}
      <div class="card stat-card">
        <div class="stat-value">{streaks.currentStreak}</div>
        <div class="stat-label">Current streak</div>
      </div>
    {/if}
  </div>

  {#if listeningData.length > 0 || genres.length > 0}
    <div class="charts-row">
      {#if listeningData.length > 0}
        <div class="card chart-half">
          <div class="chart-header"><h3>Plays</h3><span class="r2-badge">R² = {playsRegression.r2.toFixed(2)}</span></div>
          <BaseChart option={lineChartOption} height="220px" />
        </div>
      {/if}
      {#if genres.length > 0}
        <div class="card chart-half">
          <h3 style="margin-bottom: 0.5rem;">Genre distribution</h3>
          <BaseChart option={pieOption} height="220px" />
        </div>
      {/if}
    </div>
  {/if}

  {#if listeningData.length > 0}
    <div class="charts-row">
      <div class="card chart-half">
        <div class="chart-header"><h3>Listening time</h3><span class="r2-badge">R² = {timeRegression.r2.toFixed(2)}</span></div>
        <BaseChart option={barChartOption} height="220px" />
      </div>
      {#if yearlyData.length > 1}
        <div class="card chart-half">
          <div class="chart-header"><h3>Listening time by year</h3><span class="r2-badge">R² = {yearlyRegression.r2.toFixed(2)}</span></div>
          <BaseChart option={yearlyChartOption} height="220px" />
        </div>
      {/if}
    </div>
  {/if}

  <div class="card" style="margin-bottom: 1.5rem;">
    <div class="chart-header">
      <h3>Library growth {#if discovery.length > 1}<span class="r2-badge">R² = {discoveryRegression.r2.toFixed(2)}</span>{/if}</h3>
      <div class="entity-toggle">
        {#each (['track', 'album', 'artist'] as const) as type}
          <button
            class="toggle-btn"
            class:active={discoveryEntity === type}
            style:--btn-color={entityColors[type]}
            onclick={() => { discoveryEntity = type; loadDiscovery(); }}
          >{entityLabels[type]}</button>
        {/each}
      </div>
    </div>
    {#if discoveryLoading}
      <div class="ghost-chart" style="height: 220px;"></div>
    {:else if discovery.length > 0}
      <BaseChart option={discoveryOption} height="220px" />
    {/if}
  </div>

  {#if heatmap.length > 0}
    <div class="card" style="margin-bottom: 1.5rem;">
      <h3 style="margin-bottom: 0.5rem;">Listening heatmap</h3>
      <BaseChart option={heatmapOption} height="220px" />
    </div>
  {/if}

  {#if heatmap.length > 0 || monthlyDist.length > 0}
    <div class="charts-row charts-row--triple">
      <div class="card chart-third">
        <h3>By hour</h3>
        <BaseChart option={hourPolarOption} height="280px" />
      </div>
      <div class="card chart-third">
        <h3>By day</h3>
        <BaseChart option={dayPolarOption} height="280px" />
      </div>
      <div class="card chart-third">
        <h3>By month</h3>
        <BaseChart option={monthPolarOption} height="280px" />
      </div>
    </div>
  {/if}
{/if}

<style>
  .stat-card--clickable {
    cursor: pointer;
    user-select: none;
    /* es un <button>: reset para conservar el look de .card/.stat-card */
    font: inherit;
    color: inherit;
    width: 100%;
  }
  .charts-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
    margin-bottom: 1.5rem;
  }
  .chart-half h3, .chart-third h3 {
    margin-bottom: 0.5rem;
  }
  .charts-row--triple {
    grid-template-columns: 1fr 1fr 1fr;
  }
  .r2-badge {
    font-size: 0.7rem;
    font-weight: 400;
    color: var(--text-muted);
    margin-left: 0.4rem;
    vertical-align: middle;
  }
  .ghost-stat {
    width: 3.5rem;
    height: 1.4rem;
    vertical-align: middle;
  }
  .ghost-chart {
    border-radius: var(--radius);
    background: linear-gradient(90deg, #1e2a2a 25%, #253030 50%, #1e2a2a 75%);
    background-size: 200% 100%;
    animation: shimmer 1.5s ease-in-out infinite;
  }
  .chart-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.5rem;
    gap: 0.5rem;
  }
  .chart-header h3 {
    margin: 0;
  }
  .entity-toggle {
    display: flex;
    gap: 0.25rem;
    background: var(--bg-hover);
    border-radius: var(--radius);
    padding: 2px;
  }
  .toggle-btn {
    padding: 0.25rem 0.75rem;
    border: none;
    border-radius: var(--radius);
    background: transparent;
    color: var(--text-muted);
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    cursor: pointer;
    transition: all 0.05s;
  }
  .toggle-btn:hover {
    color: #ccc;
  }
  .toggle-btn.active {
    background: var(--btn-color);
    color: #fff;
  }
  @media (max-width: 768px) {
    .charts-row {
      grid-template-columns: 1fr;
    }
  }
</style>
