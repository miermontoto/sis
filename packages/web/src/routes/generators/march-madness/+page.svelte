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
    DRAW_MODES, FORMATS, FORMAT_IDS, PLAYOFF_CUTS, drawOrder, maxPlayoffCut, replay, upsets,
    type DrawMode, type FormatId, type Upset,
  } from '$lib/tournament';
  import { renderBoard, type BoardRender } from './board-canvas';

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
  // nombre del formato en el subtítulo del png (al suizo se le añade el corte)
  const FORMAT_NAMES: Record<FormatId, string> = {
    knockout: 'knockout', double: 'double elimination', groups: 'groups + knockout', swiss: 'swiss', koth: 'king of the hill',
  };

  // factores de supersampling del canvas (ver renderBoard)
  const MIN_RENDER_SCALE = 2;
  const EXPORT_SCALE = 2;

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
  let playoffCut = $state<number>(8);
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

  const fetchCtrl = createFetchController();

  const fmt = $derived(FORMATS[format]);
  const cutCap = $derived(maxPlayoffCut(entries.length));
  const spec = $derived({ n: entries.length, playoffCut: format === 'swiss' ? Math.min(playoffCut, cutCap) : 0 });
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
    winners = [];
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
    if (pending && (c === pending.a || c === pending.b)) winners = [...winners, c];
  }

  function undo() {
    winners = winners.slice(0, -1);
  }

  function restart() {
    winners = [];
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
    const formatName = spec.playoffCut ? `${FORMAT_NAMES[format]} + top ${spec.playoffCut}` : FORMAT_NAMES[format];
    const parts = [
      source === 'pick' ? null : entityTab, rangeLabel(), fieldLabel, formatName,
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
    };
  }

  async function updatePreview() {
    const seq = ++renderSeq;
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
    } finally {
      if (seq === renderSeq) rendering = false;
    }
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
    // otro corte de playoff es otro torneo
    void playoffCut;
    untrack(() => { winners = []; });
  });

  $effect(() => {
    // el tablero se repinta al terminar o al abrirlo, y con cada elección mientras está abierto
    void run; void blind;
    if ((finished || showBoard) && run) untrack(updatePreview);
  });
</script>

<svelte:window onkeydown={onKeydown} />

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

  {#if format === 'swiss'}
    <div class="control-group">
      <span class="control-label">Playoff</span>
      <div class="toggle-group">
        {#each PLAYOFF_CUTS as cut}
          <button
            class="toggle-btn"
            class:active={spec.playoffCut === cut}
            disabled={cut > cutCap}
            title={cut > cutCap ? `Needs a field of at least ${cut * 2}` : ''}
            onclick={() => playoffCut = cut}
          >{cut ? `Top ${cut}` : 'None'}</button>
        {/each}
      </div>
    </div>
  {/if}

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
        {#if runnerUp}
          {#if format === 'swiss' && !spec.playoffCut}
            Topped the standings ahead of <strong>{runnerUp.name}</strong>.
          {:else}
            Beat <strong>{runnerUp.name}</strong> in the final.
          {/if}
        {/if}
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
    </div>
  {:else if pending}
    <div class="matchup">
      {#each [pending.a, pending.b] as c, i (c)}
        {@const side = entries[c]}
        <button class="contender" onclick={() => choose(c)}>
          {#if side.imageUrl}
            <img class="contender-img" src={side.imageUrl} alt={side.name} />
          {:else}
            <div class="contender-img placeholder">{side.name.charAt(0)}</div>
          {/if}
          {#if !blind}<div class="seed-badge">{side.seed}</div>{/if}
          <div class="contender-name">{side.name}</div>
          {#if side.subtitle}<div class="contender-sub">{side.subtitle}</div>{/if}
          {#if pending.notes}<div class="contender-note">{pending.notes[i]}</div>{/if}
          {#if !blind}<div class="contender-stat">{metricLabel(side)}</div>{/if}
          <div class="contender-key">{i === 0 ? '←' : '→'}</div>
        </button>
        {#if i === 0}<div class="versus">vs</div>{/if}
      {/each}
    </div>
    <div class="hint-row">Click a card, or use ← / → to pick. Backspace undoes.</div>
  {/if}

  <div class="bracket-section">
    <button class="ghost-btn" onclick={() => showBoard = !showBoard}>
      {showBoard ? `Hide ${fmt.board}` : `Show ${fmt.board}`}
    </button>
    {#if showBoard || finished}
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

  .matchup {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    gap: 1rem;
    align-items: center;
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

  .champion-card {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
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
