<script lang="ts">
  import { onMount } from 'svelte';
  import { api, createFetchController, getRankingMetric, type TopArtistItem, type DateRangeParams, type MeResponse, type RankingMetric } from '$lib/api';
  import TimeRangeSelector from '$lib/components/TimeRangeSelector.svelte';
  import { downloadCanvasPng } from '$lib/canvas-export';
  import { formatNumber } from '$lib/utils/format';

  const WIDTH = 1600;
  const HEIGHT = 1200;
  const MARGIN = 60;
  const PIE_CX = 630;
  const PIE_CY = 620;
  const PIE_R = 420;
  const LEGEND_X = 1100;
  const LEGEND_W = 440;
  const TOP_N = 10;
  const FETCH_N = 40;

  // paletas de colores para la tarta
  const PALETTES = [
    {
      name: 'Espectro',
      colors: ['#e63946', '#f3722c', '#f8961e', '#f9c74f', '#90be6d', '#43aa8b', '#577590', '#4361ee', '#7209b7', '#b5179e'],
      others: '#555',
    },
    {
      name: 'Pastel',
      colors: ['#ffadad', '#ffd6a5', '#fdffb6', '#caffbf', '#9bf6ff', '#a0c4ff', '#bdb2ff', '#ffc6ff', '#fffffc', '#e4c1f9'],
      others: '#888',
    },
    {
      name: 'Mono',
      colors: ['#1db954', '#199f48', '#16863c', '#137030', '#105a24', '#0d4418', '#0a2e0c', '#083318', '#0a4424', '#0e5631'],
      others: '#444',
    },
    {
      name: 'Vapor',
      colors: ['#ff006e', '#fb5607', '#ffbe0b', '#8338ec', '#3a86ff', '#06d6a0', '#118ab2', '#ef476f', '#ffd166', '#073b4c'],
      others: '#555',
    },
  ] as const;

  let range = $state('month');
  let startDate = $state('');
  let endDate = $state('');
  let metric = $state<RankingMetric>('time');
  let palette = $state(0);
  let artists = $state<TopArtistItem[]>([]);
  let loading = $state(true);
  let rendering = $state(false);
  let me = $state<MeResponse | null>(null);
  let previewCanvas = $state<HTMLCanvasElement | null>(null);
  const fetchCtrl = createFetchController();

  function getCustomDates(): DateRangeParams | undefined {
    if (range === 'custom' && startDate && endDate) return { startDate, endDate };
    return undefined;
  }

  async function loadData() {
    const signal = fetchCtrl.reset();
    loading = true;
    try {
      artists = await api.topArtists(range, FETCH_N, metric, getCustomDates(), signal);
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

  function rangeLabel(): string {
    const map: Record<string, string> = {
      week: 'last 7 days', month: 'last 30 days', '3months': 'last 3 months',
      '6months': 'last 6 months', year: 'last year', thisYear: 'this year', all: 'all time',
    };
    if (range === 'custom') return `${startDate} — ${endDate}`;
    return map[range] ?? range;
  }

  // valor por artista según métrica seleccionada
  function valueOf(a: TopArtistItem): number {
    return metric === 'plays' ? a.playCount : a.totalMs;
  }

  // etiqueta formateada para el valor (plays o horas/minutos)
  function valueLabel(v: number): string {
    if (metric === 'plays') return `${formatNumber(v)} plays`;
    const mins = Math.round(v / 60_000);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  async function renderPie(): Promise<HTMLCanvasElement | null> {
    if (artists.length === 0) return null;

    // agrupar en top N + resto
    const topSlice = artists.slice(0, TOP_N).filter(a => valueOf(a) > 0);
    const restValue = artists.slice(TOP_N).reduce((s, a) => s + valueOf(a), 0);
    const total = topSlice.reduce((s, a) => s + valueOf(a), 0) + restValue;
    if (total === 0) return null;

    const pal = PALETTES[palette];
    const slices = [
      ...topSlice.map((a, i) => ({
        label: a.artist?.name ?? 'unknown',
        value: valueOf(a),
        color: pal.colors[i % pal.colors.length],
      })),
      ...(restValue > 0 ? [{ label: 'Others', value: restValue, color: pal.others }] : []),
    ];

    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // fondo
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // título y subtítulo
    ctx.fillStyle = '#e5e5e5';
    ctx.font = 'bold 56px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('Top artists', MARGIN, MARGIN);
    ctx.fillStyle = '#888';
    ctx.font = '500 26px sans-serif';
    ctx.fillText(`${rangeLabel()} · by ${metric === 'plays' ? 'play count' : 'listening time'}`, MARGIN, MARGIN + 72);

    // dibujar tarta
    let angle = -Math.PI / 2; // empezar arriba
    for (const s of slices) {
      const delta = (s.value / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(PIE_CX, PIE_CY);
      ctx.arc(PIE_CX, PIE_CY, PIE_R, angle, angle + delta);
      ctx.closePath();
      ctx.fillStyle = s.color;
      ctx.fill();
      ctx.strokeStyle = '#0a0a0a';
      ctx.lineWidth = 3;
      ctx.stroke();

      // porcentaje dentro del sector si ≥ 4%
      const pct = s.value / total;
      if (pct >= 0.04) {
        const mid = angle + delta / 2;
        const lx = PIE_CX + Math.cos(mid) * PIE_R * 0.65;
        const ly = PIE_CY + Math.sin(mid) * PIE_R * 0.65;
        ctx.fillStyle = '#0a0a0a';
        ctx.font = 'bold 28px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${(pct * 100).toFixed(1)}%`, lx, ly);
      }

      angle += delta;
    }

    // leyenda
    const legendTop = MARGIN + 150;
    const legendGap = 52;
    const maxRows = Math.floor((HEIGHT - legendTop - MARGIN - 80) / legendGap);
    const visible = slices.slice(0, maxRows);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    visible.forEach((s, i) => {
      const y = legendTop + i * legendGap + legendGap / 2;
      // swatch
      ctx.fillStyle = s.color;
      ctx.fillRect(LEGEND_X, y - 14, 28, 28);
      // nombre (truncado)
      ctx.fillStyle = '#e5e5e5';
      ctx.font = '600 22px sans-serif';
      let name = s.label;
      const maxNameW = LEGEND_W - 40 - 120; // espacio reservado para el valor
      while (ctx.measureText(name).width > maxNameW && name.length > 1) name = name.slice(0, -1);
      if (name !== s.label) name = name.slice(0, -1) + '…';
      ctx.fillText(name, LEGEND_X + 44, y);
      // valor a la derecha
      ctx.fillStyle = '#888';
      ctx.font = '500 20px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(valueLabel(s.value), LEGEND_X + LEGEND_W, y);
      ctx.textAlign = 'left';
    });

    // footer
    const uname = me?.displayName ?? me?.spotifyId ?? 'sis';
    ctx.fillStyle = '#555';
    ctx.font = '500 20px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(uname, MARGIN, HEIGHT - MARGIN);
    ctx.textAlign = 'right';
    ctx.fillText('sis', WIDTH - MARGIN, HEIGHT - MARGIN);

    return canvas;
  }

  async function updatePreview() {
    rendering = true;
    try {
      const c = await renderPie();
      if (!c || !previewCanvas) return;
      previewCanvas.width = c.width;
      previewCanvas.height = c.height;
      const pctx = previewCanvas.getContext('2d');
      if (pctx) pctx.drawImage(c, 0, 0);
    } finally {
      rendering = false;
    }
  }

  async function download() {
    const c = await renderPie();
    if (!c) return;
    const stamp = new Date().toISOString().split('T')[0];
    await downloadCanvasPng(c, `pie-chart-${stamp}.png`);
  }

  onMount(async () => {
    metric = getRankingMetric();
    me = await api.me().catch(() => null);
  });

  $effect(() => {
    void range; void startDate; void endDate; void metric;
    loadData();
  });

  $effect(() => {
    void artists; void palette; void metric;
    if (!loading && artists.length > 0) updatePreview();
  });
</script>

<div class="page-header">
  <h1>Pie Chart</h1>
  <p>Distribution of your plays across top artists.</p>
</div>

<TimeRangeSelector value={range} onchange={setRange} {startDate} {endDate} ondatechange={setCustomDates} />

<div class="card controls">
  <div class="control-group">
    <span class="group-label">Metric</span>
    <div class="chip-row">
      <button class="chip" class:active={metric === 'time'} onclick={() => metric = 'time'}>Time</button>
      <button class="chip" class:active={metric === 'plays'} onclick={() => metric = 'plays'}>Plays</button>
    </div>
  </div>

  <div class="control-group">
    <span class="group-label">Palette</span>
    <div class="chip-row">
      {#each PALETTES as p, i}
        <button
          class="swatch"
          class:active={palette === i}
          style="background: {p.colors[0]};"
          onclick={() => palette = i}
          title={p.name}
          aria-label={p.name}
        ></button>
      {/each}
    </div>
  </div>

  <button class="download-btn" onclick={download} disabled={loading || rendering || artists.length === 0}>
    {rendering ? 'Generating...' : 'Download PNG'}
  </button>
</div>

{#if loading}
  <div class="loading"><div class="spinner"></div></div>
{:else if artists.length === 0}
  <div class="empty">No artists in the selected range.</div>
{:else}
  <div class="preview-wrap">
    <canvas bind:this={previewCanvas} class="preview"></canvas>
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

  .chip-row {
    display: flex;
    gap: 0.25rem;
  }

  .chip {
    padding: 0.3rem 0.7rem;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 0.85rem;
    font-family: var(--font);
    transition: all 0.15s;
  }

  .chip:hover { border-color: var(--text-muted); color: var(--text); }
  .chip.active { background: var(--accent); border-color: var(--accent); color: #000; }

  .swatch {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: 2px solid var(--border);
    cursor: pointer;
    transition: transform 0.15s, border-color 0.15s;
  }
  .swatch:hover { transform: scale(1.1); }
  .swatch.active { border-color: var(--accent); transform: scale(1.1); }

  .download-btn {
    margin-left: auto;
    padding: 0.5rem 1.2rem;
    border-radius: var(--radius);
    border: 1px solid var(--accent);
    background: var(--accent);
    color: #000;
    cursor: pointer;
    font-weight: 600;
    font-family: var(--font);
    transition: all 0.15s;
  }
  .download-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .download-btn:hover:not(:disabled) { background: var(--accent-hover); border-color: var(--accent-hover); }

  .preview-wrap {
    display: flex;
    justify-content: center;
    margin-top: 1rem;
  }

  .preview {
    max-width: 100%;
    height: auto;
    border-radius: var(--radius);
    border: 1px solid var(--border);
  }

  .empty {
    text-align: center;
    color: var(--text-muted);
    padding: 3rem;
  }
</style>
