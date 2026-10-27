<script lang="ts">
  import { isAbortError } from '$lib/utils/errors';
  import { onMount, untrack } from 'svelte';
  import { api, createFetchController, getRankingMetric, type DateRangeParams, type MeResponse, type RankingMetric } from '$lib/api';
  import TimeRangeSelector from '$lib/components/TimeRangeSelector.svelte';
  import LibraryPicker from '$lib/components/LibraryPicker.svelte';
  import { downloadCanvasPng } from '$lib/canvas-export';
  import { formatNumber, formatHours } from '$lib/utils/format';
  import { weightedSample } from '$lib/utils/sample';
  import { fromTopItem, metricValue, type EntityTab, type LibraryItem, type TopItem } from '$lib/utils/library-items';
  import {
    DRAW_MODES, FORMATS, FORMAT_IDS, drawOrder, replay, upsets,
    type Block, type DrawMode, type FormatId, type Match, type TableRow, type Upset,
  } from '$lib/tournament';
  import { renderBoard, type BoardRender, type Rect } from './board-canvas';

  const FIELD_SIZES = [8, 16, 32, 64] as const;
  // tope del campo en pick: el roster puede crecer sin límite, el torneo no
  const MAX_FIELD = FIELD_SIZES[FIELD_SIZES.length - 1];
  // el backend topa el limit de /stats/top-* en 200 (routes/stats/_shared.ts)
  const POOL_DEPTHS = [50, 100, 200] as const;

  const DRAW_LABELS: Record<DrawMode, string> = { seeded: 'Seeded', pots: 'Pots', random: 'Random' };
  const DRAW_HINTS: Record<DrawMode, string> = {
    seeded: 'Placed by rank: top seeds are kept apart until late.',
    pots: 'Shuffled within seed tiers: a fresh draw every time, but top seeds are still kept apart.',
    random: 'Anything goes: top seeds can meet straight away.',
  };
  // nombre del formato en el subtítulo del png
  const FORMAT_NAMES: Record<FormatId, string> = {
    knockout: 'knockout', double: 'double elimination', groups: 'groups + knockout', swiss: 'swiss + knockout', koth: 'king of the hill',
  };

  // factores de supersampling del canvas (ver renderBoard)
  const MIN_RENDER_SCALE = 2;
  const EXPORT_SCALE = 2;

  // duraciones de las animaciones: llegan al css como custom properties, así
  // los @keyframes y los temporizadores que retiran cada efecto no se desalinean
  const PICK_MS = 420;
  const BANNER_MS = 1300;
  const TOAST_MS = 2600;
  // avisos de pase o caída a la vez: cerrar un grupo de cuatro da cuatro
  const MAX_TOASTS = 4;
  // lluvia del campeón: px de caída (mínimo + variación), deriva lateral en px,
  // giro en grados y escalonado de salida
  const CONFETTI = { count: 40, fallMin: 140, fallSpread: 220, sway: 60, spin: 540, staggerMs: 350 } as const;
  const CONFETTI_COLORS = ['var(--accent)', 'var(--gold)', 'var(--info)', 'var(--like)', 'var(--warning)'];

  type Source = 'top' | 'random' | 'pick';
  // seed = puesto real por la métrica dentro del campo, no la posición del sorteo
  type Entry = LibraryItem & { seed: number };

  let entityTab = $state<EntityTab>('artists');
  let fieldSize = $state<typeof FIELD_SIZES[number]>(16);
  let source = $state<Source>('top');
  let poolDepth = $state<typeof POOL_DEPTHS[number]>(100);
  let metric = $state<RankingMetric>('time');
  let range = $state('6months');
  let startDate = $state('');
  let endDate = $state('');
  let format = $state<FormatId>('knockout');
  let draw = $state<DrawMode>('seeded');
  let blind = $state(false);

  let pool = $state<LibraryItem[]>([]);
  // en modo pick el campo lo monta el usuario a mano y el torneo se dimensiona a él
  let roster = $state<LibraryItem[]>([]);
  // el campo por ranking y el mismo en el orden del sorteo: el motor trabaja
  // con posiciones de `entries`
  let ranked = $state<Entry[]>([]);
  let entries = $state<Entry[]>([]);
  // el torneo entero se deriva de esta lista (ver replay en $lib/tournament)
  let winners = $state<number[]>([]);
  let loading = $state(true);
  let showBoard = $state(false);
  let me = $state<MeResponse | null>(null);
  let previewCanvas = $state<HTMLCanvasElement | null>(null);
  let rendering = $state(false);
  let renderSeq = 0;
  let previewWrap = $state<HTMLDivElement | null>(null);
  // dónde cayó la última elección en el tablero; `step` son los partidos jugados
  // al pintarlo, y solo un step nuevo rehace el destello
  let boardFocus = $state<{ step: number; rects: Rect[] }>({ step: -1, rects: [] });

  // el partido recién decidido, pintado encima un instante mientras entra el
  // siguiente: el elegido se ilumina y el otro cae
  interface Ghost {
    id: number;
    sides: [Entry, Entry];
    notes?: [string, string];
    won: number;
    upset: boolean;
  }
  let ghost = $state<Ghost | null>(null);
  // rótulo del cambio de fase ("Sweet 16", "Swiss · Round 3 of 5")
  let banner = $state<{ id: number; text: string } | null>(null);
  // quién acaba de pasar o caer en las tablas (suizo y grupos)
  let toasts = $state<{ id: number; entry: Entry; advanced: boolean; record: string }[]>([]);
  // sentido del último paso: el partido siguiente entra por la derecha al
  // elegir y por la izquierda al deshacer
  let stepDir = $state<1 | -1>(1);
  // entra en la clave del partido: un sorteo nuevo anima aunque el índice no cambie
  let drawSeq = $state(0);
  let fxSeq = 0;

  const fetchCtrl = createFetchController();

  const fmt = $derived(FORMATS[format]);
  const spec = $derived({ n: entries.length });
  const run = $derived(entries.length >= fmt.minEntries ? replay(fmt, spec, winners) : null);
  const pending = $derived(run?.pending ?? null);
  const finished = $derived(run?.outcome != null);
  const champion = $derived(run?.outcome?.champion != null ? entries[run.outcome.champion] : null);
  const runnerUp = $derived(run?.outcome?.runnerUp != null ? entries[run.outcome.runnerUp] : null);
  const played = $derived(run?.log.length ?? 0);
  const total = $derived(Math.max(run?.total ?? 1, 1));
  const byes = $derived(fmt.byes(entries.length));
  const canReshuffle = $derived(source === 'random' || draw !== 'seeded');
  const upsetList = $derived(run ? upsets(run.log, (c) => entries[c].seed) : []);
  const biggestUpset = $derived(upsetList.reduce<Upset | null>((best, u) => (!best || u.gap > best.gap ? u : best), null));
  // cada pieza con su columna, su caída y su giro, sorteados al coronar
  const confetti = $derived(finished
    ? Array.from({ length: CONFETTI.count }, (_, i) => ({
      left: Math.random() * 100,
      fall: CONFETTI.fallMin + Math.random() * CONFETTI.fallSpread,
      sway: (Math.random() * 2 - 1) * CONFETTI.sway,
      spin: (Math.random() * 2 - 1) * CONFETTI.spin,
      delay: Math.random() * CONFETTI.staggerMs,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    }))
    : []);

  const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const phaseOf = (m: Match | null): string | null => (m ? (m.phase ?? m.label) : null);

  // filas ya decididas de las tablas: los motores las marcan al pasar o caer
  const decidedRows = (board: Block[]): Map<number, TableRow> =>
    new Map(board
      .flatMap((b) => (b.kind === 'tables' ? b.tables.flatMap((t) => t.rows) : []))
      .filter((r) => r.qualified || r.eliminated)
      .map((r) => [r.c, r]));

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
    if (source === 'pick') {
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
      const limit = source === 'random' ? poolDepth : fieldSize;
      const items = await fetcher(range, limit, metric, getCustomDates(), undefined, signal);
      if (signal.aborted) return;
      pool = items
        .map((i) => fromTopItem(i as TopItem, entityTab))
        .filter((e): e is LibraryItem => e !== null);
      buildField();
    } catch (e) {
      if (isAbortError(e)) return;
      throw e;
    } finally {
      if (!signal.aborted) loading = false;
    }
  }

  // los que ya estén en el roster se ignoran
  function addToRoster(items: LibraryItem[]) {
    const have = new Set(roster.map((r) => r.key));
    const fresh = items.filter((i) => !have.has(i.key));
    if (fresh.length) roster = [...roster, ...fresh];
  }

  function removeFromRoster(key: string) {
    roster = roster.filter((r) => r.key !== key);
  }

  const metricOf = (p: LibraryItem) => metricValue(p, metric);
  const byMetric = (a: LibraryItem, b: LibraryItem) => metricOf(b) - metricOf(a);

  // decide qué entra en el torneo y le asigna seeds; separado de loadData para
  // poder resortear sin refetch
  function buildField() {
    const size = source === 'pick' ? MAX_FIELD : fieldSize;
    const chosen = source === 'random' ? weightedSample(pool, size, metricOf)
      // si el roster desborda el campo máximo, entran los más escuchados
      : source === 'pick' ? [...roster].sort(byMetric).slice(0, size)
      : pool.slice(0, size);
    // el seed siempre sale del ranking real dentro del campo elegido
    ranked = [...chosen].sort(byMetric).map((e, idx) => ({ ...e, seed: idx + 1 }));
    drawField();
  }

  // coloca el campo según el sorteo y los bombos del formato (los de grupos no
  // son los del cuadro); separado de buildField para cambiar de formato o
  // volver a sortear sin tocar quién entra
  function drawField() {
    entries = drawOrder(ranked.length, draw, fmt.tierOf).map((i) => ranked[i]);
    freshStart();
  }

  // vuelve al primer partido: tira los efectos en vuelo y anuncia la primera fase
  function freshStart() {
    winners = [];
    ghost = null;
    toasts = [];
    stepDir = 1;
    drawSeq++;
    showBanner(phaseOf(pending));
  }

  // con movimiento reducido el css esconde el rótulo; el temporizador lo retira igual
  function showBanner(text: string | null) {
    if (!text) return;
    const id = ++fxSeq;
    banner = { id, text };
    setTimeout(() => { if (banner?.id === id) banner = null; }, BANNER_MS);
  }

  function showGhost(match: Match, c: number) {
    const id = ++fxSeq;
    const sides: [Entry, Entry] = [entries[match.a], entries[match.b]];
    const won = c === match.a ? 0 : 1;
    // a ciegas no se delata el seed
    ghost = { id, sides, notes: match.notes, won, upset: !blind && sides[won].seed > sides[1 - won].seed };
    setTimeout(() => { if (ghost?.id === id) ghost = null; }, PICK_MS);
  }

  // avisa de lo que la elección acaba de decidir en las tablas
  function announceRows(before: Map<number, TableRow>, after: Map<number, TableRow>) {
    const fresh = [...after.values()]
      .filter((r) => !before.has(r.c))
      .map((r) => ({ id: ++fxSeq, entry: entries[r.c], advanced: r.qualified, record: r.cells[0] }));
    if (!fresh.length) return;
    toasts = [...toasts, ...fresh].slice(-MAX_TOASTS);
    const ids = new Set(fresh.map((t) => t.id));
    setTimeout(() => { toasts = toasts.filter((t) => !ids.has(t.id)); }, TOAST_MS);
  }

  // nuevo sorteo; con campo aleatorio también cambia quién entra
  function reshuffle() {
    if (source === 'random') buildField();
    else drawField();
    showBoard = false;
  }

  // un pool que no supera al campo no sortea nada (entraría entero), así que al
  // agrandar el campo se sube el pool al primero que siga siendo mayor
  function setFieldSize(n: typeof FIELD_SIZES[number]) {
    fieldSize = n;
    if (poolDepth <= n) poolDepth = POOL_DEPTHS.find((p) => p > n) ?? POOL_DEPTHS[POOL_DEPTHS.length - 1];
  }

  function choose(c: number) {
    if (!run || !pending || (c !== pending.a && c !== pending.b)) return;
    const match = pending;
    const before = decidedRows(run.board);
    showGhost(match, c);
    winners = [...winners, c];
    stepDir = 1;
    // `run` y `pending` son $derived: leídos tras la escritura ya son el estado nuevo
    if (finished) {
      // la corona no comparte escena con avisos de rondas anteriores
      banner = null;
      toasts = [];
      return;
    }
    announceRows(before, decidedRows(run.board));
    const next = phaseOf(pending);
    if (next !== phaseOf(match)) showBanner(next);
  }

  function undo() {
    winners = winners.slice(0, -1);
    stepDir = -1;
    ghost = null;
    toasts = [];
  }

  function restart() {
    freshStart();
    showBoard = false;
  }

  function onKeydown(e: KeyboardEvent) {
    if (!pending) return;
    // escribir en el buscador del modo pick no puede elegir ni deshacer
    if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable]')) return;
    if (e.key === 'ArrowLeft' || e.key === '1') { e.preventDefault(); choose(pending.a); }
    else if (e.key === 'ArrowRight' || e.key === '2') { e.preventDefault(); choose(pending.b); }
    else if (e.key === 'Backspace' || e.key === 'z') { e.preventDefault(); undo(); }
  }

  // etiqueta legible del enfrentamiento (no confundir con metricValue del util,
  // que devuelve el número con el que se siembra)
  function metricLabel(e: Entry): string {
    return metric === 'plays' ? `${formatNumber(e.playCount)} plays` : formatHours(e.totalMs);
  }

  function boardInput(): BoardRender {
    const fieldLabel = source === 'random' ? `random from top ${Math.min(poolDepth, pool.length)}`
      : source === 'pick' ? `${entries.length} hand-picked`
      : `top ${entries.length}`;
    const parts = [
      source === 'pick' ? null : entityTab, rangeLabel(), fieldLabel, FORMAT_NAMES[format],
      draw === 'seeded' ? null : `${draw} draw`,
      finished ? `${upsetList.length} ${upsetList.length === 1 ? 'upset' : 'upsets'}` : null,
    ];
    return {
      blocks: run?.board ?? [],
      entries: entries.map((e) => ({
        name: e.name, seed: e.seed, imageUrl: e.imageUrl,
        stat: metric === 'plays' ? formatNumber(e.playCount) : formatHours(e.totalMs),
      })),
      title: 'March Madness',
      subtitle: parts.filter(Boolean).join(' · '),
      owner: me?.displayName ?? me?.spotifyId ?? 'sis',
      // a ciegas el tablero tampoco enseña cifras hasta que hay campeón
      blind: blind && !finished,
      // tras deshacer no se resalta nada: el último partido ya no es la última elección
      focus: stepDir > 0 ? (run?.log.at(-1) ?? null) : null,
    };
  }

  async function updatePreview() {
    const seq = ++renderSeq;
    const step = played;
    rendering = true;
    try {
      // nunca por debajo de 2x: el PNG descargado y el preview comparten render,
      // y en pantallas 1x un 2x sigue mejorando el antialiasing del texto
      const scale = Math.max(window.devicePixelRatio || 1, MIN_RENDER_SCALE);
      const r = await renderBoard(boardInput(), scale);
      // un render más nuevo ya está en marcha: este llega tarde y no pinta
      if (seq !== renderSeq || !r || !previewCanvas) return;
      previewCanvas.width = r.canvas.width;
      previewCanvas.height = r.canvas.height;
      // el tamaño CSS se fija en unidades lógicas para que el texto conserve su
      // tamaño de lectura; los tableros anchos hacen scroll en vez de encogerse
      previewCanvas.style.width = `${r.cssWidth}px`;
      previewCanvas.getContext('2d')?.drawImage(r.canvas, 0, 0);
      const fresh = step !== boardFocus.step;
      boardFocus = { step, rects: r.focus };
      if (fresh) revealFocus(r.focus[0]);
    } finally {
      if (seq === renderSeq) rendering = false;
    }
  }

  // trae a la vista lo recién decidido si el tablero ancho lo dejó fuera por un lado
  function revealFocus(rect: Rect | undefined) {
    if (!rect || !previewWrap) return;
    const { scrollLeft, clientWidth } = previewWrap;
    if (rect.x >= scrollLeft && rect.x + rect.w <= scrollLeft + clientWidth) return;
    previewWrap.scrollTo({ left: rect.x + rect.w / 2 - clientWidth / 2, behavior: reducedMotion() ? 'auto' : 'smooth' });
  }

  async function download() {
    const r = await renderBoard(boardInput(), EXPORT_SCALE);
    if (!r) return;
    const stamp = new Date().toISOString().split('T')[0];
    const suffix = source === 'random' ? `random${poolDepth}` : source === 'pick' ? 'picked' : `top${fieldSize}`;
    await downloadCanvasPng(r.canvas, `march-madness-${source === 'pick' ? 'mixed' : entityTab}-${format}-${entries.length}-${suffix}-${stamp}.png`);
  }

  onMount(async () => {
    metric = getRankingMetric();
    me = await api.me().catch(() => null);
  });

  $effect(() => {
    // recarga y rehace el campo cuando cambia cualquier parámetro de selección
    void entityTab; void fieldSize; void source; void poolDepth; void metric; void range; void startDate; void endDate; void roster;
    untrack(loadData);
  });

  $effect(() => {
    // formato y sorteo solo recolocan el campo ya elegido
    void format; void draw;
    untrack(drawField);
  });

  $effect(() => {
    // el tablero se repinta al terminar o al abrirlo, y con cada elección mientras está abierto
    void run; void blind;
    if ((finished || showBoard) && run) untrack(updatePreview);
  });
