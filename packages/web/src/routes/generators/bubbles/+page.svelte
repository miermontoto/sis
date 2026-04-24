<script lang="ts">
  import { onMount } from 'svelte';
  import { hierarchy, pack } from 'd3-hierarchy';
  import { api, createFetchController, getRankingMetric, type TopArtistItem, type DateRangeParams, type RankingMetric } from '$lib/api';
  import TimeRangeSelector from '$lib/components/TimeRangeSelector.svelte';
  import { formatNumber } from '$lib/utils/format';

  // paletas de colores; cada artista recibe uno por índice
  const PALETTES = [
    {
      name: 'Mix',
      colors: ['#1db954', '#ff1493', '#ff8c42', '#3b9bd9', '#a88bff', '#ffd166', '#ef476f', '#06d6a0', '#f95738', '#118ab2'],
    },
    {
      name: 'Warm',
      colors: ['#ff6b35', '#f95738', '#ffd166', '#ef476f', '#ff8c42', '#ffb4a2', '#e5989b', '#ff9505', '#fb5607', '#ffbe0b'],
    },
    {
      name: 'Cool',
      colors: ['#3b9bd9', '#06d6a0', '#a88bff', '#1db954', '#6fd0ff', '#118ab2', '#0ead69', '#14b8a6', '#5a189a', '#48cae4'],
    },
    {
      name: 'Accent',
      colors: ['#1db954', '#1ed760', '#7df097', '#0d703b', '#2bc872', '#50e3a0', '#148a41', '#8bed7d'],
    },
  ] as const;

  const W = 960;
  const H = 640;

  type Leaf = { id: string; name: string; value: number; color: string };

  let range = $state('month');
  let startDate = $state('');
  let endDate = $state('');
  let palette = $state(0);
  let metric = $state<RankingMetric>('time');
  let artists = $state<TopArtistItem[]>([]);
  let loading = $state(true);
  const fetchCtrl = createFetchController();

  function getCustomDates(): DateRangeParams | undefined {
    if (range === 'custom' && startDate && endDate) return { startDate, endDate };
    return undefined;
  }

  // cuando metric == 'time' el tamaño se basa en minutos; si 'plays', en reproducciones
  function bubbleValue(a: TopArtistItem): number {
    return metric === 'plays' ? a.playCount : a.totalMs / 60_000;
  }

  function formatTooltipValue(v: number): string {
    if (metric === 'plays') return `${formatNumber(Math.round(v))} plays`;
    const h = Math.floor(v / 60);
    const m = Math.round(v % 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  async function loadData() {
    const signal = fetchCtrl.reset();
    loading = true;
    try {
      artists = await api.topArtists(range, 40, metric, getCustomDates(), signal);
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      throw e;
    } finally {
      if (!signal.aborted) loading = false;
    }
  }

  function setRange(r: string) {
    range = r;
    if (r !== 'custom') { startDate = ''; endDate = ''; }
    else if (!startDate || !endDate) {
      const now = new Date();
      endDate = now.toISOString().split('T')[0];
      const s = new Date(now); s.setDate(s.getDate() - 30);
      startDate = s.toISOString().split('T')[0];
    }
  }

  function setCustomDates(s: string, e: string) { startDate = s; endDate = e; }

  // truncar nombre para que entre en un círculo de radio r
  function fitName(name: string, r: number): string {
    // aproximadamente 2 chars por cada 10px de radio (font-size ~12-14px)
    const maxChars = Math.max(3, Math.floor(r / 4));
    if (name.length <= maxChars) return name;
    return name.slice(0, maxChars - 1) + '…';
  }

  const packed = $derived.by(() => {
    if (artists.length === 0) return [] as Array<{ x: number; y: number; r: number; data: Leaf }>;
    const colors = PALETTES[palette].colors;
    const leaves: Leaf[] = artists
      .filter(a => a.artist)
      .map((a, i) => ({
        id: a.artistId,
        name: a.artist!.name,
        value: bubbleValue(a),
        color: colors[i % colors.length],
      }));

    const root = hierarchy<{ children?: Leaf[]; value?: number }>({ children: leaves } as any)
      .sum((d: any) => d.value ?? 0)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

    const layout = pack<any>().size([W, H]).padding(4);
    const computed = layout(root);
    return computed.leaves().map((n) => ({ x: n.x, y: n.y, r: n.r, data: n.data as Leaf }));
  });

  onMount(() => {
    metric = getRankingMetric();
  });

  $effect(() => {
    void range; void startDate; void endDate; void metric;
    loadData();
  });

  // tooltip interactivo
  let hovered = $state<Leaf | null>(null);
  let tipX = $state(0);
  let tipY = $state(0);

  function onEnter(leaf: Leaf) {
    hovered = leaf;
  }
  function onLeave() {
    hovered = null;
  }
  function onMove(e: MouseEvent) {
    tipX = e.clientX;
    tipY = e.clientY;
  }
</script>

<div class="page-header">
  <h1>Bubbles</h1>
  <p>Bubble chart of your most-listened artists.</p>
</div>

<TimeRangeSelector value={range} onchange={setRange} {startDate} {endDate} ondatechange={setCustomDates} />

<div class="card controls">
  <div class="control-group">
    <span class="group-label">Palette</span>
    <div class="chip-row">
      {#each PALETTES as p, i}
        <button
          class="palette-swatch"
          class:active={palette === i}
          onclick={() => palette = i}
          title={p.name}
        >
          {#each p.colors.slice(0, 4) as c}
            <span class="palette-dot" style="background: {c};"></span>
          {/each}
        </button>
      {/each}
    </div>
  </div>
</div>

{#if loading}
  <div class="loading"><div class="spinner"></div></div>
{:else if artists.length === 0}
  <div class="empty">No artists in the selected range.</div>
{:else}
  <div class="card chart-card">
    <svg class="bubbles-svg" viewBox="0 0 {W} {H}" preserveAspectRatio="xMidYMid meet" onmousemove={onMove}>
      {#each packed as node}
        {@const isHovered = hovered?.id === node.data.id}
        <a
          href="/artist/{node.data.id}"
          class="bubble-link"
          class:dim={hovered !== null && !isHovered}
          onmouseenter={() => onEnter(node.data)}
          onmouseleave={onLeave}
        >
          <g transform="translate({node.x}, {node.y})">
            <circle
              r={node.r}
              fill={node.data.color}
              stroke={isHovered ? '#fff' : '#000'}
              stroke-opacity={isHovered ? 0.9 : 0.35}
              stroke-width={isHovered ? 2 : 1}
            />
            {#if node.r > 18}
              <text
                text-anchor="middle"
                dominant-baseline="middle"
                fill="#000"
                font-weight="700"
                font-size={Math.min(16, Math.max(10, node.r / 3.5))}
                pointer-events="none"
              >{fitName(node.data.name, node.r)}</text>
            {/if}
          </g>
        </a>
      {/each}
    </svg>
  </div>
{/if}

{#if hovered}
  <div class="bubble-tooltip" style:left="{tipX + 14}px" style:top="{tipY + 14}px">
    <div class="tt-name">{hovered.name}</div>
    <div class="tt-value">{formatTooltipValue(hovered.value)}</div>
  </div>
{/if}

<style>
  .page-header p {
    color: var(--text-muted);
    margin: 0.25rem 0 0;
    font-size: 0.9rem;
  }

  .controls {
    display: flex;
    flex-wrap: wrap;
    gap: 1.5rem;
    align-items: center;
    margin-bottom: 1rem;
  }

  .control-group {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .group-label {
    color: var(--text-muted);
    font-size: 0.85rem;
  }

  .chip-row { display: flex; gap: 0.4rem; }

  .palette-swatch {
    display: inline-grid;
    grid-template-columns: 1fr 1fr;
    gap: 2px;
    width: 40px;
    height: 40px;
    padding: 3px;
    border-radius: var(--radius);
    border: 2px solid var(--border);
    background: var(--bg);
    cursor: pointer;
    transition: transform 0.15s, border-color 0.15s;
  }

  .palette-swatch:hover { transform: scale(1.08); }
  .palette-swatch.active { border-color: var(--accent); transform: scale(1.08); }

  .palette-dot {
    width: 100%;
    height: 100%;
    border-radius: 3px;
  }

  .chart-card {
    padding: 0.5rem;
  }

  .bubbles-svg {
    width: 100%;
    height: auto;
    display: block;
  }

  .bubble-link {
    cursor: pointer;
    transition: opacity 0.15s;
  }

  .bubble-link.dim {
    opacity: 0.35;
  }

  .bubble-tooltip {
    position: fixed;
    z-index: 100;
    pointer-events: none;
    background: #1a1a1a;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.5rem 0.75rem;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    font-size: 0.85rem;
    white-space: nowrap;
  }

  .tt-name {
    color: var(--text);
    font-weight: 600;
  }

  .tt-value {
    color: var(--text-muted);
    font-size: 0.8rem;
    margin-top: 2px;
  }

  .empty {
    text-align: center;
    color: var(--text-muted);
    padding: 3rem;
  }
</style>
