<script lang="ts">
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import { api, type ArtistDetail, type RankingMetric, getRankingMetric } from '$lib/api';
  import { formatDuration, formatNumber, formatDate } from '$lib/utils/format';
  import TrackList from '$lib/components/TrackList.svelte';
  import TimeRangeSelector from '$lib/components/TimeRangeSelector.svelte';

  let data = $state<ArtistDetail | null>(null);
  let loading = $state(true);
  let range = $state('all');
  let metric = $state<RankingMetric>('time');
  let showAllTracks = $state(false);
  let showAllAlbums = $state(false);

  async function loadData() {
    loading = true;
    try {
      const sort = metric === 'plays' ? 'plays' : 'time';
      data = await api.artistDetail($page.params.id, range, {
        sort,
        trackLimit: showAllTracks ? 200 : 10,
        albumLimit: showAllAlbums ? 200 : 5,
      });
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
    void showAllTracks;
    void showAllAlbums;
    loadData();
  });
</script>

{#if loading && !data}
  <div class="loading"><div class="spinner"></div></div>
{:else if data}
  <div class="detail-hero">
    {#if data.artist.imageUrl}
      <img class="detail-image detail-image--round" src={data.artist.imageUrl} alt={data.artist.name} />
    {:else}
      <div class="detail-image detail-image--round detail-image--placeholder"></div>
    {/if}
    <div class="detail-header-info">
      <h1>{data.artist.name}</h1>
      {#if data.artist.genres?.length}
        <p class="detail-subtitle">{data.artist.genres.join(', ')}</p>
      {/if}
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
        <div class="stat-value" style="font-size:1.25rem">{formatDate(data.stats.first_played)}</div>
        <div class="stat-label">First played</div>
      </div>
    {/if}
  </div>

  {#if data.topTracks.length > 0}
    <div class="section-header">
      <h2 class="section-title">Top tracks</h2>
      <button class="show-all-btn" onclick={() => showAllTracks = !showAllTracks}>
        {showAllTracks ? 'Show less' : 'Show all'}
      </button>
    </div>
    <TrackList items={data.topTracks} showRank {metric} />
  {/if}

  {#if data.topAlbums.length > 0}
    <div class="section-header">
      <h2 class="section-title">Top albums</h2>
      <button class="show-all-btn" onclick={() => showAllAlbums = !showAllAlbums}>
        {showAllAlbums ? 'Show less' : 'Show all'}
      </button>
    </div>
    <div class="track-list">
      {#each data.topAlbums as item, i}
        {#if item.album}
          <a href="/album/{item.albumId}" class="track-item">
            <span class="track-rank">{i + 1}</span>
            {#if item.album.imageUrl}
              <img class="track-art" src={item.album.imageUrl} alt={item.album.name} />
            {:else}
              <div class="track-art"></div>
            {/if}
            <div class="track-info">
              <div class="track-name">{item.album.name}</div>
              <div class="track-artist">{item.album.releaseDate ?? ''}</div>
            </div>
            <div class="track-meta">
              <div class="track-plays">{metric === 'plays' ? `${item.playCount} plays` : formatDuration(item.totalMs)}</div>
              <div class="track-time">{metric === 'time' ? `${item.playCount} plays` : formatDuration(item.totalMs)}</div>
            </div>
          </a>
        {/if}
      {/each}
    </div>
  {/if}

  {#if data.recentPlays.length > 0}
    <h2 class="section-title">Recent plays</h2>
    <TrackList items={data.recentPlays} showTime />
  {/if}
{/if}

