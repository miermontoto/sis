<script lang="ts">
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import { api, createFetchController, type TrackDetail, type ChartHistoryResponse, type RankingMetric, getRankingMetric } from '$lib/api';
  import { formatDuration, formatNumber, formatDate, formatShortDate, localDateKey } from '$lib/utils/format';
  import { medalColor } from '$lib/utils/medals';
  import { extractColor } from '$lib/utils/color';
  import TrackList from '$lib/components/TrackList.svelte';
  import BaseChart from '$lib/components/charts/BaseChart.svelte';
  import ChartStats from '$lib/components/ChartStats.svelte';
  import RankingBadges from '$lib/components/RankingBadges.svelte';
  import Accolades from '$lib/components/Accolades.svelte';
  import EntityActionsMenu from '$lib/components/EntityActionsMenu.svelte';
  import MergeEntityModal from '$lib/components/MergeEntityModal.svelte';
  import { nowPlayingStore } from '$lib/stores/now-playing.svelte';

  import type { EChartsOption } from 'echarts';

  let data = $state<TrackDetail | null>(null);
  let chartHistoryData = $state<ChartHistoryResponse | null>(null);
  let loading = $state(true);
  let heroColor = $state('');
  let highlightedMonth = $state('');
  let metric = $state<RankingMetric>('time');
  let showMergeModal = $state(false);
  const fetchCtrl = createFetchController();

  async function loadData(id: string) {
    const signal = fetchCtrl.reset();
    loading = true;
    try {
      const result = await api.trackDetail(id, 'all', signal);
      if (signal.aborted) return;
      data = result;
      const imgUrl = result.track.album?.imageUrl;
      if (imgUrl) {
        extractColor(imgUrl).then(([r, g, b]) => {
          if (!signal.aborted) heroColor = `${r},${g},${b}`;
        });
      } else {
        heroColor = '';
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      throw e;
    } finally {
      if (!signal.aborted) loading = false;
    }
  }

  let initialized = false;
  let prevId = '';

  onMount(() => {
    metric = getRankingMetric();
    initialized = true;
  });

  $effect(() => {
    const id = $page.params.id;
    if (!initialized || !id) return;
    if (id !== prevId) {
      data = null;
      chartHistoryData = null;
      prevId = id;
    }
    loadData(id);
  });

  let chartOption = $derived.by<EChartsOption>(() => {
    if (!data?.series.length) return {};
    const s = data.series;
    const isPlays = metric === 'plays';
    return {
      grid: { left: 50, right: 20, top: 20, bottom: 30 },
      tooltip: { trigger: 'axis', formatter: (params: any) => { const p = Array.isArray(params) ? params[0] : params; return isPlays ? `${p.name}<br/>${p.value} plays` : `${p.name}<br/>${formatDuration(p.value)}`; } },
      xAxis: { type: 'category', data: s.map(d => d.period), axisLabel: { color: '#888', fontSize: 11 }, axisLine: { lineStyle: { color: '#2a2a2a' } } },
      yAxis: { type: 'value', splitLine: { lineStyle: { color: '#2a2a2a' } }, axisLabel: { color: '#888', formatter: isPlays ? undefined : (v: number) => formatDuration(v) } },
      series: [{ type: 'bar', data: s.map(d => isPlays ? d.play_count : d.total_ms), itemStyle: { color: '#1db954', borderRadius: [4, 4, 0, 0] }, barMaxWidth: 20 }],
    };
  });
</script>

{#if loading && !data}
  <div class="loading"><div class="spinner"></div></div>
{:else if data}
  {#if heroColor}
    <div class="detail-color-bg" style="background: linear-gradient(180deg, rgba({heroColor},0.18) 0%, transparent 100%);"></div>
  {/if}
  <div class="detail-hero-row">
    <div class="detail-hero">
      {#if data.track.album?.imageUrl}
        <img class="detail-image" src={data.track.album.imageUrl} alt={data.track.album?.name ?? ''} />
      {:else}
        <div class="detail-image detail-image--placeholder"></div>
      {/if}
      <div class="detail-header-info">
        <h1>{data.track.name}{#if $page.params.id === nowPlayingStore.trackId} <span class="live-badge"><span class="live-dot"></span> Live</span>{/if}</h1>
        <p class="detail-subtitle">
          {#each data.track.artists as artist, i}
            <a href="/artist/{artist.id}">{artist.name}</a>{#if i < data.track.artists.length - 1}{', '}{/if}
          {/each}
        </p>
        {#if data.track.album}
          <p class="detail-album">
            <a href="/album/{data.track.album.id}">{data.track.album.name}</a>
            {#if data.track.album.releaseDate}
              <span class="detail-meta"> &middot; {data.track.album.releaseDate}</span>
            {/if}
          </p>
        {/if}
      </div>
    </div>
    <div class="hero-actions">
      {#if !data.mergedInto}
        <Accolades entityType="track" entityId={$page.params.id} />
      {/if}
      <EntityActionsMenu
        title="Actions"
        actions={[
          { label: 'Manage merges', onClick: () => { showMergeModal = true; } },
        ]}
      />
    </div>
  </div>

  {#if data.mergedInto}
    <div class="merge-banner merge-banner--source">
      <span>Merged into <a href="/track/{data.mergedInto.id}">{data.mergedInto.name}</a></span>
      <button class="merge-banner-unmerge" onclick={async () => { await api.deleteMerge(data!.mergedInto!.ruleId); loadData($page.params.id); }}>Unmerge</button>
    </div>
  {/if}

  {#if data.mergedFrom.length > 0}
    <div class="merge-banner merge-banner--target">
      <div class="merge-banner-label">Includes plays from:</div>
      <div class="merge-banner-albums">
        {#each data.mergedFrom as merge}
          <a href="/track/{merge.id}" class="merge-banner-album">
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

  <div class="stats-grid">
    <div class="card stat-card">
      <div class="stat-value">{formatNumber(data.stats.play_count)}</div>
      <div class="stat-label">Plays</div>
    </div>
    <div class="card stat-card">
      <div class="stat-value">{formatDuration(data.stats.total_ms)}</div>
      <div class="stat-label">Total listening time</div>
    </div>
    <div class="card stat-card">
      <div class="stat-value">{formatDuration(data.track.durationMs)}</div>
      <div class="stat-label">Duration</div>
    </div>
    {#if data.stats.first_played}
      <a href="/history?date={localDateKey(data.stats.first_played)}&focus={encodeURIComponent(data.stats.first_played)}" class="card stat-card stat-card--link">
        <div class="stat-value">{formatShortDate(data.stats.first_played)}</div>
        <div class="stat-label">First played</div>
      </a>
    {/if}
    {#if data.stats.last_played}
      <a href="/history?date={localDateKey(data.stats.last_played)}&focus={encodeURIComponent(data.stats.last_played)}" class="card stat-card stat-card--link">
        <div class="stat-value">{formatShortDate(data.stats.last_played)}</div>
        <div class="stat-label">Last played</div>
      </a>
    {/if}
  </div>

  {#if !data.mergedInto}
    <RankingBadges entityType="track" entityId={$page.params.id} bind:highlightedMonth />
    <ChartStats entityType="track" entityId={$page.params.id} bind:chartData={chartHistoryData} bind:highlightedMonth />
  {/if}

  {#if data.albumBreakdown.length > 1}
    <h2 class="section-title">Played in</h2>
    <div class="track-list">
      {#each data.albumBreakdown as item, i}
        <a href="/album/{item.album.id}" class="track-item">
          <span class="track-rank" style:color={medalColor(i + 1)}>{i + 1}</span>
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
      {/each}
    </div>
  {/if}

  {#if data.series.length > 1}
    <h2 class="section-title">Listening history</h2>
    <div class="card chart-card">
      <BaseChart option={chartOption} height="260px" />
    </div>
  {/if}

  {#if data.recentPlays.length > 0}
    <h2 class="section-title"><a href="/history?track={$page.params.id}" class="section-link">Recent plays</a></h2>
    <TrackList items={data.recentPlays} showTime />
  {/if}
{/if}

{#if data}
  <MergeEntityModal
    bind:show={showMergeModal}
    entityType="track"
    target={{ id: data.track.id, name: data.track.name, imageUrl: data.track.album?.imageUrl ?? null }}
    parentId={data.track.artists[0]?.id ?? ''}
    existingMerges={data.mergedFrom}
    onMerged={() => loadData($page.params.id)}
  />
{/if}

<style>
  .chart-card {
    margin-bottom: 1.5rem;
    padding: 1rem;
  }
  .hero-actions {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    align-self: center;
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
  .merge-banner a { color: var(--accent); text-decoration: none; }
  .merge-banner a:hover { text-decoration: underline; }
  .merge-banner--source {
    background: rgba(255, 170, 0, 0.1);
    border: 1px solid rgba(255, 170, 0, 0.3);
    color: #ffaa00;
  }
  .merge-banner--source a {
    color: #ffaa00;
    text-decoration: underline;
  }
  .merge-banner--target {
    background: rgba(29, 185, 84, 0.08);
    border: 1px solid rgba(29, 185, 84, 0.25);
    flex-direction: column;
    align-items: stretch;
    gap: 0.5rem;
  }
  .merge-banner-label {
    font-size: 0.75rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .merge-banner-albums {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 0.75rem;
  }
  .merge-banner-album {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--text);
    text-decoration: none;
  }
  .merge-banner-album:hover { color: var(--accent); }
  .merge-banner-thumb {
    width: 22px;
    height: 22px;
    border-radius: 3px;
    object-fit: cover;
    flex-shrink: 0;
  }
  .merge-banner-thumb--empty { background: var(--border); }
  .merge-banner-name { font-size: 0.85rem; }
  .merge-banner-unmerge {
    background: transparent;
    border: 1px solid currentColor;
    color: inherit;
    padding: 0.2rem 0.6rem;
    border-radius: 6px;
    font-size: 0.75rem;
    cursor: pointer;
    font-family: var(--font);
    opacity: 0.8;
  }
  .merge-banner-unmerge:hover { opacity: 1; }
</style>
