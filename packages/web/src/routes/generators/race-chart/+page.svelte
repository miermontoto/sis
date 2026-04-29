<script lang="ts">
  import { onMount } from 'svelte';
  import { api, createFetchController, getRankingMetric, getWeekStart, type TopTrackItem, type TopArtistItem, type TopAlbumItem, type RankingMetric } from '$lib/api';
  import BaseChart from '$lib/components/charts/BaseChart.svelte';
  import { GRID, AXIS_LINE, AXIS_LABEL, SPLIT_LINE } from '$lib/utils/chart';
  import { formatNumber } from '$lib/utils/format';
  import type { EChartsOption } from 'echarts';
  import type * as echarts from 'echarts/core';

  const PALETTE = [
    '#1db954', '#ff1493', '#ff8c42', '#3b9bd9', '#a88bff',
    '#ffd166', '#ef476f', '#06d6a0', '#e0e8e8', '#f95738',
    '#00b4d8', '#e63946', '#2a9d8f', '#f4a261', '#6a4c93',
    '#c77dff', '#80ed99', '#ff758f', '#48bfe3', '#fca311',
  ];

  const TOP_PER_MONTH = 20;

  type EntityTab = 'tracks' | 'artists' | 'albums';
  type MonthBucket = { key: string; label: string; startDate: string; endDate: string };
  type FrameEntry = { id: string; name: string; value: number; color: string };
  type Frame = { label: string; entries: FrameEntry[] };

  let entityTab = $state<EntityTab>('artists');
  let metric = $state<RankingMetric>('time');
  let topN = $state(10);
  let speed = $state(1200);

  let loading = $state(true);
  let frames = $state<Frame[]>([]);
  let currentFrame = $state(0);
  let playing = $state(false);
  let chartInstance = $state<echarts.ECharts | null>(null);
  let timer: ReturnType<typeof setInterval> | null = null;

  const fetchCtrl = createFetchController();

  function monthBucket(year: number, monthIdx: number): MonthBucket {
    const start = new Date(Date.UTC(year, monthIdx, 1));
    const end = new Date(Date.UTC(year, monthIdx + 1, 0));
    return {
      key: `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}`,
      label: start.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
      startDate: start.toISOString().slice(0, 10),
      endDate: end.toISOString().slice(0, 10),
    };
  }

  async function buildMonths(signal?: AbortSignal): Promise<MonthBucket[]> {
    const { periods } = await api.chartPeriods('month', getWeekStart(), signal);
    if (!periods.length) return [];
    const sorted = [...periods].sort();
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const [fy, fm] = first.split('-').map(Number);
    const [ly, lm] = last.split('-').map(Number);
    const out: MonthBucket[] = [];
    for (let y = fy, mo = fm - 1; y < ly || (y === ly && mo <= lm - 1); mo++) {
      if (mo > 11) { mo = 0; y++; }
      out.push(monthBucket(y, mo));
    }
    return out;
  }

  function extractEntity(item: TopTrackItem | TopArtistItem | TopAlbumItem, tab: EntityTab): { id: string; name: string } | null {
    if (tab === 'tracks') {
      const t = item as TopTrackItem;
      return t.track ? { id: t.trackId, name: t.track.name } : null;
    }
    if (tab === 'artists') {
      const a = item as TopArtistItem;
      return a.artist ? { id: a.artistId, name: a.artist.name } : null;
    }
    const al = item as TopAlbumItem;
    return al.album ? { id: al.albumId, name: al.album.name } : null;
  }

  function metricValue(item: TopTrackItem | TopArtistItem | TopAlbumItem): number {
    return metric === 'plays' ? item.playCount : item.totalMs;
  }

  async function loadData() {
    stop();
    const signal = fetchCtrl.reset();
    loading = true;
    frames = [];
    currentFrame = 0;

    try {
      const months = await buildMonths(signal);
      if (signal.aborted) return;
      const fetcher = entityTab === 'tracks' ? api.topTracks
        : entityTab === 'artists' ? api.topArtists
        : api.topAlbums;

      const perMonth = await Promise.all(
        months.map(m =>
          fetcher('custom', TOP_PER_MONTH, metric, { startDate: m.startDate, endDate: m.endDate }, undefined, signal)
            .catch(() => [])
        )
      );
      if (signal.aborted) return;

      const cumulative = new Map<string, { name: string; total: number }>();
      const colorMap = new Map<string, string>();
      let colorIdx = 0;
      const builtFrames: Frame[] = [];

      for (let mIdx = 0; mIdx < months.length; mIdx++) {
        const items = perMonth[mIdx];
        for (const item of items) {
          const entity = extractEntity(item as any, entityTab);
          if (!entity) continue;
          const val = metricValue(item as any);
          const prev = cumulative.get(entity.id);
          cumulative.set(entity.id, { name: entity.name, total: (prev?.total ?? 0) + val });
          if (!colorMap.has(entity.id)) {
            colorMap.set(entity.id, PALETTE[colorIdx % PALETTE.length]);
            colorIdx++;
          }
        }

        const sorted = [...cumulative.entries()]
          .map(([id, d]) => ({ id, name: d.name, value: d.total, color: colorMap.get(id)! }))
          .sort((a, b) => b.value - a.value)
          .slice(0, topN);

        builtFrames.push({ label: months[mIdx].label, entries: sorted });
      }

      frames = builtFrames;
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      throw e;
    } finally {
      if (!signal.aborted) loading = false;
    }
  }

  function formatMetricValue(v: number): string {
    if (metric === 'plays') return formatNumber(v);
    const hours = Math.floor(v / 3_600_000);
    const mins = Math.round((v % 3_600_000) / 60_000);
    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  }

  function buildOption(frame: Frame): EChartsOption {
    const names = frame.entries.map(e => e.name);
    const values = frame.entries.map(e => e.value);
    const colors = frame.entries.map(e => e.color);

    return {
      grid: { ...GRID, left: 10, right: 80, top: 10, bottom: 30, containLabel: true },
      xAxis: {
        type: 'value',
        max: 'dataMax',
        axisLine: { ...AXIS_LINE },
        axisLabel: {
          ...AXIS_LABEL,
          formatter: (v: number) => formatMetricValue(v),
        },
        splitLine: { ...SPLIT_LINE },
      },
      yAxis: {
        type: 'category',
        data: names,
        inverse: true,
        animationDuration: 300,
        animationDurationUpdate: 300,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          ...AXIS_LABEL,
          fontSize: 12,
          width: 140,
          overflow: 'truncate',
        },
      },
      series: [{
        type: 'bar',
        data: values.map((v, i) => ({ value: v, itemStyle: { color: colors[i] } })),
        barMaxWidth: 32,
        barMinWidth: 12,
        label: {
          show: true,
          position: 'right',
          formatter: (p: any) => formatMetricValue(p.value),
          color: '#6a7a7a',
          fontSize: 11,
        },
        itemStyle: { borderRadius: [0, 2, 2, 0] },
      }],
      graphic: [{
        type: 'text',
        right: 60,
        bottom: 40,
        style: {
          text: frame.label,
          font: 'bold 28px ui-monospace, SF Mono, Menlo, Consolas, monospace',
          fill: 'rgba(255,255,255,0.12)',
        },
        z: 100,
      }],
      animationDuration: 0,
      animationDurationUpdate: speed * 0.8,
      animationEasing: 'linear',
      animationEasingUpdate: 'linear',
    };
  }

  function applyFrame(idx: number) {
    if (idx < 0 || idx >= frames.length) return;
    currentFrame = idx;
    if (chartInstance) {
      chartInstance.setOption(buildOption(frames[idx]));
    }
  }

  function play() {
    if (frames.length === 0) return;
    if (currentFrame >= frames.length - 1) currentFrame = 0;
    playing = true;
    applyFrame(currentFrame);
    timer = setInterval(() => {
      if (currentFrame >= frames.length - 1) {
        stop();
        return;
      }
      applyFrame(currentFrame + 1);
    }, speed);
  }

  function stop() {
    playing = false;
    if (timer) { clearInterval(timer); timer = null; }
  }

  function restart() {
    stop();
    applyFrame(0);
  }

  function togglePlay() {
    if (playing) stop(); else play();
  }

  const initialOption = $derived(frames.length > 0 ? buildOption(frames[0]) : ({} as EChartsOption));

  $effect(() => {
    entityTab; metric; topN;
    loadData();
  });

  $effect(() => {
    // al cambiar speed, reiniciar timer si está en play
    if (playing) {
      if (timer) clearInterval(timer);
      timer = setInterval(() => {
        if (currentFrame >= frames.length - 1) { stop(); return; }
        applyFrame(currentFrame + 1);
      }, speed);
    }
  });

  onMount(() => {
    metric = getRankingMetric();
    return () => { if (timer) clearInterval(timer); };
  });
