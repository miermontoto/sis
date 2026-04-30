<script lang="ts">
  import { onMount } from 'svelte';
  import { api, createFetchController, type TopTrackItem, type TopArtistItem, type DateRangeParams, type MeResponse } from '$lib/api';
  import TimeRangeSelector from '$lib/components/TimeRangeSelector.svelte';
  import { downloadCanvasPng } from '$lib/canvas-export';
  import { formatNumber } from '$lib/utils/format';

  // tasa aproximada de royalty por stream (Spotify paga ~$0.003–$0.005)
  const ROYALTY_PER_STREAM = 0.004;
  const WIDTH = 600;
  const ITEM_COUNT = 10;
  const PADDING_X = 40;
  const MONO_FONT = 'ui-monospace, "Cascadia Code", Menlo, Consolas, monospace';

  type Subject = 'tracks' | 'artists';

  let range = $state('month');
  let startDate = $state('');
  let endDate = $state('');
  let subject = $state<Subject>('tracks');
  let tracks = $state<TopTrackItem[]>([]);
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
      if (subject === 'tracks') {
        tracks = await api.topTracks(range, ITEM_COUNT, 'plays', getCustomDates(), signal);
      } else {
        artists = await api.topArtists(range, ITEM_COUNT, 'plays', getCustomDates(), signal);
      }
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
      week: 'LAST 7 DAYS', month: 'LAST 30 DAYS', '3months': 'LAST 3 MONTHS',
      '6months': 'LAST 6 MONTHS', year: 'LAST YEAR', thisYear: 'THIS YEAR', all: 'ALL TIME',
    };
    if (range === 'custom') return `${startDate} — ${endDate}`;
    return (map[range] ?? range).toUpperCase();
  }

  // items normalizados para render
  type Item = { name: string; sub: string; plays: number };
  function items(): Item[] {
    if (subject === 'tracks') {
      return tracks.map(t => ({
        name: (t.track?.name ?? 'unknown').toUpperCase(),
        sub: (t.track?.artists?.map(a => a.name).join(', ') ?? '').toUpperCase(),
        plays: t.playCount,
      }));
    }
    return artists.map(a => ({
      name: (a.artist?.name ?? 'unknown').toUpperCase(),
      sub: '',
      plays: a.playCount,
    }));
  }

  function formatUsd(v: number): string {
    return `$${v.toFixed(2)}`;
  }

  // trunca a ancho máximo con elipsis
  function fitText(ctx: CanvasRenderingContext2D, s: string, maxW: number): string {
    if (ctx.measureText(s).width <= maxW) return s;
    let t = s;
    while (ctx.measureText(t + '…').width > maxW && t.length > 1) t = t.slice(0, -1);
    return t + '…';
  }

  // dibuja borde de sierra en la parte superior o inferior
  function drawZigzag(ctx: CanvasRenderingContext2D, y: number, down: boolean) {
    const step = 12;
    const height = 8;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    if (down) {
      ctx.moveTo(0, y);
      for (let x = 0; x <= WIDTH; x += step) {
        ctx.lineTo(x + step / 2, y + height);
        ctx.lineTo(x + step, y);
      }
      ctx.lineTo(WIDTH, y - 100);
      ctx.lineTo(0, y - 100);
    } else {
      ctx.moveTo(0, y);
      for (let x = 0; x <= WIDTH; x += step) {
        ctx.lineTo(x + step / 2, y - height);
        ctx.lineTo(x + step, y);
      }
      ctx.lineTo(WIDTH, y + 100);
      ctx.lineTo(0, y + 100);
    }
    ctx.closePath();
    ctx.fill();
  }

  // línea discontinua
  function dashedLine(ctx: CanvasRenderingContext2D, y: number) {
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(PADDING_X, y);
    ctx.lineTo(WIDTH - PADDING_X, y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // barcode de barras aleatorias deterministas
  function drawBarcode(ctx: CanvasRenderingContext2D, y: number, seed: number) {
    const barsY = y;
    const barsH = 50;
    const barsStart = PADDING_X + 40;
    const barsEnd = WIDTH - PADDING_X - 40;
    const barsW = barsEnd - barsStart;
    let x = barsStart;
    let s = seed || 1;
    const rand = () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
    ctx.fillStyle = '#000';
    while (x < barsEnd) {
      const w = 1 + Math.floor(rand() * 4);
      if (rand() > 0.35) ctx.fillRect(x, barsY, w, barsH);
      x += w + 1 + Math.floor(rand() * 3);
    }
    // blanco al final para que no parezca cortado
    void barsW;
  }

  async function renderReceipt(): Promise<HTMLCanvasElement | null> {
    const list = items();
    if (list.length === 0) return null;

    // calcular altura dinámica
    const headerH = 280;
    const itemH = subject === 'tracks' ? 62 : 44;
    const footerH = 340;
    const height = headerH + list.length * itemH + footerH;

    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // fondo blanco
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, WIDTH, height);

    // sierra superior (negativo sobre fondo oscuro sería distinto; aquí blanco sobre bg oscuro al mostrar)
    // dibujamos una muesca en el borde superior/inferior directamente
    ctx.fillStyle = '#ffffff';
    // recortar bordes superior e inferior con triángulos "sierra" en blanco sobre fondo transparente
    // (en canvas opaco no aporta; lo omitimos y usamos solo separadores dashed)

    let y = 60;

    // logo/título
    ctx.fillStyle = '#000';
    ctx.font = `bold 36px ${MONO_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('SIS  RECEIPT', WIDTH / 2, y);
    y += 28;

    ctx.font = `500 14px ${MONO_FONT}`;
    ctx.fillStyle = '#444';
    ctx.fillText('LISTENING ROYALTIES · EST.', WIDTH / 2, y);
    y += 32;

    // datos
    const now = new Date();
    const stamp = now.toISOString().replace('T', ' ').slice(0, 16);
    ctx.font = `500 16px ${MONO_FONT}`;
    ctx.fillStyle = '#000';
    ctx.textAlign = 'left';
    const leftX = PADDING_X;
    const rightX = WIDTH - PADDING_X;

    const uname = (me?.displayName ?? me?.spotifyId ?? 'sis').toUpperCase();
    const lines = [
      [`CUSTOMER:`, uname],
      [`DATE:`, stamp],
      [`PERIOD:`, rangeLabel()],
      [`SUBJECT:`, `TOP ${list.length} ${subject.toUpperCase()}`],
      [`RATE:`, `$${ROYALTY_PER_STREAM.toFixed(4)} / STREAM`],
    ];
    for (const [k, v] of lines) {
      ctx.textAlign = 'left';
      ctx.fillText(k, leftX, y);
      ctx.textAlign = 'right';
      ctx.fillText(fitText(ctx, v, WIDTH - PADDING_X * 2 - 140), rightX, y);
      y += 22;
    }
    y += 10;
    dashedLine(ctx, y);
    y += 20;

    // cabecera de columnas
    ctx.font = `bold 14px ${MONO_FONT}`;
    ctx.textAlign = 'left';
    ctx.fillText('QTY  ITEM', leftX, y);
    ctx.textAlign = 'right';
    ctx.fillText('TOTAL', rightX, y);
    y += 12;
    dashedLine(ctx, y);
    y += 20;

    // items
    let subtotal = 0;
    ctx.font = `500 16px ${MONO_FONT}`;
    const priceW = 70;
    list.forEach((it, i) => {
      const total = it.plays * ROYALTY_PER_STREAM;
      subtotal += total;

      const idx = `${String(i + 1).padStart(2, '0')}.`;
      ctx.fillStyle = '#000';
      ctx.textAlign = 'left';
      ctx.fillText(idx, leftX, y);
      const nameMaxW = WIDTH - PADDING_X * 2 - 40 - priceW - 10;
      ctx.fillText(fitText(ctx, it.name, nameMaxW), leftX + 40, y);
      ctx.textAlign = 'right';
      ctx.fillText(formatUsd(total), rightX, y);
      y += 22;

      if (subject === 'tracks') {
        ctx.fillStyle = '#666';
        ctx.font = `400 13px ${MONO_FONT}`;
        ctx.textAlign = 'left';
        const subLine = `     ${fitText(ctx, `${it.sub} · ${formatNumber(it.plays)} PLAYS`, WIDTH - PADDING_X * 2 - 40)}`;
        ctx.fillText(subLine, leftX, y);
        ctx.font = `500 16px ${MONO_FONT}`;
        y += 20;
      } else {
        ctx.fillStyle = '#666';
        ctx.font = `400 13px ${MONO_FONT}`;
        ctx.textAlign = 'left';
        ctx.fillText(`     ${formatNumber(it.plays)} PLAYS`, leftX, y);
        ctx.font = `500 16px ${MONO_FONT}`;
        y += 12;
      }
      y += 10;
    });

    dashedLine(ctx, y);
    y += 26;

    // totales
    ctx.fillStyle = '#000';
    ctx.font = `500 16px ${MONO_FONT}`;
    const totRow = (label: string, val: string, bold = false) => {
      ctx.font = `${bold ? 'bold' : '500'} ${bold ? 20 : 16}px ${MONO_FONT}`;
      ctx.textAlign = 'left';
      ctx.fillText(label, leftX, y);
      ctx.textAlign = 'right';
      ctx.fillText(val, rightX, y);
      y += bold ? 30 : 22;
    };
    totRow('SUBTOTAL', formatUsd(subtotal));
    totRow('TAX', formatUsd(0));
    y += 4;
    dashedLine(ctx, y);
    y += 26;
    totRow('TOTAL', formatUsd(subtotal), true);

    y += 20;
    dashedLine(ctx, y);
    y += 26;

    const totalPlays = list.reduce((s, it) => s + it.plays, 0);
    ctx.font = `500 13px ${MONO_FONT}`;
    ctx.fillStyle = '#444';
    ctx.textAlign = 'center';
    ctx.fillText(`${formatNumber(totalPlays)} PLAYS  ·  ${list.length} ${subject.toUpperCase()}`, WIDTH / 2, y);
    y += 28;

    ctx.font = `bold 18px ${MONO_FONT}`;
    ctx.fillStyle = '#000';
    ctx.fillText('THANK YOU FOR LISTENING', WIDTH / 2, y);
    y += 28;

    // barcode
    drawBarcode(ctx, y, totalPlays);
    y += 64;

    // footer url
    ctx.font = `500 14px ${MONO_FONT}`;
    ctx.fillStyle = '#000';
    ctx.fillText('sis.mier.info', WIDTH / 2, y);

    // sierra decorativa arriba y abajo
    drawZigzag(ctx, 0, false);
    drawZigzag(ctx, height, true);

    return canvas;
  }

  async function updatePreview() {
    rendering = true;
    try {
      const c = await renderReceipt();
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
    const c = await renderReceipt();
    if (!c) return;
    const stamp = new Date().toISOString().split('T')[0];
    await downloadCanvasPng(c, `receipt-${subject}-${stamp}.png`);
  }

  onMount(async () => {
    me = await api.me().catch(() => null);
  });

  $effect(() => {
    void range; void startDate; void endDate; void subject;
    loadData();
  });

  $effect(() => {
    void tracks; void artists; void subject;
    if (!loading) updatePreview();
  });
</script>

<div class="page-header">
  <h1>Receipt</h1>
  <p>Top 10 tracks or artists as a shopping receipt with estimated Spotify royalties.</p>
</div>

<TimeRangeSelector value={range} onchange={setRange} {startDate} {endDate} ondatechange={setCustomDates} />

<div class="card controls">
  <div class="control-group">
    <span class="group-label">Subject</span>
    <div class="chip-row">
      <button class="chip" class:active={subject === 'tracks'} onclick={() => subject = 'tracks'}>Tracks</button>
      <button class="chip" class:active={subject === 'artists'} onclick={() => subject = 'artists'}>Artists</button>
    </div>
  </div>

  <div class="control-group">
    <span class="group-label">Royalty rate</span>
    <span class="rate">${ROYALTY_PER_STREAM.toFixed(4)} / stream</span>
  </div>

  <button class="download-btn" onclick={download} disabled={loading || rendering}>
    {rendering ? 'Generating...' : 'Download PNG'}
  </button>
</div>

{#if loading}
  <div class="loading"><div class="spinner"></div></div>
{:else if (subject === 'tracks' ? tracks.length : artists.length) === 0}
  <div class="empty">No data in the selected range.</div>
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

  .rate {
    color: var(--text);
    font-family: ui-monospace, Menlo, monospace;
    font-size: 0.9rem;
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
  .chip:hover { border-color: var(--text-muted); color: var(--text); }
  .chip.active { background: var(--accent); border-color: var(--accent); color: #000; }

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
