<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { api, createFetchController, getRankingMetric, type Accolade, type ArtistDetail, type ArtistOverlap, type RankingMetric } from '$lib/api';
  import { ARTIST_TOP_ALBUMS_LIMIT, ARTIST_TOP_TRACKS_LIMIT } from '$lib/detail-layout';
  import { artistCompare } from '$lib/stores/artist-compare.svelte';
  import { attributionVersion } from '$lib/stores/attribution';
  import { EntityRanks } from '$lib/stores/entity-ranks.svelte';
  import { nowPlayingStore } from '$lib/stores/now-playing.svelte';
  import { batchTouches, playUpdatesStore } from '$lib/stores/play-updates.svelte';
  import { statFlashStore } from '$lib/stores/stat-flash.svelte';
  import { alignTimelines, canonicalArtistId, leadHistory, recordRows, versusHref, versusRow, VERSUS_NO_VALUE, type VersusRow, type VersusSide } from '$lib/utils/artist-versus';
  import { metricAxisScale, rankAxis, valueAxis } from '$lib/utils/chart';
  import { fitTimeline } from '$lib/utils/entity-timeline';
  import { formatDuration, formatNumber, formatShortDate } from '$lib/utils/format';
  import { invalidateEntityDetail } from '$lib/utils/optimistic-play';
  import { RANK_PERIODS } from '$lib/utils/rank-periods';
  import { canShare, publicHref, shareEntity } from '$lib/utils/share';
  import { isAbortError } from '$lib/utils/errors';
  import ConcertRow from '$lib/components/ConcertRow.svelte';
  import EntityActionsMenu from '$lib/components/EntityActionsMenu.svelte';
  import MetricMeta from '$lib/components/MetricMeta.svelte';
  import TrackItem from '$lib/components/TrackItem.svelte';
  import TrackList from '$lib/components/TrackList.svelte';
  import VersusLineChart from '$lib/components/charts/VersusLineChart.svelte';
  import VersusRows from '$lib/components/versus/VersusRows.svelte';
  import VersusSplit from '$lib/components/versus/VersusSplit.svelte';
  import VersusTimeline from '$lib/components/versus/VersusTimeline.svelte';
  import IconArtist from '$lib/icons/IconArtist.svelte';
  import IconShare from '$lib/icons/IconShare.svelte';
  import IconSwap from '$lib/icons/IconSwap.svelte';

  type TimelineView = 'period' | 'total';
  const TIMELINE_VIEWS: { value: TimelineView; label: string }[] = [
    { value: 'period', label: 'Period' },
    { value: 'total', label: 'Total' },
  ];
  // listas largas cuestan más que lo que aportan: el resto, tras "show all"
  const RECORD_ROWS_COLLAPSED = 10;
  const TOGETHER_COLLAPSED = 10;
  const RANK_PENDING = '…';

  interface Pair {
    a: ArtistDetail;
    b: ArtistDetail;
    overlap: ArtistOverlap;
  }

  const aId = $derived(page.params.id ?? '');
  const bId = $derived(page.params.other ?? '');

  let pair = $state<Pair | null>(null);
  let loading = $state(true);
  let notFound = $state(false);
  // el mismo artista por los dos lados, o los dos en un mismo grupo de merge
  let sameArtist = $state<{ id: string; name: string } | null>(null);
  let metric = $state<RankingMetric>('time');
  let accolades = $state<{ a: Accolade[]; b: Accolade[]; metric: RankingMetric } | null>(null);
  let accoladesLoading = $state(true);
  let showAllRecords = $state(false);
  let showAllTogether = $state(false);
  let timelineView = $state<TimelineView>('period');
  let timelineWidth = $state(0);
  let highlightedMonth = $state('');

  const fetchCtrl = createFetchController();
  const accoladesCtrl = createFetchController();
  onDestroy(() => {
    fetchCtrl.abort();
    accoladesCtrl.abort();
  });

  // $derived y no `pair` a pelo: el detalle se relee con cada play confirmado y eso no
  // debe relanzar el escaneo de ranking de los dos. Sólo se pide con los ids ya canónicos
  let ready = $derived(!!pair);
  const ranksA = new EntityRanks(() => ({ type: 'artist', id: aId, metric, ranks: ready, chart: false }));
  const ranksB = new EntityRanks(() => ({ type: 'artist', id: bId, metric, ranks: ready, chart: false }));

  let ranksLoading = $derived(ranksA.rankingsLoading || ranksB.rankingsLoading);

  let names = $derived<[string, string]>(pair ? [pair.a.artist.name, pair.b.artist.name] : ['', '']);
  let sides = $derived(pair ? [
    { key: 'a' as const, id: aId, detail: pair.a },
    { key: 'b' as const, id: bId, detail: pair.b },
  ] : []);

  const statOf = (detail: ArtistDetail) => (metric === 'plays' ? detail.stats.play_count : detail.stats.total_ms);
  const formatMetric = (value: number) => (metric === 'plays' ? `${formatNumber(value)} plays` : formatDuration(value));

  // --- cifras ---

  let statRows = $derived.by<VersusRow[]>(() => {
    if (!pair) return [];
    const { a, b } = pair;
    const time = versusRow('time', 'Listening time', a.stats.total_ms, b.stats.total_ms, formatDuration);
    const plays = versusRow('plays', 'Plays', a.stats.play_count, b.stats.play_count, formatNumber);
    const rankText = (v: number) => `#${formatNumber(v)}`;
    // sin posición por ningún lado la fila no dice nada (nadie ha sonado en esa ventana)
    const ranks = RANK_PERIODS.flatMap(({ key, label }) => {
      const rowKey = `rank:${key}`;
      const title = `Rank ${label}`;
      if (ranksLoading) return [{ key: rowKey, label: title, a: RANK_PENDING, b: RANK_PENDING, leader: null }];
      const [ra, rb] = [ranksA.rankings?.[key], ranksB.rankings?.[key]];
      return ra == null && rb == null ? [] : [versusRow(rowKey, title, ra, rb, rankText, 'lower')];
    });
    const best = (history: { rank: number }[]) => (history.length ? Math.min(...history.map(h => h.rank)) : null);
    const [bestA, bestB] = [best(ranksA.history), best(ranksB.history)];
    const dateRow = (key: string, label: string, x: string | null, y: string | null): VersusRow =>
      ({ key, label, a: x ? formatShortDate(x) : VERSUS_NO_VALUE, b: y ? formatShortDate(y) : VERSUS_NO_VALUE, leader: null });
    const concerts = [a.concerts?.length ?? 0, b.concerts?.length ?? 0] as const;
    return [
      ...(metric === 'plays' ? [plays, time] : [time, plays]),
      ...ranks,
      ...(bestA != null || bestB != null ? [versusRow('rank:best', 'Best rank', bestA, bestB, rankText, 'lower')] : []),
      dateRow('first', 'First played', a.stats.first_played, b.stats.first_played),
      dateRow('last', 'Last played', a.stats.last_played, b.stats.last_played),
      ...(concerts[0] || concerts[1] ? [versusRow('concerts', 'Concerts', concerts[0], concerts[1], formatNumber)] : []),
    ];
  });

  let allRecordRows = $derived(accolades ? recordRows(accolades.a, accolades.b, accolades.metric) : []);
  let shownRecordRows = $derived(showAllRecords ? allRecordRows : allRecordRows.slice(0, RECORD_ROWS_COLLAPSED));

  // --- gráficas ---

  // los mismos meses por los dos lados, alineados por índice
  let months = $derived(pair ? alignTimelines(
    { series: pair.a.series, rankHistory: ranksA.history },
    { series: pair.b.series, rankHistory: ranksB.history },
    new Date(),
  ) : { a: [], b: [] });
  let timeline = $derived({
    a: fitTimeline(months.a, timelineWidth, 'month', null),
    b: fitTimeline(months.b, timelineWidth, 'month', null),
  });

  const bucketValue = (bucket: (typeof months.a)[number]) => {
    if (timelineView === 'total') return metric === 'plays' ? bucket.cumPlays : bucket.cumMs;
    return metric === 'plays' ? bucket.plays : bucket.ms;
  };
  let timelineScale = $derived(metricAxisScale(Math.max(0, ...timeline.a.map(bucketValue), ...timeline.b.map(bucketValue)), metric));
  const timelineLine = (name: string, buckets: typeof months.a) =>
    ({ name, values: buckets.map(bucket => bucketValue(bucket) / timelineScale.div) });

  const rankLine = (name: string, buckets: typeof months.a) => ({ name, values: buckets.map(bucket => bucket.rank) });

  let lead = $derived(leadHistory(months.a, months.b, metric));
  let leadMonths = $derived(lead.changes.map(change => change.month));
  let monthKeys = $derived(months.a.map(bucket => bucket.key));

  // --- carga ---

  async function load(idA: string, idB: string) {
    const signal = fetchCtrl.reset();
    notFound = false;
    sameArtist = null;
    loading = true;
    try {
      const opts = { sort: metric, trackLimit: ARTIST_TOP_TRACKS_LIMIT, albumLimit: ARTIST_TOP_ALBUMS_LIMIT, signal };
      const [a, b, overlap] = await Promise.all([
        api.artistDetail(idA, 'all', opts),
        api.artistDetail(idB, 'all', opts),
        api.artistOverlap(idA, idB, metric, signal),
      ]);
      if (signal.aborted) return;
      // un alias rankea con el id de su canónico y sus cifras son sólo las suyas: se compara
      // el canónico, y si los dos resuelven al mismo no hay nada que comparar
      const [canonicalA, canonicalB] = [canonicalArtistId(a), canonicalArtistId(b)];
      if (canonicalA === canonicalB) {
        sameArtist = { id: canonicalA, name: canonicalA === a.artist.id ? a.artist.name : b.artist.name };
        pair = null;
        return;
      }
      if (canonicalA !== idA || canonicalB !== idB) {
        await goto(versusHref(canonicalA, canonicalB), { replaceState: true });
        return;
      }
      pair = { a, b, overlap };
    } catch (e) {
      if (isAbortError(e)) return;
      notFound = true;
      pair = null;
    } finally {
      if (!signal.aborted) loading = false;
    }
  }

  let initialized = false;
  let prevKey = '';

  onMount(() => {
    metric = getRankingMetric();
    initialized = true;
  });

  // un merge, una colección o unos créditos corregidos cambian a quién cuenta cada play
  $effect(() => {
    const [idA, idB] = [aId, bId];
    void metric;
    void attributionVersion();
    if (!initialized || !idA || !idB) return;
    const key = `${idA}|${idB}`;
    if (key !== prevKey) {
      pair = null;
      accolades = null;
      prevKey = key;
    }
    if (idA === idB) {
      fetchCtrl.abort();
      pair = null;
      loading = false;
      notFound = false;
      sameArtist = { id: idA, name: '' };
      return;
    }
    untrack(() => load(idA, idB));
  });

  // aparte del detalle: en frío esperan al horneado de records, y eso no puede tener la
  // página en blanco. Sólo con los ids ya canónicos (`ready`), que un alias no tiene records
  $effect(() => {
    const [idA, idB] = [aId, bId];
    void attributionVersion();
    if (!ready) {
      accoladesCtrl.abort();
      return;
    }
    const signal = accoladesCtrl.reset();
    accoladesLoading = true;
    Promise.all([api.accolades('artist', idA, signal), api.accolades('artist', idB, signal)])
      .then(([x, y]) => {
        if (signal.aborted) return;
        accolades = { a: x.accolades, b: y.accolades, metric: x.metric };
        accoladesLoading = false;
      })
      .catch(() => {
        if (signal.aborted) return;
        accolades = null;
        accoladesLoading = false;
      });
    return () => accoladesCtrl.abort();
  });

  // play confirmado de cualquiera de los dos: relectura, igual que la ficha del artista
  let lastConfirmedSeq = 0;
  $effect(() => {
    const batch = playUpdatesStore.confirmed;
    if (!batch || batch.seq <= lastConfirmedSeq) return;
    lastConfirmedSeq = batch.seq;
    untrack(() => {
      const touched = [aId, bId].filter(id => batchTouches(batch.updates, 'artists', id));
      if (!pair || touched.length === 0) return;
      const [idA, idB] = [aId, bId];
      Promise.all(touched.map(id => invalidateEntityDetail('artist', id)))
        .then(() => load(idA, idB))
        .then(() => statFlashStore.flash(touched))
        .catch(() => {});
    });
  });
