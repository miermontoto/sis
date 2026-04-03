<script lang="ts">
  import { onMount } from 'svelte';
  import { api, getRankingMetric, type TopTrackItem, type HistoryItem, type HealthData, type RankingMetric } from '$lib/api';
  import NowPlaying from '$lib/components/NowPlaying.svelte';
  import TrackList from '$lib/components/TrackList.svelte';
  import { formatNumber, formatHours } from '$lib/utils/format';

  let topTracks = $state<TopTrackItem[]>([]);
  let recentPlays = $state<HistoryItem[]>([]);
  let health = $state<HealthData | null>(null);
  let todayPlays = $state(0);
  let todayMs = $state(0);
  let metric = $state<RankingMetric>('time');
  let loading = $state(true);

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

  onMount(async () => {
    metric = getRankingMetric();
    try {
      const [top, history, h, today] = await Promise.all([
        api.topTracks('week', 5, metric),
        api.history(1, 10),
        api.health(),
        api.listeningTime('week', 'day'),
      ]);
      topTracks = top;
      recentPlays = history.items;
      health = h;

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
      <span class="stats-bar-value">{formatNumber(health?.totalPlays ?? 0)}</span>
      <span class="stats-bar-label">total plays</span>
    </div>
  </div>

  {#if topTracks.length > 0}
    <div class="card" style="margin-bottom: 1.5rem;">
      <h3 style="margin-bottom: 0.75rem;"><a href="/top" class="section-link">Top tracks this week</a></h3>
      <TrackList items={topTracks} showRank {metric} />
    </div>
  {/if}

  {#if recentPlays.length > 0}
    <div class="card">
      <h3 style="margin-bottom: 0.75rem;"><a href="/history" class="section-link">Recent plays</a></h3>
      <TrackList items={recentPlays} showTime />
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