</script>

<div class="page-header">
  <h1>Race Chart</h1>
  <p>Animated bar chart race showing cumulative plays over time.</p>
</div>

<div class="controls card">
  <div class="control-row">
    <div class="control-group">
      <span class="control-label">Type</span>
      <div class="toggle-group">
        <button class="toggle-btn" class:active={entityTab === 'artists'} onclick={() => entityTab = 'artists'}>Artists</button>
        <button class="toggle-btn" class:active={entityTab === 'tracks'} onclick={() => entityTab = 'tracks'}>Tracks</button>
        <button class="toggle-btn" class:active={entityTab === 'albums'} onclick={() => entityTab = 'albums'}>Albums</button>
      </div>
    </div>

    <div class="control-group">
      <span class="control-label">Metric</span>
      <div class="toggle-group">
        <button class="toggle-btn" class:active={metric === 'time'} onclick={() => metric = 'time'}>Time</button>
        <button class="toggle-btn" class:active={metric === 'plays'} onclick={() => metric = 'plays'}>Plays</button>
      </div>
    </div>

    <div class="control-group">
      <span class="control-label">Top {topN}</span>
      <input type="range" min="5" max="15" bind:value={topN} class="slider" />
    </div>

    <div class="control-group">
      <span class="control-label">Speed</span>
      <div class="toggle-group">
        <button class="toggle-btn" class:active={speed === 2000} onclick={() => speed = 2000}>0.5x</button>
        <button class="toggle-btn" class:active={speed === 1200} onclick={() => speed = 1200}>1x</button>
        <button class="toggle-btn" class:active={speed === 600} onclick={() => speed = 600}>2x</button>
      </div>
    </div>
  </div>
