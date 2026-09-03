<script lang="ts">
  // Registro global de conciertos: totales, bolos por año, artistas más vistos y
  // la lista completa agrupada por año en orden cronológico inverso. La página
  // de artista tiene su propia sección acotada a ese artista; ésta es la vista
  // completa y el único sitio desde donde se puede dar de alta un bolo de
  // cualquiera (el modal pide el artista antes de nada, con el buscador global
  // en modo pick: mismo debounce, mismo pool y mismas teclas que el resto).
  import { isAbortError, errorMessage } from '$lib/utils/errors';
  import { onMount } from 'svelte';
  import { api, createFetchController, type Concert, type ConcertStats } from '$lib/api';
  import { formatCalendarDate, formatNumber } from '$lib/utils/format';
  import { GRID, TOOLTIP_BASE, categoryAxis, valueAxis, barSeries, tooltipPoint, type TooltipParams, type ChartClickEvent } from '$lib/utils/chart';
  import type { EChartsOption } from 'echarts';
  import type { EntityContext } from '$lib/utils/entity-context';
  import { toastStore } from '$lib/stores/toast.svelte';
  import BaseChart from '$lib/components/charts/BaseChart.svelte';
  import TrackItem from '$lib/components/TrackItem.svelte';
  import ConcertRow from '$lib/components/ConcertRow.svelte';
  import ConcertModal from '$lib/components/ConcertModal.svelte';
  import SearchModal from '$lib/components/SearchModal.svelte';
  import IconPlus from '$lib/icons/IconPlus.svelte';

  // artistas más vistos: sólo los repetidos, y no más de éstos
  const TOP_ARTISTS_LIMIT = 5;
  // opacidad de las barras de los años que el filtro deja fuera
  const DIMMED_BAR_OPACITY = 0.3;

  let concerts = $state<Concert[]>([]);
  let stats = $state<ConcertStats | null>(null);
  let loading = $state(true);
  let error = $state('');
  // filtro por año ('' = todos): lo fijan los botones y las barras de la gráfica
  let yearFilter = $state('');
  let showModal = $state(false);
  let editing = $state<Concert | null>(null);
  let showArtistPicker = $state(false);
  let pickedArtist = $state<{ id: string; name: string } | null>(null);
  const fetchCtrl = createFetchController();

  async function load() {
    const signal = fetchCtrl.reset();
    loading = true;
    try {
      const res = await api.concerts(signal);
      if (signal.aborted) return;
      concerts = res.concerts;
      stats = res.stats;
    } catch (e) {
      if (isAbortError(e)) return;
      error = errorMessage(e, 'Error loading concerts');
    } finally {
      if (!signal.aborted) loading = false;
    }
  }

  onMount(load);

  // la lista llega ordenada por fecha descendente: el Set conserva ese orden
  let years = $derived([...new Set(concerts.map(c => c.date.slice(0, 4)))]);
  let visible = $derived(yearFilter ? concerts.filter(c => c.date.startsWith(yearFilter)) : concerts);
  // cifras de los setlists para las tarjetas: canciones vistas en directo y qué
  // parte ya conocías (escuchadas antes del bolo) — el titular de la página
  let songsLive = $derived(concerts.reduce((sum, c) => sum + c.songsTotal, 0));
  let knownShare = $derived.by(() => {
    if (songsLive === 0) return 0;
    const known = concerts.reduce((sum, c) => sum + c.songs.filter(s => (s.playsBefore ?? 0) > 0).length, 0);
    return Math.round((known / songsLive) * 100);
  });

  // agrupado por año sobre la lista ya ordenada: basta arrastrar el año
  // anterior, sin reordenar ni construir un índice aparte
  let byYear = $derived.by(() => {
    const groups: { year: string; items: Concert[] }[] = [];
    for (const c of visible) {
      const year = c.date.slice(0, 4);
      if (groups.at(-1)?.year !== year) groups.push({ year, items: [] });
      groups.at(-1)!.items.push(c);
    }
    return groups;
  });

  let topArtists = $derived((stats?.topArtists ?? []).filter(a => a.count > 1).slice(0, TOP_ARTISTS_LIMIT));

  // bolos por año con la misma gráfica que "history by year" de las fichas. La
  // barra del año filtrado se queda encendida y las demás se atenúan
  let yearOption = $derived.by<EChartsOption>(() => {
    const rows = stats?.byYear ?? [];
    const values = rows.map(y => yearFilter && y.year !== yearFilter
      ? { value: y.count, itemStyle: { opacity: DIMMED_BAR_OPACITY } }
      : y.count);
    return {
      grid: GRID,
      tooltip: {
        ...TOOLTIP_BASE,
        formatter: (params: TooltipParams) => {
          const p = tooltipPoint(params);
          return `${p.value} show${p.value === 1 ? '' : 's'}<br/><span style="color:#6a7a7a">${p.name}</span>`;
        },
      },
      xAxis: categoryAxis(rows.map(y => y.year)),
      yAxis: valueAxis({ minInterval: 1 }),
      series: [barSeries(values, { cursor: 'pointer' })],
    };
  });

  // pinchar una barra filtra la lista por ese año; pinchar la misma lo quita
  function onBarClick(params: ChartClickEvent) {
    if (params?.componentType !== 'series') return;
    const y = stats?.byYear[params.dataIndex]?.year;
    if (y) yearFilter = yearFilter === y ? '' : y;
  }

  async function remove(concert: Concert) {
    if (!confirm(`Remove ${concert.artistName} · ${formatCalendarDate(concert.date)}? Its setlist and attributions go with it.`)) return;
    try {
      await api.deleteConcert(concert.id);
      await load();
    } catch (e) {
      toastStore.show(errorMessage(e, 'Error removing concert'));
    }
  }

  // editar entra directo (el artista ya está fijado); dar de alta pasa antes por
  // el buscador
  function openModal(concert: Concert | null) {
    editing = concert;
    if (concert) {
      pickedArtist = { id: concert.artistId, name: concert.artistName };
      showModal = true;
      return;
    }
    pickedArtist = null;
    showArtistPicker = true;
  }
