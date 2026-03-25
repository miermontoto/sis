<script lang="ts">
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import { api, type AlbumDetail, type Rankings, type RankingMetric, getRankingMetric } from '$lib/api';
  import { formatDuration, formatNumber, formatDate } from '$lib/utils/format';
  import { getQueryParam, setQueryParams } from '$lib/utils/query-state';
  import TrackList from '$lib/components/TrackList.svelte';
  import TimeRangeSelector from '$lib/components/TimeRangeSelector.svelte';
  import BaseChart from '$lib/components/charts/BaseChart.svelte';
  import MergeAlbumModal from '$lib/components/MergeAlbumModal.svelte';
  import type { EChartsOption } from 'echarts';

  let data = $state<AlbumDetail | null>(null);
  let rankings = $state<Rankings | null>(null);
  let loading = $state(true);
  let range = $state('all');
  let metric = $state<RankingMetric>('time');
  let showMergeModal = $state(false);

  async function loadData() {
    loading = true;
    rankings = null;
    try {
      data = await api.albumDetail($page.params.id, range, metric === 'plays' ? 'plays' : 'time');
      api.rankings('album', $page.params.id, metric).then(r => rankings = r).catch(() => {});
    } finally {
      loading = false;
    }
  }

  function setRange(r: string) {
    range = r;
    setQueryParams({ range: r });
  }

  onMount(() => {
    range = getQueryParam('range', 'all');
    metric = getRankingMetric();
  });

  $effect(() => {
    void range;
    void metric;
    void $page.params.id;
    loadData();
  });

  const rankLabels = { week: '7D', month: '30D', thisYear: 'YTD', all: 'All' } as const;

  let chartOption = $derived.by<EChartsOption>(() => {
    if (!data?.series.length) return {};
    const s = data.series;
    const isPlays = metric === 'plays';
    return {
      grid: { left: 50, right: 20, top: 20, bottom: 30 },
      tooltip: {
        trigger: 'axis',
        formatter: (params: any) => {
          const p = Array.isArray(params) ? params[0] : params;
          return isPlays
            ? `${p.name}<br/>${p.value} plays`
            : `${p.name}<br/>${formatDuration(p.value)}`;
        },
      },
      xAxis: {
        type: 'category',
        data: s.map(d => d.period),
        axisLabel: { color: '#888', fontSize: 11 },
        axisLine: { lineStyle: { color: '#2a2a2a' } },
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: '#2a2a2a' } },
        axisLabel: {
          color: '#888',
          formatter: isPlays ? undefined : (v: number) => formatDuration(v),
        },
      },
      series: [{
        type: 'bar',
        data: s.map(d => isPlays ? d.play_count : d.total_ms),
        itemStyle: { color: '#1db954', borderRadius: [4, 4, 0, 0] },
        barMaxWidth: 20,
      }],
    };
  });
</script>

