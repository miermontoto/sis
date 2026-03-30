<script lang="ts">
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import { api, type LibraryPlaylistDetail, type RankingMetric, getRankingMetric } from '$lib/api';
  import { formatDuration, formatNumber } from '$lib/utils/format';
  import BaseChart from '$lib/components/charts/BaseChart.svelte';
  import type { EChartsOption } from 'echarts';

  let data = $state<LibraryPlaylistDetail | null>(null);
  let loading = $state(true);
  let metric = $state<RankingMetric>('time');

  async function loadData(id: string) {
    loading = true;
    try {
      data = await api.libraryPlaylistDetail(parseInt(id));
    } catch {
      data = null;
    } finally {
      loading = false;
    }
  }

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

  // time series chart
  let seriesChart = $derived.by<EChartsOption>(() => {
    if (!data?.series.length) return {};
    const s = data.series;
    const isPlays = metric === 'plays';
    return {
      grid: { left: 50, right: 20, top: 20, bottom: 30 },
      tooltip: { trigger: 'axis', formatter: (params: any) => { const p = Array.isArray(params) ? params[0] : params; return isPlays ? `${p.name}<br/>${p.value} plays` : `${p.name}<br/>${formatDuration(p.value)}`; } },
      xAxis: { type: 'category', data: s.map(d => d.period), axisLabel: { color: '#888', fontSize: 11 }, axisLine: { lineStyle: { color: '#2a2a2a' } } },
      yAxis: { type: 'value', splitLine: { lineStyle: { color: '#2a2a2a' } }, axisLabel: { color: '#888', formatter: isPlays ? undefined : (v: number) => formatDuration(v) } },
      series: [{
        type: 'line',
        data: s.map(d => isPlays ? d.play_count : d.total_ms),
        smooth: true,
        showSymbol: false,
        lineStyle: { color: '#1db954', width: 2 },
        areaStyle: { color: 'rgba(29, 185, 84, 0.1)' },
      }],
    };
  });

  // genre pie chart
  let genreChart = $derived.by<EChartsOption>(() => {
    if (!data?.genres.length) return {};
    const colors = ['#1db954', '#1ed760', '#2ecc71', '#27ae60', '#16a085', '#3498db', '#2980b9', '#9b59b6', '#e67e22', '#e74c3c'];
    return {
      tooltip: { trigger: 'item', formatter: '{b}: {c} plays ({d}%)' },
      series: [{
        type: 'pie',
        radius: ['40%', '70%'],
        data: data.genres.slice(0, 10).map((g, i) => ({
          name: g.genre,
          value: g.play_count,
          itemStyle: { color: colors[i % colors.length] },
        })),
        label: { color: '#888', fontSize: 11 },
        emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.5)' } },
      }],
    };
  });
</script>

