<script lang="ts">
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import { api, type AlbumDetail, type RankingMetric, getRankingMetric } from '$lib/api';
  import { formatDuration, formatNumber, formatDate } from '$lib/utils/format';
  import TrackList from '$lib/components/TrackList.svelte';
  import TimeRangeSelector from '$lib/components/TimeRangeSelector.svelte';

  let data = $state<AlbumDetail | null>(null);
  let loading = $state(true);
  let range = $state('all');
  let metric = $state<RankingMetric>('time');

  async function loadData() {
    loading = true;
    try {
      data = await api.albumDetail($page.params.id, range, metric === 'plays' ? 'plays' : 'time');
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    metric = getRankingMetric();
    loadData();
  });

  $effect(() => {
    void range;
    void metric;
    loadData();
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
      <h1>{data.album.name}</h1>
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

  <TimeRangeSelector value={range} onchange={(r) => range = r} />

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

  {#if data.tracks.length > 0}
    <h2 class="section-title">Tracks</h2>
    <TrackList items={data.tracks} showRank {metric} />
  {/if}

  {#if data.recentPlays.length > 0}
    <h2 class="section-title">Recent plays</h2>
    <TrackList items={data.recentPlays} showTime />
  {/if}
{/if}

