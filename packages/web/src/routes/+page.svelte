<script lang="ts">
  import { onMount } from 'svelte';
  import { api, getRankingMetric, type TopTrackItem, type TopArtistItem, type TopAlbumItem, type HistoryItem, type HealthData, type StreaksData, type RankingMetric } from '$lib/api';
  import NowPlaying from '$lib/components/NowPlaying.svelte';
  import TrackList from '$lib/components/TrackList.svelte';
  import CoverGrid from '$lib/components/CoverGrid.svelte';
  import { formatNumber, formatHours, formatDuration } from '$lib/utils/format';
  import { nowPlayingStore } from '$lib/stores/now-playing.svelte';
  import { getClosedCharts, dismissAllClosedCharts, type ClosedChart } from '$lib/utils/periods';

  let topTracks = $state<TopTrackItem[]>([]);
  let topArtists = $state<TopArtistItem[]>([]);
  let topAlbums = $state<TopAlbumItem[]>([]);
  let recentPlays = $state<HistoryItem[]>([]);
  let health = $state<HealthData | null>(null);
  let todayPlays = $state(0);
  let todayMs = $state(0);
  let weekMs = $state(0);
  let streaks = $state<StreaksData | null>(null);
  let metric = $state<RankingMetric>('time');
  let loading = $state(true);
  let closedCharts = $state<ClosedChart[]>([]);

  async function pollRecent() {
    try {
      const res = await api.history(1, 10);
      if (res.items.length === 0 || recentPlays.length === 0) return;
      const latestId = recentPlays[0].id;
      const newItems = res.items.filter((i) => i.id > latestId);
      if (newItems.length > 0) {
        recentPlays = [...newItems, ...recentPlays].slice(0, 10);
      }
    } catch {
      // silenciar errores de polling
    }
  }

  function handleDismissCharts() {
    dismissAllClosedCharts();
    closedCharts = [];
  }

  onMount(async () => {
    metric = getRankingMetric();
    closedCharts = getClosedCharts();
    try {
      const [top, artists, albums, history, h, today, s] = await Promise.all([
        api.topTracks('week', 5, metric),
        api.topArtists('week', 5, metric),
        api.topAlbums('week', 5, metric),
        api.history(1, 10),
        api.health(),
        api.listeningTime('week', 'day'),
        api.streaks(),
      ]);
      topTracks = top;
      topArtists = artists;
      topAlbums = albums;
      recentPlays = history.items;
      health = h;
      streaks = s;
      weekMs = today.reduce((sum, d) => sum + d.total_ms, 0);

      // stats de hoy
      const todayStr = new Date().toISOString().split('T')[0];
      const todayData = today.find(d => d.period === todayStr);
      if (todayData) {
        todayPlays = todayData.play_count;
        todayMs = todayData.total_ms;
      }
    } catch (err) {
      console.error('error loading dashboard:', err);
    } finally {
      loading = false;
    }

    const pollInterval = setInterval(pollRecent, 15_000);
    return () => clearInterval(pollInterval);
  });
</script>

<div class="page-header">
  <h1>Dashboard</h1>
</div>

<div class="mobile-only-np">
  <NowPlaying />
</div>