{#if loading && !data}
  <div class="loading"><div class="spinner"></div></div>
{:else if data}
  <div class="detail-hero">
    {#if data.album.imageUrl}
      <img class="detail-image" src={data.album.imageUrl} alt={data.album.name} />
    {:else}
      <div class="detail-image detail-image--placeholder"></div>
    {/if}
    <div class="detail-header-info">
      <div class="album-title-row">
        <h1>{data.album.name}</h1>
        {#if !data.mergedInto}
          <button class="merge-header-btn" title="Manage merges" onclick={() => showMergeModal = true}>⤵ Merges</button>
        {/if}
      </div>
      <p class="detail-subtitle">
        {#each data.artists as artist, i}
          <a href="/artist/{artist.id}">{artist.name}</a>{#if i < data.artists.length - 1}, {/if}
        {/each}
        {#if data.album.releaseDate}
          <span class="detail-meta"> &middot; {data.album.releaseDate}</span>
        {/if}
        {#if data.album.totalTracks}
          <span class="detail-meta"> &middot; {data.album.totalTracks} tracks</span>
        {/if}
      </p>
    </div>
  </div>

  {#if data.mergedInto}
    <div class="merge-banner merge-banner--source">
      <span>Merged into <a href="/album/{data.mergedInto.id}">{data.mergedInto.name}</a></span>
      <button class="merge-banner-unmerge" onclick={async () => { await api.deleteMerge(data!.mergedInto!.ruleId); loadData(); }}>Unmerge</button>
    </div>
  {/if}

  {#if data.mergedFrom.length > 0}
    <div class="merge-banner merge-banner--target">
      <div class="merge-banner-label">Includes plays from:</div>
      <div class="merge-banner-albums">
        {#each data.mergedFrom as merge}
          <a href="/album/{merge.id}" class="merge-banner-album">
            {#if merge.imageUrl}
              <img class="merge-banner-thumb" src={merge.imageUrl} alt="" />
            {:else}
              <div class="merge-banner-thumb merge-banner-thumb--empty"></div>
            {/if}
            <span class="merge-banner-name">{merge.name}</span>
          </a>
        {/each}
      </div>
    </div>
  {/if}

  <TimeRangeSelector value={range} onchange={setRange} />

  <div class="stats-grid">
    <div class="card stat-card">
      <div class="stat-value">{formatNumber(data.stats.play_count)}</div>
      <div class="stat-label">Plays</div>
    </div>
    <div class="card stat-card">
      <div class="stat-value">{formatDuration(data.stats.total_ms)}</div>
      <div class="stat-label">Listening time</div>
    </div>
    {#if data.stats.first_played}
      <div class="card stat-card">
        <div class="stat-value">{new Date(data.stats.first_played).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</div>
        <div class="stat-label">First played</div>
      </div>
    {/if}
  </div>

  <div class="rankings-row">
    {#each Object.entries(rankLabels) as [key, label]}
      {@const rank = rankings?.[key as keyof Rankings] ?? null}
      <div class="ranking-badge" class:ranking-badge--active={rank != null} class:ranking-badge--loading={!rankings}>
        <span class="ranking-label">{label}</span>
        <span class="ranking-value">{rankings ? (rank != null ? `#${rank}` : '—') : ''}</span>
      </div>
    {/each}
  </div>

  {#if data.series.length > 1}
    <div class="card chart-card">
      <BaseChart option={chartOption} height="250px" />
    </div>
  {/if}

  {#if data.tracks.length > 0}
    <h2 class="section-title">Tracks</h2>
    <TrackList items={data.tracks} showRank {metric} />
  {/if}

  {#if data.recentPlays.length > 0}
    <h2 class="section-title">Recent plays</h2>
    <TrackList items={data.recentPlays} showTime />
  {/if}
{/if}

{#if data}
  <MergeAlbumModal
    bind:show={showMergeModal}
    targetAlbum={{ id: data.album.id, name: data.album.name, imageUrl: data.album.imageUrl }}
    artistId={data.artists[0]?.id ?? ''}
    existingMerges={data.mergedFrom}
    onMerged={loadData}
  />
{/if}

<style>
  .album-title-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .album-title-row h1 {
    margin: 0;
  }
  .merge-header-btn {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-muted);
    font-size: 0.75rem;
    padding: 0.25rem 0.6rem;
    border-radius: 6px;
    cursor: pointer;
    white-space: nowrap;
    transition: color 0.15s, border-color 0.15s;
    font-family: var(--font);
    flex-shrink: 0;
  }
  .merge-header-btn:hover {
    color: var(--accent);
    border-color: var(--accent);
  }
  .merge-banner {
    padding: 0.6rem 1rem;
    border-radius: 8px;
    font-size: 0.85rem;
    margin-bottom: 1rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .merge-banner a {
    color: var(--accent);
    text-decoration: none;
  }
  .merge-banner a:hover {
    text-decoration: underline;
  }
  .merge-banner--source {
    background: rgba(255, 170, 0, 0.1);
    border: 1px solid rgba(255, 170, 0, 0.3);
    color: #ffaa00;
  }
  .merge-banner--target {
    background: rgba(29, 185, 84, 0.08);
    border: 1px solid rgba(29, 185, 84, 0.2);
    color: var(--text-muted);
    flex-direction: column;
    align-items: flex-start;
    gap: 0.4rem;
  }
  .merge-banner-label {
    font-size: 0.8rem;
    color: var(--text-muted);
  }
  .merge-banner-albums {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .merge-banner-album {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    text-decoration: none;
    color: var(--text);
    padding: 0.2rem 0.5rem 0.2rem 0.2rem;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.05);
    transition: background 0.15s;
  }
  .merge-banner-album:hover {
    background: rgba(255, 255, 255, 0.1);
  }
  .merge-banner-thumb {
    width: 24px;
    height: 24px;
    border-radius: 3px;
    object-fit: cover;
    flex-shrink: 0;
  }
  .merge-banner-thumb--empty {
    background: var(--border);
  }
  .merge-banner-name {
    font-size: 0.8rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 200px;
  }
  .merge-banner-unmerge {
    background: none;
    border: 1px solid rgba(255, 170, 0, 0.4);
    color: #ffaa00;
    font-size: 0.75rem;
    padding: 0.2rem 0.5rem;
    border-radius: 4px;
    cursor: pointer;
    font-family: var(--font);
    flex-shrink: 0;
  }
  .merge-banner-unmerge:hover {
    background: rgba(255, 170, 0, 0.15);
  }
  .rankings-row {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1.5rem;
    flex-wrap: wrap;
  }
  .ranking-badge {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.15rem;
    flex: 1;
    min-width: 60px;
    padding: 0.5rem 0.75rem;
    border-radius: 10px;
    background: var(--bg-card);
    border: 1px solid #2a2a2a;
  }
  .ranking-badge--active {
    border-color: #1db954;
  }
  .ranking-badge--loading .ranking-value {
    width: 28px;
    height: 1.1rem;
    border-radius: 4px;
    background: linear-gradient(90deg, #2a2a2a 25%, #3a3a3a 50%, #2a2a2a 75%);
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite;
    display: inline-block;
  }
  @keyframes shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }
  .ranking-label {
    font-size: 0.7rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .ranking-value {
    font-size: 1.1rem;
    font-weight: 700;
    color: var(--text);
  }
  .ranking-badge--active .ranking-value {
    color: #1db954;
  }
  .chart-card {
    margin-bottom: 1.5rem;
    padding: 1rem;
  }
</style>