</script>

<div class="page-header">
  <h1>Concerts</h1>
  <p>Every show you have logged, and how much of each setlist you already knew.</p>
</div>

{#if loading && !stats}
  <div class="loading"><div class="spinner"></div></div>
{:else if error && !stats}
  <div class="empty-state">{error}</div>
{:else if stats}
  <div class="concerts-toolbar">
    {#if years.length > 1}
      <button class="range-btn" class:active={yearFilter === ''} onclick={() => (yearFilter = '')}>All</button>
      {#each years as y (y)}
        <button class="range-btn" class:active={yearFilter === y} onclick={() => (yearFilter = y)}>{y}</button>
      {/each}
    {/if}
    <button class="range-btn range-btn--playlist" onclick={() => openModal(null)}>
      <IconPlus /> Add concert
    </button>
  </div>

  {#if concerts.length === 0}
    <div class="empty-state">No concerts logged yet. Add one here, or from any artist's page.</div>
  {:else}
    <div class="stats-grid">
      <div class="card stat-card">
        <div class="stat-value">{formatNumber(stats.total)}</div>
        <div class="stat-label">Shows</div>
      </div>
      <div class="card stat-card">
        <div class="stat-value">{formatNumber(stats.artists)}</div>
        <div class="stat-label">Artists seen</div>
      </div>
      <div class="card stat-card">
        <div class="stat-value">{formatNumber(stats.venues)}</div>
        <div class="stat-label">Venues</div>
      </div>
      <div class="card stat-card">
        <div class="stat-value">{formatNumber(stats.countries)}</div>
        <div class="stat-label">Countries</div>
      </div>
      {#if songsLive > 0}
        <div class="card stat-card">
          <div class="stat-value">{formatNumber(songsLive)}</div>
          <div class="stat-label">Songs live</div>
        </div>
        <div class="card stat-card">
          <div class="stat-value">{knownShare}%</div>
          <div class="stat-label">Already knew</div>
        </div>
      {/if}
    </div>

    {#if stats.byYear.length > 1 || topArtists.length > 0}
      <div class="concerts-overview">
        {#if stats.byYear.length > 1}
          <section>
            <h2 class="section-title">Shows per year</h2>
            <div class="card chart-card">
              <BaseChart option={yearOption} height="150px" onclick={onBarClick} replaceMerge={['series']} />
            </div>
          </section>
        {/if}
        {#if topArtists.length > 0}
          <section>
            <h2 class="section-title">Seen the most</h2>
            <div class="track-list">
              {#each topArtists as a, i (a.artistId)}
                <TrackItem
                  href="/artist/{a.artistId}"
                  rank={i + 1}
                  imageUrl={a.imageUrl}
                  imageRound
                  name={a.name}
                  entity={{ type: 'artist', id: a.artistId, name: a.name, imageUrl: a.imageUrl } as EntityContext}
                  compact
                >
                  {#snippet meta()}
                    <div class="track-plays">{a.count} shows</div>
                  {/snippet}
                </TrackItem>
              {/each}
            </div>
          </section>
        {/if}
      </div>
    {/if}

    {#each byYear as group (group.year)}
      <h2 class="section-title">
        {group.year}
        <span class="concerts-year-count">{group.items.length} show{group.items.length === 1 ? '' : 's'}</span>
      </h2>
      <div class="track-list">
        {#each group.items as c (c.id)}
          <ConcertRow concert={c} onEdit={openModal} onRemove={remove} />
        {/each}
      </div>
    {/each}
  {/if}
{/if}

<SearchModal
  bind:show={showArtistPicker}
  pick={{
    types: ['artist'],
    placeholder: 'Which artist did you see?',
    onPick: (entity) => {
      pickedArtist = { id: entity.id, name: entity.name };
      editing = null;
      showModal = true;
    },
  }}
/>

{#if pickedArtist}
  <ConcertModal
    bind:show={showModal}
    artist={pickedArtist}
    {editing}
    onSaved={load}
    onChangeArtist={() => (showArtistPicker = true)}
  />
{/if}

<style>
  /* botones globales .range-btn en su propio contenedor: .time-range-selector
     arrastra el margen de cabecera de página */
  .concerts-toolbar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.25rem;
    margin-bottom: 1.5rem;
  }

  /* gráfica y artistas más vistos lado a lado cuando hay anchura; en una
     columna por debajo */
  .concerts-overview {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
    gap: 0 1.5rem;
    align-items: start;
  }
  .concerts-overview section {
    min-width: 0;
  }
  .chart-card {
    padding: 0.75rem;
    margin-bottom: 0.75rem;
  }

  .concerts-year-count {
    font-weight: 400;
    color: var(--text-muted);
    margin-left: 0.4rem;
  }
</style>