{#if loading}
  <div class="loading">
    <div class="spinner"></div>
    Loading...
  </div>
{:else}
  {#if closedCharts.length > 0}
    <div class="card closed-charts-card">
      <div class="closed-charts-header">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
        <span>Charts ready to view</span>
        <button class="closed-charts-dismiss" onclick={handleDismissCharts} title="Dismiss">&times;</button>
      </div>
      <div class="closed-charts-list">
        {#each closedCharts as chart}
          <a href="/charts?granularity={chart.granularity}&period={chart.period}" class="closed-chart-link">
            {chart.label}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </a>
        {/each}
      </div>
    </div>
  {/if}

  <div class="card stats-bar">
    <div class="stats-bar-item">
      <span class="stats-bar-value">{formatNumber(todayPlays)}</span>
      <span class="stats-bar-label">plays today</span>
    </div>
    <div class="stats-bar-sep"></div>
    <div class="stats-bar-item">
      <span class="stats-bar-value">{formatHours(todayMs)}</span>
      <span class="stats-bar-label">listened today</span>
    </div>
    <div class="stats-bar-sep"></div>
    <div class="stats-bar-item">
      <span class="stats-bar-value">{formatHours(weekMs)}</span>
      <span class="stats-bar-label">this week</span>
    </div>
    <div class="stats-bar-sep"></div>
    <div class="stats-bar-item">
      <span class="stats-bar-value">{streaks?.currentStreak ?? 0}d</span>
      <span class="stats-bar-label">streak</span>
    </div>
    <div class="stats-bar-sep"></div>
    <div class="stats-bar-item">
      <span class="stats-bar-value">{formatNumber(health?.totalPlays ?? 0)}</span>
      <span class="stats-bar-label">total plays</span>
    </div>
  </div>

  {#if topTracks.length > 0}
    <div class="card" style="margin-bottom: 1.5rem;">
      <h3 style="margin-bottom: 0.75rem;"><a href="/top?range=week" class="section-link">Top tracks this week</a></h3>
      <TrackList items={topTracks} showRank {metric} compact />
    </div>
  {/if}

  {#if topAlbums.length > 0}
    <div class="card" style="margin-bottom: 1.5rem;">
      <h3 style="margin-bottom: 0.75rem;"><a href="/top?range=week&tab=albums" class="section-link">Top albums this week</a></h3>
      <CoverGrid items={topAlbums.filter(a => a.album).map((item, i) => ({
        href: `/album/${item.albumId}`,
        rank: i + 1,
        imageUrl: item.album?.imageUrl,
        name: item.album?.name ?? '',
        stat: metric === 'plays' ? `${item.playCount} plays` : formatDuration(item.totalMs),
        isLive: item.albumId === nowPlayingStore.albumId,
      }))} />
    </div>
  {/if}

  {#if topArtists.length > 0}
    <div class="card" style="margin-bottom: 1.5rem;">
      <h3 style="margin-bottom: 0.75rem;"><a href="/top?range=week&tab=artists" class="section-link">Top artists this week</a></h3>
      <CoverGrid items={topArtists.filter(a => a.artist).map((item, i) => ({
        href: `/artist/${item.artistId}`,
        rank: i + 1,
        imageUrl: item.artist?.imageUrl,
        name: item.artist?.name ?? '',
        stat: metric === 'plays' ? `${item.playCount} plays` : formatDuration(item.totalMs),
        isLive: nowPlayingStore.artistIds.includes(item.artistId),
        round: true,
      }))} />
    </div>
  {/if}

  {#if recentPlays.length > 0}
    <div class="card">
      <h3 style="margin-bottom: 0.75rem;"><a href="/history" class="section-link">Recent plays</a></h3>
      <TrackList items={recentPlays} showTime compact />
    </div>
  {:else}
    <div class="card empty-state">
      <p>No listening data yet.</p>
    </div>
  {/if}
{/if}

<style>
  .stats-bar {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 1.25rem;
    padding: 0.75rem 1.25rem;
    margin-bottom: 1.5rem;
    flex-wrap: wrap;
  }
  .stats-bar-item {
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
  }
  .stats-bar-value {
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--accent);
  }
  .stats-bar-label {
    font-size: 0.8rem;
    color: var(--text-dim);
  }
  .stats-bar-sep {
    width: 1px;
    height: 1.25rem;
    background: var(--border);
  }
  .closed-charts-card {
    margin-bottom: 1.5rem;
    border-color: rgba(29, 185, 84, 0.3);
    background: rgba(29, 185, 84, 0.04);
  }
  .closed-charts-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: var(--accent);
    font-size: 0.85rem;
    font-weight: 600;
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
    display: flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--text);
    text-decoration: none;
    font-size: 0.85rem;
    padding: 0.3rem 0;
    transition: color 0.15s;
  }
  .closed-chart-link:hover {
    color: var(--accent);
  }
  .closed-chart-link svg {
    margin-left: auto;
    opacity: 0;
    transition: opacity 0.15s;
  }
  .closed-chart-link:hover svg {
    opacity: 1;
  }

  .section-link {
    color: inherit;
    text-decoration: none;
  }
  .section-link:hover {
    color: var(--accent);
  }

  @media (max-width: 600px) {
    .stats-bar {
      gap: 0.75rem;
    }
    .stats-bar-item {
      flex-direction: column;
      align-items: center;
      gap: 0.1rem;
    }
    .stats-bar-value {
      font-size: 1.1rem;
    }
    .stats-bar-label {
      font-size: 0.7rem;
    }
  }
</style>
