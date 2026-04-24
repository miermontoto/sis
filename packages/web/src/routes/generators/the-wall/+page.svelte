<script lang="ts">
  import { onMount } from 'svelte';
  import { api, createFetchController, getRankingMetric, type TopArtistItem, type DateRangeParams, type MeResponse, type RankingMetric } from '$lib/api';
  import TimeRangeSelector from '$lib/components/TimeRangeSelector.svelte';
  import { downloadCanvasPng } from '$lib/canvas-export';

  // presets de color: { bg, fg, name }
  const PRESETS = [
    { name: 'Clásico',   bg: '#0a0a0a', fg: '#e5e5e5' },
    { name: 'Amarillo',  bg: '#fff200', fg: '#ff1493' },
    { name: 'Rojo',      bg: '#c8102e', fg: '#000000' },
    { name: 'Verde',     bg: '#1db954', fg: '#000000' },
    { name: 'Violeta',   bg: '#2d1b69', fg: '#ffffff' },
    { name: 'Mier',      bg: '#ff6b35', fg: '#1a1a1a' },
  ] as const;

  const SEP = ' · ';
  const WIDTH = 1600;
  const HEIGHT = 2000;
  const MARGIN = 80;

  let range = $state('month');
  let startDate = $state('');
  let endDate = $state('');
  let preset = $state(0);
  let metric = $state<RankingMetric>('time');
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
      artists = await api.topArtists(range, 50, metric, getCustomDates(), signal);
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

  // busca el tamaño de fuente más grande que haga caber todos los nombres en la zona disponible
  function fitFontSize(ctx: CanvasRenderingContext2D, names: string[], maxWidth: number, maxHeight: number): { fontSize: number; lines: string[] } {
    let lo = 20, hi = 140;
    let best = { fontSize: lo, lines: [] as string[] };
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      ctx.font = `bold ${mid}px sans-serif`;
      const lineHeight = mid * 1.15;
      const lines = wrapLines(ctx, names, maxWidth);
      const totalHeight = lines.length * lineHeight;
      if (totalHeight <= maxHeight) {
        best = { fontSize: mid, lines };
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return best;
  }

  function wrapLines(ctx: CanvasRenderingContext2D, names: string[], maxWidth: number): string[] {
    const lines: string[] = [];
    let current = '';
    for (let i = 0; i < names.length; i++) {
      const candidate = current ? current + SEP + names[i] : names[i];
      if (ctx.measureText(candidate).width <= maxWidth) {
        current = candidate;
      } else {
        if (current) lines.push(current);
        current = names[i];
      }
    }
    if (current) lines.push(current);
    return lines;
  }

  async function renderWall(): Promise<HTMLCanvasElement | null> {
    if (artists.length === 0) return null;
    const { bg, fg } = PRESETS[preset];

    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    const names = artists.map(a => a.artist?.name ?? '').filter(Boolean);
    const footerHeight = 80;
    const available = {
      width: WIDTH - MARGIN * 2,
      height: HEIGHT - MARGIN * 2 - footerHeight,
    };

    const { fontSize, lines } = fitFontSize(ctx, names, available.width, available.height);
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.fillStyle = fg;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';

    const lineHeight = fontSize * 1.15;
    const startY = MARGIN + (available.height - lines.length * lineHeight) / 2;
    lines.forEach((line, i) => {
      ctx.fillText(line, MARGIN, startY + i * lineHeight);
    });

    // footer
    const uname = me?.displayName ?? me?.spotifyId ?? 'sis';
    ctx.font = '600 24px sans-serif';
    ctx.fillStyle = fg;
    ctx.globalAlpha = 0.7;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`top 50 artists · ${uname}`, MARGIN, HEIGHT - MARGIN - 40);
    ctx.textAlign = 'right';
    ctx.fillText(rangeLabel(), WIDTH - MARGIN, HEIGHT - MARGIN - 40);
    ctx.globalAlpha = 1;

    return canvas;
  }

  async function updatePreview() {
    rendering = true;
    try {
      const c = await renderWall();
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
    const c = await renderWall();
    if (!c) return;
    const stamp = new Date().toISOString().split('T')[0];
    await downloadCanvasPng(c, `the-wall-${stamp}.png`);
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
    void artists; void preset;
    if (!loading && artists.length > 0) updatePreview();
  });
</script>

<div class="page-header">
  <h1>The Wall</h1>
  <p>Typographic poster of your top 50 artists.</p>
</div>

<TimeRangeSelector value={range} onchange={setRange} {startDate} {endDate} ondatechange={setCustomDates} />

<div class="card controls">
  <div class="control-group">
    <span class="group-label">Color</span>
    <div class="chip-row">
      {#each PRESETS as p, i}
        <button
          class="swatch"
          class:active={preset === i}
          style="background: {p.bg}; color: {p.fg};"
          onclick={() => preset = i}
          title={p.name}
        >{p.name[0]}</button>
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
    gap: 0.4rem;
  }

  .swatch {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: 2px solid var(--border);
    cursor: pointer;
    font-weight: 700;
    font-family: var(--font);
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
