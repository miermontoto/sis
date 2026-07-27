<script lang="ts">
  import { onMount } from 'svelte';
  import { api, createFetchController, getRankingMetric, type DateRangeParams, type MeResponse, type RankingMetric } from '$lib/api';
  import TimeRangeSelector from '$lib/components/TimeRangeSelector.svelte';
  import LibraryPicker from '$lib/components/LibraryPicker.svelte';
  import { downloadCanvasPng, tryLoadImage } from '$lib/canvas-export';
  import { formatNumber, formatHours } from '$lib/utils/format';
  import { weightedSample } from '$lib/utils/sample';
  import { fromTopItem, metricValue, type EntityTab, type LibraryItem } from '$lib/utils/library-items';

  const BRACKET_SIZES = [8, 16, 32, 64] as const;
  // el backend topa el limit de /stats/top-* en 200 (routes/stats/_shared.ts)
  const POOL_DEPTHS = [50, 100, 200] as const;

  // nombres clásicos de ronda según cuántos huecos quedan
  const ROUND_NAMES: Record<number, string> = {
    2: 'Final',
    4: 'Final Four',
    8: 'Elite Eight',
    16: 'Sweet 16',
  };

  // paleta del canvas exportado, alineada con el resto de generators
  const CANVAS_BG = '#080a0c';
  const CANVAS_SLOT = '#161a1d';
  const CANVAS_TEXT = '#e0e8e8';
  const CANVAS_MUTED = '#6a7a7a';
  const CANVAS_ACCENT = '#1db954';
  const CANVAS_LINE = '#2a3033';

  // geometría del bracket exportado
  const SLOT_H = 40;
  const SLOT_GAP = 8;
  const COL_W = 230;
  const COL_GAP = 34;
  const PAD = 32;
  const HEADER_H = 96;
  const FOOTER_H = 54;
  const THUMB = 28;

  // factores de supersampling del canvas (ver renderBracket)
  const MIN_RENDER_SCALE = 2;
  const EXPORT_SCALE = 2;

  type Field = 'top' | 'random' | 'pick';
  type Entry = LibraryItem & { seed: number };
  type PoolItem = LibraryItem;
  type Snapshot = { rounds: (Entry | null)[][]; cursor: { round: number; match: number } };
  // cssWidth/cssHeight son las dimensiones lógicas, sin el factor de escala
  type RenderResult = { canvas: HTMLCanvasElement; cssWidth: number; cssHeight: number };

  let entityTab = $state<EntityTab>('artists');
  let bracketSize = $state<typeof BRACKET_SIZES[number]>(16);
  let field = $state<Field>('top');
  let poolDepth = $state<typeof POOL_DEPTHS[number]>(100);
  let metric = $state<RankingMetric>('time');
  let range = $state('6months');
  let startDate = $state('');
  let endDate = $state('');

  let pool = $state<PoolItem[]>([]);
  // en modo pick el campo lo monta el usuario a mano; el bracket se dimensiona
  // solo a partir de él, así que no pasa por el control de tamaño
  let roster = $state<PoolItem[]>([]);
  let entries = $state<Entry[]>([]);
  let rounds = $state<(Entry | null)[][]>([]);
  let cursor = $state({ round: 0, match: 0 });
  let history = $state<Snapshot[]>([]);
  let loading = $state(true);
  let showBracket = $state(false);
  let me = $state<MeResponse | null>(null);
  let previewCanvas = $state<HTMLCanvasElement | null>(null);
  let rendering = $state(false);

  const fetchCtrl = createFetchController();

  const finished = $derived(rounds.length > 0 && cursor.round >= rounds.length - 1);
  const champion = $derived(finished ? rounds[rounds.length - 1][0] : null);
  const pair = $derived<[Entry | null, Entry | null] | null>(
    rounds.length > 0 && !finished
      ? [rounds[cursor.round][cursor.match * 2], rounds[cursor.round][cursor.match * 2 + 1]]
      : null
  );
  // los byes no cuentan como enfrentamiento: con N entradas siempre hay N-1
  // decisiones reales, y el stack de undo lleva justo una entrada por elección
  const totalMatches = $derived(Math.max(entries.length - 1, 1));
  const playedMatches = $derived(history.length);
  // en pick el cuadro se ajusta al roster: la potencia de dos inmediatamente
  // superior, acotada al rango de tamaños que soporta el bracket
  const effectiveSize = $derived(
    field === 'pick'
      ? Math.min(Math.max(2 ** Math.ceil(Math.log2(Math.max(roster.length, 2))), BRACKET_SIZES[0]), BRACKET_SIZES[BRACKET_SIZES.length - 1])
      : bracketSize
  );
  const runnerUp = $derived.by(() => {
    if (!finished || rounds.length < 2) return null;
    const semis = rounds[rounds.length - 2];
    return semis[0]?.id === champion?.id ? semis[1] : semis[0];
  });

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

  async function loadData() {
    // en pick no hay nada que traer: el campo es el roster que monta el usuario
    if (field === 'pick') {
      fetchCtrl.reset();
      loading = false;
      buildField();
      return;
    }
    const signal = fetchCtrl.reset();
    loading = true;
    try {
      const fetcher = entityTab === 'tracks' ? api.topTracks
        : entityTab === 'artists' ? api.topArtists
        : api.topAlbums;
      // en modo random se pide el pool entero y el sorteo se hace en cliente,
      // así reshuffle() no vuelve a pegarle a la API
      const limit = field === 'random' ? poolDepth : bracketSize;
      const items = await fetcher(range, limit, metric, getCustomDates(), undefined, signal);
      if (signal.aborted) return;
      pool = items
        .map((i) => fromTopItem(i as any, entityTab))
        .filter((e): e is PoolItem => e !== null);
      buildField();
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      throw e;
    } finally {
      if (!signal.aborted) loading = false;
    }
  }

  // los que ya estén en el roster se ignoran
  function addToRoster(items: PoolItem[]) {
    const have = new Set(roster.map((r) => r.key));
    const fresh = items.filter((i) => !have.has(i.key));
    if (fresh.length) roster = [...roster, ...fresh];
  }

  function removeFromRoster(key: string) {
    roster = roster.filter((r) => r.key !== key);
  }

  const metricOf = (p: PoolItem) => metricValue(p, metric);

  // decide qué entra en el bracket y le asigna seeds; separado de loadData para
  // poder resortear sin refetch
  function buildField() {
    const chosen = field === 'random' ? weightedSample(pool, effectiveSize, metricOf)
      // si el roster desborda el cuadro máximo, entran los más escuchados
      : field === 'pick' ? [...roster].sort((a, b) => metricOf(b) - metricOf(a)).slice(0, effectiveSize)
      : pool.slice(0, effectiveSize);
    // el seed siempre sale del ranking real dentro del campo elegido
    entries = [...chosen]
      .sort((a, b) => metricOf(b) - metricOf(a))
      .map((e, idx) => ({ ...e, seed: idx + 1 }));
    buildBracket();
  }

  function reshuffle() {
    buildField();
    showBracket = false;
  }

  // un pool que no supera al bracket no sortea nada (entraría el campo entero),
  // así que al agrandar el bracket se sube el pool al primero que siga siendo mayor
  function setBracketSize(n: typeof BRACKET_SIZES[number]) {
    bracketSize = n;
    if (poolDepth <= n) poolDepth = POOL_DEPTHS.find((p) => p > n) ?? POOL_DEPTHS[POOL_DEPTHS.length - 1];
  }

  // orden de seeds estándar: espeja recursivamente para que los cabezas de
  // serie no se crucen hasta lo más tarde posible ([1,8,4,5,2,7,3,6] para 8)
  function seedOrder(size: number): number[] {
    let order = [1];
    while (order.length < size) {
      const n = order.length * 2 + 1;
      order = order.flatMap((s) => [s, n - s]);
    }
    return order;
  }

  function buildBracket() {
    if (entries.length < 2) { rounds = []; history = []; return; }
    const bySeed = new Map(entries.map((e) => [e.seed, e]));
    // huecos sin entrada son byes: pasan solos a la siguiente ronda
    const first = seedOrder(effectiveSize).map((s) => bySeed.get(s) ?? null);

    const built: (Entry | null)[][] = [first];
    for (let n = effectiveSize / 2; n >= 1; n /= 2) built.push(new Array(n).fill(null));

    rounds = built;
    cursor = { round: 0, match: 0 };
    history = [];
    autoAdvance();
  }

  function atEnd(): boolean {
    return cursor.round >= rounds.length - 1;
  }

  function step() {
    const matchesInRound = rounds[cursor.round].length / 2;
    cursor = cursor.match + 1 < matchesInRound
      ? { round: cursor.round, match: cursor.match + 1 }
      : { round: cursor.round + 1, match: 0 };
  }

  // resuelve byes en cadena hasta plantarse en un enfrentamiento real
  function autoAdvance() {
    while (!atEnd()) {
      const a = rounds[cursor.round][cursor.match * 2];
      const b = rounds[cursor.round][cursor.match * 2 + 1];
      if (a && b) return;
      rounds[cursor.round + 1][cursor.match] = a ?? b;
      step();
    }
  }

  function pick(winner: Entry | null) {
    if (!winner || atEnd()) return;
    history = [...history, { rounds: rounds.map((r) => [...r]), cursor: { ...cursor } }];
    rounds[cursor.round + 1][cursor.match] = winner;
    step();
    autoAdvance();
  }

  function undo() {
    const prev = history[history.length - 1];
    if (!prev) return;
    history = history.slice(0, -1);
    rounds = prev.rounds;
    cursor = prev.cursor;
  }

  function replay() {
    buildBracket();
    showBracket = false;
  }

  function onKeydown(e: KeyboardEvent) {
    if (!pair || finished) return;
    if (e.key === 'ArrowLeft' || e.key === '1') { e.preventDefault(); pick(pair[0]); }
    else if (e.key === 'ArrowRight' || e.key === '2') { e.preventDefault(); pick(pair[1]); }
    else if (e.key === 'Backspace' || e.key === 'z') { e.preventDefault(); undo(); }
  }

  function roundLabel(round: number): string {
    const slots = rounds[round]?.length ?? 0;
    return ROUND_NAMES[slots] ?? `Round of ${slots}`;
  }

  // etiqueta legible del enfrentamiento (no confundir con metricValue del util,
  // que devuelve el número con el que se siembra)
  function metricLabel(e: Entry): string {
    return metric === 'plays' ? `${formatNumber(e.playCount)} plays` : formatHours(e.totalMs);
  }

  // recorta un texto al ancho disponible añadiendo elipsis
  function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
    if (ctx.measureText(text).width <= maxW) return text;
    let txt = text;
    while (txt.length > 1 && ctx.measureText(`${txt}…`).width > maxW) txt = txt.slice(0, -1);
    return `${txt}…`;
  }

  // y del centro de cada hueco: cada ganador se centra entre sus dos alimentadores
  function slotPositions(): number[][] {
    const pos: number[][] = [rounds[0].map((_, i) => i * (SLOT_H + SLOT_GAP))];
    for (let r = 1; r < rounds.length; r++) {
      pos.push(rounds[r].map((_, i) => (pos[r - 1][i * 2] + pos[r - 1][i * 2 + 1]) / 2));
    }
    return pos;
  }

  // dibuja en unidades lógicas sobre un buffer escalado: sin esto el canvas
  // tiene menos píxeles que la pantalla en displays HiDPI y el texto se ve dentado
  async function renderBracket(scale: number): Promise<RenderResult | null> {
    if (rounds.length === 0) return null;

    const pos = slotPositions();
    const contentH = rounds[0].length * (SLOT_H + SLOT_GAP) - SLOT_GAP;
    const width = PAD * 2 + rounds.length * COL_W + (rounds.length - 1) * COL_GAP;
    const height = PAD * 2 + HEADER_H + contentH + FOOTER_H;

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.scale(scale, scale);

    ctx.fillStyle = CANVAS_BG;
    ctx.fillRect(0, 0, width, height);

    // una sola carga por url aunque la entrada aparezca en varias rondas
    const urls = [...new Set(entries.map((e) => e.imageUrl).filter((u): u is string => !!u))];
    const loaded = await Promise.all(urls.map((u) => tryLoadImage(u)));
    const images = new Map(urls.map((u, i) => [u, loaded[i]]));

    ctx.textBaseline = 'middle';
    ctx.fillStyle = CANVAS_TEXT;
    ctx.font = 'bold 34px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('March Madness', PAD, PAD + 22);
    ctx.fillStyle = CANVAS_MUTED;
    ctx.font = '16px sans-serif';
    const fieldLabel = field === 'random' ? `random from top ${Math.min(poolDepth, pool.length)}`
      : field === 'pick' ? `${entries.length} hand-picked`
      : `top ${effectiveSize}`;
    ctx.fillText(`${entityTab} · ${rangeLabel()} · ${fieldLabel}`, PAD, PAD + 52);

    const colX = (r: number) => PAD + r * (COL_W + COL_GAP);
    const slotY = (r: number, i: number) => PAD + HEADER_H + pos[r][i];

    // cabeceras de ronda
    ctx.font = '600 13px sans-serif';
    ctx.fillStyle = CANVAS_MUTED;
    ctx.textAlign = 'left';
    for (let r = 0; r < rounds.length; r++) {
      const label = r === rounds.length - 1 ? 'Champion' : roundLabel(r);
      ctx.fillText(label.toUpperCase(), colX(r), PAD + HEADER_H - 16);
    }

    // conectores entre columnas
    ctx.strokeStyle = CANVAS_LINE;
    ctx.lineWidth = 1.5;
    for (let r = 0; r < rounds.length - 1; r++) {
      for (let i = 0; i < rounds[r].length; i++) {
        if (!rounds[r][i]) continue;
        const fromX = colX(r) + COL_W;
        const fromY = slotY(r, i) + SLOT_H / 2;
        const toX = colX(r + 1);
        const toY = slotY(r + 1, Math.floor(i / 2)) + SLOT_H / 2;
        const midX = fromX + COL_GAP / 2;
        ctx.beginPath();
        ctx.moveTo(fromX, fromY);
        ctx.lineTo(midX, fromY);
        ctx.lineTo(midX, toY);
        ctx.lineTo(toX, toY);
        ctx.stroke();
      }
    }

    for (let r = 0; r < rounds.length; r++) {
      for (let i = 0; i < rounds[r].length; i++) {
        const entry = rounds[r][i];
        const x = colX(r);
        const y = slotY(r, i);
        const isChampion = r === rounds.length - 1;

        ctx.fillStyle = entry ? CANVAS_SLOT : '#0e1113';
        ctx.beginPath();
        ctx.roundRect(x, y, COL_W, SLOT_H, 6);
        ctx.fill();
        if (entry && isChampion) {
          ctx.strokeStyle = CANVAS_ACCENT;
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        if (!entry) continue;

        const img = entry.imageUrl ? images.get(entry.imageUrl) : null;
        const thumbY = y + (SLOT_H - THUMB) / 2;
        if (img) {
          ctx.save();
          ctx.beginPath();
          ctx.roundRect(x + 6, thumbY, THUMB, THUMB, 4);
          ctx.clip();
          ctx.drawImage(img, x + 6, thumbY, THUMB, THUMB);
          ctx.restore();
        } else {
          ctx.fillStyle = '#22282b';
          ctx.beginPath();
          ctx.roundRect(x + 6, thumbY, THUMB, THUMB, 4);
          ctx.fill();
        }

        ctx.textAlign = 'right';
        ctx.font = '12px sans-serif';
        ctx.fillStyle = CANVAS_MUTED;
        const stat = metric === 'plays' ? `${formatNumber(entry.playCount)}` : formatHours(entry.totalMs);
        ctx.fillText(stat, x + COL_W - 8, y + SLOT_H / 2);
        const statW = ctx.measureText(stat).width;

        ctx.textAlign = 'left';
        ctx.font = '600 11px sans-serif';
        ctx.fillStyle = CANVAS_MUTED;
        ctx.fillText(String(entry.seed), x + THUMB + 14, y + SLOT_H / 2);
        const seedW = ctx.measureText(String(entry.seed)).width;

        const nameX = x + THUMB + 20 + seedW;
        ctx.font = isChampion ? 'bold 14px sans-serif' : '14px sans-serif';
        ctx.fillStyle = isChampion ? CANVAS_ACCENT : CANVAS_TEXT;
        ctx.fillText(fitText(ctx, entry.name, COL_W - (nameX - x) - statW - 16), nameX, y + SLOT_H / 2);
      }
    }

    const footerY = height - PAD - FOOTER_H / 2;
    ctx.font = '600 16px sans-serif';
    ctx.fillStyle = CANVAS_MUTED;
    ctx.textAlign = 'left';
    ctx.fillText(me?.displayName ?? me?.spotifyId ?? 'sis', PAD, footerY);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#555';
    ctx.fillText('sis', width - PAD, footerY);

    return { canvas, cssWidth: width, cssHeight: height };
  }

  async function updatePreview() {
    rendering = true;
    try {
      // nunca por debajo de 2x: el PNG descargado y el preview comparten render,
      // y en pantallas 1x un 2x sigue mejorando el antialiasing del texto
      const scale = Math.max(window.devicePixelRatio || 1, MIN_RENDER_SCALE);
      const r = await renderBracket(scale);
      if (!r || !previewCanvas) return;
      previewCanvas.width = r.canvas.width;
      previewCanvas.height = r.canvas.height;
      // el tamaño CSS se fija en unidades lógicas para que el texto conserve su
      // tamaño de lectura; los brackets anchos hacen scroll en vez de encogerse
      previewCanvas.style.width = `${r.cssWidth}px`;
      previewCanvas.getContext('2d')?.drawImage(r.canvas, 0, 0);
    } finally {
      rendering = false;
    }
  }

  async function download() {
    const r = await renderBracket(EXPORT_SCALE);
    if (!r) return;
    const stamp = new Date().toISOString().split('T')[0];
    const suffix = field === 'random' ? `random${poolDepth}` : field === 'pick' ? 'picked' : `top${effectiveSize}`;
    await downloadCanvasPng(r.canvas, `march-madness-${field === 'pick' ? 'mixed' : entityTab}-${effectiveSize}-${suffix}-${stamp}.png`);
  }

  onMount(async () => {
    metric = getRankingMetric();
    me = await api.me().catch(() => null);
  });

  $effect(() => {
    // recarga y reinicia el bracket cuando cambia cualquier parámetro de setup
    void entityTab; void bracketSize; void field; void poolDepth; void metric; void range; void startDate; void endDate; void roster;
    loadData();
  });

  $effect(() => {
    // el bracket se repinta al terminar o al abrirlo manualmente
    void rounds; void cursor;
    if ((finished || showBracket) && rounds.length > 0) updatePreview();
  });
</script>

<svelte:window onkeydown={onKeydown} />

<div class="page-header">
  <h1>March Madness</h1>
  <p>
    {field === 'random' ? `Draw a random field of ${entityTab}` : `Seed your top ${entityTab}`}
    into a bracket and pick your way to a champion.
  </p>
</div>

<TimeRangeSelector value={range} onchange={setRange} {startDate} {endDate} ondatechange={setCustomDates} />

<div class="card controls">
  <div class="control-group">
    <span class="control-label">Field</span>
    <div class="toggle-group">
      <button class="toggle-btn" class:active={field === 'top'} onclick={() => field = 'top'}>Top {bracketSize}</button>
      <button class="toggle-btn" class:active={field === 'random'} onclick={() => field = 'random'}>Random</button>
      <button class="toggle-btn" class:active={field === 'pick'} onclick={() => field = 'pick'}>Pick</button>
    </div>
  </div>

  {#if field !== 'pick'}
    <div class="control-group">
      <span class="control-label">Type</span>
      <div class="toggle-group">
        <button class="toggle-btn" class:active={entityTab === 'artists'} onclick={() => entityTab = 'artists'}>Artists</button>
        <button class="toggle-btn" class:active={entityTab === 'tracks'} onclick={() => entityTab = 'tracks'}>Tracks</button>
        <button class="toggle-btn" class:active={entityTab === 'albums'} onclick={() => entityTab = 'albums'}>Albums</button>
      </div>
    </div>

    <div class="control-group">
      <span class="control-label">Bracket</span>
      <div class="toggle-group">
        {#each BRACKET_SIZES as n}
          <button class="toggle-btn" class:active={bracketSize === n} onclick={() => setBracketSize(n)}>{n}</button>
        {/each}
      </div>
    </div>
  {:else}
    <div class="control-group">
      <span class="control-label">Bracket</span>
      <span class="auto-size">{effectiveSize} <small>auto</small></span>
    </div>
  {/if}

  {#if field === 'random'}
    <div class="control-group">
      <span class="control-label">Pool</span>
      <div class="toggle-group">
        {#each POOL_DEPTHS as n}
          <button
            class="toggle-btn"
            class:active={poolDepth === n}
            disabled={n <= bracketSize}
            title={n <= bracketSize ? `Needs to be bigger than the ${bracketSize}-entry bracket` : ''}
            onclick={() => poolDepth = n}
          >Top {n}</button>
        {/each}
      </div>
    </div>
  {/if}

  <div class="control-group">
    <span class="control-label">Seed by</span>
    <div class="toggle-group">
      <button class="toggle-btn" class:active={metric === 'time'} onclick={() => metric = 'time'}>Time</button>
      <button class="toggle-btn" class:active={metric === 'plays'} onclick={() => metric = 'plays'}>Plays</button>
    </div>
  </div>

  <div class="control-actions">
    {#if field === 'random'}
      <button class="ghost-btn" onclick={reshuffle} disabled={pool.length === 0}>Reshuffle</button>
    {/if}
    {#if field === 'pick'}
      <button class="ghost-btn" onclick={() => roster = []} disabled={roster.length === 0}>Clear field</button>
    {/if}
    <button class="ghost-btn" onclick={undo} disabled={history.length === 0}>Undo</button>
    <button class="ghost-btn" onclick={replay} disabled={rounds.length === 0}>Reset</button>
  </div>
</div>

{#if field === 'pick'}
  <div class="card picker-card">
    <LibraryPicker onadd={addToRoster} />

    <div class="roster">
      <span class="control-label">Field · {roster.length} {roster.length === 1 ? 'entry' : 'entries'}</span>
      {#if roster.length === 0}
        <p class="hint">Search for artists, albums or tracks, or pull an artist's whole discography. The bracket sizes itself to what you add.</p>
      {:else}
        <div class="roster-chips">
          {#each roster as r (r.key)}
            <button class="roster-chip" onclick={() => removeFromRoster(r.key)} title="Remove {r.name}">
              {#if r.imageUrl}<img src={r.imageUrl} alt="" />{/if}
              <span>{r.name}</span>
              <span class="roster-x">×</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>
  </div>
{/if}

{#if field === 'random' && !loading && entries.length > 0}
  <div class="notice">
    Drawn at random from your top {Math.min(poolDepth, pool.length)} {entityTab}, weighted so what you
    actually play is likelier to show up. <button class="link-btn" onclick={reshuffle}>Reshuffle</button> for a new field.
  </div>
{/if}

{#if loading}
  <div class="loading"><div class="spinner"></div></div>
{:else if entries.length < 2}
  <div class="empty">Not enough {entityTab} in the selected range to build a bracket.</div>
{:else}
  {#if entries.length < effectiveSize}
    <div class="notice">
      {#if field === 'pick'}
        {entries.length} picked — the remaining {effectiveSize - entries.length} slots are byes.
      {:else}
        Only {entries.length} {entityTab} in this range — the remaining {effectiveSize - entries.length} slots are byes.
      {/if}
    </div>
  {/if}

  <div class="progress-rail">
    <div class="progress-meta">
      <span class="round-name">{finished ? 'Champion' : roundLabel(cursor.round)}</span>
      <span class="match-count">{finished ? totalMatches : playedMatches + 1} / {totalMatches}</span>
    </div>
    <div class="progress-track">
      <div class="progress-fill" style="width: {(playedMatches / totalMatches) * 100}%"></div>
    </div>
  </div>

  {#if finished && champion}
    <div class="card champion-card">
      <div class="champion-label">Your champion</div>
      <div class="champion-body">
        {#if champion.imageUrl}
          <img class="champion-img" src={champion.imageUrl} alt={champion.name} />
        {:else}
          <div class="champion-img placeholder">{champion.name.charAt(0)}</div>
        {/if}
        <div class="champion-info">
          <div class="champion-name">{champion.name}</div>
          {#if champion.subtitle}<div class="champion-sub">{champion.subtitle}</div>{/if}
          <div class="champion-stats">
            Seed {champion.seed} · {formatNumber(champion.playCount)} plays · {formatHours(champion.totalMs)}
          </div>
        </div>
      </div>
      <div class="champion-footnote">
        {#if runnerUp}Beat <strong>{runnerUp.name}</strong> in the final. {/if}
        {#if entries[0] && entries[0].id !== champion.id}
          {field === 'random' ? 'The top seed in this field was' : 'Your most-played was'}
          <strong>{entries[0].name}</strong> — the bracket disagreed.
        {:else}
          Your top seed went all the way.
        {/if}
      </div>
      <div class="champion-actions">
        <button class="download-btn" onclick={download} disabled={rendering}>
          {rendering ? 'Generating...' : 'Download PNG'}
        </button>
        <button class="ghost-btn" onclick={replay}>Play again</button>
      </div>
    </div>
  {:else if pair}
    <div class="matchup">
      {#each pair as side, i (side?.id ?? i)}
        <button class="contender" onclick={() => pick(side)}>
          {#if side?.imageUrl}
            <img class="contender-img" src={side.imageUrl} alt={side.name} />
          {:else}
            <div class="contender-img placeholder">{side?.name.charAt(0) ?? '?'}</div>
          {/if}
          <div class="seed-badge">{side?.seed}</div>
          <div class="contender-name">{side?.name}</div>
          {#if side?.subtitle}<div class="contender-sub">{side.subtitle}</div>{/if}
          <div class="contender-stat">{side ? metricLabel(side) : ''}</div>
          <div class="contender-key">{i === 0 ? '←' : '→'}</div>
        </button>
        {#if i === 0}<div class="versus">vs</div>{/if}
      {/each}
    </div>
    <div class="hint-row">Click a card, or use ← / → to pick. Backspace undoes.</div>
  {/if}

  <div class="bracket-section">
    <button class="ghost-btn" onclick={() => showBracket = !showBracket}>
      {showBracket ? 'Hide bracket' : 'Show bracket'}
    </button>
    {#if showBracket || finished}
      <div class="preview-wrap">
        <canvas bind:this={previewCanvas} class="preview"></canvas>
      </div>
      {#if !finished}
        <button class="download-btn" onclick={download} disabled={rendering}>
          {rendering ? 'Generating...' : 'Download PNG'}
        </button>
      {/if}
    {/if}
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
    gap: 1.25rem;
    align-items: flex-end;
    margin-bottom: 1rem;
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

  .control-actions {
    margin-left: auto;
    display: flex;
    gap: 0.4rem;
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
    transition: all 0.05s;
  }

  .toggle-btn:hover:not(:disabled) { border-color: var(--text-muted); color: var(--text); }
  .toggle-btn.active { background: var(--accent); border-color: var(--accent); color: #000; }
  .toggle-btn:disabled { opacity: 0.35; cursor: not-allowed; }

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

  .notice {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.6rem 0.9rem;
    color: var(--text-muted);
    font-size: 0.85rem;
    margin-bottom: 1rem;
    line-height: 1.5;
  }

  .auto-size {
    font-size: 0.95rem;
    color: var(--text);
    font-weight: 600;
    padding: 0.3rem 0;
  }

  .auto-size small {
    color: var(--text-muted);
    font-weight: 400;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .picker-card {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    margin-bottom: 1rem;
  }

  .roster {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .roster-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    max-height: 190px;
    overflow-y: auto;
  }

  .roster-chip {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.2rem 0.45rem 0.2rem 0.2rem;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 0.78rem;
    cursor: pointer;
    max-width: 220px;
  }

  .roster-chip:hover { border-color: #ef476f; }
  .roster-chip:hover .roster-x { color: #ef476f; }

  .roster-chip img {
    width: 22px;
    height: 22px;
    border-radius: 3px;
    object-fit: cover;
    flex-shrink: 0;
  }

  .roster-chip span:not(.roster-x) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .roster-x { color: var(--text-muted); flex-shrink: 0; }

  .hint {
    color: var(--text-muted);
    font-size: 0.85rem;
    margin: 0;
    line-height: 1.5;
  }

  .link-btn {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: var(--accent);
    cursor: pointer;
    text-decoration: underline;
  }

  .progress-rail {
    margin-bottom: 1.25rem;
  }

  .progress-meta {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 0.4rem;
  }

  .round-name {
    font-size: 1rem;
    font-weight: 600;
    color: var(--text);
  }

  .match-count {
    font-size: 0.8rem;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }

  .progress-track {
    height: 4px;
    background: var(--border);
    border-radius: 2px;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: var(--accent);
    transition: width 0.15s;
  }

  .matchup {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    gap: 1rem;
    align-items: center;
  }

  .versus {
    color: var(--text-muted);
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .contender {
    position: relative;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1.25rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.4rem;
    cursor: pointer;
    color: inherit;
    font: inherit;
    text-align: center;
    transition: border-color 0.05s, transform 0.05s;
  }

  .contender:hover {
    border-color: var(--accent);
    transform: translateY(-2px);
  }

  .contender-img {
    width: 160px;
    height: 160px;
    object-fit: cover;
    border-radius: var(--radius);
  }

  .placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-hover, #161a1d);
    color: var(--text-muted);
    font-size: 3rem;
    font-weight: 600;
  }

  .seed-badge {
    position: absolute;
    top: 0.6rem;
    left: 0.6rem;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.1rem 0.4rem;
    font-size: 0.7rem;
    color: var(--text-muted);
  }

  .contender-name {
    font-size: 1.05rem;
    font-weight: 600;
    color: var(--text);
    line-height: 1.3;
  }

  .contender-sub {
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  .contender-stat {
    font-size: 0.85rem;
    color: var(--accent);
    font-variant-numeric: tabular-nums;
  }

  .contender-key {
    font-size: 0.75rem;
    color: var(--text-muted);
    opacity: 0.6;
  }

  .hint-row {
    text-align: center;
    color: var(--text-muted);
    font-size: 0.8rem;
    margin-top: 0.9rem;
  }

  .champion-card {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
  }

  .champion-label {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--accent);
  }

  .champion-body {
    display: flex;
    gap: 1rem;
    align-items: center;
  }

  .champion-img {
    width: 120px;
    height: 120px;
    object-fit: cover;
    border-radius: var(--radius);
  }

  .champion-info {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .champion-name {
    font-size: 1.6rem;
    font-weight: 700;
    color: var(--text);
    line-height: 1.2;
  }

  .champion-sub {
    color: var(--text-muted);
    font-size: 0.9rem;
  }

  .champion-stats {
    color: var(--text-muted);
    font-size: 0.85rem;
  }

  .champion-footnote {
    color: var(--text-muted);
    font-size: 0.85rem;
    line-height: 1.5;
  }

  .champion-actions {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }

  .download-btn {
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

  .bracket-section {
    margin-top: 1.5rem;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.75rem;
  }

  .preview-wrap {
    width: 100%;
    overflow-x: auto;
  }

  /* sin max-width: el ancho lo fija updatePreview en px lógicos y el wrapper
     hace scroll horizontal, en vez de encoger el bracket hasta ser ilegible */
  .preview {
    display: block;
    height: auto;
    border-radius: var(--radius);
    border: 1px solid var(--border);
  }

  .empty {
    text-align: center;
    color: var(--text-muted);
    padding: 3rem;
  }

  @media (max-width: 640px) {
    .matchup {
      grid-template-columns: 1fr;
    }

    .versus {
      text-align: center;
    }

    .contender-img {
      width: 120px;
      height: 120px;
    }

    .control-actions {
      margin-left: 0;
    }
  }
</style>
