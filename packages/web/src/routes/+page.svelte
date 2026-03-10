<script lang="ts">
  import { onMount } from 'svelte';
  import { api, type TopTrackItem, type HistoryItem, type HealthData } from '$lib/api';
  import NowPlaying from '$lib/components/NowPlaying.svelte';
  import TrackList from '$lib/components/TrackList.svelte';
  import { formatNumber, formatHours } from '$lib/utils/format';

  let topTracks = $state<TopTrackItem[]>([]);
  let recentPlays = $state<HistoryItem[]>([]);
  let health = $state<HealthData | null>(null);
  let todayPlays = $state(0);
  let todayMs = $state(0);
  let loading = $state(true);

  onMount(async () => {
    try {
      const [top, history, h, today] = await Promise.all([
        api.topTracks('week', 5),
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
  });
</script>

<div class="page-header">
  <h1>Dashboard</h1>
</div>

<NowPlaying />

{#if loading}
  <div class="loading">
    <div class="spinner"></div>
    Loading...
  </div>
{:else}
  <div class="stats-grid">
    <div class="card stat-card">
      <div class="stat-value">{formatNumber(todayPlays)}</div>
      <div class="stat-label">Plays today</div>
    </div>
    <div class="card stat-card">
      <div class="stat-value">{formatHours(todayMs)}</div>
      <div class="stat-label">Listening today</div>
    </div>
    <div class="card stat-card">
      <div class="stat-value">{formatNumber(health?.totalPlays ?? 0)}</div>
      <div class="stat-label">Total plays</div>
    </div>
    <div class="card stat-card">
      <div class="stat-value">{health?.authenticated ? 'Active' : 'Inactive'}</div>
      <div class="stat-label">Polling</div>
    </div>
  </div>

  {#if topTracks.length > 0}
    <div class="card" style="margin-bottom: 1.5rem;">
      <h3 style="margin-bottom: 0.75rem;">Top tracks this week</h3>
      <TrackList items={topTracks} showRank />
    </div>
  {/if}

  {#if recentPlays.length > 0}
    <div class="card">
      <h3 style="margin-bottom: 0.75rem;">Recent plays</h3>
      <TrackList items={recentPlays} showTime />
    </div>
  {:else}
    <div class="card empty-state">
      <p>No listening data yet. <a href="/auth/login">Connect Spotify</a> to start tracking.</p>
    </div>
  {/if}
{/if}
