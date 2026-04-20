<script lang="ts">
  import { onMount } from 'svelte';
  import { api, createFetchController, getRankingMetric, getWeekStart, type EntityRecords, type ArtistRecordsData, type RankingMetric, type WeekStartOption } from '$lib/api';
  import { formatDuration, formatNumber } from '$lib/utils/format';
  import TrackItem from '$lib/components/TrackItem.svelte';

  type TabType = 'tracks' | 'albums' | 'artists';
  let metric = $state<RankingMetric>('time');
  let weekStart = $state<WeekStartOption>('monday');
  let activeTab = $state<TabType>('tracks');
  let loadingTab = $state<string | null>(null);

  let cache = $state<Map<string, EntityRecords | ArtistRecordsData>>(new Map());

  function cacheKey(tab: string) {
    return `${weekStart}:${metric}:${tab}`;
  }

  let currentData = $derived(cache.get(cacheKey(activeTab)) ?? null);
  let loading = $derived(loadingTab === activeTab);

  const fetchCtrl = createFetchController();

  async function loadTab(tab: TabType) {
    const key = cacheKey(tab);
    if (cache.has(key)) return;
    const signal = fetchCtrl.reset();
    loadingTab = tab;
    try {
      const result = await api.records(weekStart, metric, tab, signal);
      if (signal.aborted) return;
      const data = result[tab];
      if (data) {
        const next = new Map(cache);
        next.set(key, data);
        cache = next;
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      throw e;
    } finally {
      if (!signal.aborted) loadingTab = null;
    }
  }

  onMount(() => {
    metric = getRankingMetric();
    weekStart = getWeekStart();
  });

  $effect(() => {
    void activeTab;
    void metric;
    void weekStart;
    loadTab(activeTab);
  });

  function entityLink(type: string, id: string): string {
    if (type === 'artists') return `/artist/${id}`;
    if (type === 'albums') return `/album/${id}`;
    return `/track/${id}`;
  }

  function formatValue(val: number, label: string): string {
    if (label === 'weeks') return `${val} wk${val !== 1 ? 's' : ''}`;
    if (label === 'playlists') return `${val} playlist${val !== 1 ? 's' : ''}`;
    if (metric === 'plays') return `${formatNumber(val)} plays`;
    return formatDuration(val);
  }
</script>

<div class="page-header">
  <h1>Records</h1>
  <p>Weekly chart milestones and all-time bests</p>
</div>

<div class="records-tabs">
  <button class="rec-tab" class:rec-tab--active={activeTab === 'tracks'} onclick={() => activeTab = 'tracks'}>Tracks</button>
  <button class="rec-tab" class:rec-tab--active={activeTab === 'albums'} onclick={() => activeTab = 'albums'}>Albums</button>
  <button class="rec-tab" class:rec-tab--active={activeTab === 'artists'} onclick={() => activeTab = 'artists'}>Artists</button>
</div>

{#if loading && !currentData}
  <div class="loading"><div class="spinner"></div></div>
{:else if currentData}
  {#snippet recordList(title: string, items: { entityId: string; name: string; imageUrl: string | null; artistId: string | null; artistName: string | null; value: number; week: string | null }[], valueType: string)}
    {#if items.length > 0}
      <div class="record-section">
        <h3 class="record-title">{title}</h3>
        <div class="record-list">
          {#each items as item, i}
            <TrackItem
              rank={i + 1}
              imageUrl={item.imageUrl}
              imageHref={entityLink(activeTab, item.entityId)}
              imageRound={activeTab === 'artists'}
              name={item.name}
              nameHref={entityLink(activeTab, item.entityId)}
              compact
            >
              {#snippet subtitle()}
                {#if item.artistName}
                  {#if item.artistId}
                    <a href="/artist/{item.artistId}" class="artist-link">{item.artistName}</a>
                  {:else}
                    {item.artistName}
                  {/if}
                {/if}
              {/snippet}
              {#snippet meta()}
                <div class="record-value">
                  <span class="record-val">{formatValue(item.value, valueType)}</span>
                  {#if item.week === 'active'}
                    <span class="record-active">active</span>
                  {:else if item.week}
                    <a href="/charts?type={activeTab}&granularity=week&period={item.week}" class="record-week">{item.week}</a>
                  {/if}
                </div>
              {/snippet}
            </TrackItem>
          {/each}
        </div>
      </div>
    {/if}
  {/snippet}

  {@render recordList('Peak week', currentData.peakWeekPlays, 'peak')}
  {@render recordList('Biggest debuts', currentData.biggestDebuts, 'debut')}
  {@render recordList('Most weeks at #1', currentData.mostWeeksAtNo1, 'weeks')}
  {@render recordList('Most weeks in the charts', currentData.mostWeeksInTop5, 'weeks')}
  {@render recordList('Longest chart run', currentData.longestChartRun, 'weeks')}
  {#if currentData.inMostPlaylists?.length}
    {@render recordList('In most playlists', currentData.inMostPlaylists, 'playlists')}
  {/if}

  {#if activeTab === 'artists' && 'mostNo1Tracks' in currentData}
    {@const artistData = currentData as ArtistRecordsData}
    {#snippet artistRecordList(title: string, items: { artistId: string; name: string; imageUrl: string | null; count: number }[])}
      {#if items.length > 0}
        <div class="record-section">
          <h3 class="record-title">{title}</h3>
          <div class="record-list">
            {#each items as item, i}
              <TrackItem
                href="/artist/{item.artistId}"
                rank={i + 1}
                imageUrl={item.imageUrl}
                imageRound
                name={item.name}
                compact
              >
                {#snippet meta()}
                  <div class="record-value">
                    <span class="record-val">{item.count}</span>
                  </div>
                {/snippet}
              </TrackItem>
            {/each}
          </div>
        </div>
      {/if}
    {/snippet}

    {@render artistRecordList('Most #1 tracks', artistData.mostNo1Tracks)}
    {@render artistRecordList('Most #1 albums', artistData.mostNo1Albums)}
  {/if}

{/if}

<style>
  .records-tabs {
    display: flex;
    gap: 0.25rem;
    margin-bottom: 1.25rem;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 3px;
    width: fit-content;
  }
  .rec-tab {
    padding: 0.4rem 1rem;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text-muted);
    font-size: 0.85rem;
    font-family: var(--font);
    cursor: pointer;
    transition: all 0.15s;
  }
  .rec-tab:hover:not(.rec-tab--active) {
    color: var(--text);
  }
  .rec-tab--active {
    background: var(--accent);
    color: #000;
    font-weight: 500;
  }
  .record-section {
    margin-bottom: 1.5rem;
  }
  .record-title {
    font-size: 0.95rem;
    margin-bottom: 0.5rem;
    color: var(--text);
  }
  .record-list {
    background: var(--bg-card);
    border-radius: 10px;
    overflow: hidden;
  }
  .record-list :global(.track-item) {
    border-bottom: 1px solid var(--border);
    border-radius: 0;
  }
  .record-list :global(.track-item:last-child) {
    border-bottom: none;
  }
  .record-value {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    flex-shrink: 0;
    gap: 0.1rem;
  }
  .record-val {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--accent);
  }
  .record-week {
    font-size: 0.65rem;
    color: var(--text-muted);
    text-decoration: none;
  }
  .record-week:hover {
    color: var(--accent);
  }
  .record-active {
    font-size: 0.6rem;
    font-weight: 600;
    color: var(--accent);
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
</style>