</script>

<svelte:head>
  <title>{pair ? `${names[0]} vs ${names[1]}` : 'Compare artists'} — sis</title>
</svelte:head>

{#snippet legend()}
  <div class="vs-legend">
    <span><span class="versus-key versus-key--a"></span>{names[0]}</span>
    <span><span class="versus-key versus-key--b"></span>{names[1]}</span>
  </div>
{/snippet}

{#snippet sideTitle(title: string, side: VersusSide, name: string)}
  <div class="section-header">
    <h2 class="section-title"><span class="versus-key versus-key--{side}"></span>{title} · {name}</h2>
  </div>
{/snippet}

{#if sameArtist}
  <div class="empty-state">
    <p>Those are the same artist{sameArtist.name ? ` in your library: ${sameArtist.name}` : ''}, so there's nothing to compare.</p>
    <a class="show-all-btn" href="/artist/{sameArtist.id}">Open artist</a>
  </div>
{:else if notFound}
  <div class="empty-state">Couldn't load these artists.</div>
{:else if loading && !pair}
  <div class="loading"><div class="spinner"></div></div>
{:else if pair}
  {@const overlap = pair.overlap}
  <div class="vs-hero">
    {#each sides as side (side.key)}
      <div class="vs-hero-side vs-hero-side--{side.key}">
        <a href="/artist/{side.id}" class="vs-hero-photo-link" aria-label={side.detail.artist.name}>
          {#if side.detail.artist.imageUrl}
            <img class="vs-hero-photo vs-hero-photo--{side.key}" src={side.detail.artist.imageUrl} alt="" />
          {:else}
            <span class="vs-hero-photo vs-hero-photo--{side.key} vs-hero-photo--empty"><IconArtist size={32} /></span>
          {/if}
        </a>
        <div class="vs-hero-text">
          <h1 class="vs-hero-name"><a href="/artist/{side.id}">{side.detail.artist.name}</a></h1>
          {#if nowPlayingStore.isLive('artist', side.id)}
            <span class="live-badge"><span class="live-dot"></span> Live</span>
          {/if}
        </div>
      </div>
      {#if side.key === 'a'}
        <div class="vs-hero-mid">
          <span class="vs-hero-vs">vs</span>
          <EntityActionsMenu
            title="Actions"
            actions={[
              { label: 'Swap sides', icon: IconSwap, onClick: () => goto(versusHref(bId, aId)) },
              { label: `Change ${names[0]}`, icon: IconArtist, onClick: () => artistCompare.open({ id: bId, name: names[1] }, 'b') },
              { label: `Change ${names[1]}`, icon: IconArtist, onClick: () => artistCompare.open({ id: aId, name: names[0] }, 'a') },
              ...(canShare() ? [{ label: 'Share', icon: IconShare, onClick: () => shareEntity(`${names[0]} vs ${names[1]}`, publicHref()) }] : []),
            ]}
          />
        </div>
      {/if}
    {/each}
  </div>

  <div class="section-grid">
    <section class="detail-section detail-section--half">
      <div class="section-header"><h2 class="section-title">Head to head</h2></div>
      <div class="card">
        <VersusSplit
          {names}
          a={statOf(pair.a)}
          b={statOf(pair.b)}
          shared={metric === 'plays' ? overlap.playCount : overlap.totalMs}
          format={formatMetric}
        />
        <VersusRows {names} rows={statRows} />
      </div>
    </section>

    <!-- mientras llegan ocupa su media columna: si creciera después, la tabla de al lado saltaría -->
    {#if accoladesLoading || allRecordRows.length > 0}
      <section class="detail-section detail-section--half">
        <div class="section-header">
          <h2 class="section-title"><a href="/records?tab=artists" class="section-link">Records</a></h2>
          {#if allRecordRows.length > RECORD_ROWS_COLLAPSED}
            <button class="show-all-btn" onclick={() => (showAllRecords = !showAllRecords)}>
              {showAllRecords ? 'Show less' : 'Show all'}
            </button>
          {/if}
        </div>
        <div class="card">
          {#if accoladesLoading && !accolades}
            <div class="vs-ghost"></div>
          {:else}
            <VersusRows {names} rows={shownRecordRows} />
          {/if}
        </div>
      </section>
    {/if}

    {#if timeline.a.length > 1}
      <section class="detail-section detail-section--half">
        <div class="section-header section-header--views">
          <h2 class="section-title">Listening history</h2>
          <div class="section-actions">
            <div class="view-toggle" role="group" aria-label="View as">
              {#each TIMELINE_VIEWS as view (view.value)}
                <button
                  class="show-all-btn"
                  class:active={timelineView === view.value}
                  aria-pressed={timelineView === view.value}
                  onclick={() => (timelineView = view.value)}
                >{view.label}</button>
              {/each}
            </div>
          </div>
        </div>
        <div class="card chart-card" bind:clientWidth={timelineWidth}>
          {@render legend()}
          <VersusLineChart
            buckets={timeline.a}
            a={timelineLine(names[0], timeline.a)}
            b={timelineLine(names[1], timeline.b)}
            yAxis={valueAxis({ axisLabel: { formatter: timelineScale.label } })}
            format={value => formatMetric(value * timelineScale.div)}
            marks={timelineView === 'total' ? leadMonths : []}
            endLabels={timelineView === 'total'}
            bind:highlightedMonth
          />
        </div>
      </section>
    {/if}

    {#if ranksLoading || months.a.length > 1}
    <section class="detail-section detail-section--half">
      <div class="section-header"><h2 class="section-title">All-time rank</h2></div>
      <div class="card chart-card">
        {#if ranksLoading}
          <div class="vs-ghost"></div>
        {:else}
          {@render legend()}
          <VersusLineChart
            buckets={months.a}
            a={rankLine(names[0], months.a)}
            b={rankLine(names[1], months.b)}
            yAxis={rankAxis()}
            format={value => `#${formatNumber(value)}`}
            marks={leadMonths}
            bind:highlightedMonth
          />
        {/if}
      </div>
    </section>
    {/if}

    <!-- explica las líneas discontinuas de las dos gráficas: va debajo de ambas, no dentro de una -->
    {#if lead.leader && lead.since}
      <section class="detail-section">
        <div class="section-header"><h2 class="section-title">Lead history</h2></div>
        <div class="card">
          <VersusTimeline months={monthKeys} history={lead} {names} bind:highlightedMonth />
        </div>
      </section>
    {/if}

    {#if overlap.tracks.length > 0}
      <section class="detail-section">
        <div class="section-header">
          <h2 class="section-title">Together</h2>
          <div class="section-actions">
            <span class="vs-together-meta">{formatNumber(overlap.playCount)} plays · {formatDuration(overlap.totalMs)}</span>
            {#if overlap.tracks.length > TOGETHER_COLLAPSED}
              <button class="show-all-btn" onclick={() => (showAllTogether = !showAllTogether)}>
                {showAllTogether ? 'Show less' : 'Show all'}
              </button>
            {/if}
          </div>
        </div>
        <TrackList items={showAllTogether ? overlap.tracks : overlap.tracks.slice(0, TOGETHER_COLLAPSED)} showRank {metric} />
      </section>
    {/if}

    {#each sides as side (side.key)}
      <section class="detail-section detail-section--half">
        {@render sideTitle('Top tracks', side.key, side.detail.artist.name)}
        {#if side.detail.topTracks.length > 0}
          <TrackList items={side.detail.topTracks} showRank {metric} />
        {:else}
          <p class="vs-empty">No plays yet.</p>
        {/if}
      </section>
    {/each}

    {#each sides as side (side.key)}
      <section class="detail-section detail-section--half">
        {@render sideTitle('Top albums', side.key, side.detail.artist.name)}
        {#if side.detail.topAlbums.length > 0}
          <div class="track-list">
            {#each side.detail.topAlbums as item, i (item.albumId)}
              {#if item.album}
                <TrackItem
                  href="/album/{item.albumId}"
                  rank={i + 1}
                  imageUrl={item.album.imageUrl}
                  name={item.album.name}
                  isLive={nowPlayingStore.isLive('album', item.albumId)}
                  entity={{ type: 'album', id: item.albumId, name: item.album.name, imageUrl: item.album.imageUrl, parentArtistId: side.id }}
                >
                  {#snippet subtitle()}{item.album?.releaseDate ?? ''}{/snippet}
                  {#snippet meta()}
                    <MetricMeta playCount={item.playCount} totalMs={item.totalMs} {metric} flash={statFlashStore.isFlashing(item.albumId)} />
                  {/snippet}
                </TrackItem>
              {/if}
            {/each}
          </div>
        {:else}
          <p class="vs-empty">No albums yet.</p>
        {/if}
      </section>
    {/each}

    {#if sides.some(side => (side.detail.concerts ?? []).length > 0)}
      {#each sides as side (side.key)}
        <section class="detail-section detail-section--half">
          {@render sideTitle('Concerts', side.key, side.detail.artist.name)}
          {#if (side.detail.concerts ?? []).length > 0}
            <div class="track-list">
              {#each side.detail.concerts ?? [] as concert (concert.id)}
                <ConcertRow {concert} variant="artist" compact />
              {/each}
            </div>
          {:else}
            <p class="vs-empty">No concerts logged.</p>
          {/if}
        </section>
      {/each}
    {/if}
  </div>
{/if}

<style>
  /* las secciones van a pares y sólo algunas cabeceras llevan botón: con el alto de la del
     botón en todas, las dos tarjetas de cada fila empiezan a la misma altura */
  .section-header {
    min-height: 1.75rem;
  }
  .vs-hero {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    gap: 1.5rem;
    margin-bottom: 1.5rem;
  }
  .vs-hero-side {
    display: flex;
    align-items: center;
    gap: 1.25rem;
    min-width: 0;
  }
  .vs-hero-side--b {
    flex-direction: row-reverse;
    text-align: right;
  }
  .vs-hero-photo-link {
    flex-shrink: 0;
    line-height: 0;
  }
  /* el aro es la identidad del lado: el mismo color que su línea en las gráficas */
  .vs-hero-photo {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 112px;
    height: 112px;
    object-fit: cover;
    border-radius: 50%;
    background: var(--border);
    color: var(--text-muted);
    outline: 3px solid;
    outline-offset: 3px;
  }
  .vs-hero-photo--a {
    outline-color: var(--versus-a);
  }
  .vs-hero-photo--b {
    outline-color: var(--versus-b);
  }
  .vs-hero-text {
    min-width: 0;
  }
  .vs-hero-name {
    font-size: var(--fs-display);
    font-weight: 700;
    word-break: break-word;
  }
  .vs-hero-name a {
    color: inherit;
    text-decoration: none;
  }
  .vs-hero-name a:hover {
    text-decoration: underline;
  }
  .vs-hero-mid {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
  }
  .vs-hero-vs {
    font-family: var(--font-mono);
    font-size: var(--fs-lg);
    text-transform: uppercase;
    letter-spacing: var(--track-wide);
    color: var(--text-muted);
  }
  :global(.versus-key) {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 2px;
    vertical-align: 0.05em;
    flex-shrink: 0;
  }
  :global(.versus-key--a) {
    background: var(--versus-a);
  }
  :global(.versus-key--b) {
    background: var(--versus-b);
  }
  .section-title .versus-key {
    margin-right: 0.5rem;
  }
  .chart-card {
    padding: 1rem;
  }
  .vs-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 1rem;
    margin-bottom: 0.5rem;
    font-size: var(--fs-sm);
    color: var(--text-secondary);
  }
  .vs-legend .versus-key {
    margin-right: 0.35rem;
  }
  .vs-ghost {
    height: 250px;
    border-radius: var(--radius);
    background: linear-gradient(90deg, var(--bg-hover) 25%, var(--bg-placeholder) 50%, var(--bg-hover) 75%);
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite;
  }
  .vs-together-meta {
    font-family: var(--font-mono);
    font-size: var(--fs-sm);
    color: var(--text-muted);
  }
  .vs-empty {
    margin: 0;
    padding: 1rem 0;
    font-size: var(--fs-md);
    color: var(--text-muted);
  }

  /* en un móvil la foto va sobre el nombre: en fila, dos nombres largos no caben */
  @media (max-width: 768px) {
    .vs-hero {
      gap: 0.75rem;
      align-items: start;
    }
    .vs-hero-side,
    .vs-hero-side--b {
      flex-direction: column;
      gap: 0.75rem;
      text-align: center;
    }
    .vs-hero-photo {
      width: 72px;
      height: 72px;
    }
    .vs-hero-name {
      font-size: var(--fs-lg);
    }
    .vs-hero-mid {
      padding-top: 1.25rem;
    }
  }
</style>
