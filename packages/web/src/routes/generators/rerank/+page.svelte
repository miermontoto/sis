<script lang="ts">
  import { onMount } from 'svelte';
  import {
    api, createFetchController, getRankingMetric,
    type DateRangeParams, type GeneratedPlaylist, type RankingMetric,
  } from '$lib/api';
  import TimeRangeSelector from '$lib/components/TimeRangeSelector.svelte';
  import { formatNumber, formatHours, formatDuration, formatTrackLength } from '$lib/utils/format';
  import { fromTopItem, type EntityTab, type LibraryItem } from '$lib/utils/library-items';
  import {
    computeRows, fillGoal, msPerPlay, planTrackIds, slotsCount, slotsDuration,
    WEIGHT_PLAYS, WEIGHT_TIME, type PlanCandidate, type PlanGroup,
  } from '$lib/utils/rerank';

  // por debajo de este desplazamiento el gesto cuenta como toque, no arrastre
  const DRAG_THRESHOLD_PX = 5;

  const LIST_SIZES = [10, 20, 50] as const;

  // ventana para estimar el ritmo actual de escucha (independiente del rango
  // elegido: lo que importa es a qué velocidad se escucha HOY)
  const PACE_DAYS = 30;

  // candidatos por entidad en el plan: suficientes para que no sea un bucle
  const CANDIDATES_PER_ENTITY = 8;
  // topes del plan; si cortan, se avisa en pantalla
  const MAX_PLAN_TRACKS = 300;
  const MAX_TRACKS_PER_GOAL = 60;
  // /me/player/play no admite listas largas: solo arranca el principio del plan
  const MAX_PLAY_URIS = 50;

  const HIGHLIGHT_LIMIT = 3;

  let entityTab = $state<EntityTab>('artists');
  let listSize = $state<typeof LIST_SIZES[number]>(20);
  let metric = $state<RankingMetric>('time');
  let range = $state('all');
  let startDate = $state('');
  let endDate = $state('');

  let loading = $state(false);
  let error = $state<string | null>(null);
  let loadedSig = $state('');

  // orden real del ranking vs orden deseado por el usuario
  let baseOrder = $state<LibraryItem[]>([]);
  let order = $state<LibraryItem[]>([]);
  let avgMsPerDay = $state(0);

  let rootEl = $state<HTMLElement | null>(null);
  let dragKey = $state<string | null>(null);
  let dragging = $state(false);
  let dropIndex = $state<number | null>(null);
  let dragOrigin = { x: 0, y: 0 };

  let plan = $state<PlanGroup[] | null>(null);
  let planSkipped = $state<string[]>([]);
  let building = $state(false);
  let creating = $state(false);
  let createdUrl = $state<string | null>(null);
  let playMessage = $state<string | null>(null);

  const candidateCache = new Map<string, PlanCandidate[]>();
  const fetchCtrl = createFetchController();

  const currentRanks = $derived(new Map(baseOrder.map((i, idx) => [i.key, idx + 1])));
  const rows = $derived(computeRows(order, currentRanks, metric));
  const goals = $derived(rows.filter((r) => r.deficit > 0));
  const totalDeficitMs = $derived(rows.reduce((s, r) => s + r.deficitMs, 0));
  const totalDeficitPlays = $derived(rows.reduce((s, r) => s + r.deficitPlays, 0));
  const movedCount = $derived(rows.filter((r) => r.delta !== 0).length);
  const climbers = $derived(rows.filter((r) => r.delta > 0).sort((a, b) => b.delta - a.delta));
  const fallers = $derived(rows.filter((r) => r.delta < 0).sort((a, b) => a.delta - b.delta));
  const hardest = $derived([...goals].sort((a, b) => b.deficitMs - a.deficitMs));
  const daysAtPace = $derived(avgMsPerDay > 0 ? totalDeficitMs / avgMsPerDay : null);
  const configSig = $derived(`${entityTab}|${listSize}|${metric}|${range}|${startDate}|${endDate}`);
  const stale = $derived(loadedSig !== '' && loadedSig !== configSig);
  const planTracks = $derived(plan ? plan.reduce((n, g) => n + slotsCount(g.slots), 0) : 0);
  const planMs = $derived(plan ? plan.reduce((ms, g) => ms + g.coveredMs, 0) : 0);

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

  const metricLabel = (v: number) => metric === 'time' ? formatHours(v) : `${formatNumber(v)} plays`;

  // --- carga ---

  async function load() {
    const signal = fetchCtrl.reset();
    loading = true;
    error = null;
    try {
      const fetcher = entityTab === 'tracks' ? api.topTracks
        : entityTab === 'artists' ? api.topArtists
        : api.topAlbums;
      const [raw, pace] = await Promise.all([
        fetcher(range, listSize, metric, getCustomDates(), undefined, signal),
        api.listeningTime('month', 'day', undefined, signal).catch(() => []),
      ]);
      if (signal.aborted) return;
      const items = raw.map((r) => fromTopItem(r as any, entityTab)).filter((i): i is LibraryItem => i !== null);
      baseOrder = items;
      order = [...items];
      // los días sin escuchas no vienen en la serie, pero cuentan para el ritmo
      avgMsPerDay = pace.reduce((s, p) => s + p.total_ms, 0) / PACE_DAYS;
      resetPlan();
      candidateCache.clear();
      loadedSig = configSig;
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      error = e?.message ?? 'Could not load the ranking';
    } finally {
      if (!signal.aborted) loading = false;
    }
  }

  // el plan deja de valer en cuanto cambia el orden deseado
  function resetPlan() {
    plan = null;
    planSkipped = [];
    createdUrl = null;
    playMessage = null;
  }

  // --- reordenación ---

  function moveTo(key: string, index: number) {
    const item = order.find((i) => i.key === key);
    if (!item) return;
    const next = order.filter((i) => i.key !== key);
    next.splice(Math.max(0, Math.min(index, next.length)), 0, item);
    order = next;
    resetPlan();
  }

  function nudge(key: string, delta: number) {
    const from = order.findIndex((i) => i.key === key);
    if (from < 0) return;
    const to = from + delta;
    if (to < 0 || to >= order.length) return;
    moveTo(key, to);
  }

  function jumpTo(key: string, value: string) {
    const pos = Number(value);
    if (!Number.isFinite(pos) || pos < 1) return;
    moveTo(key, Math.min(Math.round(pos), order.length) - 1);
  }

  function shuffle() {
    const next = [...order];
    for (let i = next.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [next[i], next[j]] = [next[j], next[i]];
    }
    order = next;
    resetPlan();
  }

  function resetOrder() {
    order = [...baseOrder];
    resetPlan();
  }

  // índice de inserción según la coordenada vertical, contado sobre las filas que
  // NO son la arrastrada (así casa con el array una vez quitada)
  function locate(y: number): number {
    const els = rootEl
      ? [...rootEl.querySelectorAll<HTMLElement>('[data-row]')].filter((el) => el.dataset.row !== dragKey)
      : [];
    for (let i = 0; i < els.length; i++) {
      const r = els[i].getBoundingClientRect();
      if (y < r.top + r.height / 2) return i;
    }
    return els.length;
  }

  // igual que en la tier list: la fila arrastrada no se mueve en el DOM hasta
  // soltarla (reparentarla libera el pointer capture y corta el gesto). durante
  // el arrastre solo se pinta la marca de inserción
  function onRowDown(e: PointerEvent, key: string) {
    // los controles de la fila (botones, input) tienen que seguir funcionando
    if ((e.target as HTMLElement).closest('.row-tools')) return;
    e.preventDefault();
    dragKey = key;
    dragging = false;
    dragOrigin = { x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onRowMove(e: PointerEvent) {
    if (!dragKey) return;
    if (!dragging) {
      if (Math.hypot(e.clientX - dragOrigin.x, e.clientY - dragOrigin.y) < DRAG_THRESHOLD_PX) return;
      dragging = true;
    }
    dropIndex = locate(e.clientY);
  }

  function onRowUp() {
    if (dragKey && dragging && dropIndex !== null) moveTo(dragKey, dropIndex);
    endDrag();
  }

  function endDrag() {
    dragKey = null;
    dragging = false;
    dropIndex = null;
  }

  // traduce dropIndex (contado sin la fila arrastrada) al índice tal como se
  // renderiza la lista, que todavía la incluye
  function markAt(renderIndex: number): boolean {
    if (dropIndex === null) return false;
    let seen = 0;
    for (let i = 0; i < order.length; i++) {
      if (order[i].key === dragKey) continue;
      if (seen === dropIndex) return i === renderIndex;
      seen++;
    }
    return renderIndex === order.length;
  }

  // --- plan de escucha ---

  async function candidatesFor(item: LibraryItem): Promise<PlanCandidate[]> {
    const cached = candidateCache.get(item.key);
    if (cached) return cached;

    let list: PlanCandidate[] = [];
    if (item.kind === 'track') {
      list = [{
        id: item.id, name: item.name, subtitle: item.subtitle, imageUrl: item.imageUrl,
        durationMs: item.durationMs ?? msPerPlay(item),
      }];
    } else if (item.kind === 'artist') {
      const detail = await api.artistDetail(item.id, 'all', { trackLimit: CANDIDATES_PER_ENTITY });
      list = detail.topTracks.flatMap((t) => t.track ? [{
        id: t.track.id, name: t.track.name, subtitle: item.name,
        imageUrl: t.track.album?.imageUrl ?? item.imageUrl, durationMs: t.track.durationMs,
      }] : []);
    } else {
      const detail = await api.albumDetail(item.id, 'all');
      // en orden de disco: un álbum se escucha entero, no por popularidad
      list = detail.tracks
        .flatMap((t) => t.track ? [t.track] : [])
        .sort((a, b) => (a.trackNumber ?? 0) - (b.trackNumber ?? 0))
        .slice(0, CANDIDATES_PER_ENTITY)
        .map((t) => ({
          id: t.id, name: t.name, subtitle: t.artists.map((a) => a.name).join(', '),
          imageUrl: t.album?.imageUrl ?? item.imageUrl, durationMs: t.durationMs,
        }));
    }

    const usable = list.filter((c) => c.durationMs > 0);
    candidateCache.set(item.key, usable);
    return usable;
  }

  async function buildPlan() {
    building = true;
    error = null;
    createdUrl = null;
    playMessage = null;
    try {
      const targets = goals;
      const lists = await Promise.all(targets.map((r) => candidatesFor(r.item).catch(() => [])));

      // rankeando por plays el objetivo se mide en escuchas, no en tiempo: una
      // canción larga no vale por dos
      const byPlays = metric === 'plays';
      const weight = byPlays ? WEIGHT_PLAYS : WEIGHT_TIME;

      const groups: PlanGroup[] = [];
      const skipped: string[] = [];
      let budget = MAX_PLAN_TRACKS;

      targets.forEach((r, i) => {
        const candidates = lists[i];
        const cap = Math.min(MAX_TRACKS_PER_GOAL, budget);
        if (candidates.length === 0 || cap <= 0) {
          skipped.push(r.item.name);
          return;
        }
        const target = byPlays ? r.deficit : r.deficitMs;
        const slots = fillGoal(candidates, target, cap, weight);
        if (slots.length === 0) {
          skipped.push(r.item.name);
          return;
        }
        const placed = slotsCount(slots);
        budget -= placed;
        groups.push({
          key: r.item.key, item: r.item, targetRank: r.targetRank, deficitMs: r.deficitMs,
          slots, coveredMs: slotsDuration(slots),
          truncated: (byPlays ? placed : slotsDuration(slots)) < target,
        });
      });

      plan = groups;
      planSkipped = skipped;
    } catch (e: any) {
      error = e?.message ?? 'Could not build the plan';
    } finally {
      building = false;
    }
  }

  async function createPlaylist() {
    if (!plan?.length) return;
    creating = true;
    error = null;
    try {
      const ids = planTrackIds(plan);
      const stamp = new Date().toLocaleString('en', { month: 'short', year: 'numeric' });
      const res = await api.generatePlaylist({
        strategy: 'custom',
        params: { trackIds: ids },
        name: `[SIS] Rerank plan (${entityTab}) — ${stamp}`,
      }) as GeneratedPlaylist;
      createdUrl = res.spotifyUrl ?? (res.spotifyPlaylistId ? `https://open.spotify.com/playlist/${res.spotifyPlaylistId}` : null);
    } catch (e: any) {
      error = e?.message === 'missing_scopes'
        ? 'Spotify needs playlist permissions — log in again to grant them.'
        : e?.message ?? 'Could not create the playlist';
    } finally {
      creating = false;
    }
  }

  async function playPlan() {
    if (!plan?.length) return;
    playMessage = null;
    const ids = planTrackIds(plan).slice(0, MAX_PLAY_URIS);
    const res = await api.playbackPlayContext({ uris: ids.map((id) => `spotify:track:${id}`) });
    playMessage = res.success
      ? `Playing the first ${ids.length} tracks of the plan.`
      : res.error === 'no_active_device' ? 'No active Spotify device.' : 'Could not start playback.';
  }

  onMount(() => {
    metric = getRankingMetric();
    load();
  });
</script>

<div class="page-header">
  <h1>Rerank</h1>
  <p>Drag your ranking into the order you wish it had, and see what it would take to make it real.</p>
</div>

<div class="card sources">
  <div class="control-row">
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
        {#each LIST_SIZES as n}
          <button class="toggle-btn" class:active={listSize === n} onclick={() => listSize = n}>{n}</button>
        {/each}
      </div>
    </div>

    <div class="control-group">
      <span class="control-label">Ranked by</span>
      <div class="toggle-group">
        <button class="toggle-btn" class:active={metric === 'time'} onclick={() => metric = 'time'}>Time</button>
        <button class="toggle-btn" class:active={metric === 'plays'} onclick={() => metric = 'plays'}>Plays</button>
      </div>
    </div>
  </div>

  <TimeRangeSelector value={range} onchange={setRange} {startDate} {endDate} ondatechange={setCustomDates} />

  <button class="primary-btn" onclick={load} disabled={loading}>
    {loading ? 'Loading...' : stale ? 'Reload ranking' : 'Load ranking'}
  </button>
</div>

{#if error}
  <div class="notice notice--error">{error}</div>
{/if}

{#if stale}
  <div class="notice">Controls changed — reload to rerank the new list.</div>
{/if}

{#if rows.length > 0}
  <div class="card summary">
    <div class="stat-grid">
      <div class="stat">
        <span class="stat-label">Moved</span>
        <span class="stat-value">{movedCount}<span class="stat-unit">/{rows.length}</span></span>
      </div>
      <div class="stat">
        <span class="stat-label">Extra listening</span>
        <span class="stat-value">{formatHours(totalDeficitMs)}</span>
        <span class="stat-sub">{formatDuration(totalDeficitMs)}</span>
      </div>
      <div class="stat">
        <span class="stat-label">Extra plays</span>
        <span class="stat-value">{formatNumber(totalDeficitPlays)}</span>
      </div>
      <div class="stat">
        <span class="stat-label">At your pace</span>
        <span class="stat-value">{daysAtPace === null ? '—' : `${daysAtPace < 1 ? daysAtPace.toFixed(1) : Math.ceil(daysAtPace)}d`}</span>
        <span class="stat-sub">{avgMsPerDay > 0 ? `${formatHours(avgMsPerDay)}/day` : 'no recent plays'}</span>
      </div>
    </div>

    {#if movedCount === 0}
      <p class="summary-hint">This is your ranking exactly as it is. Move something to see what it would cost.</p>
    {:else}
      <div class="highlights">
        {#if climbers.length}
          <div class="highlight">
            <span class="highlight-label">Biggest climbs</span>
            {#each climbers.slice(0, HIGHLIGHT_LIMIT) as r}
              <div class="highlight-row">
                <span class="badge badge--up">▲{r.delta}</span>
                <span class="highlight-name">{r.item.name}</span>
                <span class="highlight-meta">#{r.currentRank} → #{r.targetRank}</span>
              </div>
            {/each}
          </div>
        {/if}
        {#if fallers.length}
          <div class="highlight">
            <span class="highlight-label">Biggest drops</span>
            {#each fallers.slice(0, HIGHLIGHT_LIMIT) as r}
              <div class="highlight-row">
                <span class="badge badge--down">▼{-r.delta}</span>
                <span class="highlight-name">{r.item.name}</span>
                <span class="highlight-meta">#{r.currentRank} → #{r.targetRank}</span>
              </div>
            {/each}
          </div>
        {/if}
        {#if hardest.length}
          <div class="highlight">
            <span class="highlight-label">Hardest goals</span>
            {#each hardest.slice(0, HIGHLIGHT_LIMIT) as r}
              <div class="highlight-row">
                <span class="badge badge--cost">{formatHours(r.deficitMs)}</span>
                <span class="highlight-name">{r.item.name}</span>
                <span class="highlight-meta">{formatNumber(r.deficitPlays)} plays</span>
              </div>
            {/each}
          </div>
        {/if}
      </div>
      <p class="summary-hint">
        Dropping is free: you cannot un-listen anything, so those fall only because the ones above them climb past.
      </p>
    {/if}
  </div>

  <div class="board-actions">
    <span class="counter">{goals.length} goal{goals.length === 1 ? '' : 's'}</span>
    <button class="ghost-btn" onclick={shuffle}>Shuffle</button>
    <button class="ghost-btn" onclick={resetOrder} disabled={movedCount === 0}>Reset order</button>
    <button class="primary-btn" onclick={buildPlan} disabled={building || goals.length === 0}>
      {building ? 'Building...' : 'Build playlist plan'}
    </button>
  </div>

  <div class="board" class:is-dragging={dragging} bind:this={rootEl}>
    {#each rows as row, i (row.item.key)}
      {#if markAt(i)}<span class="drop-mark"></span>{/if}
      <div
        class="row"
        class:dragging={dragKey === row.item.key}
        class:row--up={row.delta > 0}
        class:row--down={row.delta < 0}
        data-row={row.item.key}
        onpointerdown={(e) => onRowDown(e, row.item.key)}
        onpointermove={onRowMove}
        onpointerup={onRowUp}
        onpointercancel={endDrag}
      >
        <span class="rank">#{row.targetRank}</span>
        <span class="thumb" class:thumb--round={row.item.kind === 'artist'}>
          {#if row.item.imageUrl}
            <img src={row.item.imageUrl} alt="" draggable="false" loading="lazy" />
          {:else}
            <span class="thumb-ph">{row.item.name.charAt(0).toUpperCase()}</span>
          {/if}
        </span>
        <span class="names">
          <a class="name" href="/{row.item.kind}/{row.item.id}">{row.item.name}</a>
          {#if row.item.subtitle}<span class="subtitle">{row.item.subtitle}</span>{/if}
        </span>
        <span class="value">{metricLabel(row.value)}</span>
        <span class="move">
          {#if row.delta > 0}
            <span class="badge badge--up">▲{row.delta}</span>
          {:else if row.delta < 0}
            <span class="badge badge--down">▼{-row.delta}</span>
          {:else}
            <span class="badge badge--flat">—</span>
          {/if}
          <span class="move-from">from #{row.currentRank}</span>
        </span>
        <span class="cost">
          {#if row.deficit > 0}
            <span class="cost-main">+{formatHours(row.deficitMs)}</span>
            <span class="cost-sub">{formatNumber(row.deficitPlays)} plays{row.delta === 0 ? ' · to hold' : ''}</span>
          {:else if row.delta < 0}
            <span class="cost-free">free</span>
            <span class="cost-sub">passed by others</span>
          {:else}
            <span class="cost-free">—</span>
          {/if}
        </span>
        <span class="row-tools">
          <button class="mini-btn" onclick={() => nudge(row.item.key, -1)} disabled={i === 0} aria-label="Move up">↑</button>
          <button class="mini-btn" onclick={() => nudge(row.item.key, 1)} disabled={i === rows.length - 1} aria-label="Move down">↓</button>
          <input
            class="jump"
            type="number"
            min="1"
            max={rows.length}
            placeholder="#"
            aria-label="Move to position"
            onchange={(e) => { jumpTo(row.item.key, e.currentTarget.value); e.currentTarget.value = ''; }}
          />
        </span>
      </div>
    {/each}
    {#if markAt(rows.length)}<span class="drop-mark"></span>{/if}
  </div>
{:else if !loading}
  <div class="notice">No ranking data for this range yet.</div>
{/if}

{#if plan}
  <div class="card plan">
    <div class="plan-header">
      <div>
        <h2>Playlist plan</h2>
        <p class="plan-sub">
          {formatNumber(planTracks)} plays · {formatHours(planMs)} · covers {plan.length} of {goals.length} goal{goals.length === 1 ? '' : 's'}
        </p>
      </div>
      <div class="plan-actions">
        <button class="ghost-btn" onclick={playPlan} disabled={planTracks === 0}>Play now</button>
        <button class="primary-btn" onclick={createPlaylist} disabled={creating || planTracks === 0}>
          {creating ? 'Creating...' : 'Create on Spotify'}
        </button>
      </div>
    </div>

    {#if createdUrl}
      <div class="notice notice--ok">
        Playlist created — <a href={createdUrl} target="_blank" rel="noopener noreferrer">open it on Spotify</a>.
      </div>
    {/if}
    {#if playMessage}
      <div class="notice">{playMessage}</div>
    {/if}
    {#if planSkipped.length}
      <div class="notice">Left out (no tracks available or plan limit reached): {planSkipped.join(', ')}.</div>
    {/if}

    {#if plan.length === 0}
      <p class="plan-sub">Nothing to play: no tracks could be resolved for these goals.</p>
    {/if}

    {#each plan as group (group.key)}
      <div class="plan-group">
        <div class="plan-goal">
          <span class="rank">#{group.targetRank}</span>
          <span class="plan-goal-name">{group.item.name}</span>
          <span class="plan-goal-meta">
            needs {formatHours(group.deficitMs)} · plan gives {formatNumber(slotsCount(group.slots))} plays / {formatHours(group.coveredMs)}
            {#if group.truncated}· capped, short of the goal{/if}
          </span>
        </div>
        <div class="plan-tracks">
          {#each group.slots as slot}
            <div class="plan-track">
              <span class="plan-count">×{slot.count}</span>
              <span class="plan-track-name">{slot.candidate.name}</span>
              <span class="plan-track-meta">{slot.candidate.subtitle}</span>
              <span class="plan-track-len">{formatTrackLength(slot.candidate.durationMs)}</span>
            </div>
          {/each}
        </div>
      </div>
    {/each}
  </div>
{/if}

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
    padding: 0.5rem 0.8rem;
    color: var(--text-muted);
    font-size: 0.82rem;
    margin-bottom: 0.75rem;
  }

  .notice--error { border-color: #e34234; color: #e34234; }
  .notice--ok { border-color: #1db954; }
  .notice a { color: inherit; }

  .summary { margin-bottom: 1rem; }

  .stat-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 0.75rem;
  }

  .stat { display: flex; flex-direction: column; gap: 0.1rem; }

  .stat-label {
    font-size: 0.7rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .stat-value {
    font-size: 1.4rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    line-height: 1.1;
  }

  .stat-unit { font-size: 0.9rem; font-weight: 400; color: var(--text-muted); }
  .stat-sub { font-size: 0.72rem; color: var(--text-muted); }

  .highlights {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 0.75rem;
    margin-top: 1rem;
  }

  .highlight { display: flex; flex-direction: column; gap: 0.2rem; min-width: 0; }

  .highlight-label {
    font-size: 0.7rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .highlight-row {
    display: flex;
    align-items: baseline;
    gap: 0.35rem;
    font-size: 0.8rem;
    min-width: 0;
  }

  .highlight-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .highlight-meta {
    font-size: 0.7rem;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }

  .summary-hint {
    margin: 0.85rem 0 0;
    font-size: 0.78rem;
    color: var(--text-muted);
  }

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

  .board { display: flex; flex-direction: column; gap: 3px; }

  .row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.4rem 0.6rem;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-left: 3px solid var(--border);
    border-radius: var(--radius);
    cursor: grab;
    /* sin esto el navegador interpreta el arrastre táctil como scroll */
    touch-action: none;
    user-select: none;
  }

  .row--up { border-left-color: #1db954; }
  .row--down { border-left-color: #e34234; }
  .row.dragging { opacity: 0.4; cursor: grabbing; }

  /* durante el arrastre nada del tablero captura el gesto, salvo la propia fila
     arrastrada: quitarle los pointer-events liberaría el pointer capture */
  .board.is-dragging { cursor: grabbing; }
  .board.is-dragging .row { pointer-events: none; }
  .board.is-dragging .row.dragging { pointer-events: auto; }

  .drop-mark {
    height: 3px;
    border-radius: 2px;
    background: var(--accent);
  }

  .rank {
    width: 2.6rem;
    flex-shrink: 0;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--text-muted);
  }

  .thumb {
    width: 38px;
    height: 38px;
    flex-shrink: 0;
    border-radius: 4px;
    overflow: hidden;
    background: var(--bg);
  }

  .thumb--round { border-radius: 50%; }

  .thumb img, .thumb-ph {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    pointer-events: none;
  }

  .thumb-ph {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    font-weight: 600;
  }

  .names {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .name {
    color: var(--text);
    text-decoration: none;
    font-weight: 600;
    font-size: 0.9rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .name:hover { color: var(--accent); }

  .subtitle {
    font-size: 0.72rem;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .value {
    width: 5rem;
    flex-shrink: 0;
    text-align: right;
    font-size: 0.8rem;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }

  .move {
    width: 5.5rem;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.05rem;
  }

  .move-from {
    font-size: 0.65rem;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }

  .badge {
    font-size: 0.72rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }

  .badge--up { color: #1db954; }
  .badge--down { color: #e34234; }
  .badge--flat { color: var(--text-muted); }
  .badge--cost { color: var(--accent); }

  .cost {
    width: 7.5rem;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
  }

  .cost-main {
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--accent);
    font-variant-numeric: tabular-nums;
  }

  .cost-sub, .cost-free { font-size: 0.68rem; color: var(--text-muted); }

  .row-tools {
    display: flex;
    align-items: center;
    gap: 0.15rem;
    flex-shrink: 0;
  }

  .mini-btn {
    width: 20px;
    height: 20px;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text-muted);
    border-radius: 3px;
    cursor: pointer;
    font-size: 0.7rem;
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .mini-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
  .mini-btn:disabled { opacity: 0.3; cursor: not-allowed; }

  .jump {
    width: 2.6rem;
    padding: 0.1rem 0.25rem;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: transparent;
    color: var(--text);
    font-size: 0.72rem;
    font-family: inherit;
  }

  .plan { margin-top: 1.25rem; }

  .plan-header {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    align-items: flex-start;
    justify-content: space-between;
    margin-bottom: 0.75rem;
  }

  .plan-header h2 { margin: 0; font-size: 1.05rem; }

  .plan-sub {
    margin: 0.15rem 0 0;
    font-size: 0.78rem;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }

  .plan-actions { display: flex; gap: 0.4rem; align-items: center; }

  .plan-group {
    border-top: 1px solid var(--border);
    padding: 0.6rem 0 0.2rem;
  }

  .plan-goal {
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
    margin-bottom: 0.3rem;
  }

  .plan-goal-name { font-weight: 600; font-size: 0.88rem; }

  .plan-goal-meta {
    font-size: 0.72rem;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }

  .plan-tracks { display: flex; flex-direction: column; gap: 0.1rem; }

  .plan-track {
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
    font-size: 0.8rem;
    min-width: 0;
  }

  .plan-count {
    width: 2.2rem;
    flex-shrink: 0;
    color: var(--accent);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .plan-track-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .plan-track-meta {
    flex: 1;
    min-width: 0;
    font-size: 0.72rem;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .plan-track-len {
    font-size: 0.72rem;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }

  @media (max-width: 720px) {
    .value, .move-from, .subtitle { display: none; }
    .cost { width: 5.5rem; }
    .move { width: 2.5rem; }
    .counter { margin-right: 0; width: 100%; }
  }
</style>