{#if loading && !data}
  <div class="loading"><div class="spinner"></div></div>
{:else if data}
  {@const pl = data.playlist}
  {@const cov = data.coverage}

  <!-- Hero -->
  <div class="hero">
    {#if pl.imageUrl}
      <img class="hero-img" src={pl.imageUrl} alt={pl.name} />
    {:else}
      <div class="hero-img placeholder"></div>
    {/if}
    <div class="hero-info">
      <h1>{pl.name}</h1>
      <div class="hero-meta">
        {#if pl.ownerName}<span>by {pl.ownerName}</span>{/if}
        <span>{pl.trackCount} tracks</span>
        {#if pl.isAlgorithmic}<span class="badge algo">Algorithmic</span>{/if}
      </div>
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
      style="border-radius: 12px;"
    ></iframe>
  </div>

  <!-- Stats -->
  <div class="stats-grid">
    <div class="stat-card">
      <div class="stat-value">{formatNumber(data.stats.totalPlays)}</div>
      <div class="stat-label">plays</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">{formatDuration(data.stats.totalMs)}</div>
      <div class="stat-label">listening time</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">{cov.tracksPlayed}/{cov.totalTracks}</div>
      <div class="stat-label">tracks played</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">{cov.percent}%</div>
      <div class="stat-label">coverage</div>
    </div>
  </div>

  <!-- Coverage bar -->
  <div class="coverage-section">
    <div class="coverage-bar-lg">
      <div class="coverage-fill-lg" style="width: {cov.percent}%"></div>
    </div>
  </div>

  <!-- Time series -->
  {#if data.series.length > 0}
    <div class="card">
      <h2>Listening over time</h2>
      <BaseChart option={seriesChart} height="250px" />
    </div>
  {/if}

  <!-- Genres -->
  {#if data.genres.length > 0}
    <div class="card">
      <h2>Genres</h2>
      <BaseChart option={genreChart} height="300px" />
    </div>
  {/if}

  <!-- Track list -->
  <div class="card">
    <h2>Tracks</h2>
    <div class="track-list-detail">
      {#each data.tracks as t, i}
        {#if t.track}
          <div class="track-row">
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
                <span class="track-plays">{t.playCount} plays</span>
                <span class="track-time">{formatDuration(t.totalMs)}</span>
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

  .hero {
    display: flex;
    gap: 1.5rem;
    align-items: center;
    margin-bottom: 1.5rem;
  }
  .hero-img {
    width: 160px;
    height: 160px;
    border-radius: var(--radius);
    object-fit: cover;
    flex-shrink: 0;
  }
  .hero-img.placeholder {
    background: var(--bg-card);
  }
  .hero-info { flex: 1; }
  .hero-info h1 { margin: 0 0 0.5rem; font-size: 1.5rem; }
  .hero-meta {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    color: var(--text-muted);
    font-size: 0.9rem;
  }
  .badge.algo {
    background: rgba(255, 165, 0, 0.15);
    color: orange;
    padding: 0.15rem 0.5rem;
    border-radius: 999px;
    font-size: 0.75rem;
  }

  .embed-section {
    margin-bottom: 1.5rem;
  }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
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
    font-size: 1.3rem;
    font-weight: 600;
  }
  .stat-label {
    font-size: 0.75rem;
    color: var(--text-muted);
    margin-top: 0.2rem;
  }

  .coverage-section { margin-bottom: 1.5rem; }
  .coverage-bar-lg {
    height: 6px;
    background: var(--border);
    border-radius: 3px;
    overflow: hidden;
  }
  .coverage-fill-lg {
    height: 100%;
    background: var(--accent);
    border-radius: 3px;
    transition: width 0.3s;
  }

  .card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1.5rem;
    margin-bottom: 1.5rem;
  }
  h2 { margin: 0 0 1rem; font-size: 1.1rem; }

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
    border-radius: 4px;
    transition: background 0.1s;
  }
  .track-row:hover { background: var(--bg-hover); }
  .track-pos {
    width: 24px;
    text-align: right;
    color: var(--text-muted);
    font-size: 0.8rem;
    flex-shrink: 0;
  }
  .track-art {
    width: 36px;
    height: 36px;
    border-radius: 3px;
    object-fit: cover;
    flex-shrink: 0;
    background: var(--bg-hover);
  }
  .track-info { flex: 1; min-width: 0; }
  .track-name {
    display: block;
    font-size: 0.9rem;
    color: var(--text);
    text-decoration: none;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .track-name:hover { color: var(--accent); }
  .track-artists {
    font-size: 0.75rem;
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
  .track-plays { font-size: 0.8rem; }
  .track-time { font-size: 0.7rem; color: var(--text-muted); }
  .track-unplayed {
    font-size: 0.75rem;
    color: var(--text-muted);
    opacity: 0.5;
  }

  .empty {
    color: var(--text-muted);
    text-align: center;
    padding: 4rem;
  }

  @media (max-width: 768px) {
    .hero { flex-direction: column; text-align: center; }
    .hero-img { width: 120px; height: 120px; }
    .hero-meta { justify-content: center; flex-wrap: wrap; }
    .stats-grid { grid-template-columns: repeat(2, 1fr); }
  }
</style>
