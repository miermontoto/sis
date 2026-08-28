<script lang="ts">
  import { isAbortError } from '$lib/utils/errors';
  import { onMount, onDestroy } from 'svelte';
  import { api, createFetchController, getRankingMetric, getWeekStart, getRecordsUnique, type TrackRecords, type AlbumRecords, type ArtistRecordsData, type RankingMetric, type WeekStartOption, type RecordEntry, type MonthCountEntry } from '$lib/api';
  import { formatDuration, formatNumber, formatShortDate } from '$lib/utils/format';
  import { urlEnumParam } from '$lib/utils/query-state.svelte';
  import TrackItem from '$lib/components/TrackItem.svelte';
  import IconCheckSmall from '$lib/icons/IconCheckSmall.svelte';
  import IconPlus from '$lib/icons/IconPlus.svelte';
  import IconTrack from '$lib/icons/IconTrack.svelte';
  import IconArtist from '$lib/icons/IconArtist.svelte';
  import IconAlbum from '$lib/icons/IconAlbum.svelte';
  import type { EntityContext } from '$lib/utils/entity-context';
  import { shortcutStore } from '$lib/stores/keyboard-shortcuts.svelte';

  type TabType = 'tracks' | 'albums' | 'artists';
  type TabData = TrackRecords | AlbumRecords | ArtistRecordsData;

  let metric = $state<RankingMetric>('time');
  let weekStart = $state<WeekStartOption>('monday');
  let unique = $state(true);
  const tab = urlEnumParam<TabType>('tab', ['tracks', 'albums', 'artists'], 'tracks');
  let loadingTab = $state<string | null>(null);

  let cache = $state<Map<string, TabData>>(new Map());

  // el param se llama tabId, no tab: `tab` es el urlEnumParam del scope de arriba
  function cacheKey(tabId: string) {
    return `${weekStart}:${metric}:${unique}:${tabId}`;
  }

  let currentData = $derived(cache.get(cacheKey(tab.value)) ?? null);
  let loading = $derived(loadingTab === tab.value);

  const fetchCtrl = createFetchController();

  async function loadTab(tabId: TabType) {
    const key = cacheKey(tabId);
    if (cache.has(key)) return;
    const signal = fetchCtrl.reset();
    loadingTab = tabId;
    try {
      const result = await api.records(weekStart, metric, tabId, unique, signal);
      if (signal.aborted) return;
      const data = result[tabId];
      if (data) {
        const next = new Map(cache);
        next.set(key, data as TabData);
        cache = next;
      }
    } catch (e) {
      if (isAbortError(e)) return;
      throw e;
    } finally {
      if (!signal.aborted) loadingTab = null;
    }
  }

  onMount(() => {
    metric = getRankingMetric();
    weekStart = getWeekStart();
    unique = getRecordsUnique();
  });

  const REC_TABS: TabType[] = ['tracks', 'albums', 'artists'];
  shortcutStore.registerPageShortcuts(
    [
      { key: '1', description: 'Tracks', category: 'page' },
      { key: '2', description: 'Albums', category: 'page' },
      { key: '3', description: 'Artists', category: 'page' },
    ],
    (e) => {
      if (e.key === '1' || e.key === '2' || e.key === '3') {
        e.preventDefault();
        tab.value = REC_TABS[+e.key - 1];
        return true;
      }
      return false;
    },
  );
  onDestroy(() => shortcutStore.unregisterPageShortcuts());

  $effect(() => {
    void metric;
    void weekStart;
    void unique;
    loadTab(tab.value);
  });

  function entityLink(type: string, id: string): string {
    if (type === 'artists') return `/artist/${id}`;
    if (type === 'albums') return `/album/${id}`;
    return `/track/${id}`;
  }

  function formatValue(val: number, label: string): string {
    if (label === 'weeks') return `${val} wk${val !== 1 ? 's' : ''}`;
    if (label === 'playlists') return `${val} playlist${val !== 1 ? 's' : ''}`;
    if (label === 'months') return `${val} mo${val !== 1 ? 's' : ''}`;
    if (label === 'tracks') return `${val} track${val !== 1 ? 's' : ''}`;
    if (label === 'days') return `${formatNumber(val)} day${val !== 1 ? 's' : ''}`;
    if (label === 'count') return `${val} record${val !== 1 ? 's' : ''}`;
    if (label === 'percent') return `${val.toFixed(1)}%`;
    if (label === 'plays' || metric === 'plays') return `${formatNumber(val)} plays`;
    return formatDuration(val);
  }

  // "2024-01" → "Jan 2024"
  function formatMonth(yyyymm: string): string {
    const [y, m] = yyyymm.split('-');
    const d = new Date(Date.UTC(Number(y), Number(m) - 1, 1));
    return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' });
  }

  // "YYYY-MM-DDTHH:MM:SSZ" → "Jan 5, 2024"
  function fmtDate(iso?: string | null): string {
    if (!iso) return '';
    return formatShortDate(iso);
  }

  // --- playlist creation from records ---
  let creatingPlaylist = $state<string | null>(null);
  let createdPlaylists = $state<Map<string, number>>(new Map());

  function singularTab(t: TabType): 'track' | 'album' | 'artist' {
    if (t === 'tracks') return 'track';
    if (t === 'albums') return 'album';
    return 'artist';
  }

  function recordPlaylistStateKey(recordKey: string): string {
    return `${tab.value}:${weekStart}:${metric}:${recordKey}`;
  }

  async function createRecordPlaylist(recordKey: string) {
    if (creatingPlaylist) return;
    const stateKey = recordPlaylistStateKey(recordKey);
    creatingPlaylist = stateKey;
    try {
      const result = await api.generatePlaylist({
        strategy: 'record',
        params: {
          recordKey,
          entityType: singularTab(tab.value),
          weekStart,
          sort: metric,
          limit: 50,
        },
      });
      if ('id' in result) {
        createdPlaylists = new Map(createdPlaylists).set(stateKey, result.libraryPlaylistId ?? result.id);
      }
    } catch {
      // silently fail
    } finally {
      creatingPlaylist = null;
    }
  }
