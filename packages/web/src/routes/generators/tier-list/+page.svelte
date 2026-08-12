<script lang="ts">
  import { isAbortError } from '$lib/utils/errors';
  import { onMount } from 'svelte';
  import { api, createFetchController, getRankingMetric, type DateRangeParams, type MeResponse, type RankingMetric } from '$lib/api';
  import TimeRangeSelector from '$lib/components/TimeRangeSelector.svelte';
  import LibraryPicker from '$lib/components/LibraryPicker.svelte';
  import { downloadCanvasPng, tryLoadImage } from '$lib/canvas-export';
  import { formatNumber, formatHours } from '$lib/utils/format';
  import { weightedSample } from '$lib/utils/sample';
  import { fromTopItem, metricValue, type EntityTab, type LibraryItem, type TopItem } from '$lib/utils/library-items';

  // por debajo de este desplazamiento el gesto cuenta como toque, no arrastre
  const DRAG_THRESHOLD_PX = 5;

  const TOP_COUNTS = [20, 50, 100] as const;
  // el backend topa el limit de /stats/top-* en 200 (routes/stats/_shared.ts)
  const POOL_DEPTHS = [50, 100, 200] as const;

  // paleta clásica de tier list; las filas nuevas van rotando por EXTRA_COLORS
  const DEFAULT_TIERS = [
    { label: 'S', color: '#ff7f7f' },
    { label: 'A', color: '#ffbf7f' },
    { label: 'B', color: '#ffdf80' },
    { label: 'C', color: '#ffff7f' },
    { label: 'D', color: '#bfff7f' },
  ];
  const EXTRA_COLORS = ['#7fffbf', '#7fdfff', '#bf9fff', '#ff9fdf', '#c0c0c0'];

  // colores del canvas exportado, alineados con el resto de generators
  const CANVAS_BG = '#080a0c';
  const CANVAS_ROW = '#12161a';
  const CANVAS_TEXT = '#e0e8e8';
  const CANVAS_MUTED = '#6a7a7a';

  // geometría del export
  const EXPORT_SCALE = 2;
  const MIN_RENDER_SCALE = 2;
  const CELL = 96;
  const LABEL_W = 132;
  const COLS = 10;
  const PAD = 28;
  const HEADER_H = 92;
  const FOOTER_H = 52;
  const ROW_GAP = 4;
  const CAPTION_H = 22;

  type SourceMode = 'top' | 'random' | 'pick';
  type Item = LibraryItem;
  type Tier = { id: string; label: string; color: string; items: Item[] };
  type RenderResult = { canvas: HTMLCanvasElement; cssWidth: number; cssHeight: number };

  let tierSeq = 0;
  const newTierId = () => `tier-${++tierSeq}`;

  let tiers = $state<Tier[]>(DEFAULT_TIERS.map((t) => ({ id: newTierId(), label: t.label, color: t.color, items: [] })));
  let tray = $state<Item[]>([]);

  let sourceMode = $state<SourceMode>('top');
  let entityTab = $state<EntityTab>('artists');
  let topCount = $state<typeof TOP_COUNTS[number]>(20);
  let poolDepth = $state<typeof POOL_DEPTHS[number]>(100);
  let metric = $state<RankingMetric>('time');
  let range = $state('6months');
  let startDate = $state('');
  let endDate = $state('');

  let adding = $state(false);
  let dragKey = $state<string | null>(null);
  let dragging = $state(false);
  let dropTarget = $state<{ zone: string; index: number } | null>(null);
  let dragOrigin = { x: 0, y: 0 };
  let selectedKey = $state<string | null>(null);
  let rootEl = $state<HTMLElement | null>(null);
  let me = $state<MeResponse | null>(null);
  let previewCanvas = $state<HTMLCanvasElement | null>(null);
  let rendering = $state(false);
  let showPreview = $state(false);

  const fetchCtrl = createFetchController();

  const placedCount = $derived(tiers.reduce((n, t) => n + t.items.length, 0));
  const allKeys = $derived(new Set([...tray, ...tiers.flatMap((t) => t.items)].map((i) => i.key)));

  function getCustomDates(): DateRangeParams | undefined {
    if (range === 'custom' && startDate && endDate) return { startDate, endDate };
    return undefined;
  }

  function setRange(r: string) {
    range = r;
    if (r !== 'custom') { startDate = ''; endDate = ''; }
    else if (!startDate || !endDate) {
      const now = new Date();
      endDate = now.toISOString().split('T')[0];
      const s = new Date(now); s.setDate(s.getDate() - 180);
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

  const metricOf = (i: Item) => metricValue(i, metric);

  // los que ya estén en la lista (en tray o en cualquier tier) se ignoran
  function addItems(items: Item[]) {
    const fresh = items.filter((i) => !allKeys.has(i.key));
    if (fresh.length) tray = [...tray, ...fresh];
  }

  async function addFromTop() {
    const signal = fetchCtrl.reset();
    adding = true;
    try {
      const fetcher = entityTab === 'tracks' ? api.topTracks
        : entityTab === 'artists' ? api.topArtists
        : api.topAlbums;
      const isRandom = sourceMode === 'random';
      const raw = await fetcher(range, isRandom ? poolDepth : topCount, metric, getCustomDates(), undefined, signal);
      if (signal.aborted) return;
      const items = (raw as TopItem[]).map((r) => fromTopItem(r, entityTab)).filter((i): i is Item => i !== null);
      addItems(isRandom ? weightedSample(items, topCount, metricOf) : items);
    } catch (e) {
      if (isAbortError(e)) return;
      throw e;
    } finally {
      if (!signal.aborted) adding = false;
    }
  }

  // --- drag and drop: pointer events como en DetailLayoutEditor, para que
  // funcione igual con ratón y con dedo ---

  function positionOf(key: string): { zone: string; index: number } | null {
    const trayIdx = tray.findIndex((i) => i.key === key);
    if (trayIdx >= 0) return { zone: 'tray', index: trayIdx };
    for (const t of tiers) {
      const idx = t.items.findIndex((i) => i.key === key);
      if (idx >= 0) return { zone: t.id, index: idx };
    }
    return null;
  }

  function findItem(key: string): Item | null {
    return tray.find((i) => i.key === key) ?? tiers.flatMap((t) => t.items).find((i) => i.key === key) ?? null;
  }

  // zona bajo el puntero + índice de inserción. el índice se calcula sobre los
  // chips que NO son el arrastrado, así casa con el array una vez quitado
  function locate(x: number, y: number): { zone: string; index: number } | null {
    const els = rootEl ? [...rootEl.querySelectorAll<HTMLElement>('[data-zone]')] : [];
    const target = els.find((el) => {
      const r = el.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    });
    if (!target) return null;
    const chips = [...target.querySelectorAll<HTMLElement>('[data-item]')].filter((c) => c.dataset.item !== dragKey);
    let index = chips.length;
    for (let i = 0; i < chips.length; i++) {
      const r = chips[i].getBoundingClientRect();
      // los chips fluyen y hacen wrap: basta con estar por encima de su base
      // para que decida la coordenada horizontal
      if (y < r.bottom && x < r.left + r.width / 2) { index = i; break; }
    }
    return { zone: target.dataset.zone!, index };
  }

  function moveItem(key: string, zone: string, index: number) {
    const item = findItem(key);
    if (!item) return;
    const strippedTray = tray.filter((i) => i.key !== key);
    const strippedTiers = tiers.map((t) => ({ ...t, items: t.items.filter((i) => i.key !== key) }));
    if (zone === 'tray') {
      strippedTray.splice(index, 0, item);
      tiers = strippedTiers;
    } else {
      const t = strippedTiers.find((x) => x.id === zone);
      if (t) t.items.splice(index, 0, item);
      tiers = strippedTiers;
    }
    tray = strippedTray;
  }

  // el elemento arrastrado NO se mueve en el DOM hasta soltarlo: reparentarlo en
  // cada pointermove lo saca del documento y eso libera el pointer capture, que
  // es lo que cortaba el arrastre a medio gesto. durante el gesto solo se pinta
  // una marca de inserción y la lista se toca una sola vez, en el pointerup
  function onItemDown(e: PointerEvent, key: string) {
    e.preventDefault();
    dragKey = key;
    dragging = false;
    dragOrigin = { x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onItemMove(e: PointerEvent) {
    if (!dragKey) return;
    if (!dragging) {
      // hasta superar el umbral el gesto sigue siendo un toque, no un arrastre
      if (Math.hypot(e.clientX - dragOrigin.x, e.clientY - dragOrigin.y) < DRAG_THRESHOLD_PX) return;
      dragging = true;
    }
    dropTarget = locate(e.clientX, e.clientY);
  }

  function onItemUp(key: string) {
    if (!dragKey) return;
    if (dragging) {
      if (dropTarget) moveItem(dragKey, dropTarget.zone, dropTarget.index);
    } else {
      // sin desplazamiento fue un toque: selecciona, y luego se coloca tocando
      // una fila, que en móvil es más cómodo que arrastrar
      selectedKey = selectedKey === key ? null : key;
    }
    endDrag();
  }

  function endDrag() {
    dragKey = null;
    dragging = false;
    dropTarget = null;
  }

  // posición de la marca de inserción dentro de la lista TAL COMO SE RENDERIZA,
  // que todavía incluye el elemento arrastrado; dropTarget.index en cambio se
  // cuenta sin él, así que hay que saltárselo al traducir
  function markAt(items: Item[], zone: string, renderIndex: number): boolean {
    if (dropTarget?.zone !== zone) return false;
    let seen = 0;
    for (let i = 0; i < items.length; i++) {
      if (items[i].key === dragKey) continue;
      if (seen === dropTarget.index) return i === renderIndex;
      seen++;
    }
    return renderIndex === items.length;
  }

  function assignSelected(zone: string) {
    if (!selectedKey) return;
    const target = zone === 'tray' ? tray.length : (tiers.find((t) => t.id === zone)?.items.length ?? 0);
    moveItem(selectedKey, zone, target);
    selectedKey = null;
  }

  function removeItem(key: string) {
    tray = tray.filter((i) => i.key !== key);
    tiers = tiers.map((t) => ({ ...t, items: t.items.filter((i) => i.key !== key) }));
    if (selectedKey === key) selectedKey = null;
  }

  // --- filas ---

  function addTier() {
    const color = EXTRA_COLORS[tiers.length % EXTRA_COLORS.length];
    tiers = [...tiers, { id: newTierId(), label: `T${tiers.length + 1}`, color, items: [] }];
  }

  function removeTier(id: string) {
    const t = tiers.find((x) => x.id === id);
    if (!t) return;
    // lo que hubiera dentro vuelve al tray en vez de desaparecer
    tray = [...tray, ...t.items];
    tiers = tiers.filter((x) => x.id !== id);
  }

  function moveTier(id: string, delta: number) {
    const idx = tiers.findIndex((t) => t.id === id);
    const next = idx + delta;
    if (idx < 0 || next < 0 || next >= tiers.length) return;
    const copy = [...tiers];
    [copy[idx], copy[next]] = [copy[next], copy[idx]];
    tiers = copy;
  }

  function clearAll() {
    tray = [...tray, ...tiers.flatMap((t) => t.items)];
    tiers = tiers.map((t) => ({ ...t, items: [] }));
  }

  function resetAll() {
    tiers = DEFAULT_TIERS.map((t) => ({ id: newTierId(), label: t.label, color: t.color, items: [] }));
    tray = [];
    selectedKey = null;
  }

  // --- export ---

  // negro o blanco según la luminancia del color de la fila, para que la
  // etiqueta se lea sobre cualquier tono que elija el usuario
  function textOn(hex: string): string {
    const h = hex.replace('#', '');
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
    const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) > 0.4 ? '#000' : '#fff';
  }

  function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
    if (ctx.measureText(text).width <= maxW) return text;
    let txt = text;
    while (txt.length > 1 && ctx.measureText(`${txt}…`).width > maxW) txt = txt.slice(0, -1);
    return `${txt}…`;
  }

  const rowHeight = (n: number) => Math.max(1, Math.ceil(n / COLS)) * CELL;

  async function renderList(scale: number): Promise<RenderResult | null> {
    const width = PAD * 2 + LABEL_W + COLS * CELL;
    const rowsH = tiers.reduce((acc, t) => acc + rowHeight(t.items.length) + ROW_GAP, 0);
    const height = PAD * 2 + HEADER_H + rowsH + FOOTER_H;

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    // se dibuja en unidades lógicas sobre un buffer escalado: si no, en pantallas
    // HiDPI el canvas tiene menos píxeles que la pantalla y el texto sale dentado
    ctx.scale(scale, scale);

    ctx.fillStyle = CANVAS_BG;
    ctx.fillRect(0, 0, width, height);

    const placed = tiers.flatMap((t) => t.items);
    const urls = [...new Set(placed.map((i) => i.imageUrl).filter((u): u is string => !!u))];
    const loaded = await Promise.all(urls.map((u) => tryLoadImage(u)));
    const images = new Map(urls.map((u, i) => [u, loaded[i]]));

    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = CANVAS_TEXT;
    ctx.font = 'bold 32px sans-serif';
    ctx.fillText('Tier List', PAD, PAD + 20);
    ctx.fillStyle = CANVAS_MUTED;
    ctx.font = '16px sans-serif';
    ctx.fillText(`${me?.displayName ?? me?.spotifyId ?? 'sis'} · ${placed.length} ranked · ${rangeLabel()}`, PAD, PAD + 50);

    let y = PAD + HEADER_H;
    for (const tier of tiers) {
      const h = rowHeight(tier.items.length);

      ctx.fillStyle = tier.color;
      ctx.fillRect(PAD, y, LABEL_W, h);
      ctx.fillStyle = textOn(tier.color);
      ctx.font = 'bold 30px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(fitText(ctx, tier.label, LABEL_W - 16), PAD + LABEL_W / 2, y + h / 2);

      ctx.fillStyle = CANVAS_ROW;
      ctx.fillRect(PAD + LABEL_W, y, COLS * CELL, h);

      tier.items.forEach((item, i) => {
        const cx = PAD + LABEL_W + (i % COLS) * CELL;
        const cy = y + Math.floor(i / COLS) * CELL;
        const img = item.imageUrl ? images.get(item.imageUrl) : null;
        if (img) {
          ctx.drawImage(img, cx, cy, CELL, CELL);
        } else {
          ctx.fillStyle = '#22282b';
          ctx.fillRect(cx, cy, CELL, CELL);
          ctx.fillStyle = CANVAS_MUTED;
          ctx.font = 'bold 34px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(item.name.charAt(0).toUpperCase(), cx + CELL / 2, cy + CELL / 2);
        }
        // franja translúcida para que el nombre se lea sobre cualquier carátula
        ctx.fillStyle = 'rgba(0,0,0,0.62)';
        ctx.fillRect(cx, cy + CELL - CAPTION_H, CELL, CAPTION_H);
        ctx.fillStyle = CANVAS_TEXT;
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(fitText(ctx, item.name, CELL - 8), cx + CELL / 2, cy + CELL - CAPTION_H / 2);
      });

      y += h + ROW_GAP;
    }

    const footerY = height - PAD - FOOTER_H / 2;
    ctx.font = '600 15px sans-serif';
    ctx.fillStyle = CANVAS_MUTED;
    ctx.textAlign = 'left';
    ctx.fillText(rangeLabel(), PAD, footerY);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#555';
    ctx.fillText('sis', width - PAD, footerY);

    return { canvas, cssWidth: width, cssHeight: height };
  }

  async function updatePreview() {
    rendering = true;
    try {
      const scale = Math.max(window.devicePixelRatio || 1, MIN_RENDER_SCALE);
      const r = await renderList(scale);
      if (!r || !previewCanvas) return;
      previewCanvas.width = r.canvas.width;
      previewCanvas.height = r.canvas.height;
      previewCanvas.style.width = `${r.cssWidth}px`;
      previewCanvas.getContext('2d')?.drawImage(r.canvas, 0, 0);
    } finally {
      rendering = false;
    }
  }

  async function download() {
    const r = await renderList(EXPORT_SCALE);
    if (!r) return;
    const stamp = new Date().toISOString().split('T')[0];
    await downloadCanvasPng(r.canvas, `tier-list-${stamp}.png`);
  }

  onMount(() => {
    metric = getRankingMetric();
    // el callback no puede ser async: onMount solo acepta una función de
    // limpieza síncrona como valor de retorno
    api.me().then((r) => { me = r; }).catch(() => { me = null; });
  });

  $effect(() => {
    void tiers; void showPreview;
    if (showPreview) updatePreview();
  });
</script>

<div class="page-header">
  <h1>Tier List</h1>
  <p>Build a tier list from your library. Drag items into rows, or tap one and tap a row.</p>
</div>

<div class="card sources">
  <div class="control-row">
    <div class="control-group">
      <span class="control-label">Add from</span>
      <div class="toggle-group">
        <button class="toggle-btn" class:active={sourceMode === 'top'} onclick={() => sourceMode = 'top'}>Top</button>
        <button class="toggle-btn" class:active={sourceMode === 'random'} onclick={() => sourceMode = 'random'}>Random</button>
        <button class="toggle-btn" class:active={sourceMode === 'pick'} onclick={() => sourceMode = 'pick'}>Pick</button>
      </div>
    </div>

    {#if sourceMode === 'top' || sourceMode === 'random'}
      <div class="control-group">
        <span class="control-label">Type</span>
        <div class="toggle-group">
          <button class="toggle-btn" class:active={entityTab === 'artists'} onclick={() => entityTab = 'artists'}>Artists</button>
          <button class="toggle-btn" class:active={entityTab === 'tracks'} onclick={() => entityTab = 'tracks'}>Tracks</button>
          <button class="toggle-btn" class:active={entityTab === 'albums'} onclick={() => entityTab = 'albums'}>Albums</button>
        </div>
      </div>

      <div class="control-group">
        <span class="control-label">How many</span>
        <div class="toggle-group">
          {#each TOP_COUNTS as n}
            <button class="toggle-btn" class:active={topCount === n} onclick={() => topCount = n}>{n}</button>
          {/each}
        </div>
      </div>
    {/if}

    {#if sourceMode === 'random'}
      <div class="control-group">
        <span class="control-label">Pool</span>
        <div class="toggle-group">
          {#each POOL_DEPTHS as n}
            <button
              class="toggle-btn"
              class:active={poolDepth === n}
              disabled={n <= topCount}
              title={n <= topCount ? `Needs to be bigger than the ${topCount} you are drawing` : ''}
              onclick={() => poolDepth = n}
            >Top {n}</button>
          {/each}
        </div>
      </div>
    {/if}
  </div>

  {#if sourceMode === 'top' || sourceMode === 'random'}
    <TimeRangeSelector value={range} onchange={setRange} {startDate} {endDate} ondatechange={setCustomDates} />
    <button class="primary-btn" onclick={addFromTop} disabled={adding}>
      {adding ? 'Adding...' : sourceMode === 'random' ? `Draw ${topCount} from top ${poolDepth}` : `Add top ${topCount}`}
    </button>
  {:else}
    <LibraryPicker onadd={addItems} />
  {/if}
</div>

<div class="board-actions">
  <span class="counter">{placedCount} ranked · {tray.length} unranked</span>
  <button class="ghost-btn" onclick={addTier}>Add row</button>
  <button class="ghost-btn" onclick={clearAll} disabled={placedCount === 0}>Clear rows</button>
  <button class="ghost-btn" onclick={resetAll}>Reset</button>
  <button class="ghost-btn" onclick={() => showPreview = !showPreview}>{showPreview ? 'Hide preview' : 'Preview'}</button>
  <button class="primary-btn" onclick={download} disabled={rendering || placedCount === 0}>
    {rendering ? 'Generating...' : 'Download PNG'}
  </button>
</div>

{#if selectedKey}
  <div class="notice">Item selected — tap a row to place it, or tap the item again to deselect.</div>
{/if}

<!-- el tray tiene que vivir DENTRO de rootEl: locate() solo mira zonas que
     cuelguen de él, y estando fuera no había forma de devolver nada a Unranked -->
<div class="workspace" class:is-dragging={dragging} bind:this={rootEl}>
  <div class="board">
    {#each tiers as tier (tier.id)}
      <div class="tier" style="--tier-color: {tier.color}">
        <div class="tier-label">
          <input class="tier-input" bind:value={tier.label} aria-label="Tier name" />
          <div class="tier-tools">
            <input class="tier-color" type="color" bind:value={tier.color} aria-label="Tier colour" />
            <button class="mini-btn" onclick={() => moveTier(tier.id, -1)} aria-label="Move row up">↑</button>
            <button class="mini-btn" onclick={() => moveTier(tier.id, 1)} aria-label="Move row down">↓</button>
            <button class="mini-btn" onclick={() => removeTier(tier.id)} aria-label="Remove row">×</button>
          </div>
        </div>
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div
          class="tier-items"
          class:drop-zone={dropTarget?.zone === tier.id}
          data-zone={tier.id}
          onclick={() => assignSelected(tier.id)}
        >
          {#each tier.items as item, i (item.key)}
            {#if markAt(tier.items, tier.id, i)}<span class="drop-mark"></span>{/if}
            {@render chip(item)}
          {/each}
          {#if markAt(tier.items, tier.id, tier.items.length)}<span class="drop-mark"></span>{/if}
          {#if selectedKey}
            <!-- alternativa accesible al clic en la zona: sin ella, colocar un
                 elemento seleccionado solo sería posible con puntero -->
            <button class="place-btn" onclick={() => assignSelected(tier.id)}>Place here</button>
          {:else if tier.items.length === 0}
            <span class="tier-empty">drop here</span>
          {/if}
        </div>
      </div>
    {/each}
  </div>

  <div class="tray-wrap">
    <div class="tray-title">Unranked</div>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
      class="tray"
      class:drop-zone={dropTarget?.zone === 'tray'}
      data-zone="tray"
      onclick={() => assignSelected('tray')}
    >
      {#each tray as item, i (item.key)}
        {#if markAt(tray, 'tray', i)}<span class="drop-mark"></span>{/if}
        {@render chip(item)}
      {/each}
      {#if markAt(tray, 'tray', tray.length)}<span class="drop-mark"></span>{/if}
      {#if tray.length === 0 && !selectedKey}
        <span class="tier-empty">Add items with the panel above.</span>
      {/if}
      {#if selectedKey}
        <button class="place-btn" onclick={() => assignSelected('tray')}>Send back here</button>
      {/if}
    </div>
  </div>
</div>

{#if showPreview}
  <div class="preview-wrap">
    <canvas bind:this={previewCanvas} class="preview"></canvas>
  </div>
{/if}

{#snippet chip(item: Item)}
  <div
    class="chip"
    class:dragging={dragKey === item.key}
    class:selected={selectedKey === item.key}
    data-item={item.key}
    role="button"
    tabindex="0"
    aria-pressed={selectedKey === item.key}
    title="{item.name}{item.subtitle ? ` — ${item.subtitle}` : ''}{item.playCount ? ` · ${formatNumber(item.playCount)} plays · ${formatHours(item.totalMs)}` : ''}"
    onpointerdown={(e) => onItemDown(e, item.key)}
    onpointermove={onItemMove}
    onpointerup={() => onItemUp(item.key)}
    onpointercancel={endDrag}
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => {
      // sin ratón ni dedo: seleccionar con enter/espacio y colocar activando una fila
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectedKey = selectedKey === item.key ? null : item.key;
      }
    }}
  >
    {#if item.imageUrl}
      <img src={item.imageUrl} alt={item.name} draggable="false" />
    {:else}
      <div class="chip-ph">{item.name.charAt(0).toUpperCase()}</div>
    {/if}
    <span class="chip-name">{item.name}</span>
    <button class="chip-remove" onpointerdown={(e) => e.stopPropagation()} onclick={() => removeItem(item.key)} aria-label="Remove {item.name}">×</button>
  </div>
{/snippet}

<style>
  .page-header p {
    color: var(--text-muted);
    margin: 0.25rem 0 0;
    font-size: 0.9rem;
  }

  .sources {
    margin-bottom: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
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

  .toggle-group { display: flex; gap: 0.2rem; }

  .toggle-btn {
    padding: 0.3rem 0.65rem;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 0.8rem;
    transition: all 0.05s;
  }

  .toggle-btn:hover:not(:disabled) { border-color: var(--text-muted); color: var(--text); }
  .toggle-btn.active { background: var(--accent); border-color: var(--accent); color: #000; }
  .toggle-btn:disabled { opacity: 0.35; cursor: not-allowed; }












  .board-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    align-items: center;
    margin-bottom: 0.75rem;
  }

  .counter {
    font-size: 0.8rem;
    color: var(--text-muted);
    margin-right: auto;
    font-variant-numeric: tabular-nums;
  }

  .ghost-btn {
    padding: 0.35rem 0.8rem;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 0.8rem;
    transition: all 0.05s;
  }

  .ghost-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
  .ghost-btn:disabled { opacity: 0.4; cursor: not-allowed; }

  .primary-btn {
    padding: 0.4rem 1rem;
    border-radius: var(--radius);
    border: 1px solid var(--accent);
    background: var(--accent);
    color: #000;
    cursor: pointer;
    font-weight: 600;
    font-size: 0.85rem;
    align-self: flex-start;
    transition: all 0.05s;
  }

  .primary-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .primary-btn:hover:not(:disabled) { background: var(--accent-hover); border-color: var(--accent-hover); }

  .notice {
    background: var(--bg-card);
    border: 1px solid var(--accent);
    border-radius: var(--radius);
    padding: 0.5rem 0.8rem;
    color: var(--text-muted);
    font-size: 0.82rem;
    margin-bottom: 0.75rem;
  }

  .board {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .tier {
    display: flex;
    align-items: stretch;
    background: var(--bg-card);
    border-radius: var(--radius);
    overflow: hidden;
  }

  .tier-label {
    width: 108px;
    flex-shrink: 0;
    background: var(--tier-color);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.25rem;
    padding: 0.4rem 0.3rem;
  }

  .tier-input {
    width: 100%;
    background: transparent;
    border: none;
    text-align: center;
    font-size: 1.3rem;
    font-weight: 700;
    color: #000;
    font-family: inherit;
    min-width: 0;
  }

  .tier-input:focus { outline: 1px solid rgba(0, 0, 0, 0.35); border-radius: 3px; }

  .tier-tools { display: flex; gap: 0.15rem; align-items: center; }

  .tier-color {
    width: 18px;
    height: 18px;
    padding: 0;
    border: none;
    background: none;
    cursor: pointer;
  }

  .mini-btn {
    width: 18px;
    height: 18px;
    border: none;
    background: rgba(0, 0, 0, 0.18);
    color: #000;
    border-radius: 3px;
    cursor: pointer;
    font-size: 0.7rem;
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .mini-btn:hover { background: rgba(0, 0, 0, 0.35); }

  .tier-items, .tray {
    flex: 1;
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
    padding: 3px;
    min-height: 72px;
    align-content: flex-start;
  }

  .tray {
    background: var(--bg-card);
    border: 1px dashed var(--border);
    border-radius: var(--radius);
    min-height: 96px;
  }

  .tray-wrap { margin-top: 1rem; }

  .tray-title {
    font-size: 0.75rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: 0.35rem;
  }

  .tier-empty {
    color: var(--text-muted);
    font-size: 0.8rem;
    align-self: center;
    padding: 0 0.5rem;
    opacity: 0.6;
  }

  .place-btn {
    align-self: center;
    padding: 0.25rem 0.6rem;
    border-radius: var(--radius);
    border: 1px dashed var(--accent);
    background: transparent;
    color: var(--accent);
    cursor: pointer;
    font-size: 0.72rem;
  }

  .place-btn:hover { background: color-mix(in srgb, var(--accent) 15%, transparent); }

  .chip {
    position: relative;
    width: 66px;
    height: 66px;
    border-radius: 4px;
    overflow: hidden;
    cursor: grab;
    /* imprescindible para arrastrar con el dedo: sin esto el navegador
       interpreta el gesto como scroll y no llegan los pointermove */
    touch-action: none;
    user-select: none;
    background: var(--bg);
    flex-shrink: 0;
  }

  .chip.dragging { opacity: 0.4; cursor: grabbing; }

  /* marca de inserción: ocupa sitio en el flujo, así los chips se apartan y se
     ve exactamente dónde va a caer */
  .drop-mark {
    width: 3px;
    align-self: stretch;
    min-height: 66px;
    border-radius: 2px;
    background: var(--accent);
    flex-shrink: 0;
  }

  .drop-zone { outline: 1px dashed var(--accent); outline-offset: -1px; }

  /* mientras se arrastra, nada del tablero debe capturar el gesto ni mostrar
     cursores de texto: el puntero está capturado por el chip */
  .workspace.is-dragging { cursor: grabbing; }
  .workspace.is-dragging .chip { pointer-events: none; }
  .workspace.is-dragging .chip.dragging { pointer-events: auto; }
  .chip.selected { outline: 2px solid var(--accent); outline-offset: -2px; }

  .chip img, .chip-ph {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    pointer-events: none;
  }

  .chip-ph {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-card);
    color: var(--text-muted);
    font-size: 1.4rem;
    font-weight: 600;
  }

  .chip-name {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.65);
    color: #fff;
    font-size: 0.58rem;
    line-height: 1.1;
    padding: 2px 3px;
    text-align: center;
    max-height: 2.2em;
    overflow: hidden;
    pointer-events: none;
  }

  .chip-remove {
    position: absolute;
    top: 1px;
    right: 1px;
    width: 15px;
    height: 15px;
    border: none;
    border-radius: 3px;
    background: rgba(0, 0, 0, 0.6);
    color: #fff;
    font-size: 0.7rem;
    line-height: 1;
    cursor: pointer;
    opacity: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .chip:hover .chip-remove { opacity: 1; }

  .preview-wrap {
    width: 100%;
    overflow-x: auto;
    margin-top: 1.25rem;
  }

  /* sin max-width: el ancho lo fija updatePreview en px lógicos y el wrapper
     hace scroll horizontal, en vez de encoger la lista hasta ser ilegible */
  .preview {
    display: block;
    height: auto;
    border-radius: var(--radius);
    border: 1px solid var(--border);
  }


  @media (max-width: 640px) {
    .tier-label { width: 84px; }
    .chip { width: 56px; height: 56px; }
    .counter { margin-right: 0; width: 100%; }
  }
</style>
