<script lang="ts">
  import { onMount } from 'svelte';
  import { api, getRankingMetric, getSessionTrackingEnabled, type TopTrackItem, type TopArtistItem, type TopAlbumItem, type HistoryItem, type HealthData, type StreaksData, type RankingMetric } from '$lib/api';
  import TrackList from '$lib/components/TrackList.svelte';
  import CoverGrid from '$lib/components/CoverGrid.svelte';
  import { formatNumber, formatHours, formatDuration } from '$lib/utils/format';
  import { nowPlayingStore } from '$lib/stores/now-playing.svelte';
  import { closedChartsStore } from '$lib/stores/closed-charts.svelte';
  import { projectionsStore } from '$lib/stores/projections.svelte';
  import IconChart from '$lib/icons/IconChart.svelte';
  import IconChevronRight from '$lib/icons/IconChevronRight.svelte';
  import { openEntityContextMenu } from '$lib/utils/entity-context';

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

  // estado de carga por petición independiente
  let loadingTracks = $state(true);
  let loadingArtists = $state(true);
  let loadingAlbums = $state(true);
  let loadingHistory = $state(true);
  let loadingTime = $state(true);
  let loadingHealth = $state(true);
  let loadingStreaks = $state(true);

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

  onMount(() => {
    metric = getRankingMetric();

    // disparar cada petición por separado para que cada sección
    // se renderice en cuanto su dato esté disponible
    api.topTracks('week', 5, metric)
      .then((t) => { topTracks = t; })
      .catch((e) => console.error('topTracks:', e))
      .finally(() => { loadingTracks = false; });

    api.topArtists('week', 5, metric)
      .then((a) => { topArtists = a; })
      .catch((e) => console.error('topArtists:', e))
      .finally(() => { loadingArtists = false; });

    api.topAlbums('week', 5, metric)
      .then((a) => { topAlbums = a; })
      .catch((e) => console.error('topAlbums:', e))
      .finally(() => { loadingAlbums = false; });

    api.history(1, 10)
      .then((h) => { recentPlays = h.items; })
      .catch((e) => console.error('history:', e))
      .finally(() => { loadingHistory = false; });

    api.health()
      .then((h) => { health = h; })
      .catch((e) => console.error('health:', e))
      .finally(() => { loadingHealth = false; });

    api.listeningTime('week', 'day')
      .then((today) => {
        weekMs = today.reduce((sum, d) => sum + d.total_ms, 0);
        const todayStr = new Date().toISOString().split('T')[0];
        const todayData = today.find((d) => d.period === todayStr);
        if (todayData) {
          todayPlays = todayData.play_count;
          todayMs = todayData.total_ms;
        }
      })
      .catch((e) => console.error('listeningTime:', e))
      .finally(() => { loadingTime = false; });

    api.streaks()
      .then((s) => { streaks = s; })
      .catch((e) => console.error('streaks:', e))
      .finally(() => { loadingStreaks = false; });

    const pollInterval = setInterval(pollRecent, 15_000);
    return () => clearInterval(pollInterval);
  });

  $effect(() => {
    const play = nowPlayingStore.lastFinishedPlay;
    if (!play || recentPlays.length === 0) return;
    if (recentPlays[0]?.track?.id === play.track?.id && Math.abs(new Date(recentPlays[0].playedAt).getTime() - new Date(play.playedAt).getTime()) < 60_000) return;
    recentPlays = [play, ...recentPlays].slice(0, 10);
  });
</script>

<div class="page-header">
  <h1>Dashboard</h1>
</div>

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