</script>

<div class="page-header">
  <h1>Records</h1>
  <p>All-time bests, longevity, discovery and monthly milestones.</p>
</div>

<div class="records-tabs">
  <button class="rec-tab" class:rec-tab--active={tab.value === 'tracks'} onclick={() => tab.value = 'tracks'}><IconTrack size={14} /> Tracks</button>
  <button class="rec-tab" class:rec-tab--active={tab.value === 'albums'} onclick={() => tab.value = 'albums'}><IconAlbum size={14} /> Albums</button>
  <button class="rec-tab" class:rec-tab--active={tab.value === 'artists'} onclick={() => tab.value = 'artists'}><IconArtist size={14} /> Artists</button>
</div>

{#if loading && !currentData}
  <div class="loading"><div class="spinner"></div></div>
{:else if currentData}
  <!-- ============ snippets ============ -->

  {#snippet sectionHeader(title: string, recordKey: string)}
    {@const stateKey = recordPlaylistStateKey(recordKey)}
    <div class="record-header">
      <h3 class="record-title">{title}</h3>
      {#if createdPlaylists.has(stateKey)}
        <a href="/playlists/{createdPlaylists.get(stateKey)}" class="playlist-btn playlist-btn--ok">
          <IconCheckSmall />
          Created
        </a>
      {:else}
        <button
          class="playlist-btn"
          class:playlist-btn--busy={creatingPlaylist === stateKey}
          onclick={() => createRecordPlaylist(recordKey)}
          disabled={!!creatingPlaylist}
          title="Create Spotify playlist"
        >
          {#if creatingPlaylist === stateKey}
            <span class="btn-spinner"></span>
            Creating…
          {:else}
            <IconPlus />
            Playlist
          {/if}
        </button>
      {/if}
    </div>
  {/snippet}

  {#snippet recordList(title: string, items: RecordEntry[], valueType: string, recordKey: string)}
    {#if items.length > 0}
      <div class="record-section">
        {@render sectionHeader(title, recordKey)}
        <div class="record-list">
          {#each items as item, i}
            <TrackItem
              rank={i + 1}
              imageUrl={item.imageUrl}
              imageHref={entityLink(tab.value, item.entityId)}
              imageRound={tab.value === 'artists'}
              name={item.name}
              nameHref={entityLink(tab.value, item.entityId)}
              entity={{ type: singularTab(tab.value), id: item.entityId, name: item.name, imageUrl: item.imageUrl, parentArtistId: item.artistId } as EntityContext}
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
                    <a href="/charts?type={tab.value}&granularity=week&period={item.week}" class="record-week">{item.week}</a>
                  {/if}
                </div>
              {/snippet}
            </TrackItem>
          {/each}
        </div>
      </div>
    {/if}
  {/snippet}

  {#snippet datedList(title: string, items: RecordEntry[], dateLabel: string, valueType: string, recordKey: string)}
    {#if items.length > 0}
      <div class="record-section">
        {@render sectionHeader(title, recordKey)}
        <div class="record-list">
          {#each items as item, i}
            <TrackItem
              rank={i + 1}
              imageUrl={item.imageUrl}
              imageHref={entityLink(tab.value, item.entityId)}
              imageRound={tab.value === 'artists'}
              name={item.name}
              nameHref={entityLink(tab.value, item.entityId)}
              entity={{ type: singularTab(tab.value), id: item.entityId, name: item.name, imageUrl: item.imageUrl, parentArtistId: item.artistId } as EntityContext}
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
                  {#if item.date}
                    <span class="record-week">{dateLabel} {fmtDate(item.date)}</span>
                  {/if}
                </div>
              {/snippet}
            </TrackItem>
          {/each}
        </div>
      </div>
    {/if}
  {/snippet}

  {#snippet gapList(title: string, items: RecordEntry[], recordKey: string)}
    {#if items.length > 0}
      <div class="record-section">
        {@render sectionHeader(title, recordKey)}
        <div class="record-list">
          {#each items as item, i}
            <TrackItem
              rank={i + 1}
              imageUrl={item.imageUrl}
              imageHref={entityLink(tab.value, item.entityId)}
              imageRound={tab.value === 'artists'}
              name={item.name}
              nameHref={entityLink(tab.value, item.entityId)}
              entity={{ type: singularTab(tab.value), id: item.entityId, name: item.name, imageUrl: item.imageUrl, parentArtistId: item.artistId } as EntityContext}
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
                  <span class="record-val">{formatValue(item.value, 'days')}</span>
                  {#if item.ongoing}
                    <span class="record-active">ongoing · since {fmtDate(item.date)}</span>
                  {:else if item.date && item.endDate}
                    <span class="record-week">{fmtDate(item.date)} → {fmtDate(item.endDate)}</span>
                  {:else if item.date}
                    <span class="record-week">{fmtDate(item.date)}</span>
                  {/if}
                </div>
              {/snippet}
            </TrackItem>
          {/each}
        </div>
      </div>
    {/if}
  {/snippet}

  {#snippet chartRunList(title: string, items: RecordEntry[], recordKey: string)}
    {#if items.length > 0}
      <div class="record-section">
        {@render sectionHeader(title, recordKey)}
        <div class="record-list">
          {#each items as item, i}
            <TrackItem
              rank={i + 1}
              imageUrl={item.imageUrl}
              imageHref={entityLink(tab.value, item.entityId)}
              imageRound={tab.value === 'artists'}
              name={item.name}
              nameHref={entityLink(tab.value, item.entityId)}
              entity={{ type: singularTab(tab.value), id: item.entityId, name: item.name, imageUrl: item.imageUrl, parentArtistId: item.artistId } as EntityContext}
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
                  <span class="record-val">{formatValue(item.value, 'weeks')}</span>
                  {#if item.ongoing}
                    <span class="record-active">active · since <a href="/charts?type={tab.value}&granularity=week&period={item.date}" class="record-week">{item.date}</a></span>
                  {:else if item.date && item.endDate}
                    <span class="record-week"><a href="/charts?type={tab.value}&granularity=week&period={item.date}">{item.date}</a>→<a href="/charts?type={tab.value}&granularity=week&period={item.endDate}">{item.endDate}</a></span>
                  {/if}
                </div>
              {/snippet}
            </TrackItem>
          {/each}
        </div>
      </div>
    {/if}
  {/snippet}

  {#snippet bubblingList(title: string, items: RecordEntry[], recordKey: string)}
    {#if items.length > 0}
      <div class="record-section">
        {@render sectionHeader(title, recordKey)}
        <div class="record-list">
          {#each items as item, i}
            <TrackItem
              rank={i + 1}
              imageUrl={item.imageUrl}
              imageHref={entityLink(tab.value, item.entityId)}
              imageRound={tab.value === 'artists'}
              name={item.name}
              nameHref={entityLink(tab.value, item.entityId)}
              entity={{ type: singularTab(tab.value), id: item.entityId, name: item.name, imageUrl: item.imageUrl, parentArtistId: item.artistId } as EntityContext}
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
                  <span class="record-val">{formatValue(item.value, 'total')}</span>
                  {#if item.peakRank && item.week}
                    <span class="record-week">peaked #{item.peakRank} · <a href="/charts?type={tab.value}&granularity=week&period={item.week}">{item.week}</a></span>
                  {/if}
                </div>
              {/snippet}
            </TrackItem>
          {/each}
        </div>
      </div>
    {/if}
  {/snippet}

  {#snippet oneHitList(title: string, items: RecordEntry[], recordKey: string)}
    {#if items.length > 0}
      <div class="record-section">
        {@render sectionHeader(title, recordKey)}
        <div class="record-list">
          {#each items as item, i}
            <TrackItem
              rank={i + 1}
              imageUrl={item.imageUrl}
              imageHref={entityLink(tab.value, item.entityId)}
              imageRound={tab.value === 'artists'}
              name={item.name}
              nameHref={entityLink(tab.value, item.entityId)}
              entity={{ type: singularTab(tab.value), id: item.entityId, name: item.name, imageUrl: item.imageUrl, parentArtistId: item.artistId } as EntityContext}
              compact
            >
              {#snippet subtitle()}
                {#if item.secondaryLabel}
                  <span class="hit-track">“{item.secondaryLabel}”</span>
                {/if}
                {#if item.artistName}
                  {#if item.artistId}
                    · <a href="/artist/{item.artistId}" class="artist-link">{item.artistName}</a>
                  {:else}
                    · {item.artistName}
                  {/if}
                {/if}
              {/snippet}
              {#snippet meta()}
                <div class="record-value">
                  <span class="record-val">{formatValue(item.value, 'plays')}</span>
                </div>
              {/snippet}
            </TrackItem>
          {/each}
        </div>
      </div>
    {/if}
  {/snippet}


  {#snippet monthList(title: string, items: MonthCountEntry[], entityLabel: string)}
    {#if items.length > 0}
      <div class="record-section">
        <h3 class="record-title">{title}</h3>
        <div class="record-list">
          {#each items as item, i}
            <TrackItem
              rank={i + 1}
              imageUrl={null}
              name={formatMonth(item.month)}
              compact
            >
              {#snippet cover()}
                {#if item.covers && item.covers.length > 0}
                  <div class="month-collage month-collage--{Math.min(item.covers.length, 4)}">
                    {#each item.covers.slice(0, 4) as url}
                      <img src={url} alt="" loading="lazy" />
                    {/each}
                  </div>
                {:else}
                  <div class="track-art"></div>
                {/if}
              {/snippet}
              {#snippet meta()}
                <div class="record-value">
                  <span class="record-val">{formatNumber(item.count)} {entityLabel}</span>
                  <a href="/charts?type={tab.value}&granularity=month&period={item.month}" class="record-week">{item.month}</a>
                </div>
              {/snippet}
            </TrackItem>
          {/each}
        </div>
      </div>
    {/if}
  {/snippet}

  {#snippet artistRecordList(title: string, items: { artistId: string; name: string; imageUrl: string | null; count: number }[], recordKey: string)}
    {#if items.length > 0}
      <div class="record-section">
        {@render sectionHeader(title, recordKey)}
        <div class="record-list">
          {#each items as item, i}
            <TrackItem
              href="/artist/{item.artistId}"
              rank={i + 1}
              imageUrl={item.imageUrl}
              imageRound
              name={item.name}
              entity={{ type: 'artist', id: item.artistId, name: item.name, imageUrl: item.imageUrl } as EntityContext}
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

  <!-- ============ sections ============ -->
  {@const artistData = ('mostNo1Tracks' in currentData) ? currentData as ArtistRecordsData : null}

  {@const hasAllTime =
    currentData.peakWeekPlays.length > 0 ||
    currentData.dominance.length > 0 ||
    currentData.mostWeeksAtNo1.length > 0 ||
    (currentData.inMostPlaylists?.length ?? 0) > 0 ||
    currentData.mostAccolades.length > 0 ||
    (artistData ? (artistData.mostNo1Tracks.length + artistData.mostNo1Albums.length) > 0 : false)}
  {@const hasLongevity =
    currentData.mostWeeksInTop5.length > 0 ||
    currentData.longestChartRun.length > 0}
  {@const hasDiscovery =
    currentData.biggestDebuts.length > 0 ||
    currentData.latestDiscoveries.length > 0}
  {@const hasOther =
    currentData.bubblingUnder.length > 0 ||
    currentData.longestGap.length > 0 ||
    currentData.goldenOldies.length > 0 ||
    currentData.mostUniquePerMonth.length > 0 ||
    (artistData ? (artistData.mostDistinctTracks.length + artistData.oneHitWonders.length) > 0 : false)}

  {#if hasAllTime}
    <h2 class="record-group">All-time bests</h2>
    {@render recordList('Peak week', currentData.peakWeekPlays, 'peak', 'peakWeekPlays')}
    {@render recordList('Dominance', currentData.dominance, 'percent', 'dominance')}
    {@render recordList('Most weeks at #1', currentData.mostWeeksAtNo1, 'weeks', 'mostWeeksAtNo1')}
    {@render recordList('In most playlists', currentData.inMostPlaylists, 'playlists', 'inMostPlaylists')}
    {@render recordList('Most records', currentData.mostAccolades, 'count', 'mostAccolades')}
    {#if artistData}
      {@render artistRecordList('Most #1 tracks', artistData.mostNo1Tracks, 'mostNo1Tracks')}
      {@render artistRecordList('Most #1 albums', artistData.mostNo1Albums, 'mostNo1Albums')}
    {/if}
  {/if}

  {#if hasLongevity}
    <h2 class="record-group">Longevity</h2>
    {@render recordList('Most weeks in the charts', currentData.mostWeeksInTop5, 'weeks', 'mostWeeksInTop5')}
    {@render chartRunList('Longest chart run', currentData.longestChartRun, 'longestChartRun')}
  {/if}

  {#if hasDiscovery}
    <h2 class="record-group">Discovery</h2>
    {@render recordList('Biggest debuts', currentData.biggestDebuts, 'debut', 'biggestDebuts')}
    {@render datedList('Latest discoveries', currentData.latestDiscoveries, 'first heard', 'plays', 'latestDiscoveries')}
  {/if}

  {#if hasOther}
    <h2 class="record-group">Other records</h2>
    {@render bubblingList('Bubbling under', currentData.bubblingUnder, 'bubblingUnder')}
    {@render gapList('Longest gap between plays', currentData.longestGap, 'longestGap')}
    {@render datedList('Golden oldies', currentData.goldenOldies, 'last heard', 'plays', 'goldenOldies')}
    {@render monthList(`Months with most ${tab.value}`, currentData.mostUniquePerMonth, tab.value)}
    {#if artistData}
      {@render recordList('Most distinct tracks played', artistData.mostDistinctTracks, 'tracks', 'mostDistinctTracks')}
      {@render oneHitList('One-hit wonders', artistData.oneHitWonders, 'oneHitWonders')}
    {/if}
  {/if}
{/if}

<style>
  .records-tabs {
    display: flex;
    gap: 0.25rem;
    margin-bottom: 1.25rem;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 3px;
    width: fit-content;
  }
  .rec-tab {
    padding: 0.4rem 1rem;
    border: none;
    border-radius: var(--radius);
    background: transparent;
    color: var(--text-muted);
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    cursor: pointer;
    transition: all 0.05s;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }
  .rec-tab:hover:not(.rec-tab--active) { color: var(--text); }
  .rec-tab--active {
    background: var(--accent);
    color: #000;
    font-weight: 500;
  }

  .record-group {
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin: 1.75rem 0 0.5rem;
    color: var(--text);
    font-weight: 600;
    border-bottom: 1px solid var(--border);
    padding-bottom: 0.3rem;
  }
  .record-group:first-of-type { margin-top: 0.25rem; }

  .record-section { margin-bottom: 1.5rem; }
  .record-header {
    display: flex;
    align-items: center;
    margin-bottom: 0.5rem;
  }
  .record-title {
    font-size: 0.95rem;
    color: var(--text);
  }
  .record-list {
    background: var(--bg-card);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .record-list :global(.track-item) {
    border-bottom: 1px solid var(--border);
    border-radius: 0;
  }
  .record-list :global(.track-item:last-child) { border-bottom: none; }

  .record-value {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    flex-shrink: 0;
    gap: 0.1rem;
  }
  .record-val {
    font-variant-numeric: tabular-nums;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--accent);
  }
  .record-week {
    font-size: 0.65rem;
    color: var(--text-muted);
    text-decoration: none;
  }
  .record-week:hover, .record-week a:hover { color: var(--accent); }
  .record-week a { color: inherit; text-decoration: none; }
  .record-active {
    font-size: 0.6rem;
    font-weight: 600;
    color: var(--accent);
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  .hit-track {
    font-style: italic;
  }

  /* collage de covers para los records mensuales (tracks, álbumes, artistas del mes) */
  .month-collage {
    width: 36px;
    height: 36px;
    border-radius: var(--radius);
    overflow: hidden;
    flex-shrink: 0;
    background: var(--border);
    display: grid;
    gap: 1px;
  }
  .month-collage img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .month-collage--1 { grid-template-columns: 1fr; grid-template-rows: 1fr; }
  .month-collage--2 { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr; }
  .month-collage--3 { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; }
  .month-collage--3 img:first-child { grid-column: 1 / span 2; }
  .month-collage--4 { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; }
</style>
