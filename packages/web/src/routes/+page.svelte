<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { api, invalidateCache, getRankingMetric, getSessionTrackingDisplay, getWeekStart, type TopTrackItem, type TopArtistItem, type TopAlbumItem, type HistoryItem, type HealthData, type StreaksData, type RankingMetric, type GenreItem, type ReportResponse, type WeekStartOption } from '$lib/api';
  import { REPORT_GENRES_LIMIT, nextMilestone } from '@sis/shared';
  import TrackList from '$lib/components/TrackList.svelte';
  import TopCollage from '$lib/components/TopCollage.svelte';
  import WeekStrip, { type WeekStripDay } from '$lib/components/WeekStrip.svelte';
  import RecentPlaysRail from '$lib/components/RecentPlaysRail.svelte';
  import ReportTopCard from '$lib/components/reports/ReportTopCard.svelte';
  import ReportBars from '$lib/components/reports/ReportBars.svelte';
  import ReportDelta from '$lib/components/reports/ReportDelta.svelte';
  import { formatNumber, formatHours, formatDuration } from '$lib/utils/format';
  import { latestClosedPeriod, periodDateRange } from '$lib/utils/report-periods';
  import { nowPlayingStore } from '$lib/stores/now-playing.svelte';
  import { closedChartsStore } from '$lib/stores/closed-charts.svelte';
  import { projectionsStore } from '$lib/stores/projections.svelte';
  import { playUpdatesStore, targetIdsFor, type PlayUpdate } from '$lib/stores/play-updates.svelte';
  import { applyPlayToTopRows } from '$lib/utils/optimistic-play';
  import { statFlashStore } from '$lib/stores/stat-flash.svelte';
  import IconChart from '$lib/icons/IconChart.svelte';
  import IconChevronRight from '$lib/icons/IconChevronRight.svelte';
  import { openEntityContextMenu, trackEntity } from '$lib/utils/entity-context';
  import PullToRefresh from '$lib/components/PullToRefresh.svelte';
  import RecentRankChanges from '$lib/components/RecentRankChanges.svelte';
  import { getDetailLayout } from '$lib/api/settings';
  import { defaultLayout, type DetailLayout } from '$lib/detail-layout';

  const DAY_MS = 86_400_000;
  // la tira enseña siete días; se piden catorce para tener la semana anterior
  // con la que comparar en la misma llamada
  const STRIP_DAYS = 7;
  const WINDOW_DAYS = STRIP_DAYS * 2;
  const LIST_LIMIT = 5;
  const RECENT_LIMIT = 10;
  const RECENT_POLL_MS = 15_000;
  const TZ_OFFSET_MINUTES = -new Date().getTimezoneOffset();

  // los buckets diarios de /listening-time son UTC: las claves se calculan igual
  const utcDayKey = (d: Date) => d.toISOString().slice(0, 10);

  let topTracks = $state<TopTrackItem[]>([]);
  let topArtists = $state<TopArtistItem[]>([]);
  let topAlbums = $state<TopAlbumItem[]>([]);
  let recentPlays = $state<HistoryItem[]>([]);
  let health = $state<HealthData | null>(null);
  // últimos catorce días, del más antiguo a hoy, con los días sin plays a cero
  let dayBuckets = $state<WeekStripDay[]>([]);
  let streaks = $state<StreaksData | null>(null);
  let lastReport = $state<ReportResponse | null>(null);
  let lastYearTracks = $state<TopTrackItem[]>([]);
  let genres = $state<GenreItem[]>([]);
  let metric = $state<RankingMetric>('time');
  let weekStart = $state<WeekStartOption>('monday');
  // orden configurable de las secciones del dashboard (settings, como las vistas de detalle)
  let layout = $state<DetailLayout>(defaultLayout('dashboard'));

  // estado de carga por petición independiente
  let loadingTracks = $state(true);
  let loadingArtists = $state(true);
  let loadingAlbums = $state(true);
  let loadingHistory = $state(true);
  let loadingTime = $state(true);
  let loadingHealth = $state(true);
  let loadingStreaks = $state(true);
  let loadingReport = $state(true);
  let loadingLastYear = $state(true);
  let loadingGenres = $state(true);

  // todo lo que la barra de stats y la tira muestran sale de los mismos buckets
  let weekDays = $derived(dayBuckets.slice(-STRIP_DAYS));
  let today = $derived(weekDays.at(-1));
  let yesterday = $derived(weekDays.at(-2));
  let weekMs = $derived(weekDays.reduce((sum, d) => sum + d.ms, 0));
  let prevWeekMs = $derived(dayBuckets.slice(0, -STRIP_DAYS).reduce((sum, d) => sum + d.ms, 0));
  let milestone = $derived(nextMilestone(health?.totalPlays ?? 0));

  let lastReportPeriod = $derived(latestClosedPeriod('week', weekStart));

  // la misma semana de hace un año, en días UTC como el resto de rangos custom
  let lastYearRange = $derived.by(() => {
    const end = new Date();
    end.setUTCFullYear(end.getUTCFullYear() - 1);
    return { startDate: utcDayKey(new Date(end.getTime() - (STRIP_DAYS - 1) * DAY_MS)), endDate: utcDayKey(end) };
  });

  const value = (plays: number, ms: number) => metric === 'plays' ? `${formatNumber(plays)} plays` : formatDuration(ms);

  async function pollRecent() {
    try {
      const res = await api.history(1, RECENT_LIMIT);
      if (res.items.length === 0 || recentPlays.length === 0) return;
      const latestId = recentPlays[0].id;
      const newItems = res.items.filter((i) => i.id > latestId);
      if (newItems.length > 0) {
        recentPlays = [...newItems, ...recentPlays].slice(0, RECENT_LIMIT);
      }
    } catch {}
  }

  function loadData() {
    metric = getRankingMetric();
    weekStart = getWeekStart();
    loadingTracks = loadingArtists = loadingAlbums = loadingHistory = loadingHealth = loadingTime = loadingStreaks = loadingReport = loadingLastYear = loadingGenres = true;

    api.topTracks('week', LIST_LIMIT, metric)
      .then((t) => { topTracks = t; })
      .catch((e) => console.error('topTracks:', e))
      .finally(() => { loadingTracks = false; });

    api.topArtists('week', LIST_LIMIT, metric)
      .then((a) => { topArtists = a; })
      .catch((e) => console.error('topArtists:', e))
      .finally(() => { loadingArtists = false; });

    api.topAlbums('week', LIST_LIMIT, metric)
      .then((a) => { topAlbums = a; })
      .catch((e) => console.error('topAlbums:', e))
      .finally(() => { loadingAlbums = false; });

    api.history(1, RECENT_LIMIT)
      .then((h) => { recentPlays = h.items; })
      .catch((e) => console.error('history:', e))
      .finally(() => { loadingHistory = false; });

    api.health()
      .then((h) => { health = h; })
      .catch((e) => console.error('health:', e))
      .finally(() => { loadingHealth = false; });

    // catorce días naturales (UTC) terminando hoy: la semana de la tira y la
    // anterior. es un rango custom y no `week` porque ese es una ventana rodante
    // de 7×24h que no casa con barras por día
    const now = new Date();
    const keys = Array.from({ length: WINDOW_DAYS }, (_, i) => utcDayKey(new Date(now.getTime() - (WINDOW_DAYS - 1 - i) * DAY_MS)));
    api.listeningTime('custom', 'day', { startDate: keys[0], endDate: keys[keys.length - 1] })
      .then((items) => {
        const byDay = new Map(items.map((d) => [d.period, d]));
        dayBuckets = keys.map((key) => ({ key, plays: byDay.get(key)?.play_count ?? 0, ms: byDay.get(key)?.total_ms ?? 0 }));
      })
      .catch((e) => console.error('listeningTime:', e))
      .finally(() => { loadingTime = false; });

    api.streaks()
      .then((s) => { streaks = s; })
      .catch((e) => console.error('streaks:', e))
      .finally(() => { loadingStreaks = false; });

    // el report está pre-horneado en el servidor: es una lectura de cache
    const period = lastReportPeriod;
    if (period) {
      api.report('week', period, weekStart, metric, TZ_OFFSET_MINUTES)
        .then((r) => { lastReport = r; })
        .catch((e) => console.error('report:', e))
        .finally(() => { loadingReport = false; });
    } else {
      loadingReport = false;
    }

    api.topTracks('custom', LIST_LIMIT, metric, lastYearRange)
      .then((t) => { lastYearTracks = t; })
      .catch((e) => console.error('lastYear:', e))
      .finally(() => { loadingLastYear = false; });

    api.topGenres('week', REPORT_GENRES_LIMIT)
      .then((g) => { genres = g; })
      .catch((e) => console.error('topGenres:', e))
      .finally(() => { loadingGenres = false; });
  }

  // pull-to-refresh: sin invalidar, loadData se resuelve entera desde la cache
  // SWR (TTL de 10 min en los tops) y el gesto no hace nada visible. Aquí el
  // purgado ancho sí es lo que el usuario está pidiendo
  async function refresh() {
    await invalidateCache('/stats/');
    loadData();
  }

  onMount(() => {
    layout = getDetailLayout('dashboard');
    loadData();
    const pollInterval = setInterval(pollRecent, RECENT_POLL_MS);
    return () => clearInterval(pollInterval);
  });

  $effect(() => {
    const play = nowPlayingStore.lastFinishedPlay;
    if (!play || recentPlays.length === 0) return;
    if (recentPlays[0]?.track?.id === play.track?.id && Math.abs(new Date(recentPlays[0].playedAt).getTime() - new Date(play.playedAt).getTime()) < 60_000) return;
    recentPlays = [play, ...recentPlays].slice(0, RECENT_LIMIT);
  });

  // --- play recién terminado: parche optimista de las cifras del dashboard ---
  //
  // Las listas son del rango 'week', así que un play de ahora siempre cae
  // dentro y no hace falta comprobar ventana. Los contadores se derivan del
  // mismo play, de modo que aquí no hace falta red para nada. (Lo que había
  // antes era una llamada a los mismos endpoints que la cache SWR resolvía sin
  // salir a red: parecía un refresco y no lo era.)
  let lastOptimisticSeq = 0;

  // los contadores de la barra no son entidades, así que se marcan con claves
  // propias. Van en dos grupos porque cambian en momentos distintos: los de
  // tiempo se derivan del play al vuelo, las rachas y el total esperan a que el
  // servidor confirme
  const FLASH_KEY_TIME = 'dashboard:time';
  const FLASH_KEY_TOTALS = 'dashboard:totals';

  // suma el play al bucket de hoy; si la página lleva abierta desde antes de
  // medianoche UTC, hoy aún no existe y la ventana se desliza un día
  function bumpToday(ms: number) {
    const key = utcDayKey(new Date());
    const buckets = dayBuckets.at(-1)?.key === key ? dayBuckets : [...dayBuckets.slice(1), { key, plays: 0, ms: 0 }];
    dayBuckets = buckets.map((d) => d.key === key ? { ...d, plays: d.plays + 1, ms: d.ms + ms } : d);
  }

  function applyOptimisticPlay(update: PlayUpdate) {
    topTracks = applyPlayToTopRows(topTracks, t => t.trackId, targetIdsFor(update, 'tracks'), update.playedMs, metric);
    topArtists = applyPlayToTopRows(topArtists, a => a.artistId, targetIdsFor(update, 'artists'), update.playedMs, metric);
    topAlbums = applyPlayToTopRows(topAlbums, a => a.albumId, targetIdsFor(update, 'albums'), update.playedMs, metric);
    bumpToday(update.playedMs);
    statFlashStore.flash([FLASH_KEY_TIME]);
  }

  $effect(() => {
    const update = playUpdatesStore.optimistic;
    if (!update || update.seq <= lastOptimisticSeq) return;
    lastOptimisticSeq = update.seq;
    // untrack: applyOptimisticPlay lee y reescribe las mismas listas y contadores
    untrack(() => applyOptimisticPlay(update));
  });

  // las rachas son lo único de esta pantalla que no se puede derivar del propio
  // play (el primer play de un día nuevo la alarga), así que se releen cuando el
  // servidor ya tiene el play. '/stats/streaks' casa un solo endpoint: es un
  // request, no una purga de familia
  let lastConfirmedSeq = 0;

  $effect(() => {
    const batch = playUpdatesStore.confirmed;
    if (!batch || batch.seq <= lastConfirmedSeq) return;
    lastConfirmedSeq = batch.seq;
    untrack(() => {
      invalidateCache('/stats/streaks')
        .then(() => api.streaks())
        .then(s => { streaks = s; statFlashStore.flash([FLASH_KEY_TOTALS]); })
        .catch(() => {});
      // /health no pasa por la cache (NO_CACHE_PATHS): se relee directamente
      api.health().then(h => { health = h; statFlashStore.flash([FLASH_KEY_TOTALS]); }).catch(() => {});
    });
  });
