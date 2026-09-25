<script lang="ts">
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import { api, type LibraryPlaylistDetail, type RankingMetric, getRankingMetric } from '$lib/api';
  import { formatDuration, formatNumber, formatShortDate } from '$lib/utils/format';
  import { GRID, TOOLTIP_BASE, categoryAxis, valueAxis, lineSeries, AXIS_LABEL, PIE_MAX_SLICES, tooltipPoint, type TooltipParams } from '$lib/utils/chart';
  import BaseChart from '$lib/components/charts/BaseChart.svelte';
  import { createDurationUnit } from '$lib/utils/duration-unit.svelte';
  import GenrePie from '$lib/components/charts/GenrePie.svelte';
  import type { EChartsOption } from 'echarts';
  import { openEntityContextMenu } from '$lib/utils/entity-context';
  import { nowPlayingStore } from '$lib/stores/now-playing.svelte';
  import IconPlay from '$lib/icons/IconPlay.svelte';
  import IconRefresh from '$lib/icons/IconRefresh.svelte';
  import DetailBackdrop from '$lib/components/DetailBackdrop.svelte';
  import { extractColor } from '$lib/utils/color';

  // la cifra de tiempo se pulsa y cambia de unidad (misma tarjeta que en insights)
  const listening = createDurationUnit('minutes');

  let data = $state<LibraryPlaylistDetail | null>(null);
  let listenedMs = $derived(data?.stats.totalMs ?? 0);
  // duración y fechas de alta salen de las filas, que ya traen cada track con su
  // added_at: sin los ficheros locales, que la sync no guarda (trackCount sí los cuenta)
  let lengthMs = $derived(data?.tracks.reduce((sum, t) => sum + (t.track?.durationMs ?? 0), 0) ?? 0);
  let addedRange = $derived.by(() => {
    const dates = (data?.tracks ?? []).flatMap(t => (t.addedAt ? [t.addedAt] : []));
    if (!dates.length) return null;
    // added_at es un instante: fecha local, no de calendario
    const first = formatShortDate(dates.reduce((a, b) => (b < a ? b : a)));
    const last = formatShortDate(dates.reduce((a, b) => (b > a ? b : a)));
    return { first, last };
  });
  let loading = $state(true);
  let metric = $state<RankingMetric>('time');
  let playActing = $state(false);
  let refreshing = $state(false);
  // tinte del hero sacado de la portada, como en el resto de detalles ("r,g,b")
  let heroColor = $state('');

  async function loadData(id: string) {
    loading = true;
    try {
      data = await api.libraryPlaylistDetail(parseInt(id), metric);
      const imageUrl = data?.playlist.imageUrl;
      if (!imageUrl) heroColor = '';
      // sólo pinta si la portada sigue siendo la misma al resolver (navegar entre playlists)
      else extractColor(imageUrl).then((rgb) => { if (data?.playlist.imageUrl === imageUrl) heroColor = rgb.join(','); });
    } catch {
      data = null;
    } finally {
      loading = false;
    }
  }

  // re-sincroniza la playlist con spotify y relee el detalle (la mutación ya purga su cache)
  async function refresh() {
    if (!data) return;
    refreshing = true;
    try {
      await api.syncLibraryPlaylist(data.playlist.id);
      await loadData(String(data.playlist.id));
    } catch {
      // se queda con los datos que ya había
    } finally {
      refreshing = false;
    }
  }

  // misma altura en las dos gráficas para que las tarjetas cuadren lado a lado
  const CHART_HEIGHT = '280px';

  let initialized = false;
  onMount(() => {
    metric = getRankingMetric();
    initialized = true;
  });

  $effect(() => {
    const id = $page.params.id;
    if (!initialized || !id) return;
    loadData(id);
  });

  let seriesChart = $derived.by<EChartsOption>(() => {
    if (!data?.series.length) return {};
    const s = data.series;
    const isPlays = metric === 'plays';
    return {
      grid: { ...GRID },
      tooltip: { ...TOOLTIP_BASE, formatter: (params: TooltipParams) => { const p = tooltipPoint(params); return isPlays ? `${p.name}<br/>${p.value} plays` : `${p.name}<br/>${formatDuration(p.value)}`; } },
      xAxis: categoryAxis(s.map(d => d.period)),
      yAxis: valueAxis({ axisLabel: { ...AXIS_LABEL, formatter: isPlays ? undefined : (v: number) => formatDuration(v) } }),
      series: [lineSeries(s.map(d => isPlays ? d.play_count : d.total_ms), {
        showSymbol: false,
        areaStyle: { color: 'rgba(29, 185, 84, 0.1)' },
      })],
    };
  });