</script>

<svelte:window onkeydown={onKeydown} />

{#snippet contenderBody(side: Entry, note: string | undefined, i: number)}
  {#if side.imageUrl}
    <img class="contender-img" src={side.imageUrl} alt={side.name} />
  {:else}
    <div class="contender-img placeholder">{side.name.charAt(0)}</div>
  {/if}
  {#if !blind}<div class="seed-badge">{side.seed}</div>{/if}
  <div class="contender-name">{side.name}</div>
  {#if side.subtitle}<div class="contender-sub">{side.subtitle}</div>{/if}
  {#if note}<div class="contender-note">{note}</div>{/if}
  {#if !blind}<div class="contender-stat">{metricLabel(side)}</div>{/if}
  <div class="contender-key">{i === 0 ? '←' : '→'}</div>
{/snippet}

<TimeRangeSelector value={range} onchange={setRange} {startDate} {endDate} ondatechange={setCustomDates} />

<div class="card controls">
  <div class="control-group">
    <span class="control-label">Field</span>
    <div class="toggle-group">
      <button class="toggle-btn" class:active={source === 'top'} onclick={() => source = 'top'}>Top {fieldSize}</button>
      <button class="toggle-btn" class:active={source === 'random'} onclick={() => source = 'random'}>Random</button>
      <button class="toggle-btn" class:active={source === 'pick'} onclick={() => source = 'pick'}>Pick</button>
    </div>
  </div>

  {#if source !== 'pick'}
    <div class="control-group">
      <span class="control-label">Type</span>
      <div class="toggle-group">
        <button class="toggle-btn" class:active={entityTab === 'artists'} onclick={() => entityTab = 'artists'}>Artists</button>
        <button class="toggle-btn" class:active={entityTab === 'tracks'} onclick={() => entityTab = 'tracks'}>Tracks</button>
        <button class="toggle-btn" class:active={entityTab === 'albums'} onclick={() => entityTab = 'albums'}>Albums</button>
      </div>
    </div>

    <div class="control-group">
      <span class="control-label">Size</span>
      <div class="toggle-group">
        {#each FIELD_SIZES as n}
          <button class="toggle-btn" class:active={fieldSize === n} onclick={() => setFieldSize(n)}>{n}</button>
        {/each}
      </div>
    </div>
  {:else}
    <div class="control-group">
      <span class="control-label">Size</span>
      <span class="auto-size">{entries.length} <small>auto</small></span>
    </div>
  {/if}

  {#if source === 'random'}
    <div class="control-group">
      <span class="control-label">Pool</span>
      <div class="toggle-group">
        {#each POOL_DEPTHS as n}
          <button
            class="toggle-btn"
            class:active={poolDepth === n}
            disabled={n <= fieldSize}
            title={n <= fieldSize ? `Needs to be bigger than the ${fieldSize}-entry field` : ''}
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
</div>

<div class="card controls">
  <div class="control-group">
    <span class="control-label">Format</span>
    <div class="toggle-group">
      {#each FORMAT_IDS as id}
        <button class="toggle-btn" class:active={format === id} onclick={() => format = id}>{FORMATS[id].label}</button>
      {/each}
    </div>
  </div>

  <div class="control-group">
    <span class="control-label">Draw</span>
    <div class="toggle-group">
      {#each DRAW_MODES as mode}
        <button class="toggle-btn" class:active={draw === mode} title={DRAW_HINTS[mode]} onclick={() => draw = mode}>{DRAW_LABELS[mode]}</button>
      {/each}
    </div>
  </div>

  <div class="control-group">
    <span class="control-label">Stats</span>
    <div class="toggle-group">
      <button class="toggle-btn" class:active={!blind} onclick={() => blind = false}>Shown</button>
      <button class="toggle-btn" class:active={blind} title="Hide seeds and play stats until a champion is crowned" onclick={() => blind = true}>Blind</button>
    </div>
  </div>

  <div class="control-actions">
    {#if canReshuffle}
      <button class="ghost-btn" onclick={reshuffle} disabled={ranked.length === 0}>Reshuffle</button>
    {/if}
    {#if source === 'pick'}
      <button class="ghost-btn" onclick={() => roster = []} disabled={roster.length === 0}>Clear field</button>
    {/if}
    <button class="ghost-btn" onclick={undo} disabled={winners.length === 0}>Undo</button>
    <button class="ghost-btn" onclick={restart} disabled={!run}>Reset</button>
  </div>
</div>

{#if source === 'pick'}
  <div class="card picker-card">
    <LibraryPicker onadd={addToRoster} />

    <div class="roster">
      <span class="control-label">Field · {roster.length} {roster.length === 1 ? 'entry' : 'entries'}</span>
      {#if roster.length === 0}
        <p class="hint">Search for artists, albums or tracks, or pull an artist's whole discography. The tournament sizes itself to what you add.</p>
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

{#if source === 'random' && !loading && entries.length > 0}
  <div class="notice">
    Drawn at random from your top {Math.min(poolDepth, pool.length)} {entityTab}, weighted so what you
    actually play is likelier to show up. <button class="link-btn" onclick={reshuffle}>Reshuffle</button> for a new field.
  </div>
{/if}

{#if loading}
  <div class="loading"><div class="spinner"></div></div>
{:else if !run}
  <div class="empty">
    {#if source === 'pick'}
      Add at least {fmt.minEntries} entries to the field to start.
    {:else if entries.length < 2}
      Not enough {entityTab} in the selected range to build a tournament.
    {:else}
      {fmt.label} needs at least {fmt.minEntries} entries — pick another format or a wider range.
    {/if}
  </div>
{:else}
  {#if source !== 'pick' && entries.length < fieldSize}
    <div class="notice">
      Only {entries.length} {entityTab} in this range{byes ? ` — the remaining ${byes} bracket slots are byes` : ''}.
    </div>
  {:else if byes}
    <div class="notice">{entries.length} entries — the remaining {byes} bracket slots are byes.</div>
  {/if}

  <div class="notice">
    {fmt.describe(spec)} <strong>{total} picks.</strong>
    {#if draw !== 'seeded'}{DRAW_HINTS[draw]}{/if}
    {#if blind}Seeds and stats stay hidden until the champion is crowned.{/if}
  </div>

  <div class="progress-rail">
    <div class="progress-meta">
      <span class="round-name">{finished ? 'Champion' : pending?.label}</span>
      <span class="match-count">{finished ? total : played + 1} / {total}</span>
    </div>
    <div class="progress-track">
      <div class="progress-fill" style="width: {(played / total) * 100}%"></div>
    </div>
  </div>

  <div class="match-stage" style:--pick-ms="{PICK_MS}ms" style:--banner-ms="{BANNER_MS}ms" style:--toast-ms="{TOAST_MS}ms">
    {#if finished && champion}
      <div class="card champion-card">
        <div class="champion-label">Your champion</div>
        <div class="champion-body">
          <div class="champion-portrait">
            <svg class="crown" viewBox="0 0 24 16" aria-hidden="true"><path d="M2 15 1 4l6 4 5-7 5 7 6-4-1 11z" /></svg>
            {#if champion.imageUrl}
              <img class="champion-img" src={champion.imageUrl} alt={champion.name} />
            {:else}
              <div class="champion-img placeholder">{champion.name.charAt(0)}</div>
            {/if}
          </div>
          <div class="champion-info">
            <div class="champion-name">{champion.name}</div>
            {#if champion.subtitle}<div class="champion-sub">{champion.subtitle}</div>{/if}
            <div class="champion-stats">
              Seed {champion.seed} · {formatNumber(champion.playCount)} plays · {formatHours(champion.totalMs)}
            </div>
          </div>
        </div>
        <div class="champion-footnote">
          {#if runnerUp}Beat <strong>{runnerUp.name}</strong> in the final.{/if}
          {#if ranked[0] && ranked[0].key !== champion.key}
            {source === 'random' ? 'The top seed in this field was' : 'Your most-played was'}
            <strong>{ranked[0].name}</strong> — the tournament disagreed.
          {:else}
            Your top seed went all the way.
          {/if}
        </div>
        <div class="recap">
          <span class="recap-label">Heart vs data</span>
          {#if upsetList.length === 0}
            You sided with your stats in all {played} picks: every matchup went to the higher seed.
          {:else}
            You went against your own stats in <strong>{upsetList.length}</strong> of {played} picks
            ({Math.round((upsetList.length / played) * 100)}%).
            {#if biggestUpset}
              Biggest upset: <strong>#{entries[biggestUpset.winner].seed} {entries[biggestUpset.winner].name}</strong>
              over <strong>#{entries[biggestUpset.loser].seed} {entries[biggestUpset.loser].name}</strong>
              ({biggestUpset.label}).
            {/if}
          {/if}
        </div>
        <div class="champion-actions">
          <button class="download-btn" onclick={download} disabled={rendering}>
            {rendering ? 'Generating...' : 'Download PNG'}
          </button>
          <button class="ghost-btn" onclick={restart}>Play again</button>
        </div>
        <div class="confetti" aria-hidden="true">
          {#each confetti as p, i (i)}
            <span
              style:left="{p.left}%"
              style:background={p.color}
              style:--fall="{p.fall}px"
              style:--sway="{p.sway}px"
              style:--spin="{p.spin}deg"
              style:--delay="{p.delay}ms"
            ></span>
          {/each}
        </div>
      </div>
    {:else if pending}
      {#key `${drawSeq}-${played}`}
        <div class="matchup matchup-live" style:--dir={stepDir}>
          {#each [pending.a, pending.b] as c, i (c)}
            <button class="contender" onclick={() => choose(c)}>
              {@render contenderBody(entries[c], pending.notes?.[i], i)}
            </button>
            {#if i === 0}<div class="versus">vs</div>{/if}
          {/each}
        </div>
      {/key}
    {/if}

    {#if ghost}
      {#key ghost.id}
        <div class="matchup ghost" aria-hidden="true" inert>
          {#each ghost.sides as side, i (i)}
            <div class="contender" class:won={ghost.won === i} class:lost={ghost.won !== i}>
              {@render contenderBody(side, ghost.notes?.[i], i)}
              {#if ghost.upset && ghost.won === i}<div class="upset-stamp">Upset</div>{/if}
            </div>
            {#if i === 0}<div class="versus">vs</div>{/if}
          {/each}
        </div>
      {/key}
    {/if}

    {#if banner}
      {#key banner.id}
        <div class="phase-banner" aria-hidden="true"><span>{banner.text}</span></div>
      {/key}
    {/if}

    <div class="toasts" aria-live="polite">
      {#each toasts as t (t.id)}
        <div class="toast" class:out={!t.advanced}>
          {#if t.entry.imageUrl}<img src={t.entry.imageUrl} alt="" />{/if}
          <strong>{t.entry.name}</strong>
          <span class="toast-verdict">{t.advanced ? 'Through' : 'Out'}</span>
          <span class="toast-record">{t.record}</span>
        </div>
      {/each}
    </div>
  </div>

  {#if pending}
    <div class="hint-row">Click a card, or use ← / → to pick. Backspace undoes.</div>
  {/if}

  <div class="bracket-section">
    <button class="ghost-btn" onclick={() => showBoard = !showBoard}>
      {showBoard ? `Hide ${fmt.board}` : `Show ${fmt.board}`}
    </button>
    {#if showBoard || finished}
      <div class="preview-wrap" bind:this={previewWrap}>
        <div class="preview-stage">
          <canvas bind:this={previewCanvas} class="preview"></canvas>
          {#key boardFocus.step}
            {#each boardFocus.rects as r, i (i)}
              <div class="board-focus" style:left="{r.x}px" style:top="{r.y}px" style:width="{r.w}px" style:height="{r.h}px"></div>
            {/each}
          {/key}
        </div>
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
    font-size: var(--fs-sm);
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: var(--track);
  }

  .control-actions {
    margin-left: auto;
    display: flex;
    gap: 0.4rem;
  }

  .toggle-group {
    display: flex;
    flex-wrap: wrap;
    gap: 0.2rem;
  }

  .toggle-btn {
    padding: 0.3rem 0.65rem;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    font-size: var(--fs-sm);
    transition: all 0.05s;
  }

  .toggle-btn:hover:not(:disabled) { border-color: var(--text-muted); color: var(--text); }
  .toggle-btn.active { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
  .toggle-btn:disabled { opacity: 0.35; cursor: not-allowed; }

  .ghost-btn {
    padding: 0.35rem 0.8rem;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    font-size: var(--fs-sm);
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
    font-size: var(--fs-md);
    margin-bottom: 1rem;
    line-height: 1.5;
  }

  .auto-size {
    font-size: var(--fs-md);
    color: var(--text);
    font-weight: 600;
    padding: 0.3rem 0;
  }

  .auto-size small {
    color: var(--text-muted);
    font-weight: 400;
    font-size: var(--fs-xs);
    text-transform: uppercase;
    letter-spacing: var(--track);
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
    font-size: var(--fs-sm);
    cursor: pointer;
    max-width: 220px;
  }

  .roster-chip:hover { border-color: var(--danger); }
  .roster-chip:hover .roster-x { color: var(--danger); }

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
    font-size: var(--fs-md);
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
    font-size: var(--fs-base);
    font-weight: 600;
    color: var(--text);
  }

  .match-count {
    font-size: var(--fs-sm);
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

  /* partido, fantasma del anterior, rótulo y campeón comparten celda: se
     superponen en vez de empujarse mientras dura la transición. El clip en x
     es para el móvil, donde la card ocupa el ancho entero y el escalado del
     elegido sacaba la página de lado; el margen deja respirar al halo */
  .match-stage {
    position: relative;
    display: grid;
    overflow-x: clip;
    overflow-clip-margin: 1rem;
  }

  .match-stage > * {
    grid-area: 1 / 1;
  }

  .matchup {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    gap: 1rem;
    align-items: center;
    align-self: start;
  }

  .matchup-live {
    animation: matchup-in 280ms cubic-bezier(0.2, 0.8, 0.3, 1) calc(var(--pick-ms) * 0.4) both;
  }

  @keyframes matchup-in {
    from { opacity: 0; transform: translateX(calc(var(--dir) * 32px)); }
    to { opacity: 1; transform: none; }
  }

  .ghost {
    z-index: 1;
    pointer-events: none;
  }

  .ghost .won {
    animation: pick-won var(--pick-ms) ease-out forwards;
  }

  .ghost .lost {
    animation: pick-lost var(--pick-ms) ease-in forwards;
  }

  @keyframes pick-won {
    0% { border-color: var(--accent); box-shadow: 0 0 0 0 var(--accent-a40); }
    35% { transform: scale(1.04); border-color: var(--accent); box-shadow: 0 0 0 6px var(--accent-a25); opacity: 1; }
    100% { transform: scale(1.06); border-color: var(--accent); box-shadow: 0 0 0 14px transparent; opacity: 0; }
  }

  @keyframes pick-lost {
    to { transform: translateY(18px) rotate(-2deg); filter: grayscale(1); opacity: 0; }
  }

  .upset-stamp {
    position: absolute;
    top: 0.6rem;
    right: 0.6rem;
    padding: 0.1rem 0.45rem;
    border: 1px solid var(--warning);
    border-radius: var(--radius);
    color: var(--warning);
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    text-transform: uppercase;
    letter-spacing: var(--track-wide);
    transform: rotate(8deg);
    animation: stamp calc(var(--pick-ms) * 0.5) cubic-bezier(0.3, 1.6, 0.5, 1) both;
  }

  @keyframes stamp {
    from { transform: rotate(8deg) scale(2.2); opacity: 0; }
  }

  .phase-banner {
    z-index: 2;
    align-self: center;
    display: flex;
    justify-content: center;
    padding: 0.7rem 1rem;
    background: color-mix(in srgb, var(--bg) 88%, transparent);
    border-block: 1px solid var(--accent-a40);
    pointer-events: none;
    animation: banner var(--banner-ms) ease both;
  }

  .phase-banner span {
    font-family: var(--font-mono);
    font-size: var(--fs-2xl);
    text-transform: uppercase;
    letter-spacing: var(--track-wide);
    color: var(--accent);
    text-align: center;
    animation: banner-text var(--banner-ms) ease both;
  }

  @keyframes banner {
    0% { opacity: 0; transform: scaleY(0.2); }
    12% { opacity: 1; transform: none; }
    78% { opacity: 1; }
    100% { opacity: 0; }
  }

  @keyframes banner-text {
    0% { opacity: 0; letter-spacing: 0.5em; }
    20% { opacity: 1; letter-spacing: var(--track-wide); }
  }

  .toasts {
    position: absolute;
    top: 0.5rem;
    left: 50%;
    z-index: 3;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.3rem;
    transform: translateX(-50%);
    pointer-events: none;
  }

  .toast {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    max-width: 90vw;
    padding: 0.3rem 0.7rem 0.3rem 0.3rem;
    background: var(--bg-card);
    border: 1px solid var(--accent);
    border-radius: var(--radius);
    box-shadow: 0 6px 18px color-mix(in srgb, var(--shadow-color) 35%, transparent);
    font-size: var(--fs-sm);
    white-space: nowrap;
    animation: toast var(--toast-ms) ease both;
  }

  .toast.out { border-color: var(--danger); }

  .toast img {
    width: 22px;
    height: 22px;
    border-radius: 3px;
    object-fit: cover;
    flex-shrink: 0;
  }

  .toast strong {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .toast-verdict {
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    text-transform: uppercase;
    letter-spacing: var(--track-wide);
    color: var(--accent);
  }

  .toast.out .toast-verdict { color: var(--danger); }

  .toast-record {
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }

  @keyframes toast {
    0% { opacity: 0; transform: translateY(-8px); }
    10% { opacity: 1; transform: none; }
    85% { opacity: 1; }
    100% { opacity: 0; }
  }

  .versus {
    color: var(--text-muted);
    font-size: var(--fs-md);
    text-transform: uppercase;
    letter-spacing: var(--track-wide);
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
    background: var(--bg-hover);
    color: var(--text-muted);
    font-size: var(--fs-3xl);
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
    font-size: var(--fs-xs);
    color: var(--text-muted);
  }

  .contender-name {
    font-size: var(--fs-base);
    font-weight: 600;
    color: var(--text);
    line-height: 1.3;
  }

  .contender-sub {
    font-size: var(--fs-sm);
    color: var(--text-muted);
  }

  .contender-note {
    font-size: var(--fs-sm);
    color: var(--text);
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }

  .contender-stat {
    font-size: var(--fs-md);
    color: var(--accent);
    font-variant-numeric: tabular-nums;
  }

  .contender-key {
    font-size: var(--fs-sm);
    color: var(--text-muted);
    opacity: 0.6;
  }

  .hint-row {
    text-align: center;
    color: var(--text-muted);
    font-size: var(--fs-sm);
    margin-top: 0.9rem;
  }

  /* entra cuando el fantasma de la final ya se ha ido */
  .champion-card {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
    animation: champion-in 560ms cubic-bezier(0.2, 0.9, 0.3, 1.15) var(--pick-ms) both;
  }

  @keyframes champion-in {
    from { opacity: 0; transform: translateY(12px) scale(0.96); }
  }

  .champion-portrait {
    position: relative;
    flex-shrink: 0;
  }

  .crown {
    position: absolute;
    top: 0;
    left: 50%;
    width: 44px;
    fill: var(--gold);
    transform: translate(-50%, -62%) rotate(-12deg);
    animation: crown-drop 600ms cubic-bezier(0.3, 1.6, 0.5, 1) calc(var(--pick-ms) + 250ms) both;
  }

  @keyframes crown-drop {
    from { opacity: 0; transform: translate(-50%, -180%) rotate(-40deg); }
  }

  /* la lluvia cae dentro de la card: suelta por la página estiraría el scroll */
  .confetti {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
  }

  .confetti span {
    position: absolute;
    top: -12px;
    width: 7px;
    height: 11px;
    border-radius: 1px;
    opacity: 0;
    animation: confetti 1.8s cubic-bezier(0.25, 0.6, 0.4, 1) calc(var(--pick-ms) + var(--delay)) forwards;
  }

  @keyframes confetti {
    0% { opacity: 1; transform: none; }
    80% { opacity: 1; }
    100% { opacity: 0; transform: translate(var(--sway), var(--fall)) rotate(var(--spin)); }
  }

  .champion-label {
    font-size: var(--fs-sm);
    text-transform: uppercase;
    letter-spacing: var(--track);
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
    animation: champion-glow 1.4s ease-out calc(var(--pick-ms) + 300ms) 2;
  }

  @keyframes champion-glow {
    from { box-shadow: 0 0 0 0 var(--accent-a40); }
    to { box-shadow: 0 0 0 18px transparent; }
  }

  .champion-info {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .champion-name {
    font-size: var(--fs-display);
    font-weight: 700;
    color: var(--text);
    line-height: 1.2;
  }

  .champion-sub {
    color: var(--text-muted);
    font-size: var(--fs-md);
  }

  .champion-stats {
    color: var(--text-muted);
    font-size: var(--fs-md);
  }

  .champion-footnote {
    color: var(--text-muted);
    font-size: var(--fs-md);
    line-height: 1.5;
  }

  /* bloque y no flex: el texto lleva <strong> en línea, y en flex cada trozo
     sería un item suelto en su propia fila */
  .recap {
    padding-top: 0.9rem;
    border-top: 1px solid var(--border);
    color: var(--text-muted);
    font-size: var(--fs-md);
    line-height: 1.5;
  }

  .recap-label {
    display: block;
    margin-bottom: 0.3rem;
    font-size: var(--fs-sm);
    text-transform: uppercase;
    letter-spacing: var(--track);
    color: var(--accent);
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
    color: var(--on-accent);
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

  /* el marco va aquí y no en el canvas: así el canvas empieza en el origen de
     la caja y los rects del foco se posicionan tal cual vienen del render */
  .preview-stage {
    position: relative;
    width: fit-content;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    overflow: hidden;
  }

  /* sin max-width: el ancho lo fija updatePreview en px lógicos y el wrapper
     hace scroll horizontal, en vez de encoger el bracket hasta ser ilegible */
  .preview {
    display: block;
    height: auto;
  }

  /* el último partido decidido queda enmarcado; al llegar, destella */
  .board-focus {
    position: absolute;
    border-radius: 6px;
    box-shadow: 0 0 0 2px var(--accent);
    pointer-events: none;
    animation: board-focus 1.4s ease-out both;
  }

  @keyframes board-focus {
    from { box-shadow: 0 0 0 2px var(--accent), 0 0 22px 6px var(--accent-a40); }
    to { box-shadow: 0 0 0 2px var(--accent), 0 0 22px 6px transparent; }
  }

  .empty {
    text-align: center;
    color: var(--text-muted);
    padding: 3rem;
  }

  /* sin movimiento queda lo que informa: los avisos de pase o caída y el marco
     del último partido del tablero, quietos */
  @media (prefers-reduced-motion: reduce) {
    .ghost,
    .phase-banner,
    .confetti {
      display: none;
    }

    .matchup-live,
    .upset-stamp,
    .toast,
    .champion-card,
    .crown,
    .champion-img,
    .board-focus {
      animation: none;
    }
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
