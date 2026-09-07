<script lang="ts">
  import { untrack, onDestroy } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { api, createFetchController, getWeekStart, getRankingMetric, getArtistBackdrop, type ReportResponse, type ReportFacts, type Granularity, type WeekStartOption, type RankingMetric, type ArtistBackdrop, type ListeningTimeItem } from '$lib/api';
  import { isGranularity, isPeriodKey, isClosedPeriod } from '@sis/shared';
  import { isAbortError } from '$lib/utils/errors';
  import { periodLabel } from '$lib/utils/periods';
  import { GRANULARITIES, GRANULARITY_LABELS, GRANULARITY_NOUNS, latestClosedPeriod, periodDateRange, siblingPeriod, periodBuckets } from '$lib/utils/report-periods';
  import { formatNumber, formatDuration, formatHours, formatHistoryStamp, formatShortDateUTC, getLocalizedDayNames, getLocalizedMonthNames } from '$lib/utils/format';
  import { extractColor } from '$lib/utils/color';
  import { GRID, TOOLTIP_BASE, AXIS_LABEL, categoryAxis, valueAxis, barSeries, tooltipPoint, type TooltipParams } from '$lib/utils/chart';
  import type { EChartsOption } from 'echarts';
  import type { EntityContext } from '$lib/utils/entity-context';
  import { shortcutStore } from '$lib/stores/keyboard-shortcuts.svelte';
  import DetailBackdrop from '$lib/components/DetailBackdrop.svelte';
  import BaseChart from '$lib/components/charts/BaseChart.svelte';
  import TrackItem from '$lib/components/TrackItem.svelte';
  import ReportDelta from '$lib/components/reports/ReportDelta.svelte';
  import ReportBars, { type BarItem } from '$lib/components/reports/ReportBars.svelte';
  import ReportPolar from '$lib/components/reports/ReportPolar.svelte';
  import ReportTopCard from '$lib/components/reports/ReportTopCard.svelte';
  import IconChevronRight from '$lib/icons/IconChevronRight.svelte';

  // desfase local en minutos: solo mueve el reloj por horas; el resto del report va
  // en UTC, como los límites del periodo y los charts
  const TZ_OFFSET_MINUTES = -new Date().getTimezoneOffset();
  const HOURS_PER_DAY = 24;
  const DAYS_PER_WEEK = 7;
  const CLOCK_LABEL_EVERY = 6;
  const MONTH_AXIS_LABEL_EVERY = 5;
  // primer día de la semana según la preferencia, como índice de strftime('%w') (0 = domingo)
  const WEEK_START_DOW: Record<WeekStartOption, number> = { sunday: 0, monday: 1, friday: 5 };

  let granularity = $derived(page.params.granularity ?? '');
  let period = $derived(page.params.period ?? '');
  let weekStart = $state<WeekStartOption>('friday');
  let metric = $state<RankingMetric>('time');
  let backdropMode = $state<ArtistBackdrop>('blur');
  let report = $state<ReportResponse | null>(null);
  let loading = $state(true);
  let error = $state<'invalid' | 'open' | 'missing' | null>(null);
  let heroColor = $state('');
  const fetchCtrl = createFetchController();
  const colorCtrl = createFetchController();

  async function load(gran: Granularity, key: string) {
    const signal = fetchCtrl.reset();
    loading = true;
    error = null;
    report = null;
    // misma regla de cierre que el servidor: evita pedir un periodo que responderá 400
    if (!isClosedPeriod(key, gran, weekStart)) { error = 'open'; loading = false; return; }
    try {
      report = await api.report(gran, key, weekStart, metric, TZ_OFFSET_MINUTES, signal);
    } catch (e) {
      if (isAbortError(e)) return;
      error = 'missing';
    } finally {
      if (!signal.aborted) loading = false;
    }
  }

  // la granularidad y el periodo van en la URL: prev/next remontan este mismo componente.
  // load escribe estado, así que va en untrack para que el efecto solo siga a los params
  $effect(() => {
    const gran = granularity;
    const key = period;
    untrack(() => {
      weekStart = getWeekStart();
      metric = getRankingMetric();
      backdropMode = getArtistBackdrop();
      if (!isGranularity(gran) || !isPeriodKey(key, gran)) { error = 'invalid'; loading = false; return; }
      load(gran, key);
    });
  });

  let gran = $derived<Granularity>(isGranularity(granularity) ? granularity : 'week');
  let topArtist = $derived(report?.top.artists[0] ?? null);
  let backdropUrl = $derived(topArtist?.artist?.imageUrl ?? null);

  // tinte del hero con el color dominante de la foto del artista nº 1
  $effect(() => {
    const url = backdropUrl;
    const signal = colorCtrl.reset();
    heroColor = '';
    if (!url) return;
    extractColor(url).then(([r, g, b]) => { if (!signal.aborted) heroColor = `${r},${g},${b}`; }).catch(() => {});
  });

  shortcutStore.registerPageShortcuts(
    [
      { key: '[', description: 'Previous period', category: 'page' },
      { key: ']', description: 'Next period', category: 'page' },
    ],
    (e) => {
      if (e.key !== '[' && e.key !== ']') return false;
      const target = e.key === '[' ? report?.period.prev : report?.period.next;
      if (target) { e.preventDefault(); goto(`/reports/${gran}/${target}`); }
      return true;
    },
  );
  onDestroy(() => shortcutStore.unregisterPageShortcuts());

  // --- derivados de la vista ---

  let hasPlays = $derived((report?.summary.plays ?? 0) > 0);
  let monthNames = $derived(getLocalizedMonthNames());
  let dayNames = $derived(getLocalizedDayNames());

  const value = (plays: number, ms: number) => metric === 'plays' ? `${formatNumber(plays)} plays` : formatDuration(ms);
  const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;

  // serie rellena: un bucket por día (o mes) del periodo, con 0 donde no hubo plays
  let filledSeries = $derived.by((): ListeningTimeItem[] => {
    if (!report) return [];
    const byKey = new Map(report.series.map(s => [s.period, s]));
    return periodBuckets(period, gran, weekStart).map(k => byKey.get(k) ?? { period: k, play_count: 0, total_ms: 0 });
  });
  const bucketLabel = (key: string) => {
    if (gran === 'year') return monthNames[Number(key.slice(5, 7)) - 1];
    if (gran === 'week') return dayNames[new Date(key).getUTCDay()];
    return formatShortDateUTC(new Date(key));
  };
  let seriesOption = $derived<EChartsOption>({
    grid: { ...GRID },
    tooltip: { ...TOOLTIP_BASE, formatter: (params: TooltipParams) => { const p = tooltipPoint(params); return `${p.axisValue}<br/>Plays: <b>${p.value}</b>`; } },
    xAxis: categoryAxis(filledSeries.map(s => bucketLabel(s.period)), { axisLabel: { ...AXIS_LABEL, interval: gran === 'month' ? MONTH_AXIS_LABEL_EVERY - 1 : 0 } }),
    yAxis: valueAxis(),
    series: [barSeries(filledSeries.map(s => s.play_count))],
  });

  let clockLabels = Array.from({ length: HOURS_PER_DAY }, (_, h) => hourLabel(h));
  // días de la semana rotados para que el primero sea el de la preferencia
  let weekdayValues = $derived(Array.from({ length: DAYS_PER_WEEK }, (_, i) => report?.weekdays[(i + WEEK_START_DOW[weekStart]) % DAYS_PER_WEEK] ?? 0));
  let weekdayLabels = $derived(Array.from({ length: DAYS_PER_WEEK }, (_, i) => dayNames[(i + WEEK_START_DOW[weekStart]) % DAYS_PER_WEEK]));
  let busiestWeekday = $derived.by(() => {
    const max = Math.max(...weekdayValues);
    return max > 0 ? weekdayValues.indexOf(max) : null;
  });

  let genreBars = $derived<BarItem[]>((report?.genres ?? []).map(g => ({
    key: g.genre, label: g.genre, value: g.plays, valueLabel: `${g.pct}%`, rankChange: g.rankChange, isNew: g.isNew,
  })));
  let decadeBars = $derived<BarItem[]>((report?.decades ?? []).map(d => ({
    key: String(d.decade), label: `${d.decade}s`, value: d.plays, valueLabel: `${d.pct}%`,
    sublabel: d.topArtist?.name, imageUrl: d.topArtist?.imageUrl, round: true, sublabelHref: d.topArtist ? `/artist/${d.topArtist.id}` : undefined,
  })));

  let avgPlaysPerDay = $derived(report ? Math.round(report.summary.plays / Math.max(1, report.summary.days)) : 0);

  const trackEntity = (t: { id: string; name: string; album: { imageUrl: string | null } | null; artists: { id: string }[] }): EntityContext =>
    ({ type: 'track', id: t.id, name: t.name, imageUrl: t.album?.imageUrl ?? null, parentArtistId: t.artists[0]?.id });

  // primer y último play del periodo, como dos tarjetas iguales
  const edgePlays = (f: ReportFacts) => [{ label: 'First play', play: f.firstPlay }, { label: 'Last play', play: f.lastPlay }];