</script>

{#if loading && !data}
  <div class="loading"><div class="spinner"></div></div>
{:else if data}
  {@const pl = data.playlist}

  <DetailBackdrop color={heroColor} />

  <!-- mismo hero que los detalles de artista, álbum, tema y bolo (clases globales de app.css) -->
  <div class="detail-hero-row">
    <div class="detail-hero">
      {#if pl.imageUrl}
        <img class="detail-image" src={pl.imageUrl} alt={pl.name} />
      {:else}
        <div class="detail-image"></div>
      {/if}
      <div class="detail-header-info">
        <div class="data-label">{pl.isAlgorithmic ? 'Algorithmic playlist' : 'Playlist'}</div>
        <h1>{pl.name}</h1>
        {#if pl.ownerName}<p class="detail-subtitle">by {pl.ownerName}</p>{/if}
        <p class="detail-meta-line">
          {formatNumber(pl.trackCount)} tracks{#if lengthMs > 0}{' · '}{formatDuration(lengthMs)}{/if}
        </p>
        {#if addedRange}
          <p class="detail-meta-line">
            {#if addedRange.first === addedRange.last}
              Added {addedRange.first}
            {:else}
              First added {addedRange.first} &middot; last added {addedRange.last}
            {/if}
          </p>
        {/if}
      </div>
    </div>
    <div class="hero-actions">
      <button
        class="play-entity-btn"
        title="Play on Spotify"
        disabled={playActing}
        onclick={async () => {
          playActing = true;
          await nowPlayingStore.playContext({ context_uri: `spotify:playlist:${pl.spotifyId}` });
          playActing = false;
        }}
      >
        <IconPlay />
      </button>
      <button
        class="refresh-btn"
        class:refresh-btn--spinning={refreshing}
        title="Refresh from Spotify"
        disabled={refreshing}
        onclick={refresh}
      >
        <IconRefresh />
      </button>
    </div>
  </div>

  <!-- Spotify embed -->
  <div class="embed-section">
    <iframe
      title="Spotify Playlist"
      src="https://open.spotify.com/embed/playlist/{pl.spotifyId}?utm_source=generator&theme=0"
      width="100%"
      height="152"
      frameborder="0"
      allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
      loading="lazy"
      style="border-radius: var(--radius);"
    ></iframe>
  </div>

  <!-- Stats -->
  <div class="stats-grid">
    <div class="stat-card">
      <div class="stat-value">{formatNumber(data.stats.totalPlays)}</div>
      <div class="stat-label">plays</div>
    </div>
    <button type="button" class="stat-card stat-card--clickable" onclick={() => listening.next(listenedMs)} disabled={!listening.canCycle(listenedMs)}>
      <div class="stat-value">{listening.format(listenedMs)}</div>
      <div class="stat-label">listening time</div>
    </button>
    <div class="stat-card">
      <div class="stat-value">{data.coverage.tracksPlayed}/{data.coverage.totalTracks}</div>
      <div class="stat-label">tracks played</div>
    </div>
  </div>

  <!-- gráficas: lado a lado con ancho suficiente (.section-grid), una sola va a ancho completo -->
  {#if data.series.length > 0 || data.genres.length > 0}
    <div class="section-grid charts-grid">
      {#if data.series.length > 0}
        <section class="detail-section detail-section--half">
          <div class="card">
            <h2>Listening over time</h2>
            <BaseChart option={seriesChart} height={CHART_HEIGHT} />
          </div>
        </section>
      {/if}
      {#if data.genres.length > 0}
        <section class="detail-section detail-section--half">
          <div class="card">
            <h2>Genres</h2>
            <GenrePie genres={data.genres.slice(0, PIE_MAX_SLICES)} unit="plays" height={CHART_HEIGHT} />
          </div>
        </section>
      {/if}
    </div>
  {/if}

  <!-- Track list -->
  <div class="card">
    <h2>Tracks</h2>
    <div class="track-list-detail">
      {#each data.tracks as t, i}
        {#if t.track}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="track-row" oncontextmenu={openEntityContextMenu({ type: 'track', id: t.trackId, name: t.track.name, imageUrl: t.track.album?.imageUrl ?? null, parentArtistId: t.track.artists[0]?.id })}>
            <span class="track-pos">{i + 1}</span>
            {#if t.track.album?.imageUrl}
              <a href="/album/{t.track.album.id}">
                <img class="track-art" src={t.track.album.imageUrl} alt="" />
              </a>
            {:else}
              <div class="track-art"></div>
            {/if}
            <div class="track-info">
              <a href="/track/{t.trackId}" class="track-name">{t.track.name}</a>
              <div class="track-artists">
                {#each t.track.artists as artist, j}
                  <a href="/artist/{artist.id}" class="artist-link">{artist.name}</a>{#if j < t.track.artists.length - 1}{', '}{/if}
                {/each}
              </div>
            </div>
            <div class="track-stats">
              {#if t.playCount > 0}
                {#if metric === 'plays'}
                  <span class="track-plays">{t.playCount} plays</span>
                  <span class="track-time">{formatDuration(t.totalMs)}</span>
                {:else}
                  <span class="track-plays">{formatDuration(t.totalMs)}</span>
                  <span class="track-time">{t.playCount} plays</span>
                {/if}
              {:else}
                <span class="track-unplayed">not played</span>
              {/if}
            </div>
          </div>
        {/if}
      {/each}
    </div>
  </div>
{:else}
  <div class="empty">Playlist no encontrada</div>
{/if}

<style>
  .loading {
    display: flex;
    justify-content: center;
    padding: 4rem;
  }
  .spinner {
    width: 24px;
    height: 24px;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .embed-section {
    margin-bottom: 1.5rem;
  }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.75rem;
    margin-bottom: 1rem;
  }
  .stat-card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1rem;
    text-align: center;
  }
  .stat-value {
    font-size: var(--fs-xl);
    font-weight: 600;
  }
  .stat-label {
    font-size: var(--fs-sm);
    color: var(--text-muted);
    margin-top: 0.2rem;
  }

  .refresh-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 32px;
    width: 32px;
    padding: 0;
    background: none;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text-muted);
    cursor: pointer;
    transition: color 0.05s, border-color 0.05s;
  }
  .refresh-btn:hover:not(:disabled) { color: var(--text); border-color: var(--text-muted); }
  .refresh-btn:disabled { cursor: default; }
  .refresh-btn--spinning :global(svg) { animation: spin 0.8s linear infinite; }

  /* el hueco entre tarjetas lo pone el gap de la rejilla; hasta la lista de tracks, su margen */
  .charts-grid { margin-bottom: 1.5rem; }
  .charts-grid .card { height: 100%; margin-bottom: 0; }

  .card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1.5rem;
    margin-bottom: 1.5rem;
  }
  h2 { margin: 0 0 1rem; font-size: var(--fs-lg); }

  .track-list-detail {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .track-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.4rem 0.5rem;
    border-radius: var(--radius);
    transition: background 0.05s;
  }
  .track-row:hover { background: var(--bg-hover); }
  .track-pos {
    width: 24px;
    text-align: right;
    color: var(--text-muted);
    font-size: var(--fs-sm);
    flex-shrink: 0;
  }
  .track-art {
    width: 36px;
    height: 36px;
    border-radius: var(--radius);
    object-fit: cover;
    flex-shrink: 0;
    background: var(--bg-hover);
  }
  .track-info { flex: 1; min-width: 0; }
  .track-name {
    display: block;
    font-size: var(--fs-md);
    color: var(--text);
    text-decoration: none;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .track-name:hover { color: var(--accent); }
  .track-artists {
    font-size: var(--fs-sm);
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .artist-link {
    color: inherit;
    text-decoration: none;
  }
  .artist-link:hover { color: var(--accent); }
  .track-stats {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    flex-shrink: 0;
    gap: 0.1rem;
  }
  .track-plays { font-size: var(--fs-sm); }
  .track-time { font-size: var(--fs-xs); color: var(--text-muted); }
  .track-unplayed {
    font-size: var(--fs-sm);
    color: var(--text-muted);
    opacity: 0.5;
  }

  .empty {
    color: var(--text-muted);
    text-align: center;
    padding: 4rem;
  }
</style>
