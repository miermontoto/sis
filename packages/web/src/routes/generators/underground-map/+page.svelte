<script lang="ts">
  import { onMount } from 'svelte';
  import { api, createFetchController, getRankingMetric, type TopArtistItem, type MeResponse, type RankingMetric } from '$lib/api';
  import { downloadCanvasPng } from '$lib/canvas-export';
  import { formatNumber } from '$lib/utils/format';

  // paleta de colores distintos para cada artista (inspirada en el metro de Londres
  // pero ampliada para cubrir hasta ~30 artistas visibles en el año)
  const PALETTE = [
    '#E32017', '#0098D4', '#003688', '#00782A', '#9B0056', '#FFD329', '#F3A9BB',
    '#6950A1', '#000000', '#B36305', '#95CDBA', '#00A4A7', '#EE7C0E', '#84B817',
    '#D81B60', '#1E88E5', '#43A047', '#FB8C00', '#8E24AA', '#3949AB', '#00ACC1',
    '#E53935', '#7CB342', '#FDD835', '#5E35B1', '#00897B', '#3E2723', '#546E7A',
  ];

  const WIDTH = 1920;
  const HEIGHT = 1080;
  const RANKS = 5;
  const TOP_PER_MONTH = 5;
  const MARGIN_L = 120;
  const MARGIN_R = 80;
  const MARGIN_T = 220;
  const MARGIN_B = 140;

  type MonthBucket = { key: string; label: string; startDate: string; endDate: string };
  type ArtistTrack = { id: string; name: string; color: string; ranks: (number | null)[] };
  type Mode =
    | { kind: 'year'; value: number }  // año calendario completo (Ene–Dic)
    | { kind: 'ytd' }                   // año actual, de Enero al mes en curso
    | { kind: 'rolling' };              // 12 meses móviles terminando en el mes actual

  let mode = $state<Mode>({ kind: 'ytd' });
  let metric = $state<RankingMetric>('time');
  let showUsername = $state(true);
  let artistLines = $state<ArtistTrack[]>([]);
  let monthsInView = $state<MonthBucket[]>([]);
  let loading = $state(true);
  let rendering = $state(false);
  let me = $state<MeResponse | null>(null);
  let previewCanvas = $state<HTMLCanvasElement | null>(null);
  const fetchCtrl = createFetchController();

  function monthBucket(year: number, monthIdx: number): MonthBucket {
    const start = new Date(Date.UTC(year, monthIdx, 1));
    const end = new Date(Date.UTC(year, monthIdx + 1, 0));
    return {
      key: `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}`,
      label: start.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }),
      startDate: start.toISOString().slice(0, 10),
      endDate: end.toISOString().slice(0, 10),
    };
  }

  // construye los meses a mostrar según el modo
  function buildMonths(m: Mode): MonthBucket[] {
    const now = new Date();
    if (m.kind === 'year') {
      return Array.from({ length: 12 }, (_, i) => monthBucket(m.value, i));
    }
    if (m.kind === 'ytd') {
      const last = now.getMonth();
      return Array.from({ length: last + 1 }, (_, i) => monthBucket(now.getFullYear(), i));
    }
    // rolling: 12 meses terminando en el mes actual (inclusive)
    const out: MonthBucket[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(Date.UTC(now.getFullYear(), now.getMonth() - i, 1));
      out.push(monthBucket(d.getUTCFullYear(), d.getUTCMonth()));
    }
    return out;
  }

  async function loadData() {
    const signal = fetchCtrl.reset();
    loading = true;
    try {
      const months = buildMonths(mode);
      // N llamadas en paralelo (hasta 12); cada mes devuelve el top 5 del periodo
      const perMonth: TopArtistItem[][] = await Promise.all(
        months.map(m =>
          api.topArtists('custom', TOP_PER_MONTH, metric, { startDate: m.startDate, endDate: m.endDate }, signal)
            .catch(() => [] as TopArtistItem[])
        )
      );
      if (signal.aborted) return;

      // construir matriz rank x mes, preservando orden de aparición para asignar colores
      const byArtist = new Map<string, { name: string; ranks: (number | null)[] }>();
      months.forEach((_, mIdx) => {
        const top = perMonth[mIdx];
        top.forEach((entry, rank) => {
          const id = entry.artistId;
          if (!id) return;
          let row = byArtist.get(id);
          if (!row) {
            row = { name: entry.artist?.name ?? 'unknown', ranks: new Array(months.length).fill(null) };
            byArtist.set(id, row);
          }
          row.ranks[mIdx] = rank + 1; // 1-based
        });
      });

      // ordenar artistas por primer mes de aparición para que los colores se asignen coherentemente
      const ordered = [...byArtist.entries()]
        .map(([id, v]) => ({ id, ...v, firstMonth: v.ranks.findIndex(r => r !== null) }))
        .sort((a, b) => a.firstMonth - b.firstMonth || a.name.localeCompare(b.name));

      artistLines = ordered.map((a, i) => ({
        id: a.id,
        name: a.name,
        color: PALETTE[i % PALETTE.length],
        ranks: a.ranks,
      }));
      monthsInView = months;
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      throw e;
    } finally {
      if (!signal.aborted) loading = false;
    }
  }

  function rankY(rank: number): number {
    const usableH = HEIGHT - MARGIN_T - MARGIN_B;
    return MARGIN_T + (usableH / RANKS) * (rank - 0.5);
  }

  function monthX(mIdx: number, totalMonths: number): number {
    const usableW = WIDTH - MARGIN_L - MARGIN_R;
    // con un solo mes, centrar; con varios, distribuir en [MARGIN_L, WIDTH - MARGIN_R]
    if (totalMonths <= 1) return MARGIN_L + usableW / 2;
    return MARGIN_L + (usableW / (totalMonths - 1)) * mIdx;
  }

  // agrupa la trayectoria de un artista en segmentos contiguos (donde aparece sin hueco)
  function segmentsOf(ranks: (number | null)[]): Array<{ start: number; end: number }> {
    const segs: Array<{ start: number; end: number }> = [];
    let s = -1;
    for (let i = 0; i < ranks.length; i++) {
      if (ranks[i] !== null && s === -1) s = i;
      if (ranks[i] === null && s !== -1) { segs.push({ start: s, end: i - 1 }); s = -1; }
    }
    if (s !== -1) segs.push({ start: s, end: ranks.length - 1 });
    return segs;
  }

  async function renderMap(): Promise<HTMLCanvasElement | null> {
    const months = monthsInView;
    if (months.length === 0) return null;

    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // fondo blanco
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // bandas alternadas (filas 2 y 4) para dar lectura tipo mapa
    const usableH = HEIGHT - MARGIN_T - MARGIN_B;
    const rowH = usableH / RANKS;
    ctx.fillStyle = '#f2f2f0';
    for (let r = 2; r <= RANKS; r += 2) {
      const y = MARGIN_T + (r - 1) * rowH;
      ctx.fillRect(MARGIN_L - 40, y, WIDTH - MARGIN_L - MARGIN_R + 40, rowH);
    }

    // título
    ctx.fillStyle = '#111';
    ctx.font = 'bold 64px Arial, Helvetica, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('My underground', 60, 70);

    // footer-url top-right
    ctx.fillStyle = '#9a9a9a';
    ctx.font = '500 24px Arial, Helvetica, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('sis.mier.info', WIDTH - 60, 94);

    // etiquetas de ranking a la izquierda
    ctx.fillStyle = '#d0d0d0';
    ctx.font = 'bold 72px Arial, Helvetica, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (let r = 1; r <= RANKS; r++) {
      ctx.fillText(String(r), 40, rankY(r));
    }

    // etiquetas de meses en la parte inferior
    ctx.fillStyle = '#888';
    ctx.font = '500 34px Arial, Helvetica, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    months.forEach((m, i) => {
      ctx.fillText(m.label, monthX(i, months.length), HEIGHT - MARGIN_B + 40);
    });

    // dibujar cada artista como línea rectilínea con paradas
    const LINE_W = 7;
    const STATION_R = 14;

    // primera pasada: trazos + estaciones (sin etiquetas)
    for (const artist of artistLines) {
      const segs = segmentsOf(artist.ranks);
      if (segs.length === 0) continue;

      ctx.strokeStyle = artist.color;
      ctx.lineWidth = LINE_W;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      for (const seg of segs) {
        ctx.beginPath();
        ctx.moveTo(monthX(seg.start, months.length), rankY(artist.ranks[seg.start] as number));
        for (let i = seg.start + 1; i <= seg.end; i++) {
          const x1 = monthX(i - 1, months.length);
          const x2 = monthX(i, months.length);
          const y1 = rankY(artist.ranks[i - 1] as number);
          const y2 = rankY(artist.ranks[i] as number);
          const midX = (x1 + x2) / 2;
          if (y1 === y2) {
            ctx.lineTo(x2, y2);
          } else {
            ctx.lineTo(midX - 16, y1);
            ctx.quadraticCurveTo(midX, y1, midX, y1 + Math.sign(y2 - y1) * Math.min(Math.abs(y2 - y1) / 2, 22));
            ctx.lineTo(midX, y2 - Math.sign(y2 - y1) * Math.min(Math.abs(y2 - y1) / 2, 22));
            ctx.quadraticCurveTo(midX, y2, midX + 16, y2);
            ctx.lineTo(x2, y2);
          }
        }
        ctx.stroke();

        // ticks perpendiculares en cada mes intermedio
        for (let i = seg.start + 1; i < seg.end; i++) {
          const x = monthX(i, months.length);
          const y = rankY(artist.ranks[i] as number);
          ctx.beginPath();
          ctx.moveTo(x, y - 12);
          ctx.lineTo(x, y + 12);
          ctx.stroke();
        }

        // estación de inicio: círculo blanco con borde del color del artista
        const sx = monthX(seg.start, months.length);
        const sy = rankY(artist.ranks[seg.start] as number);
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(sx, sy, STATION_R, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 5;
        ctx.strokeStyle = artist.color;
        ctx.stroke();
        ctx.lineWidth = LINE_W;

        // fin de segmento: dot sólido (solo si es el último segmento del artista)
        if (seg === segs[segs.length - 1]) {
          const ex = monthX(seg.end, months.length);
          const ey = rankY(artist.ranks[seg.end] as number);
          ctx.fillStyle = artist.color;
          ctx.beginPath();
          ctx.arc(ex, ey, STATION_R, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // segunda pasada: calcular cajas de etiquetas y aplicar anti-colisión
    const LABEL_FONT = 'bold 26px Arial, Helvetica, sans-serif';
    const LINE_H = 30;
    const LABEL_MAX_W = 220;
    ctx.font = LABEL_FONT;

    type LabelBox = { x: number; y: number; w: number; h: number; lines: string[]; sx: number; sy: number; color: string };
    const boxes: LabelBox[] = [];
    for (const artist of artistLines) {
      const segs = segmentsOf(artist.ranks);
      if (segs.length === 0) continue;
      const firstSeg = segs[0];
      const sx = monthX(firstSeg.start, months.length);
      const sy = rankY(artist.ranks[firstSeg.start] as number);
      const lines = wrapName(ctx, artist.name, LABEL_MAX_W);
      const w = Math.max(...lines.map(l => ctx.measureText(l).width));
      const h = lines.length * LINE_H;
      // posición natural: justo encima de la estación, alineada al centro de la misma
      const naturalTop = sy - STATION_R - 10 - h;
      const left = sx - w / 2;
      boxes.push({ x: left, y: naturalTop, w, h, lines, sx, sy, color: artist.color });
    }

    // anti-colisión: orden por columna; para cada caja, si colisiona con alguna
    // anterior, se desplaza hacia arriba hasta quedar libre. tope mínimo = y=110
    const MIN_Y = 110;
    const GAP = 6;
    boxes.sort((a, b) => a.sx - b.sx || a.sy - b.sy);
    for (let i = 0; i < boxes.length; i++) {
      const cur = boxes[i];
      for (let pass = 0; pass < 30; pass++) {
        let moved = false;
        for (let j = 0; j < i; j++) {
          const o = boxes[j];
          const overlapsX = cur.x < o.x + o.w && o.x < cur.x + cur.w;
          const overlapsY = cur.y < o.y + o.h && o.y < cur.y + cur.h;
          if (overlapsX && overlapsY) {
            cur.y = o.y - cur.h - GAP;
            moved = true;
            break;
          }
        }
        if (!moved) break;
      }
      if (cur.y < MIN_Y) cur.y = MIN_Y;
    }

    // tercera pasada: dibujar etiquetas (con conector si se movieron mucho)
    ctx.font = LABEL_FONT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    for (const b of boxes) {
      // conector fino si la caja quedó por encima de la posición natural + umbral
      const labelBottom = b.y + b.h;
      const naturalLabelBottom = b.sy - STATION_R - 10;
      if (naturalLabelBottom - labelBottom > 14) {
        ctx.strokeStyle = b.color;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(b.sx, labelBottom + 4);
        ctx.lineTo(b.sx, b.sy - STATION_R - 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.fillStyle = '#111';
      b.lines.forEach((line, i) => {
        ctx.fillText(line, b.x, b.y + (i + 1) * LINE_H - 6);
      });
    }

    // línea de firma inferior
    if (showUsername) {
      const uname = me?.displayName ?? me?.spotifyId ?? 'sis';
      const periodLabel = mode.kind === 'ytd'
        ? `YTD ${new Date().getFullYear()}`
        : mode.kind === 'rolling'
          ? `${months[0].label} ${months[0].key.slice(0, 4)} – ${months[months.length - 1].label} ${months[months.length - 1].key.slice(0, 4)}`
          : String(mode.value);
      ctx.fillStyle = '#555';
      ctx.font = '500 24px Arial, Helvetica, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(`${uname} · ${periodLabel}`, 60, HEIGHT - 40);
      ctx.textAlign = 'right';
      ctx.fillText(metric === 'plays' ? 'by play count' : 'by listening time', WIDTH - 60, HEIGHT - 40);
    }

    return canvas;
  }

  function wrapName(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
    if (ctx.measureText(text).width <= maxW) return [text];
    const words = text.split(' ');
    if (words.length < 2) {
      // sin espacios: truncar con elipsis
      let t = text;
      while (ctx.measureText(t + '…').width > maxW && t.length > 1) t = t.slice(0, -1);
      return [t + '…'];
    }
    // dos líneas: romper por el hueco que mejor equilibre
    let best = { a: words[0], b: words.slice(1).join(' ') };
    for (let i = 1; i < words.length; i++) {
      const a = words.slice(0, i).join(' ');
      const b = words.slice(i).join(' ');
      if (ctx.measureText(a).width <= maxW && ctx.measureText(b).width <= maxW) {
        best = { a, b };
        break;
      }
    }
    return [best.a, best.b];
  }

  async function updatePreview() {
    rendering = true;
    try {
      const c = await renderMap();
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
    const c = await renderMap();
    if (!c) return;
    const now = new Date();
    const suffix = mode.kind === 'ytd'
      ? `ytd-${now.getFullYear()}`
      : mode.kind === 'rolling'
        ? `rolling-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
        : String(mode.value);
    await downloadCanvasPng(c, `underground-map-${suffix}.png`);
  }

  onMount(async () => {
    metric = getRankingMetric();
    me = await api.me().catch(() => null);
  });

  $effect(() => {
    void mode; void metric;
    loadData();
  });

  $effect(() => {
    void artistLines; void showUsername;
    if (!loading) updatePreview();
  });

  const currentYear = new Date().getFullYear();
  const artistCount = $derived(artistLines.length);
  const totalPlays = $derived(
    artistLines.reduce((s, a) => s + a.ranks.filter(r => r !== null).length, 0)
  );
</script>

<div class="page-header">
  <h1>Underground Map</h1>
  <p>Your monthly top 5 artists across the year, laid out like a tube map.</p>
</div>

<div class="card controls">
  <div class="control-group">
    <span class="group-label">Period</span>
    <div class="chip-row">
      {#each [currentYear - 2, currentYear - 1] as y}
        <button
          class="chip"
          class:active={mode.kind === 'year' && mode.value === y}
          onclick={() => mode = { kind: 'year', value: y }}
        >{y}</button>
      {/each}
      <button
        class="chip"
        class:active={mode.kind === 'ytd'}
        onclick={() => mode = { kind: 'ytd' }}
      >YTD</button>
      <button
        class="chip"
        class:active={mode.kind === 'rolling'}
        onclick={() => mode = { kind: 'rolling' }}
      >1 year</button>
    </div>
  </div>

  <div class="control-group">
    <span class="group-label">Metric</span>
    <div class="chip-row">
      <button class="chip" class:active={metric === 'time'} onclick={() => metric = 'time'}>Time</button>
      <button class="chip" class:active={metric === 'plays'} onclick={() => metric = 'plays'}>Plays</button>
    </div>
  </div>

  <div class="control-group">
    <label>
      <input type="checkbox" bind:checked={showUsername} />
      Username tag
    </label>
  </div>

  <button class="download-btn" onclick={download} disabled={loading || rendering || artistLines.length === 0}>
    {rendering ? 'Generating...' : 'Download PNG'}
  </button>
</div>

{#if loading}
  <div class="loading"><div class="spinner"></div></div>
{:else if artistLines.length === 0}
  <div class="empty">No data for {mode.kind === 'ytd' ? `YTD ${currentYear}` : mode.kind === 'rolling' ? 'the last 12 months' : mode.value}.</div>
{:else}
  <div class="stats">
    <span>{formatNumber(artistCount)} artists</span>
    <span class="dot">·</span>
    <span>{formatNumber(totalPlays)} monthly appearances</span>
  </div>
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
    flex-wrap: wrap;
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

  .stats {
    color: var(--text-muted);
    font-size: 0.85rem;
    margin-top: 1rem;
    display: flex;
    gap: 0.5rem;
    justify-content: center;
  }
  .dot { opacity: 0.5; }

  .preview-wrap {
    display: flex;
    justify-content: center;
    margin-top: 0.5rem;
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
