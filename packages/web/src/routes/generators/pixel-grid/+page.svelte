<script lang="ts">
  import { onMount } from 'svelte';
  import { api, createFetchController, type ListeningTimeItem, type DateRangeParams, type MeResponse } from '$lib/api';
  import TimeRangeSelector from '$lib/components/TimeRangeSelector.svelte';
  import { downloadCanvasPng } from '$lib/canvas-export';

  // presets: bg + 5 escalones de intensidad (0=empty, 4=max)
  const PRESETS = [
    { name: 'Rosa',    bg: '#000000', empty: '#1a1a1a', scale: ['#2d1b3d', '#5c2a5c', '#9b3a8f', '#d84ba8', '#ff1493'] },
    { name: 'Verde',   bg: '#000000', empty: '#1a1a1a', scale: ['#0e3f1f', '#186e2e', '#22a63f', '#1db954', '#7df097'] },
    { name: 'Naranja', bg: '#000000', empty: '#1a1a1a', scale: ['#3d1a05', '#6e2f0e', '#a14b16', '#d96d1e', '#ff8c42'] },
    { name: 'Azul',    bg: '#000000', empty: '#1a1a1a', scale: ['#0a2340', '#13406e', '#2166a6', '#3b9bd9', '#6fd0ff'] },
    { name: 'Violeta', bg: '#000000', empty: '#1a1a1a', scale: ['#1a0a3d', '#2d156e', '#4a28a1', '#6e44d9', '#a88bff'] },
    { name: 'Claro',   bg: '#f5f5f5', empty: '#e5e5e5', scale: ['#c9dfd3', '#9ac4a7', '#6aa87a', '#3f8c53', '#1db954'] },
  ] as const;

  // layout: cuadrícula casi-cuadrada en orden cronológico (fila por fila)
  const SLOT = 20;          // pitch por celda
  const INNER_MAX = 16;     // lado máximo del cuadrado interior
  const INNER_MIN = 3;      // lado mínimo visible (incluso días con 0)
  const ASPECT = 1.3;       // cols/rows → ligeramente más ancho que alto
  const MARGIN = 36;
  const FOOTER_H = 40;

  let range = $state('all');
  let startDate = $state('');
  let endDate = $state('');
  let preset = $state(0);
  let daily = $state<ListeningTimeItem[]>([]);
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
      daily = await api.listeningTime(range, 'day', getCustomDates(), signal);
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
      const s = new Date(now); s.setFullYear(s.getFullYear() - 1);
      startDate = s.toISOString().split('T')[0];
    }
  }

  function setCustomDates(s: string, e: string) { startDate = s; endDate = e; }

  function dateAddDays(d: Date, n: number): Date {
    const r = new Date(d);
    r.setUTCDate(r.getUTCDate() + n);
    return r;
  }

  function toYMD(d: Date): string {
    return d.toISOString().split('T')[0];
  }

  // enumera todos los días desde el primero con actividad hasta el último
  function buildSequence(items: ListeningTimeItem[]) {
    if (items.length === 0) return null;
    const byDay = new Map<string, number>();
    items.forEach(i => byDay.set(i.period, i.total_ms));

    const sorted = [...items].sort((a, b) => a.period.localeCompare(b.period));
    const firstDay = new Date(sorted[0].period + 'T00:00:00Z');
    const lastDay = new Date(sorted[sorted.length - 1].period + 'T00:00:00Z');

    const days: number[] = [];
    let day = firstDay;
    while (day <= lastDay) {
      days.push(byDay.get(toYMD(day)) ?? 0);
      day = dateAddDays(day, 1);
    }

    const maxVal = Math.max(1, ...items.map(i => i.total_ms));
    return { days, maxVal };
  }

  function intensityBucket(value: number, max: number): number {
    if (value <= 0) return -1;
    const ratio = value / max;
    if (ratio < 0.2) return 0;
    if (ratio < 0.4) return 1;
    if (ratio < 0.6) return 2;
    if (ratio < 0.85) return 3;
    return 4;
  }

  async function renderGrid(): Promise<HTMLCanvasElement | null> {
    const built = buildSequence(daily);
    if (!built) return null;
    const { days, maxVal } = built;
    const p = PRESETS[preset];

    // cuadrícula aproximadamente cuadrada, ligeramente más ancha que alta
    const cols = Math.max(1, Math.ceil(Math.sqrt(days.length * ASPECT)));
    const rows = Math.max(1, Math.ceil(days.length / cols));

    const width = MARGIN * 2 + cols * SLOT;
    const height = MARGIN * 2 + rows * SLOT + FOOTER_H;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.fillStyle = p.bg;
    ctx.fillRect(0, 0, width, height);

    for (let i = 0; i < days.length; i++) {
      const row = Math.floor(i / cols);
      const col = i % cols;
      const slotCx = MARGIN + col * SLOT + SLOT / 2;
      const slotCy = MARGIN + row * SLOT + SLOT / 2;

      const value = days[i];
      const bucket = intensityBucket(value, maxVal);
      // tamaño escala con raíz cuarta para suavizar picos y mantener días bajos visibles
      const ratio = value > 0 ? Math.pow(value / maxVal, 0.35) : 0;
      const inner = value > 0
        ? INNER_MIN + ratio * (INNER_MAX - INNER_MIN)
        : INNER_MIN;

      ctx.fillStyle = bucket === -1 ? p.empty : p.scale[bucket];
      ctx.fillRect(slotCx - inner / 2, slotCy - inner / 2, inner, inner);
    }

    // footer
    const uname = me?.displayName ?? me?.spotifyId ?? 'sis';
    const activeDays = daily.length;
    ctx.font = '600 14px sans-serif';
    ctx.fillStyle = p.bg === '#f5f5f5' ? '#444' : '#888';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(`${activeDays} active days · ${uname}`, MARGIN, height - FOOTER_H / 2);
    ctx.textAlign = 'right';
    ctx.fillText('sis pixel grid', width - MARGIN, height - FOOTER_H / 2);

    return canvas;
  }

  async function updatePreview() {
    rendering = true;
    try {
      const c = await renderGrid();
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
    const c = await renderGrid();
    if (!c) return;
    const stamp = new Date().toISOString().split('T')[0];
    await downloadCanvasPng(c, `pixel-grid-${stamp}.png`);
  }

  onMount(async () => {
    me = await api.me().catch(() => null);
  });

  $effect(() => {
    void range; void startDate; void endDate;
    loadData();
  });

  $effect(() => {
    void daily; void preset;
    if (!loading && daily.length > 0) updatePreview();
  });
</script>

<div class="page-header">
  <h1>Pixel Grid</h1>
  <p>Every day you've listened, arranged chronologically. Cell size encodes activity.</p>
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
          style="background: linear-gradient(135deg, {p.scale[0]}, {p.scale[4]});"
          onclick={() => preset = i}
          title={p.name}
        ></button>
      {/each}
    </div>
  </div>

  <button class="download-btn" onclick={download} disabled={loading || rendering || daily.length === 0}>
    {rendering ? 'Generating...' : 'Download PNG'}
  </button>
</div>

{#if loading}
  <div class="loading"><div class="spinner"></div></div>
{:else if daily.length === 0}
  <div class="empty">No listening data.</div>
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

  .chip-row { display: flex; gap: 0.4rem; }

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
    margin-top: 1rem;
    display: flex;
    justify-content: center;
    background: var(--bg-card);
    border-radius: var(--radius);
    border: 1px solid var(--border);
    padding: 0.5rem;
  }

  .preview {
    max-width: 100%;
    height: auto;
    display: block;
    image-rendering: pixelated;
  }

  .empty {
    text-align: center;
    color: var(--text-muted);
    padding: 3rem;
  }
</style>