</div>

<div class="chart-area card">
  {#if loading}
    <div class="hint"><div class="spinner"></div></div>
  {:else if frames.length === 0}
    <div class="hint">No data available for this range.</div>
  {:else}
    <div class="playback-bar">
      <button class="play-btn" onclick={togglePlay}>{playing ? '⏸' : '▶'}</button>
      <button class="play-btn" onclick={restart}>⏮</button>
      <input
        type="range"
        min="0"
        max={frames.length - 1}
        value={currentFrame}
        oninput={(e) => { stop(); applyFrame(Number((e.target as HTMLInputElement).value)); }}
        class="progress-slider"
      />
      <span class="frame-label">{frames[currentFrame]?.label ?? ''}</span>
    </div>
    <BaseChart option={initialOption} height="{Math.max(400, topN * 42)}px" bind:instance={chartInstance} />
  {/if}
</div>

<style>
  .page-header p {
    color: var(--text-muted);
    margin: 0.25rem 0 0;
    font-size: 0.9rem;
  }

  .controls {
    margin-top: 1rem;
  }

  .control-row {
    display: flex;
    flex-wrap: wrap;
    gap: 1.25rem;
    align-items: flex-end;
  }

  .control-group {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .control-label {
    font-size: 0.75rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .toggle-group {
    display: flex;
    gap: 0.2rem;
  }

  .toggle-btn {
    padding: 0.3rem 0.65rem;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 0.8rem;
    transition: all 0.15s;
  }

  .toggle-btn:hover { border-color: var(--text-muted); color: var(--text); }
  .toggle-btn.active { background: var(--accent); border-color: var(--accent); color: #000; }

  .slider {
    width: 80px;
    accent-color: var(--accent);
  }

  .chart-area {
    margin-top: 1rem;
    padding: 1rem;
    min-height: 460px;
  }

  .playback-bar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
    padding-bottom: 0.75rem;
    border-bottom: 1px solid var(--border);
  }

  .play-btn {
    width: 32px;
    height: 32px;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text);
    cursor: pointer;
    font-size: 0.9rem;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s;
  }

  .play-btn:hover { border-color: var(--accent); color: var(--accent); }

  .progress-slider {
    flex: 1;
    accent-color: var(--accent);
  }

  .frame-label {
    font-size: 0.85rem;
    color: var(--text-muted);
    min-width: 80px;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .hint {
    text-align: center;
    color: var(--text-muted);
    padding: 4rem 1rem;
    font-size: 0.9rem;
    display: flex;
    justify-content: center;
    align-items: center;
  }
</style>