<div class="card stats-bar">
  <div class="stats-bar-item">
    {#if loadingTime}
      <span class="stats-bar-value"><span class="ghost-text ghost-stat"></span></span>
    {:else}
      <span class="stats-bar-value">{formatNumber(todayPlays)}</span>
    {/if}
    <span class="stats-bar-label">plays today</span>
  </div>
  <div class="stats-bar-sep"></div>
  <div class="stats-bar-item">
    {#if loadingTime}
      <span class="stats-bar-value"><span class="ghost-text ghost-stat"></span></span>
    {:else}
      <span class="stats-bar-value">{formatHours(todayMs)}</span>
    {/if}
    <span class="stats-bar-label">listened today</span>
  </div>
  <div class="stats-bar-sep"></div>
  <div class="stats-bar-item">
    {#if loadingTime}
      <span class="stats-bar-value"><span class="ghost-text ghost-stat"></span></span>
    {:else}
      <span class="stats-bar-value">{formatHours(weekMs)}</span>
    {/if}
    <span class="stats-bar-label">this week</span>
  </div>
  <div class="stats-bar-sep"></div>
  <div class="stats-bar-item">
    {#if loadingStreaks}
      <span class="stats-bar-value"><span class="ghost-text ghost-stat"></span></span>
    {:else}
      <span class="stats-bar-value">{streaks?.currentStreak ?? 0}d</span>
    {/if}
    <span class="stats-bar-label">streak</span>
  </div>
  <div class="stats-bar-sep"></div>
  <div class="stats-bar-item">
    {#if loadingHealth}
      <span class="stats-bar-value"><span class="ghost-text ghost-stat"></span></span>
    {:else}
      <span class="stats-bar-value">{formatNumber(health?.totalPlays ?? 0)}</span>
    {/if}
    <span class="stats-bar-label">total plays</span>
  </div>
</div>

<div class="card" style="margin-bottom: 1.5rem;">
  <h3 style="margin-bottom: 0.75rem;"><a href="/top?range=week" class="section-link">Top tracks this week</a></h3>
  {#if loadingTracks}
    <div class="track-list">
      {#each Array(5) as _, i}
        <div class="track-item compact ghost-item">
          <span class="track-rank ghost-rank">{i + 1}</span>
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
  {:else if topTracks.length > 0}
    <TrackList items={topTracks} showRank {metric} compact />
  {:else}
    <p class="empty-inline">No data yet.</p>
  {/if}
</div>

<div class="card" style="margin-bottom: 1.5rem;">
  <h3 style="margin-bottom: 0.75rem;"><a href="/top?range=week&tab=albums" class="section-link">Top albums this week</a></h3>
  {#if loadingAlbums}
    <div class="cover-row-ghost">
      {#each Array(5) as _, i}
        <div class="cover-item-ghost">
          <div class="cover-img-ghost ghost-shimmer"></div>
          <div class="ghost-line ghost-line--cover-name"></div>
          <div class="ghost-line ghost-line--cover-stat"></div>
        </div>
      {/each}
    </div>
  {:else if topAlbums.length > 0}
    <CoverGrid items={topAlbums.filter(a => a.album).map((item, i) => ({
      href: `/album/${item.albumId}`,
      rank: i + 1,
      imageUrl: item.album?.imageUrl,
      name: item.album?.name ?? '',
      stat: metric === 'plays' ? `${item.playCount} plays` : formatDuration(item.totalMs),
      isLive: item.albumId === nowPlayingStore.albumId,
      oncontextmenu: openEntityContextMenu({ type: 'album', id: item.albumId, name: item.album?.name ?? '', imageUrl: item.album?.imageUrl ?? null }),
    }))} />
  {:else}
    <p class="empty-inline">No data yet.</p>
  {/if}
</div>

<div class="card" style="margin-bottom: 1.5rem;">
  <h3 style="margin-bottom: 0.75rem;"><a href="/top?range=week&tab=artists" class="section-link">Top artists this week</a></h3>
  {#if loadingArtists}
    <div class="cover-row-ghost">
      {#each Array(5) as _, i}
        <div class="cover-item-ghost">
          <div class="cover-img-ghost cover-img-ghost--round ghost-shimmer"></div>
          <div class="ghost-line ghost-line--cover-name"></div>
          <div class="ghost-line ghost-line--cover-stat"></div>
        </div>
      {/each}
    </div>
  {:else if topArtists.length > 0}
    <CoverGrid items={topArtists.filter(a => a.artist).map((item, i) => ({
      href: `/artist/${item.artistId}`,
      rank: i + 1,
      imageUrl: item.artist?.imageUrl,
      name: item.artist?.name ?? '',
      stat: metric === 'plays' ? `${item.playCount} plays` : formatDuration(item.totalMs),
      isLive: nowPlayingStore.artistIds.includes(item.artistId),
      round: true,
      oncontextmenu: openEntityContextMenu({ type: 'artist', id: item.artistId, name: item.artist?.name ?? '', imageUrl: item.artist?.imageUrl ?? null }),
    }))} />
  {:else}
    <p class="empty-inline">No data yet.</p>
  {/if}
</div>

<div class="card">
  <h3 style="margin-bottom: 0.75rem;"><a href="/history" class="section-link">Recent plays</a></h3>
  {#if loadingHistory}
    <div class="track-list">
      {#each Array(10) as _, i}
        <div class="track-item compact ghost-item">
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
  {:else if recentPlays.length > 0}
    <TrackList items={recentPlays} showTime compact sessionStartedAt={getSessionTrackingEnabled() ? projectionsStore.sessionStartedAt : null} sessionTotalTracks={projectionsStore.data?.sessionTrackCount ?? 0} />
  {:else}
    <p class="empty-inline">No listening data yet.</p>
  {/if}
</div>

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
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: 1.25rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    color: var(--accent);
  }
  .stats-bar-label {
    font-family: var(--font-mono);
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
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
  .closed-chart-link svg {
    margin-left: auto;
    opacity: 0;
    transition: opacity 0.05s;
  }
  .closed-chart-link:hover svg {
    opacity: 1;
  }

  h3 {
    font-family: var(--font-mono);
    font-size: 0.85rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .section-link {
    color: inherit;
    text-decoration: none;
  }
  .section-link:hover {
    color: var(--accent);
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
  .cover-row-ghost {
    display: flex;
    gap: 0.75rem;
    padding-bottom: 0.25rem;
  }
  .cover-item-ghost {
    display: flex;
    flex-direction: column;
    align-items: center;
    flex: 1 1 0;
    min-width: 0;
  }
  .cover-img-ghost {
    width: 100%;
    aspect-ratio: 1;
    border-radius: var(--radius);
  }
  .cover-img-ghost--round {
    border-radius: 50%;
  }
  .ghost-line--cover-name {
    width: 70%;
    height: 0.7rem;
    margin-top: 0.45rem;
  }
  .ghost-line--cover-stat {
    width: 45%;
    height: 0.55rem;
    margin-top: 0.3rem;
  }
  .empty-inline {
    color: var(--text-muted);
    font-size: 0.85rem;
    margin: 0.25rem 0;
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