</script>

<PullToRefresh onrefresh={refresh}>
<!-- misma rejilla que las vistas de detalle: columna principal + rail a partir
     de 1800px, una sola columna (main y luego rail) por debajo. el div también
     evita que los snippets, como hijos directos de PullToRefresh, se interpreten
     como props implícitas del componente -->
<div class="detail-body">

<!-- filas fantasma de una lista de temas mientras carga -->
{#snippet trackGhost(count: number, ranked: boolean)}
  <div class="track-list">
    {#each Array(count) as _, i}
      <div class="track-item compact ghost-item">
        {#if ranked}<span class="track-rank ghost-rank">{i + 1}</span>{/if}
        <div class="track-art ghost-shimmer"></div>
        <div class="track-info">
          <div class="ghost-line ghost-line--title"></div>
          <div class="ghost-line ghost-line--sub"></div>
        </div>
        <div class="track-meta">
          <div class="ghost-line ghost-line--meta"></div>
        </div>
      </div>
    {/each}
  </div>
{/snippet}

{#snippet collageGhost()}
  <div class="collage-ghost">
    {#each Array(LIST_LIMIT) as _, i}
      <div class="collage-ghost-tile ghost-shimmer" class:collage-ghost-tile--lead={i === 0}></div>
    {/each}
  </div>
{/snippet}

<!-- una cifra de la rejilla de stats: valor, etiqueta y una línea de contexto
     (ayer, la semana anterior, el récord, el siguiente hito) -->
{#snippet stat(loading: boolean, flashKey: string, valueText: string, label: string, sub: import('svelte').Snippet)}
  <div class="card stat-card">
    {#if loading}
      <div class="stat-value"><span class="ghost-text ghost-stat"></span></div>
    {:else}
      <div class="stat-value" class:stat-flash={statFlashStore.isFlashing(flashKey)}>{valueText}</div>
    {/if}
    <div class="stat-label">{label}</div>
    <div class="stat-sub">{#if !loading}{@render sub()}{/if}</div>
  </div>
{/snippet}

<!-- despacha cada sección configurable del dashboard por su key (ver detail-layout.ts) -->
{#snippet section(key: string)}
  {#if key === 'statsBar'}
    <section class="detail-section">
      <div class="stats-grid dash-stats">
        {@render stat(loadingTime, FLASH_KEY_TIME, formatNumber(today?.plays ?? 0), 'plays today', subYesterdayPlays)}
        {@render stat(loadingTime, FLASH_KEY_TIME, formatHours(today?.ms ?? 0), 'listened today', subYesterdayTime)}
        {@render stat(loadingTime, FLASH_KEY_TIME, formatHours(weekMs), 'this week', subPrevWeek)}
        {@render stat(loadingStreaks, FLASH_KEY_TOTALS, `${streaks?.currentStreak ?? 0}d`, 'streak', subBestStreak)}
        {@render stat(loadingHealth, FLASH_KEY_TOTALS, formatNumber(health?.totalPlays ?? 0), 'total plays', subMilestone)}
      </div>
    </section>
  {:else if key === 'weekStrip'}
    <section class="detail-section">
      <div class="card">
        <h3 class="section-title"><a href="/insights" class="section-link">Last 7 days</a></h3>
        {#if loadingTime}
          <div class="week-ghost ghost-shimmer"></div>
        {:else}
          <WeekStrip days={weekDays} {metric} flash={statFlashStore.isFlashing(FLASH_KEY_TIME)} />
        {/if}
      </div>
    </section>
  {:else if key === 'topTracks'}
    <section class="detail-section">
      <div class="card">
        <h3 class="section-title"><a href="/top?range=week" class="section-link">Top tracks this week</a></h3>
        {#if loadingTracks}
          {@render trackGhost(LIST_LIMIT, true)}
        {:else if topTracks.length > 0}
          <TrackList items={topTracks} showRank {metric} compact />
        {:else}
          <p class="empty-inline">No data yet.</p>
        {/if}
      </div>
    </section>
  {:else if key === 'topAlbums'}
    <!-- artistas y álbumes son collages 2:1 (nº 1 grande + cuatro a un cuarto)
         y, contiguos en la columna principal, se colocan lado a lado -->
    <section class="detail-section detail-section--half">
      <div class="card">
        <h3 class="section-title"><a href="/top?range=week&tab=albums" class="section-link">Top albums this week</a></h3>
        {#if loadingAlbums}
          {@render collageGhost()}
        {:else if topAlbums.length > 0}
          <TopCollage items={topAlbums.filter(a => a.album).map((item, i) => ({
            href: `/album/${item.albumId}`,
            rank: i + 1,
            imageUrl: item.album?.imageUrl,
            name: item.album?.name ?? '',
            stat: value(item.playCount, item.totalMs),
            isLive: item.albumId === nowPlayingStore.albumId,
            oncontextmenu: openEntityContextMenu({ type: 'album', id: item.albumId, name: item.album?.name ?? '', imageUrl: item.album?.imageUrl ?? null }),
          }))} />
        {:else}
          <p class="empty-inline">No data yet.</p>
        {/if}
      </div>
    </section>
  {:else if key === 'topArtists'}
    <section class="detail-section detail-section--half">
      <div class="card">
        <h3 class="section-title"><a href="/top?range=week&tab=artists" class="section-link">Top artists this week</a></h3>
        {#if loadingArtists}
          {@render collageGhost()}
        {:else if topArtists.length > 0}
          <TopCollage items={topArtists.filter(a => a.artist).map((item, i) => ({
            href: `/artist/${item.artistId}`,
            rank: i + 1,
            imageUrl: item.artist?.imageUrl,
            name: item.artist?.name ?? '',
            stat: value(item.playCount, item.totalMs),
            isLive: nowPlayingStore.artistIds.includes(item.artistId),
            oncontextmenu: openEntityContextMenu({ type: 'artist', id: item.artistId, name: item.artist?.name ?? '', imageUrl: item.artist?.imageUrl ?? null }),
          }))} />
        {:else}
          <p class="empty-inline">No data yet.</p>
        {/if}
      </div>
    </section>
  {:else if key === 'lastReport'}
    <!-- sin semana cerrada (historial recién empezado) o sin plays en ella no hay sección -->
    {#if lastReportPeriod && (loadingReport || (lastReport && lastReport.summary.plays > 0))}
      <section class="detail-section">
        <div class="section-header">
          <h3 class="section-title"><a href="/reports/week/{lastReportPeriod}" class="section-link">Last week's report</a></h3>
          <span class="data-label">{periodDateRange(lastReportPeriod, 'week', weekStart)}</span>
        </div>
        {#if loadingReport || !lastReport}
          <div class="report-picks">
            {#each Array(3) as _}
              <div class="card report-pick-ghost"><div class="report-pick-ghost-img ghost-shimmer"></div><div class="ghost-line ghost-line--title"></div></div>
            {/each}
          </div>
        {:else}
          {@const s = lastReport.summary}
          {@const a = lastReport.top.artists[0]}
          {@const al = lastReport.top.albums[0]}
          {@const t = lastReport.top.tracks[0]}
          <p class="report-summary data-count">
            <span>{formatNumber(s.plays)} plays</span>
            <span class="report-summary-sep">·</span>
            <span>{formatHours(s.totalMs)}</span>
            <ReportDelta value={s.totalMs} previous={lastReport.previous?.totalMs} />
            <span class="report-summary-sep">·</span>
            <span>{formatNumber(s.distinctArtists)} artists</span>
            <span class="report-summary-sep">·</span>
            <span>{formatNumber(s.distinctTracks)} tracks</span>
          </p>
          <div class="report-picks">
            {#if a?.artist}
              <ReportTopCard label="Top artist" href="/artist/{a.artistId}" imageUrl={a.artist.imageUrl ?? null} round name={a.artist.name} sub={a.artist.genres[0] ?? ''} value={value(a.playCount, a.totalMs)} rankChange={a.rankChange} isNew={a.isNew} isReentry={a.isReentry ?? false} entity={{ type: 'artist', id: a.artistId, name: a.artist.name, imageUrl: a.artist.imageUrl ?? null }} />
            {/if}
            {#if al?.album}
              <ReportTopCard label="Top album" href="/album/{al.albumId}" imageUrl={al.album.imageUrl ?? null} name={al.album.name} sub={al.artists?.map(x => x.name).join(', ') ?? ''} value={value(al.playCount, al.totalMs)} rankChange={al.rankChange} isNew={al.isNew} isReentry={al.isReentry ?? false} entity={{ type: 'album', id: al.albumId, name: al.album.name, imageUrl: al.album.imageUrl ?? null, parentArtistId: al.artists?.[0]?.id }} />
            {/if}
            {#if t?.track}
              <ReportTopCard label="Top track" href="/track/{t.trackId}" imageUrl={t.track.album?.imageUrl ?? null} name={t.track.name} sub={t.track.artists.map(x => x.name).join(', ')} value={value(t.playCount, t.totalMs)} rankChange={t.rankChange} isNew={t.isNew} isReentry={t.isReentry ?? false} entity={trackEntity(t.track)} />
            {/if}
          </div>
        {/if}
      </section>
    {/if}
  {:else if key === 'lastYear'}
    <!-- sin historial de hace un año no hay nada que recordar: sección fuera -->
    {#if loadingLastYear || lastYearTracks.length > 0}
      <section class="detail-section">
        <div class="card">
          <div class="section-header">
            <h3 class="section-title"><a href="/top?range=custom&startDate={lastYearRange.startDate}&endDate={lastYearRange.endDate}" class="section-link">This week last year</a></h3>
            <span class="data-label">{lastYearRange.startDate.slice(0, 4)}</span>
          </div>
          {#if loadingLastYear}
            {@render trackGhost(LIST_LIMIT, true)}
          {:else}
            <TrackList items={lastYearTracks} showRank {metric} compact />
          {/if}
        </div>
      </section>
    {/if}
  {:else if key === 'topGenres'}
    <!-- sin artistas etiquetados no hay géneros: sección fuera -->
    {#if loadingGenres || genres.length > 0}
      <section class="detail-section">
        <div class="card">
          <h3 class="section-title"><a href="/insights" class="section-link">Top genres this week</a></h3>
          {#if loadingGenres}
            {#each Array(4) as _}
              <div class="ghost-line ghost-line--bar"></div>
            {/each}
          {:else}
            <ReportBars items={genres.map(g => ({ key: g.genre, label: g.genre, value: g.play_count, valueLabel: `${formatNumber(g.play_count)} plays` }))} />
          {/if}
        </div>
      </section>
    {/if}
  {:else if key === 'rankChanges'}
    <section class="detail-section">
      <RecentRankChanges />
    </section>
  {:else if key === 'recentPlays'}
    <section class="detail-section">
      <div class="card">
        {#if loadingHistory}
          <h3 class="section-title"><a href="/history" class="section-link">Recent plays</a></h3>
          {@render trackGhost(RECENT_LIMIT, false)}
        {:else if recentPlays.length > 0}
          <RecentPlaysRail initial={recentPlays} historyHref="/history" compact sessionStartedAt={getSessionTrackingDisplay() !== 'off' ? projectionsStore.sessionStartedAt : null} sessionTotalTracks={projectionsStore.data?.sessionTrackCount ?? 0} />
        {:else}
          <h3 class="section-title"><a href="/history" class="section-link">Recent plays</a></h3>
          <p class="empty-inline">No listening data yet.</p>
        {/if}
      </div>
    </section>
  {/if}
{/snippet}

{#snippet subYesterdayPlays()}{formatNumber(yesterday?.plays ?? 0)} yesterday{/snippet}
{#snippet subYesterdayTime()}{formatHours(yesterday?.ms ?? 0)} yesterday{/snippet}
{#snippet subPrevWeek()}<ReportDelta value={weekMs} previous={prevWeekMs} /> vs last week{/snippet}
{#snippet subBestStreak()}best {streaks?.longestStreak ?? 0}d{/snippet}
{#snippet subMilestone()}{formatNumber(milestone - (health?.totalPlays ?? 0))} to {formatNumber(milestone)}{/snippet}

<div class="detail-main dash-main">
  {#if closedChartsStore.charts.length > 0}
    <div class="card closed-charts-card">
      <div class="closed-charts-header">
        <IconChart />
        <span>Charts ready to view</span>
        <button class="closed-charts-dismiss" onclick={() => closedChartsStore.dismissAll()} title="Dismiss">&times;</button>
      </div>
      <div class="closed-charts-list">
        {#each closedChartsStore.charts as chart}
          <a href="/charts?granularity={chart.granularity}&period={chart.period}" class="closed-chart-link">
            {chart.label}
            <IconChevronRight />
          </a>
        {/each}
      </div>
    </div>
  {/if}

  {#each layout.main as key (key)}
    {@render section(key)}
  {/each}
</div>

<aside class="detail-rail">
  {#each layout.rail as key (key)}
    {@render section(key)}
  {/each}
</aside>

</div>
</PullToRefresh>

<style>
  /* la columna principal es una rejilla de dos: cada sección ocupa las dos
     celdas salvo dos "medias" contiguas (los collages), que comparten fila.
     una media sin pareja al lado sigue a ancho completo. el hueco entre
     secciones lo pone el gap, no el margen de cada sección */
  .dash-main {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1.5rem;
    align-content: start;
  }
  .dash-main > :global(*) {
    grid-column: 1 / -1;
    margin-bottom: 0;
  }
  .dash-main > :global(.detail-section--half:has(+ .detail-section--half)),
  .dash-main > :global(.detail-section--half + .detail-section--half) {
    grid-column: auto;
  }

  /* línea de contexto bajo cada cifra: ayer, la semana pasada, el récord… */
  .stat-sub {
    font-family: var(--font-mono);
    font-size: 0.65rem;
    color: var(--text-muted);
    margin-top: 0.35rem;
    min-height: 1em;
    display: flex;
    align-items: center;
    gap: 0.3rem;
  }

  .closed-charts-card {
    margin-bottom: 1.5rem;
    border-color: rgba(29, 185, 84, 0.3);
    background: rgba(29, 185, 84, 0.04);
  }
  .closed-charts-header {
    font-family: var(--font-mono);
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: var(--accent);
    font-size: 0.8rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: 0.5rem;
  }
  .closed-charts-dismiss {
    margin-left: auto;
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 1.2rem;
    cursor: pointer;
    padding: 0 0.2rem;
    line-height: 1;
  }
  .closed-charts-dismiss:hover {
    color: var(--text);
  }
  .closed-charts-list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .closed-chart-link {
    font-family: var(--font-mono);
    display: flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--text);
    text-decoration: none;
    font-size: 0.8rem;
    padding: 0.3rem 0;
    transition: color 0.05s;
  }
  .closed-chart-link:hover {
    color: var(--accent);
  }
  .closed-chart-link :global(svg) {
    margin-left: auto;
    opacity: 0;
    transition: opacity 0.05s;
  }
  .closed-chart-link:hover :global(svg) {
    opacity: 1;
  }

  /* report de la semana pasada: resumen y los tres nº 1, como en el report */
  .report-summary {
    margin: 0 0 0.75rem;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.45rem;
  }
  .report-summary-sep {
    color: var(--text-muted);
  }
  .report-picks {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.75rem;
  }
  .report-pick-ghost {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
  }
  .report-pick-ghost-img {
    width: 60%;
    aspect-ratio: 1;
    border-radius: var(--radius);
  }

  /* la lista del rail va dentro de una card, como el resto del dashboard: la
     card hereda el estirado de su sección para que el scroll absorba el hueco
     hasta donde acaba la columna principal (ver .detail-rail en app.css) */
  @media (min-width: 1800px) {
    :global(.detail-rail > .detail-section > .card:has(.recent-scroll)) {
      display: flex;
      flex-direction: column;
      flex: 1 1 0;
      min-height: 0;
    }
  }

  /* ghost loading placeholders */
  .ghost-stat {
    width: 2.5rem;
    height: 1.1rem;
    vertical-align: middle;
  }
  .ghost-item {
    pointer-events: none;
  }
  .ghost-rank {
    opacity: 0.35;
  }
  .ghost-shimmer {
    background: linear-gradient(90deg, #1e2a2a 25%, #253030 50%, #1e2a2a 75%);
    background-size: 200% 100%;
    animation: shimmer 1.5s ease-in-out infinite;
  }
  .ghost-line {
    display: block;
    border-radius: var(--radius);
    background: linear-gradient(90deg, #1e2a2a 25%, #253030 50%, #1e2a2a 75%);
    background-size: 200% 100%;
    animation: shimmer 1.5s ease-in-out infinite;
  }
  .ghost-line--title {
    width: 60%;
    height: 0.8rem;
    margin-bottom: 0.35rem;
  }
  .ghost-line--sub {
    width: 40%;
    height: 0.65rem;
  }
  .ghost-line--meta {
    width: 3rem;
    height: 0.75rem;
    margin-left: auto;
  }
  .ghost-line--bar {
    height: 1.4rem;
    margin-bottom: 0.5rem;
  }
  .week-ghost {
    height: 7.5rem;
    border-radius: var(--radius);
  }
  .collage-ghost {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    grid-auto-rows: minmax(0, 1fr);
    gap: 0.4rem;
    aspect-ratio: 2 / 1;
  }
  .collage-ghost-tile {
    border-radius: var(--radius);
  }
  .collage-ghost-tile--lead {
    grid-column: span 2;
    grid-row: span 2;
  }
  .empty-inline {
    color: var(--text-muted);
    font-size: 0.85rem;
    margin: 0.25rem 0;
  }

  @media (max-width: 600px) {
    .report-picks {
      grid-template-columns: 1fr;
    }
    /* cinco cifras en dos columnas: la última ocupa la fila entera en vez de
       quedarse sola a un lado */
    .dash-stats {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .dash-stats > :nth-child(odd):last-child {
      grid-column: 1 / -1;
    }
  }
</style>
