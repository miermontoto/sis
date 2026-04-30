<script lang="ts">
  import { onMount } from 'svelte';
  import { api, createFetchController, getRankingMetric, type TopAlbumItem, type DateRangeParams, type MeResponse, type RankingMetric } from '$lib/api';
  import TimeRangeSelector from '$lib/components/TimeRangeSelector.svelte';
  import { downloadCanvasPng, tryLoadImage } from '$lib/canvas-export';
  import { formatNumber } from '$lib/utils/format';

  const GRID_SIZES = [3, 4, 5, 6] as const;
  const CELL_SIZE = 300; // px por cover en el canvas exportado

  let range = $state('month');
  let startDate = $state('');
  let endDate = $state('');
  let gridSize = $state<typeof GRID_SIZES[number]>(5);
  let metric = $state<RankingMetric>('time');
  let showTitles = $state(false);
  let includeBorders = $state(false);
  let showUsername = $state(true);
  let albums = $state<TopAlbumItem[]>([]);
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
      const count = gridSize * gridSize;
      albums = await api.topAlbums(range, count, metric, getCustomDates(), signal);
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

  // dibuja el quilt en un canvas offscreen y lo devuelve
  async function renderQuilt(): Promise<HTMLCanvasElement | null> {
    if (albums.length === 0) return null;

    const titleHeight = showTitles ? 50 : 0;
    const gap = includeBorders ? 4 : 0;
    const margin = includeBorders ? 4 : 0;
    const footerHeight = showUsername ? 60 : 0;

    const width = gridSize * CELL_SIZE + (gridSize - 1) * gap + margin * 2;
    const cellWithTitle = CELL_SIZE + titleHeight;
    const height = gridSize * cellWithTitle + (gridSize - 1) * gap + margin * 2 + footerHeight;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.fillStyle = '#080a0c';
    ctx.fillRect(0, 0, width, height);

    // cargar covers en paralelo (null si falla)
    const covers = await Promise.all(
      albums.slice(0, gridSize * gridSize).map((a) => tryLoadImage(a.album?.imageUrl ?? null))
    );

    for (let row = 0; row < gridSize; row++) {
      for (let col = 0; col < gridSize; col++) {
        const idx = row * gridSize + col;
        const album = albums[idx];
        if (!album) continue;

        const x = margin + col * (CELL_SIZE + gap);
        const y = margin + row * (cellWithTitle + gap);
        const img = covers[idx];

        if (img) {
          ctx.drawImage(img, x, y, CELL_SIZE, CELL_SIZE);
        } else {
          // placeholder con primera letra del álbum
          ctx.fillStyle = '#161a1d';
          ctx.fillRect(x, y, CELL_SIZE, CELL_SIZE);
          ctx.fillStyle = '#444';
          ctx.font = 'bold 120px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const letter = (album.album?.name ?? '?').charAt(0).toUpperCase();
          ctx.fillText(letter, x + CELL_SIZE / 2, y + CELL_SIZE / 2);
        }

        if (showTitles) {
          ctx.fillStyle = '#e0e8e8';
          ctx.font = '600 18px sans-serif';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          const name = album.album?.name ?? '';
          // truncar si es demasiado largo
          const maxW = CELL_SIZE - 10;
          let txt = name;
          while (ctx.measureText(txt).width > maxW && txt.length > 1) {
            txt = txt.slice(0, -1);
          }
          if (txt !== name) txt = txt.slice(0, -1) + '…';
          ctx.fillText(txt, x + 4, y + CELL_SIZE + 6);
          ctx.fillStyle = '#6a7a7a';
          ctx.font = '14px sans-serif';
          const subtitle = metric === 'plays'
            ? `${formatNumber(album.playCount)} plays`
            : (() => {
                const mins = Math.round(album.totalMs / 60_000);
                const h = Math.floor(mins / 60);
                const m = mins % 60;
                return h > 0 ? `${h}h ${m}m` : `${m}m`;
              })();
          ctx.fillText(subtitle, x + 4, y + CELL_SIZE + 28);
        }
      }
    }

    if (showUsername) {
      const footerY = height - footerHeight;
      ctx.fillStyle = '#6a7a7a';
      ctx.font = '600 20px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const uname = me?.displayName ?? me?.spotifyId ?? 'sis';
      ctx.fillText(`${uname} · ${rangeLabel()}`, margin, footerY + footerHeight / 2);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#555';
      ctx.fillText('sis', width - margin, footerY + footerHeight / 2);
    }

    return canvas;
  }

  // re-renderiza a preview
  async function updatePreview() {
    rendering = true;
    try {
      const c = await renderQuilt();
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
    const c = await renderQuilt();
    if (!c) return;
    const stamp = new Date().toISOString().split('T')[0];
    await downloadCanvasPng(c, `album-quilt-${gridSize}x${gridSize}-${stamp}.png`);
  }

  onMount(async () => {
    metric = getRankingMetric();
    me = await api.me().catch(() => null);
  });

  $effect(() => {
    // re-fetch cuando cambia el rango, grid size o métrica
    void range; void startDate; void endDate; void gridSize; void metric;
    loadData();
  });

  $effect(() => {
    // re-renderizar preview cuando cambian datos u opciones
    void albums; void gridSize; void showTitles; void includeBorders; void showUsername;
    if (!loading && albums.length > 0) updatePreview();
  });
</script>

<div class="page-header">
  <h1>Album Quilt</h1>
  <p>Grid of your most-listened album covers.</p>
</div>

<TimeRangeSelector value={range} onchange={setRange} {startDate} {endDate} ondatechange={setCustomDates} />

<div class="card controls">
  <div class="control-group">
    <span class="group-label">Size</span>
    <div class="chip-row">
      {#each GRID_SIZES as n}
        <button class="chip" class:active={gridSize === n} onclick={() => gridSize = n}>{n}×{n}</button>
      {/each}
    </div>
  </div>

  <div class="control-group">
    <label>
      <input type="checkbox" bind:checked={showTitles} />
      Show album names
    </label>
    <label>
      <input type="checkbox" bind:checked={includeBorders} />
      Include borders
    </label>
    <label>
      <input type="checkbox" bind:checked={showUsername} />
      Username tag
    </label>
  </div>

  <button class="download-btn" onclick={download} disabled={loading || rendering || albums.length === 0}>
    {rendering ? 'Generating...' : 'Download PNG'}
  </button>
</div>

{#if loading}
  <div class="loading"><div class="spinner"></div></div>
{:else if albums.length === 0}
  <div class="empty">No albums in the selected range.</div>
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

  .control-group label {
    color: var(--text-muted);
    font-size: 0.85rem;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    cursor: pointer;
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
    transition: all 0.05s;
  }

  .chip:hover {
    border-color: var(--text-muted);
    color: var(--text);
  }

  .chip.active {
    background: var(--accent);
    border-color: var(--accent);
    color: #000;
  }

  .download-btn {
    margin-left: auto;
    padding: 0.5rem 1.2rem;
    border-radius: var(--radius);
    border: 1px solid var(--accent);
    background: var(--accent);
    color: #000;
    cursor: pointer;
    font-weight: 600;
    transition: all 0.05s;
  }

  .download-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .download-btn:hover:not(:disabled) {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
  }

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
