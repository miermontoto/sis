<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/stores';
  import { api, createFetchController, getRankingMetric, getWeekStart, type ChartResponse, type DropoutEntry, type RankingMetric, type WeekStartOption, type Granularity } from '$lib/api';

  type ChartEntityType = 'tracks' | 'albums' | 'artists';
  import { formatDuration, formatNumber, formatMonthYear, formatShortDateUTC } from '$lib/utils/format';
  import { computeCurrentPeriod } from '$lib/utils/periods';
  import { closedChartsStore } from '$lib/stores/closed-charts.svelte';
  import { setQueryParams } from '$lib/utils/query-state';
  import RankChange from '$lib/components/RankChange.svelte';
  import PeakSelector from '$lib/components/PeakSelector.svelte';
  import { medalColor } from '$lib/utils/medals';
  import { nowPlayingStore } from '$lib/stores/now-playing.svelte';
  import IconChart from '$lib/icons/IconChart.svelte';
  import IconPlus from '$lib/icons/IconPlus.svelte';
  import IconCheckSmall from '$lib/icons/IconCheckSmall.svelte';
  import IconTrack from '$lib/icons/IconTrack.svelte';
  import IconArtist from '$lib/icons/IconArtist.svelte';
  import IconAlbum from '$lib/icons/IconAlbum.svelte';
  import { openEntityContextMenu } from '$lib/utils/entity-context';
  import { shortcutStore } from '$lib/stores/keyboard-shortcuts.svelte';

  let metric = $state<RankingMetric>('time');
  // default alineado con el resto de la app (backend/getWeekStart = 'friday'); onMount
  // aplica la preferencia real. antes estaba hardcodeado 'monday', lo que etiquetaba las
  // semanas en monday-weeks al cargar (p.ej. W16 en vez de W15) hasta que onMount corregía
  let weekStart = $state<WeekStartOption>('friday');
  let activeType = $state<ChartEntityType>('tracks');
  let granularity = $state<Granularity>('week');
  let selectedPeriod = $state('');
  let periods = $state<string[]>([]);
  let loading = $state(false);
  let periodsLoading = $state(false);

  // cache: `${type}:${granularity}:${period}:${metric}` → ChartResponse
  let cache = $state<Map<string, ChartResponse>>(new Map());
  const periodsFetchCtrl = createFetchController();
  const chartFetchCtrl = createFetchController();

  function cacheKey() {
    return `${activeType}:${granularity}:${selectedPeriod}:${metric}`;
  }

  let currentData = $derived(cache.get(cacheKey()) ?? null);
  // cache de peaks ya cargados
  let peaksLoaded = $state<Set<string>>(new Set());
  let peaksReady = $derived(peaksLoaded.has(cacheKey()));
  let closedChart = $derived(closedChartsStore.charts.find(c => c.granularity === granularity) ?? null);

  // ancho mínimo para la columna "wks" basado en el texto más largo
  function wksText(wk: number, cons: number): string {
    return cons > 0 ? `${wk} (${cons})` : `${wk}`;
  }
  let wksMinWidth = $derived.by(() => {
    if (!currentData) return '2.5rem';
    let maxLen = 0;
    for (const e of currentData.entries) {
      maxLen = Math.max(maxLen, wksText(e.weeksOnChart, e.consecutiveWeeks).length);
    }
    for (const d of currentData.dropouts) {
      maxLen = Math.max(maxLen, String(d.weeksOnChart).length);
    }
    // 0.55em por carácter (números son más estrechos que ch) + padding
    return maxLen <= 3 ? '2.5rem' : `${maxLen * 0.55 + 0.5}em`;
  });

  async function loadPeriods() {
    periodsLoading = true;
    const signal = periodsFetchCtrl.reset();
    try {
      const res = await api.chartPeriods(granularity, weekStart, signal);
      if (signal.aborted) return;
      periods = res.periods;
      if (periods.length > 0 && !periods.includes(selectedPeriod)) {
        selectedPeriod = periods[0];
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      throw e;
    } finally {
      if (!signal.aborted) periodsLoading = false;
    }
  }

  function periodMatchesGranularity(period: string, gran: Granularity): boolean {
    if (gran === 'year') return /^\d{4}$/.test(period);
    if (gran === 'month') return /^\d{4}-\d{2}$/.test(period);
    return /^\d{4}-W\d{2}$/.test(period);
  }



  async function loadChart() {
    if (!selectedPeriod || !periodMatchesGranularity(selectedPeriod, granularity)) return;
    const key = cacheKey();
    if (cache.has(key)) return;
    const signal = chartFetchCtrl.reset();
    loading = true;
    try {
      const result = await api.chart(activeType, granularity, selectedPeriod, weekStart, metric, 25, signal);
      if (signal.aborted) return;
      const next = new Map(cache);
      next.set(key, result);
      cache = next;

      // cargar peaks en background (no bloquea el render)
      if (!peaksLoaded.has(key)) {
        const allIds = [...result.entries.map(e => e.entityId), ...result.dropouts.map(d => d.entityId)];
        api.chartPeaks(activeType, granularity, selectedPeriod, weekStart, metric, allIds).then(peaks => {
          const cached = cache.get(key);
          if (!cached) return;
          const updated = { ...cached };
          updated.entries = cached.entries.map(e => {
            const p = peaks[e.entityId];
            if (!p) return e;
            return { ...e, peakRank: p.peakRank, peakPeriod: p.peakPeriod, peakPeriods: p.peakPeriods, timesAtPeak: p.timesAtPeak, weeksOnChart: p.weeksOnChart, consecutiveWeeks: p.consecutiveWeeks, isReentry: p.isReentry, isNew: e.isNew && !p.isReentry };
          });
          updated.dropouts = cached.dropouts.map(d => {
            const p = peaks[d.entityId];
            if (!p) return d;
            return { ...d, peakRank: p.peakRank, peakPeriod: p.peakPeriod, weeksOnChart: p.weeksOnChart };
          });
          const m = new Map(cache);
          m.set(key, updated);
          cache = m;
          peaksLoaded = new Set([...peaksLoaded, key]);
        }).catch(() => {});
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      throw e;
    } finally {
      if (!signal.aborted) loading = false;
    }
  }

  function entityLink(id: string): string {
    if (activeType === 'artists') return `/artist/${id}`;
    if (activeType === 'albums') return `/album/${id}`;
    return `/track/${id}`;
  }

  function isEntityLive(id: string): boolean {
    if (activeType === 'tracks') return id === nowPlayingStore.trackId;
    if (activeType === 'albums') return id === nowPlayingStore.albumId;
    return nowPlayingStore.artistIds.includes(id);
  }

  let currentIndex = $derived(periods.indexOf(selectedPeriod));
  let hasPrev = $derived(currentIndex < periods.length - 1); // periods sorted newest first
  let hasNext = $derived(currentIndex > 0);

  function goPrev() { if (hasPrev) selectedPeriod = periods[currentIndex + 1]; }
  function goNext() { if (hasNext) selectedPeriod = periods[currentIndex - 1]; }

  // calcular rango de fechas natural para el periodo seleccionado
  function periodDateRange(period: string, gran: Granularity, ws: WeekStartOption): string {
    if (gran === 'year') return period;
    if (gran === 'month') {
      if (!/^\d{4}-\d{2}$/.test(period)) return period;
      return formatMonthYear(period + '-01');
    }
    // week: YYYY-WNN
    // SQLite %W: semanas empezando lunes, semana 00 = la que contiene ene 1
    // El lunes de la semana N es: ene 1 + (N * 7) - (díaDeSemana de ene 1, ajustado)
    const match = period.match(/^(\d{4})-W(\d{2})$/);
    if (!match) return period;
    const year = parseInt(match[1]);
    const wn = parseInt(match[2]);

    // encontrar el primer lunes del año o antes
    const jan1 = new Date(Date.UTC(year, 0, 1));
    const jan1Day = jan1.getUTCDay(); // 0=dom, 1=lun, ...
    // días hasta el lunes de esa semana: si ene 1 es lunes (1), offset=0; si martes (2), offset=-1; ...
    // SQLite %W: semana 00 empieza el lunes <= ene 1
    const daysToMonday = jan1Day === 0 ? -6 : 1 - jan1Day;
    const week0Monday = new Date(Date.UTC(year, 0, 1 + daysToMonday));
    const monday = new Date(week0Monday);
    monday.setUTCDate(monday.getUTCDate() + wn * 7);

    // ajustar según el weekStart configurado
    // el backend resta días antes de calcular %W, así que la "semana" real empieza en otro día
    const start = new Date(monday);
    if (ws === 'sunday') start.setUTCDate(start.getUTCDate() + 1); // el backend resta 1, nosotros sumamos 1 para compensar
    else if (ws === 'friday') start.setUTCDate(start.getUTCDate() + 4); // el backend resta 4

    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 6);

    const fmt = (d: Date) => formatShortDateUTC(d);
    const y1 = start.getUTCFullYear();
    const y2 = end.getUTCFullYear();
    return y1 !== y2 ? `${fmt(start)}, ${y1} – ${fmt(end)}, ${y2}` : `${fmt(start)} – ${fmt(end)}, ${y1}`;
  }

  let dateRangeLabel = $derived(selectedPeriod ? periodDateRange(selectedPeriod, granularity, weekStart) : '');

  let initialized = false;

  function handleDismissBanner() {
    if (closedChart) {
      closedChartsStore.dismiss(closedChart.granularity);
    }
  }

  function viewClosedChart() {
    if (closedChart) {
      selectedPeriod = closedChart.period;
      handleDismissBanner();
    }
  }

  onMount(() => {
    metric = getRankingMetric();
    weekStart = getWeekStart();
    // leer query params para navegación desde chart-run o peak links
    const params = $page.url.searchParams;
    if (params.get('type')) activeType = params.get('type') as ChartEntityType;
    if (params.get('granularity')) granularity = params.get('granularity') as Granularity;
    // usar periodo de URL si existe, si no calcular el actual
    selectedPeriod = params.get('period') || computeCurrentPeriod(granularity, weekStart);
    initialized = true;
  });

  const CHART_TYPES: ChartEntityType[] = ['tracks', 'albums', 'artists'];
  shortcutStore.registerPageShortcuts(
    [
      { key: '1', description: 'Tracks', category: 'page' },
      { key: '2', description: 'Albums', category: 'page' },
      { key: '3', description: 'Artists', category: 'page' },
      { key: '[', description: 'Previous period', category: 'page' },
      { key: ']', description: 'Next period', category: 'page' },
      { key: 'W', description: 'Weekly', category: 'page' },
      { key: 'M', description: 'Monthly', category: 'page' },
      { key: 'Y', description: 'Yearly', category: 'page' },
    ],
    (e) => {
      if (e.key === '1' || e.key === '2' || e.key === '3') {
        e.preventDefault();
        activeType = CHART_TYPES[+e.key - 1];
        return true;
      }
      if (e.key === '[') { e.preventDefault(); goPrev(); return true; }
      if (e.key === ']') { e.preventDefault(); goNext(); return true; }
      const key = e.key.toLowerCase();
      if (key === 'w') { e.preventDefault(); granularity = 'week'; return true; }
      if (key === 'm') { e.preventDefault(); granularity = 'month'; return true; }
      if (key === 'y') { e.preventDefault(); granularity = 'year'; return true; }
      return false;
    },
  );
  onDestroy(() => shortcutStore.unregisterPageShortcuts());

  // cuando cambia granularidad o weekStart, recalcular periodo actual y cargar periodos
  $effect(() => {
    void granularity;
    void weekStart;
    if (!initialized) return;
    // establecer periodo actual para que el chart cargue inmediatamente
    if (!periodMatchesGranularity(selectedPeriod, granularity)) {
      selectedPeriod = computeCurrentPeriod(granularity, weekStart);
    }
    loadPeriods();
  });

  // cargar chart cuando cambia el periodo o tipo
  $effect(() => {
    void selectedPeriod;
    void activeType;
    void metric;
    if (initialized && selectedPeriod) loadChart();
  });

  // sincronizar tipo/granularidad/periodo con la URL
  $effect(() => {
    const t = activeType;
    const g = granularity;
    const p = selectedPeriod;
    if (!initialized) return;
    setQueryParams({ type: t, granularity: g, period: p || null });
  });

  // --- playlist creation ---
  let creatingPlaylist = $state(false);
  let createdPlaylistId = $state<number | null>(null);
  let playlistKey = $state('');

  function chartPlaylistKey() {
    return `${activeType}:${granularity}:${selectedPeriod}`;
  }

  $effect(() => {
    const key = chartPlaylistKey();
    if (key !== playlistKey) {
      createdPlaylistId = null;
      playlistKey = key;
    }
  });

  function singularType(t: ChartEntityType): 'track' | 'album' | 'artist' {
    if (t === 'tracks') return 'track';
    if (t === 'albums') return 'album';
    return 'artist';
  }

  async function createChartPlaylist() {
    if (creatingPlaylist) return;
    creatingPlaylist = true;
    try {
      const result = await api.generatePlaylist({
        strategy: 'chart',
        params: {
          entityType: singularType(activeType),
          granularity,
          period: selectedPeriod,
          weekStart,
          sort: metric,
          limit: 25,
        },
      });
      if ('id' in result) createdPlaylistId = result.libraryPlaylistId ?? result.id;
    } catch { /* silently fail */ }
    finally { creatingPlaylist = false; }
  }
</script>

<div class="page-header">
  <h1>Charts</h1>
</div>

{#if closedChart}
  <div class="closed-chart-banner">
    <IconChart size={14} />
    <span>{closedChart.label}</span>
    <button class="banner-action" onclick={viewClosedChart}>View</button>
    <button class="banner-dismiss" onclick={handleDismissBanner}>&times;</button>
  </div>
{/if}

<div class="tabs">
  <button class="tab" class:active={activeType === 'tracks'} onclick={() => activeType = 'tracks'}>
    <IconTrack size={14} /> Tracks
  </button>
  <button class="tab" class:active={activeType === 'albums'} onclick={() => activeType = 'albums'}>
    <IconAlbum size={14} /> Albums
  </button>
  <button class="tab" class:active={activeType === 'artists'} onclick={() => activeType = 'artists'}>
    <IconArtist size={14} /> Artists
  </button>
</div>

<div class="range-row">
  <button class="range-btn" class:active={granularity === 'week'} onclick={() => granularity = 'week'}>Week</button>
  <button class="range-btn" class:active={granularity === 'month'} onclick={() => granularity = 'month'}>Month</button>
  <button class="range-btn" class:active={granularity === 'year'} onclick={() => granularity = 'year'}>Year</button>

  <div class="period-nav">
    <button class="range-btn period-arrow" disabled={!hasPrev || periodsLoading} onclick={goPrev} title="Previous period">&lsaquo;</button>
    <select class="period-select" bind:value={selectedPeriod} disabled={periodsLoading}>
      {#each periods as p}
        <option value={p}>{p}</option>
      {/each}
    </select>
    <button class="range-btn period-arrow" disabled={!hasNext || periodsLoading} onclick={goNext} title="Next period">&rsaquo;</button>
  </div>

  {#if dateRangeLabel}
    <span class="period-date-label">{dateRangeLabel}</span>
  {/if}

  {#if currentData && currentData.entries.length > 0}
    {#if createdPlaylistId}
      <a href="/playlists/{createdPlaylistId}" class="range-btn range-btn--playlist range-btn--ok">
        <IconCheckSmall />
        Created
      </a>
    {:else}
      <button
        class="range-btn range-btn--playlist"
        class:range-btn--busy={creatingPlaylist}
        onclick={createChartPlaylist}
        disabled={creatingPlaylist}
        title="Create Spotify playlist from this chart"
      >
        {#if creatingPlaylist}
          <span class="btn-spinner"></span>
          Creating…
        {:else}
          <IconPlus />
          Playlist
        {/if}
      </button>
    {/if}
  {/if}
</div>

{#if (loading && !currentData) || periodsLoading}
  <div class="loading"><div class="spinner"></div></div>
{:else if currentData && currentData.entries.length > 0}
  <div class="chart-list">
    {#each currentData.entries as entry}
      <a href={entityLink(entry.entityId)} class="chart-item" oncontextmenu={openEntityContextMenu({ type: singularType(activeType), id: entry.entityId, name: entry.name, imageUrl: entry.imageUrl, parentArtistId: entry.artistId ?? undefined })}>
        <div class="chart-rank-col">
          <span class="chart-rank" style:color={medalColor(entry.rank)}>{entry.rank}</span>
          <RankChange rankChange={entry.rankChange} isNew={entry.isNew} isReentry={entry.isReentry} />
        </div>
        {#if entry.imageUrl}
          <img class="chart-art" class:chart-art--round={activeType === 'artists'} src={entry.imageUrl} alt="" />
        {:else}
          <div class="chart-art" class:chart-art--round={activeType === 'artists'}></div>
        {/if}
        <div class="chart-info">
          <div class="chart-name">{entry.name}{#if isEntityLive(entry.entityId)} <span class="live-dot"></span>{/if}</div>
          {#if entry.artists?.length}
            <!-- svelte-ignore node_invalid_placement_ssr -->
            <div class="chart-artists">
              {#each entry.artists as artist, i}<a href="/artist/{artist.id}" class="chart-artist" onclick={(e) => e.stopPropagation()}>{artist.name}</a>{#if i < entry.artists.length - 1}{', '}{/if}{/each}
            </div>
          {:else if entry.artistName}
            <!-- svelte-ignore node_invalid_placement_ssr -->
            <div class="chart-artists"><a href="/artist/{entry.artistId}" class="chart-artist" onclick={(e) => e.stopPropagation()}>{entry.artistName}</a></div>
          {/if}
        </div>
        <div class="chart-stats">
          {#if !peaksReady}
            <div class="chart-stat"><span class="ghost-text"></span><span class="chart-stat-label">peak</span></div>
            {#if granularity === 'week'}
              <div class="chart-stat" style:min-width={wksMinWidth}><span class="ghost-text"></span><span class="chart-stat-label">wks</span></div>
            {/if}
          {:else if entry.rank <= entry.peakRank && entry.peakPeriods?.includes(selectedPeriod) && entry.timesAtPeak === 1}
            <div class="chart-peak-badge">PEAK</div>
          {:else if entry.timesAtPeak > 1 && entry.peakPeriods?.length > 1}
            <div class="chart-stat">
              <PeakSelector peakRank={entry.peakRank} peakPeriods={entry.peakPeriods} onselect={(p) => selectedPeriod = p} />
            </div>
          {:else}
            <button class="chart-stat chart-stat--peak" title="Go to peak chart ({entry.peakPeriod})" onclick={(e) => { e.preventDefault(); e.stopPropagation(); selectedPeriod = entry.peakPeriod; }}>
              <span class="chart-stat-val" style:color={medalColor(entry.peakRank)}>#{entry.peakRank}</span>
              <span class="chart-stat-label">peak</span>
            </button>
          {/if}
          {#if peaksReady && granularity === 'week'}
            <div class="chart-stat" style:min-width={wksMinWidth} title="{entry.weeksOnChart} total, {entry.consecutiveWeeks} consecutive">
              <span class="chart-stat-val">{entry.weeksOnChart}{#if entry.consecutiveWeeks > 0} <span class="chart-stat-total">({entry.consecutiveWeeks})</span>{/if}</span>
              <span class="chart-stat-label">wks</span>
            </div>
          {/if}
        </div>
        <div class="chart-meta">
          <div class="chart-primary">{metric === 'plays' ? `${formatNumber(entry.plays)} plays` : formatDuration(entry.totalMs)}</div>
          <div class="chart-secondary">{metric === 'plays' ? formatDuration(entry.totalMs) : `${formatNumber(entry.plays)} plays`}</div>
        </div>
      </a>
    {/each}
  </div>
{:else if currentData}
  <div class="card" style="text-align: center; color: var(--text-muted); padding: 2rem;">No data for this period.</div>
{/if}

{#if currentData && currentData.dropouts.length > 0}
  <div class="dropouts-section">
    <div class="dropouts-header">Dropped off</div>
    <div class="chart-list">
      {#each currentData.dropouts as d}
        <a href={entityLink(d.entityId)} class="chart-item chart-item--dropout" oncontextmenu={openEntityContextMenu({ type: singularType(activeType), id: d.entityId, name: d.name, imageUrl: d.imageUrl, parentArtistId: d.artistId ?? undefined })}>
          <div class="chart-rank-col">
            <span class="chart-rank" style:color={medalColor(d.previousRank)}>{d.previousRank}</span>
            <span class="dropout-arrow">OUT</span>
          </div>
          {#if d.imageUrl}
            <img class="chart-art" class:chart-art--round={activeType === 'artists'} src={d.imageUrl} alt="" />
          {:else}
            <div class="chart-art" class:chart-art--round={activeType === 'artists'}></div>
          {/if}
          <div class="chart-info">
            <div class="chart-name">{d.name}</div>
            {#if d.artists?.length}
              <!-- svelte-ignore node_invalid_placement_ssr -->
              <div class="chart-artists">
                {#each d.artists as artist, i}<a href="/artist/{artist.id}" class="chart-artist" onclick={(e) => e.stopPropagation()}>{artist.name}</a>{#if i < d.artists.length - 1}{', '}{/if}{/each}
              </div>
            {:else if d.artistName}
              <!-- svelte-ignore node_invalid_placement_ssr -->
              <div class="chart-artists"><a href="/artist/{d.artistId}" class="chart-artist" onclick={(e) => e.stopPropagation()}>{d.artistName}</a></div>
            {/if}
          </div>
          <div class="chart-stats">
            {#if !peaksReady}
              <div class="chart-stat"><span class="ghost-text"></span><span class="chart-stat-label">peak</span></div>
              {#if granularity === 'week'}
                <div class="chart-stat" style:min-width={wksMinWidth}><span class="ghost-text"></span><span class="chart-stat-label">wks</span></div>
              {/if}
            {:else}
              <div class="chart-stat" title="Peak rank">
                <span class="chart-stat-val" style:color={medalColor(d.peakRank)}>#{d.peakRank}</span>
                <span class="chart-stat-label">peak</span>
              </div>
              {#if granularity === 'week'}
                <div class="chart-stat" style:min-width={wksMinWidth} title="Weeks on chart">
                  <span class="chart-stat-val">{d.weeksOnChart}</span>
                  <span class="chart-stat-label">wks</span>
                </div>
              {/if}
            {/if}
          </div>
        </a>
      {/each}
    </div>
  </div>
{/if}

<style>
  .closed-chart-banner {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.6rem 1rem;
    margin-bottom: 1rem;
    border-radius: var(--radius);
    border: 1px solid rgba(29, 185, 84, 0.3);
    background: rgba(29, 185, 84, 0.06);
    color: var(--text);
    font-size: 0.85rem;
  }
  .closed-chart-banner svg {
    color: var(--accent);
    flex-shrink: 0;
  }
  .banner-action {
    margin-left: auto;
    background: var(--accent);
    color: #000;
    border: none;
    border-radius: var(--radius);
    padding: 0.25rem 0.7rem;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.05s;
  }
  .banner-action:hover {
    background: var(--accent-hover);
  }
  .banner-dismiss {
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 1.1rem;
    cursor: pointer;
    padding: 0 0.2rem;
    line-height: 1;
  }
  .banner-dismiss:hover {
    color: var(--text);
  }

  .range-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem;
    margin-bottom: 1.25rem;
  }
  .period-nav {
    display: flex;
    align-items: center;
    gap: 0.2rem;
    margin-left: 0.35rem;
  }
  .period-arrow {
    padding: 0.4rem 0.5rem;
    font-size: 1.1rem;
    line-height: 1;
  }
  .period-select {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 0.8rem;
    padding: 0.4rem 0.6rem;
    border-radius: var(--radius);
    cursor: pointer;
    outline: none;
  }
  .period-select:focus {
    border-color: var(--accent);
  }
  .period-date-label {
    font-size: 0.8rem;
    color: var(--text-muted);
    margin-left: 0.35rem;
  }
  .chart-list {
    background: var(--bg-card);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .chart-item {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.55rem 0.75rem;
    text-decoration: none;
    color: var(--text);
    transition: background 0.05s;
    border-bottom: 1px solid var(--border);
  }
  .chart-item:last-child {
    border-bottom: none;
  }
  .chart-item:hover {
    background: var(--bg-hover);
  }
  .chart-rank-col {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.1rem;
    width: 2.5rem;
    flex-shrink: 0;
  }
  .chart-rank {
    font-variant-numeric: tabular-nums;
    font-size: 0.9rem;
    font-weight: 700;
    color: var(--text);
  }
  .chart-art {
    width: 40px;
    height: 40px;
    border-radius: var(--radius);
    object-fit: cover;
    flex-shrink: 0;
    background: var(--border);
  }
  .chart-art--round {
    border-radius: 50%;
  }
  .chart-info {
    flex: 1;
    min-width: 0;
  }
  .chart-name {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.9rem;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  /* la línea entera trunca; cada artista es un link inline dentro */
  .chart-artists {
    font-size: 0.8rem;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .chart-artist {
    color: inherit;
    text-decoration: none;
  }
  .chart-artist:hover {
    color: var(--accent);
  }
  .chart-stats {
    display: flex;
    gap: 0.4rem;
    flex-shrink: 0;
  }
  .chart-stat {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.05rem;
    min-width: 2.5rem;
    height: 2.2rem;
  }
  .chart-stat-val {
    font-variant-numeric: tabular-nums;
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--text);
    line-height: 1.1;
  }
  .chart-stat-label {
    font-size: 0.6rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .chart-stat-total {
    font-size: 0.7rem;
    font-weight: 500;
    color: var(--text-muted);
    margin-left: 0.15em;
  }
  .chart-stat--peak {
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    border-radius: var(--radius);
    transition: background 0.05s;
  }
  .chart-stat--peak:hover {
    background: rgba(29, 185, 84, 0.12);
  }
  .chart-stat--peak .chart-stat-val {
    color: var(--accent);
  }
  .chart-peak-badge {
    font-size: 0.6rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    color: #f0c040;
    background: rgba(240, 192, 64, 0.12);
    border: 1px solid rgba(240, 192, 64, 0.3);
    padding: 0;
    border-radius: var(--radius);
    min-width: 2.5rem;
    width: 2.5rem;
    height: 2.2rem;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .chart-meta {
    text-align: right;
    flex-shrink: 0;
  }
  .chart-primary {
    font-size: 0.85rem;
    font-weight: 500;
  }
  .chart-secondary {
    font-size: 0.75rem;
    color: var(--text-muted);
  }
  .dropouts-section {
    margin-top: 1.25rem;
  }
  .dropouts-header {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 0.5rem;
  }
  .chart-item--dropout {
    opacity: 0.55;
  }
  .chart-item--dropout:hover {
    opacity: 1;
  }
  .dropout-arrow {
    font-size: 0.55rem;
    font-weight: 700;
    color: #e74c3c;
    letter-spacing: 0.03em;
  }
  @media (max-width: 640px) {
    .period-date-label {
      display: none;
    }
  }
</style>
