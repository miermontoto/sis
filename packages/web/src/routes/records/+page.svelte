<script lang="ts">
  import { onMount } from 'svelte';
  import { api, createFetchController, getRankingMetric, getWeekStart, type EntityRecords, type ArtistRecordsData, type RankingMetric, type WeekStartOption } from '$lib/api';
  import { formatDuration, formatNumber } from '$lib/utils/format';
  import { medalColor } from '$lib/utils/medals';

  let metric = $state<RankingMetric>('time');
  let weekStart = $state<WeekStartOption>('monday');
  let activeTab = $state<'tracks' | 'albums' | 'artists'>('tracks');
  let loadingTab = $state<string | null>(null);

  // cache por tab: clave = `${weekStart}:${metric}:${tab}`
  let cache = $state<Map<string, EntityRecords | ArtistRecordsData>>(new Map());

  function cacheKey(tab: string) {
    return `${weekStart}:${metric}:${tab}`;
  }

  let currentData = $derived(cache.get(cacheKey(activeTab)) ?? null);
  let loading = $derived(loadingTab === activeTab);

  const fetchCtrl = createFetchController();

  async function loadTab(tab: 'tracks' | 'albums' | 'artists') {
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
            <div class="record-item">
              <span class="record-rank" style:color={medalColor(i + 1)}>{i + 1}</span>
              {#if item.imageUrl}
                <a href={entityLink(activeTab, item.entityId)} class="record-art-link">
                  <img class="record-art" class:record-art--round={activeTab === 'artists'} src={item.imageUrl} alt="" />
                </a>
              {:else}
                <div class="record-art" class:record-art--round={activeTab === 'artists'}></div>
              {/if}
              <div class="record-info">
                <a href={entityLink(activeTab, item.entityId)} class="record-name-link">{item.name}</a>
                {#if item.artistName}
                  {#if item.artistId}
                    <a href="/artist/{item.artistId}" class="record-sub-link">{item.artistName}</a>
                  {:else}
                    <div class="record-sub">{item.artistName}</div>
                  {/if}
                {/if}
              </div>
              <div class="record-value">
                <span class="record-val">{formatValue(item.value, valueType)}</span>
                {#if item.week === 'active'}
                  <span class="record-active">active</span>
                {:else if item.week}
                  <a href="/charts?type={activeTab}&granularity=week&period={item.week}" class="record-week">{item.week}</a>
                {/if}
              </div>
            </div>
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
              <a href="/artist/{item.artistId}" class="record-item">
                <span class="record-rank" style:color={medalColor(i + 1)}>{i + 1}</span>
                {#if item.imageUrl}
                  <img class="record-art record-art--round" src={item.imageUrl} alt="" />
                {:else}
                  <div class="record-art record-art--round"></div>
                {/if}
                <div class="record-info">
                  <div class="record-name">{item.name}</div>
                </div>
                <div class="record-value">
                  <span class="record-val">{item.count}</span>
                </div>
              </a>
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
  .record-item {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.5rem 0.75rem;
    text-decoration: none;
    color: var(--text);
    transition: background 0.1s;
    border-bottom: 1px solid var(--border);
  }
  .record-item:last-child {
    border-bottom: none;
  }
  .record-item:hover {
    background: var(--bg-hover);
  }
  .record-rank {
    width: 1.5rem;
    text-align: center;
    font-size: 0.8rem;
    color: var(--text-muted);
    flex-shrink: 0;
  }
  .record-art-link {
    display: flex;
    flex-shrink: 0;
    line-height: 0;
  }
  .record-art {
    width: 36px;
    height: 36px;
    border-radius: 4px;
    object-fit: cover;
    flex-shrink: 0;
    background: var(--border);
  }
  .record-art--round {
    border-radius: 50%;
  }
  .record-info {
    flex: 1;
    min-width: 0;
  }
  .record-name-link {
    font-size: 0.85rem;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--text);
    text-decoration: none;
    display: block;
  }
  .record-name-link:hover {
    color: var(--accent);
  }
  .record-sub {
    font-size: 0.75rem;
    color: var(--text-muted);
  }
  .record-sub-link {
    font-size: 0.75rem;
    color: var(--text-muted);
    text-decoration: none;
  }
  .record-sub-link:hover {
    color: var(--accent);
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