</script>

{#if error}
  <div class="card empty-state report-empty">
    {#if error === 'invalid'}
      <p>This report doesn't exist.</p>
    {:else if error === 'open'}
      <p>This {GRANULARITY_NOUNS[gran].toLowerCase()} hasn't closed yet. Reports are written once the period ends.</p>
      {#if latestClosedPeriod(gran, weekStart)}
        <a class="range-btn" href="/reports/{gran}/{latestClosedPeriod(gran, weekStart)}">Last closed {GRANULARITY_NOUNS[gran].toLowerCase()}</a>
      {/if}
    {:else}
      <p>Couldn't load this report.</p>
    {/if}
    <a class="range-btn" href="/reports">All reports</a>
  </div>
{:else}
  <DetailBackdrop imageUrl={backdropUrl} color={heroColor} mode={backdropMode} />

  <div class="report-hero">
    <div class="report-nav">
      {#if report?.period.prev}
        <a class="range-btn report-arrow" href="/reports/{gran}/{report.period.prev}" title="Previous {GRANULARITY_NOUNS[gran].toLowerCase()}">&lsaquo;</a>
      {:else}
        <button class="range-btn report-arrow" disabled title="No earlier {GRANULARITY_NOUNS[gran].toLowerCase()}">&lsaquo;</button>
      {/if}
      <div class="report-title">
        <span class="data-label">{GRANULARITY_LABELS[gran]} report</span>
        <h1>{periodLabel(period, gran)}</h1>
        <!-- en meses y años el rango de fechas es el propio título: no repetirlo -->
        {#if periodDateRange(period, gran, weekStart) !== periodLabel(period, gran)}
          <span class="report-range">{periodDateRange(period, gran, weekStart)}</span>
        {/if}
      </div>
      {#if report?.period.next}
        <a class="range-btn report-arrow" href="/reports/{gran}/{report.period.next}" title="Next {GRANULARITY_NOUNS[gran].toLowerCase()}">&rsaquo;</a>
      {:else}
        <button class="range-btn report-arrow" disabled title="This is the latest closed {GRANULARITY_NOUNS[gran].toLowerCase()}">&rsaquo;</button>
      {/if}
    </div>
    <div class="report-actions">
      <div class="time-range-selector report-gran">
        {#each GRANULARITIES as g (g)}
          {@const target = g === gran ? period : siblingPeriod(period, gran, g, weekStart)}
          {#if target}
            <a class="range-btn" class:active={g === gran} href="/reports/{g}/{target}">{GRANULARITY_NOUNS[g]}</a>
          {/if}
        {/each}
      </div>
      <a class="range-btn report-chart-link" href="/charts?granularity={gran}&period={period}">Chart <IconChevronRight /></a>
    </div>
  </div>

  {#if loading || !report}
    <div class="loading"><div class="spinner"></div></div>
  {:else if !hasPlays}
    <div class="card empty-state report-empty"><p>No plays in this {GRANULARITY_NOUNS[gran].toLowerCase()}.</p></div>
  {:else}
    {@const s = report.summary}
    {@const prev = report.previous}
    {@const facts = report.facts}

    <!-- cifras grandes con su variación respecto al periodo anterior -->
    <div class="stats-grid report-summary">
      <div class="card stat-card">
        <div class="stat-value">{formatNumber(s.plays)}</div>
        <div class="stat-label">Plays <ReportDelta value={s.plays} previous={prev?.plays} /></div>
      </div>
      <div class="card stat-card">
        <div class="stat-value">{formatHours(s.totalMs)}</div>
        <div class="stat-label">Listening time <ReportDelta value={s.totalMs} previous={prev?.totalMs} /></div>
      </div>
      <div class="card stat-card">
        <div class="stat-value">{formatNumber(s.distinctArtists)}</div>
        <div class="stat-label">Artists <ReportDelta value={s.distinctArtists} previous={prev?.distinctArtists} /></div>
      </div>
      <div class="card stat-card">
        <div class="stat-value">{formatNumber(s.distinctAlbums)}</div>
        <div class="stat-label">Albums <ReportDelta value={s.distinctAlbums} previous={prev?.distinctAlbums} /></div>
      </div>
      <div class="card stat-card">
        <div class="stat-value">{formatNumber(s.distinctTracks)}</div>
        <div class="stat-label">Tracks <ReportDelta value={s.distinctTracks} previous={prev?.distinctTracks} /></div>
      </div>
    </div>

    <!-- nº 1 de cada tipo + el resto del top en su columna -->
    <div class="report-columns">
      <div class="report-column">
        {#if report.top.artists[0]?.artist}
          {@const a = report.top.artists[0]}
          <ReportTopCard label="Top artist" href="/artist/{a.artistId}" imageUrl={a.artist?.imageUrl ?? null} round name={a.artist?.name ?? ''} sub={a.artist?.genres[0] ?? ''} value={value(a.playCount, a.totalMs)} rankChange={a.rankChange} isNew={a.isNew} isReentry={a.isReentry ?? false} entity={{ type: 'artist', id: a.artistId, name: a.artist?.name ?? '', imageUrl: a.artist?.imageUrl ?? null }} />
        {/if}
        <div class="track-list">
          {#each report.top.artists.slice(1) as a, i (a.artistId)}
            <TrackItem compact rank={i + 2} rankChange={a.rankChange} isNew={a.isNew} isReentry={a.isReentry ?? false} imageUrl={a.artist?.imageUrl} imageHref="/artist/{a.artistId}" imageRound name={a.artist?.name ?? a.artistId} nameHref="/artist/{a.artistId}" entity={{ type: 'artist', id: a.artistId, name: a.artist?.name ?? '', imageUrl: a.artist?.imageUrl ?? null }}>
              {#snippet subtitle()}{a.artist?.genres[0] ?? ''}{/snippet}
              {#snippet meta()}<span class="data-count">{value(a.playCount, a.totalMs)}</span>{/snippet}
            </TrackItem>
          {/each}
        </div>
      </div>
      <div class="report-column">
        {#if report.top.albums[0]?.album}
          {@const al = report.top.albums[0]}
          <ReportTopCard label="Top album" href="/album/{al.albumId}" imageUrl={al.album?.imageUrl ?? null} name={al.album?.name ?? ''} sub={al.artists?.map(x => x.name).join(', ') ?? ''} value={value(al.playCount, al.totalMs)} rankChange={al.rankChange} isNew={al.isNew} isReentry={al.isReentry ?? false} entity={{ type: 'album', id: al.albumId, name: al.album?.name ?? '', imageUrl: al.album?.imageUrl ?? null, parentArtistId: al.artists?.[0]?.id }} />
        {/if}
        <div class="track-list">
          {#each report.top.albums.slice(1) as al, i (al.albumId)}
            <TrackItem compact rank={i + 2} rankChange={al.rankChange} isNew={al.isNew} isReentry={al.isReentry ?? false} imageUrl={al.album?.imageUrl} imageHref="/album/{al.albumId}" name={al.album?.name ?? al.albumId} nameHref="/album/{al.albumId}" entity={{ type: 'album', id: al.albumId, name: al.album?.name ?? '', imageUrl: al.album?.imageUrl ?? null, parentArtistId: al.artists?.[0]?.id }}>
              {#snippet subtitle()}
                {#each al.artists ?? [] as ar, j (ar.id)}{#if j > 0}, {/if}<a href="/artist/{ar.id}" class="artist-link">{ar.name}</a>{/each}
              {/snippet}
              {#snippet meta()}<span class="data-count">{value(al.playCount, al.totalMs)}</span>{/snippet}
            </TrackItem>
          {/each}
        </div>
      </div>
      <div class="report-column">
        {#if report.top.tracks[0]?.track}
          {@const t = report.top.tracks[0]}
          <ReportTopCard label="Top track" href="/track/{t.trackId}" imageUrl={t.track?.album?.imageUrl ?? null} name={t.track?.name ?? ''} sub={[t.track?.artists.map(x => x.name).join(', '), facts.topTrackShare > 0 ? `${facts.topTrackShare}% of plays` : ''].filter(Boolean).join(' · ')} value={value(t.playCount, t.totalMs)} rankChange={t.rankChange} isNew={t.isNew} isReentry={t.isReentry ?? false} entity={t.track ? trackEntity(t.track) : undefined} />
        {/if}
        <div class="track-list">
          {#each report.top.tracks.slice(1) as t, i (t.trackId)}
            <TrackItem compact rank={i + 2} rankChange={t.rankChange} isNew={t.isNew} isReentry={t.isReentry ?? false} imageUrl={t.track?.album?.imageUrl} imageHref={t.track?.album ? `/album/${t.track.album.id}` : undefined} name={t.track?.name ?? t.trackId} nameHref="/track/{t.trackId}" entity={t.track ? trackEntity(t.track) : undefined}>
              {#snippet subtitle()}
                {#each t.track?.artists ?? [] as ar, j (ar.id)}{#if j > 0}, {/if}<a href="/artist/{ar.id}" class="artist-link">{ar.name}</a>{/each}
              {/snippet}
              {#snippet meta()}<span class="data-count">{value(t.playCount, t.totalMs)}</span>{/snippet}
            </TrackItem>
          {/each}
        </div>
      </div>
    </div>

    <!-- actividad: plays por día (o mes) + reloj por horas (+ días de la semana) -->
    <div class="report-charts" class:report-charts--triple={gran !== 'week'}>
      <div class="card">
        <h3 class="section-title">{gran === 'year' ? 'Plays by month' : 'Plays by day'}</h3>
        <BaseChart option={seriesOption} height="240px" />
      </div>
      <div class="card">
        <h3 class="section-title">Listening clock</h3>
        <ReportPolar values={report.clock} labels={clockLabels} highlight={facts.busiestHour} labelEvery={CLOCK_LABEL_EVERY} height="240px" />
      </div>
      {#if gran !== 'week'}
        <div class="card">
          <h3 class="section-title">By weekday</h3>
          <ReportPolar values={weekdayValues} labels={weekdayLabels} highlight={busiestWeekday} height="240px" />
        </div>
      {/if}
    </div>

    <!-- quick facts: pocas tarjetas y etiquetas cortas (la cifra grande ya cuenta la
         historia); el primer y último play van en una línea porque un título de tema
         no cabe en una stat card -->
    <h2 class="section-title">Quick facts</h2>
    <div class="stats-grid report-facts">
      {#if facts.busiestDay}
        <a class="card stat-card stat-card--link" href="/history?date={facts.busiestDay.date}" title="{formatNumber(facts.busiestDay.plays)} plays">
          <div class="stat-value">{formatShortDateUTC(new Date(facts.busiestDay.date))}</div>
          <div class="stat-label">Busiest day</div>
        </a>
      {/if}
      {#if facts.busiestHour !== null}
        <div class="card stat-card">
          <div class="stat-value">{hourLabel(facts.busiestHour)}</div>
          <div class="stat-label">Peak hour</div>
        </div>
      {/if}
      <div class="card stat-card">
        <div class="stat-value">{s.activeDays}<span class="report-of">/{s.days}</span></div>
        <div class="stat-label">Active days</div>
      </div>
      <div class="card stat-card">
        <div class="stat-value">{formatNumber(avgPlaysPerDay)}</div>
        <div class="stat-label">Plays per day</div>
      </div>
      <!-- la racha solo aporta cuando no es simplemente "todos los días activos seguidos" -->
      {#if facts.longestStreak > 1 && facts.longestStreak < s.activeDays}
        <div class="card stat-card">
          <div class="stat-value">{facts.longestStreak}</div>
          <div class="stat-label">Day streak</div>
        </div>
      {/if}
    </div>
    {#if facts.firstPlay?.track || facts.lastPlay?.track}
      <div class="report-edges">
        {#each edgePlays(facts) as { label, play } (label)}
          {#if play?.track}
            <div class="card report-edge">
              <span class="data-label">{label}</span>
              <div class="track-list">
                <TrackItem compact imageUrl={play.track.album?.imageUrl} imageHref={play.track.album ? `/album/${play.track.album.id}` : undefined} name={play.track.name} nameHref="/track/{play.track.id}" entity={trackEntity(play.track)}>
                  {#snippet subtitle()}
                    {#each play.track?.artists ?? [] as ar, j (ar.id)}{#if j > 0}, {/if}<a href="/artist/{ar.id}" class="artist-link">{ar.name}</a>{/each}
                  {/snippet}
                  {#snippet meta()}<span class="data-count">{formatHistoryStamp(play.playedAt)}</span>{/snippet}
                </TrackItem>
              </div>
            </div>
          {/if}
        {/each}
      </div>
    {/if}

    <!-- géneros + décadas -->
    {#if genreBars.length > 0 || decadeBars.length > 0}
      <div class="report-pair">
        {#if genreBars.length > 0}
          <div class="card">
            <div class="section-header">
              <h3 class="section-title">Top genres</h3>
              <span class="data-label" title="Share of plays whose artist has genre tags">{report.genreCoveragePct}% tagged</span>
            </div>
            <ReportBars items={genreBars} />
          </div>
        {/if}
        {#if decadeBars.length > 0}
          <div class="card">
            <h3 class="section-title">Music by decade</h3>
            <ReportBars items={decadeBars} />
          </div>
        {/if}
      </div>
    {/if}

    <!-- discovery: lo que era nuevo para ti -->
    {@const d = report.discovery}
    <div class="card report-discovery">
      <h3 class="section-title">Discovery</h3>
      <p class="report-discovery-lead">
        <span class="report-discovery-pct data-val">{d.artists.pct}%</span>
        of the artists you listened to were new to you
        {#if d.artists.playsPct > 0}<span class="report-discovery-sub">({d.artists.playsPct}% of your plays)</span>{/if}
      </p>
      <div class="report-discovery-tiles">
        <div class="report-discovery-tile"><span class="data-val">{formatNumber(d.artists.newCount)}</span><span class="data-label">new artists of {formatNumber(d.artists.totalCount)}</span></div>
        <div class="report-discovery-tile"><span class="data-val">{formatNumber(d.albums.newCount)}</span><span class="data-label">new albums of {formatNumber(d.albums.totalCount)}</span></div>
        <div class="report-discovery-tile"><span class="data-val">{formatNumber(d.tracks.newCount)}</span><span class="data-label">new tracks of {formatNumber(d.tracks.totalCount)}</span></div>
      </div>
      <!-- topNew se lee con ?.: una respuesta cacheada por la versión anterior no trae la clave -->
      {#if d.topNew?.artist || d.topNew?.album || d.topNew?.track}
        <div class="report-discovery-picks">
          {#if d.topNew.artist}
            {@const n = d.topNew.artist}
            <ReportTopCard label="New artist" href="/artist/{n.id}" imageUrl={n.imageUrl} round name={n.name} value={value(n.plays, n.totalMs)} entity={{ type: 'artist', id: n.id, name: n.name, imageUrl: n.imageUrl }} />
          {/if}
          {#if d.topNew.album}
            {@const n = d.topNew.album}
            <ReportTopCard label="New album" href="/album/{n.id}" imageUrl={n.imageUrl} name={n.name} sub={n.artists?.map(x => x.name).join(', ') ?? ''} value={value(n.plays, n.totalMs)} entity={{ type: 'album', id: n.id, name: n.name, imageUrl: n.imageUrl, parentArtistId: n.artists?.[0]?.id }} />
          {/if}
          {#if d.topNew.track}
            {@const n = d.topNew.track}
            <ReportTopCard label="New track" href="/track/{n.id}" imageUrl={n.imageUrl} name={n.name} sub={n.artists?.map(x => x.name).join(', ') ?? ''} value={value(n.plays, n.totalMs)} entity={{ type: 'track', id: n.id, name: n.name, imageUrl: n.imageUrl, parentArtistId: n.artists?.[0]?.id }} />
          {/if}
        </div>
      {/if}
    </div>

    <!-- extras del año: cada mes con su líder, y los hitos de plays -->
    {#if report.months && report.months.length > 0}
      <h2 class="section-title">Month by month</h2>
      <div class="report-months">
        {#each report.months as m (m.month)}
          <div class="card report-month">
            <span class="data-label">{monthNames[Number(m.month.slice(5, 7)) - 1]}</span>
            <span class="report-month-plays data-count">{formatNumber(m.plays)} plays · {formatHours(m.totalMs)}</span>
            {#if m.topArtist}
              <a class="report-month-artist" href="/artist/{m.topArtist.id}">
                {#if m.topArtist.imageUrl}<img class="report-month-face" src={m.topArtist.imageUrl} alt="" />{/if}
                <span>{m.topArtist.name}</span>
              </a>
            {/if}
            {#if m.topTrack}
              <a class="report-month-track" href="/track/{m.topTrack.id}">{m.topTrack.name}</a>
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    {#if report.milestones.length > 0}
      <h2 class="section-title">Milestones</h2>
      <div class="track-list">
        {#each report.milestones as ms (ms.n)}
          <TrackItem compact imageUrl={ms.track?.album?.imageUrl} name={ms.track?.name ?? 'Unknown track'} nameHref={ms.track ? `/track/${ms.track.id}` : undefined}>
            {#snippet subtitle()}Play #{formatNumber(ms.n)} of all time · {formatHistoryStamp(ms.playedAt)}{/snippet}
          </TrackItem>
        {/each}
      </div>
    {/if}
  {/if}
{/if}

<style>
  .report-hero {
    position: relative;
    z-index: 1;
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 1.5rem;
  }
  .report-nav {
    display: flex;
    align-items: center;
    gap: 1rem;
  }
  .report-arrow {
    font-size: 1.2rem;
    line-height: 1;
    padding: 0.35rem 0.7rem;
    text-decoration: none;
  }
  .report-arrow:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .report-title {
    display: flex;
    flex-direction: column;
  }
  .report-title h1 {
    font-size: 2rem;
    font-weight: 700;
    line-height: 1.15;
  }
  .report-range {
    color: var(--text-muted);
    font-size: 0.9rem;
  }
  .report-actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  /* el selector global lleva margen inferior: aquí va en línea con las acciones */
  .report-gran {
    margin: 0;
  }
  .report-chart-link {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    text-decoration: none;
  }
  .report-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
  }
  .report-summary {
    position: relative;
    z-index: 1;
  }
  .report-summary .stat-label {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }
  /* las tres columnas comparten filas (subgrid): la tarjeta del nº 1 mide lo mismo
     en todas aunque un nombre se parta en dos líneas, y las listas arrancan a la
     misma altura */
  .report-columns {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    grid-template-rows: auto auto;
    gap: 1rem;
    margin-bottom: 1.5rem;
  }
  .report-column {
    display: grid;
    grid-row: span 2;
    grid-template-rows: subgrid;
    gap: 0.75rem;
    min-width: 0;
  }
  /* como ítems de grid, la tarjeta y la lista no encogen por debajo de su contenido
     (min-width: auto): un título de tema kilométrico ensanchaba la columna entera */
  .report-column > .track-list,
  .report-column > :global(.report-top-card) {
    min-width: 0;
  }
  /* filas de dos líneas en las tres listas: un artista sin género o un álbum sin
     año no puede dejar su fila más baja que las de al lado */
  .report-column :global(.track-item) {
    min-height: 3.1rem;
  }
  .report-charts {
    display: grid;
    grid-template-columns: 2fr 1fr;
    gap: 1rem;
    margin-bottom: 1.5rem;
  }
  .report-charts--triple {
    grid-template-columns: 2fr 1fr 1fr;
  }
  .report-of {
    color: var(--text-muted);
    font-size: 0.6em;
  }
  .report-edges {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
    margin-bottom: 1.5rem;
  }
  .report-edge {
    padding: 0.75rem 0.75rem 0.5rem;
  }
  .report-edge > .data-label {
    display: block;
    margin: 0 0.5rem 0.35rem;
  }
  .report-pair {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
    margin-bottom: 1.5rem;
  }
  .report-discovery {
    margin-bottom: 1.5rem;
  }
  .report-discovery-lead {
    font-size: 1.1rem;
    line-height: 1.4;
    margin-bottom: 1rem;
  }
  .report-discovery-pct {
    font-size: 2rem;
    color: var(--accent);
    margin-right: 0.35rem;
  }
  .report-discovery-sub {
    color: var(--text-muted);
    font-size: 0.85rem;
  }
  .report-discovery-tiles {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.5rem;
    margin-bottom: 1rem;
  }
  .report-discovery-tile {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    padding: 0.6rem 0.75rem;
    background: var(--bg-hover);
    border-radius: var(--radius);
  }
  .report-discovery-picks {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.75rem;
  }
  .report-months {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.75rem;
    margin-bottom: 1.5rem;
  }
  .report-month {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding: 0.9rem 1rem;
    min-width: 0;
  }
  .report-month-plays {
    font-size: 0.75rem;
    color: var(--text-muted);
  }
  .report-month-artist {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: inherit;
    font-weight: 600;
    min-width: 0;
  }
  .report-month-artist span,
  .report-month-track {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .report-month-artist:hover { color: var(--accent); }
  .report-month-face {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
    background: var(--border);
  }
  .report-month-track {
    font-size: 0.8rem;
    color: var(--text-muted);
  }
  .report-month-track:hover { color: var(--accent); }
  @media (max-width: 1024px) {
    .report-columns { grid-template-columns: 1fr; grid-template-rows: none; }
    .report-column { grid-row: auto; grid-template-rows: auto auto; }
    .report-charts, .report-charts--triple { grid-template-columns: 1fr; }
    .report-months { grid-template-columns: repeat(2, 1fr); }
  }
  @media (max-width: 768px) {
    .report-pair { grid-template-columns: 1fr; }
    .report-discovery-tiles { grid-template-columns: 1fr; }
    .report-discovery-picks { grid-template-columns: 1fr; }
    .report-edges { grid-template-columns: 1fr; }
    .report-title h1 { font-size: 1.5rem; }
  }
</style>
