<script lang="ts">
  import { page } from '$app/stores';
  import { api, createFetchController, type CompareResponse, type TimeRange, type ProfileSummary, type TopArtistItem, type TopTrackItem, type TopAlbumItem, type SharedRankedItem } from '$lib/api';
  import { formatDuration, formatNumber, formatShortDate } from '$lib/utils/format';

  let data = $state<CompareResponse | null>(null);
  let loading = $state(true);
  let notFound = $state(false);
  let range = $state<TimeRange>('all');
  let sideEntity = $state<'artists' | 'tracks' | 'albums'>('artists');
  const fetchCtrl = createFetchController();

  const RANGES: { key: TimeRange; label: string }[] = [
    { key: 'month', label: '30D' },
    { key: '3months', label: '3M' },
    { key: 'year', label: '1Y' },
    { key: 'thisYear', label: 'YTD' },
    { key: 'all', label: 'All' },
  ];

  async function loadData(id: string) {
    const signal = fetchCtrl.reset();
    loading = true;
    notFound = false;
    try {
      const result = await api.socialCompare(id, range, signal);
      if (signal.aborted) return;
      data = result;
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      data = null;
      notFound = true;
    } finally {
      if (!signal.aborted) loading = false;
    }
  }

  let prevId = '';
  $effect(() => {
    const id = $page.params.id;
    void range;
    if (!id) return;
    if (id !== prevId) {
      data = null;
      prevId = id;
    }
    loadData(id);
  });

  function nameOf(s: ProfileSummary): string {
    return s.displayName ?? s.spotifyId;
  }

  // filas del head-to-head all-time. better: 'high' gana el mayor, 'low' gana el menor (fechas)
  type H2HRow = { label: string; mine: string; theirs: string; winner: 'me' | 'them' | 'tie' };

  function h2hRow(label: string, mineVal: number, theirsVal: number, fmt: (n: number) => string): H2HRow {
    return {
      label,
      mine: fmt(mineVal),
      theirs: fmt(theirsVal),
      winner: mineVal === theirsVal ? 'tie' : mineVal > theirsVal ? 'me' : 'them',
    };
  }

  let headToHead = $derived.by<H2HRow[]>(() => {
    if (!data) return [];
    const rows: H2HRow[] = [
      h2hRow('Plays', data.me.totalPlays, data.them.totalPlays, formatNumber),
      h2hRow('Listening time', data.me.totalMs, data.them.totalMs, formatDuration),
      h2hRow('Artists', data.me.distinctArtists, data.them.distinctArtists, formatNumber),
      h2hRow('Tracks', data.me.distinctTracks, data.them.distinctTracks, formatNumber),
      h2hRow('Albums', data.me.distinctAlbums, data.them.distinctAlbums, formatNumber),
      h2hRow('Longest streak', data.myStreaks.longestStreak, data.theirStreaks.longestStreak, n => `${n} days`),
      h2hRow('Current streak', data.myStreaks.currentStreak, data.theirStreaks.currentStreak, n => `${n} days`),
      h2hRow('Days listened', data.myStreaks.totalDays, data.theirStreaks.totalDays, formatNumber),
    ];
    if (data.me.firstPlayedAt && data.them.firstPlayedAt) {
      const mineTs = new Date(data.me.firstPlayedAt).getTime();
      const theirsTs = new Date(data.them.firstPlayedAt).getTime();
      rows.push({
        label: 'First play',
        mine: formatShortDate(data.me.firstPlayedAt),
        theirs: formatShortDate(data.them.firstPlayedAt),
        winner: mineTs === theirsTs ? 'tie' : mineTs < theirsTs ? 'me' : 'them', // más antiguo gana
      });
    }
    return rows;
  });

  type SideItem = { id: string; name: string; imageUrl: string | null; round: boolean; totalMs: number; href: string };

  function artistSide(items: TopArtistItem[]): SideItem[] {
    return items.map(i => ({ id: i.artistId, name: i.artist?.name ?? i.artistId, imageUrl: i.artist?.imageUrl ?? null, round: true, totalMs: i.totalMs, href: `/artist/${i.artistId}` }));
  }
  function trackSide(items: TopTrackItem[]): SideItem[] {
    return items.map(i => ({ id: i.trackId, name: i.track?.name ?? i.trackId, imageUrl: i.track?.album?.imageUrl ?? null, round: false, totalMs: i.totalMs, href: `/track/${i.trackId}` }));
  }
  function albumSide(items: TopAlbumItem[]): SideItem[] {
    return items.map(i => ({ id: i.albumId, name: i.album?.name ?? i.albumId, imageUrl: i.album?.imageUrl ?? null, round: false, totalMs: i.totalMs, href: `/album/${i.albumId}` }));
  }

  let sideLists = $derived.by<{ mine: SideItem[]; theirs: SideItem[] }>(() => {
    if (!data) return { mine: [], theirs: [] };
    if (sideEntity === 'artists') return { mine: artistSide(data.myTopArtists), theirs: artistSide(data.theirTopArtists) };
    if (sideEntity === 'tracks') return { mine: trackSide(data.myTopTracks), theirs: trackSide(data.theirTopTracks) };
    return { mine: albumSide(data.myTopAlbums), theirs: albumSide(data.theirTopAlbums) };
  });

  // ids compartidos del tipo seleccionado, para resaltar coincidencias en los tops
  let sharedIds = $derived.by<Set<string>>(() => {
    if (!data) return new Set();
    const list: SharedRankedItem[] = sideEntity === 'artists' ? data.sharedArtists : sideEntity === 'tracks' ? data.sharedTracks : data.sharedAlbums;
    return new Set(list.map(i => i.id));
  });

  const SHARED_SECTIONS: Array<{ key: 'sharedArtists' | 'sharedTracks' | 'sharedAlbums'; title: string; round: boolean; hrefBase: string }> = [
    { key: 'sharedArtists', title: 'Shared artists', round: true, hrefBase: '/artist' },
    { key: 'sharedTracks', title: 'Shared tracks', round: false, hrefBase: '/track' },
    { key: 'sharedAlbums', title: 'Shared albums', round: false, hrefBase: '/album' },
  ];
</script>

<svelte:head>
  <title>Compare — SIS</title>
</svelte:head>

{#if loading && !data}
  <div class="loading"><div class="spinner"></div></div>
{:else if notFound}
  <div class="empty-state">
    <p>Can't compare with this user.</p>
  </div>
{:else if data}
  <div class="compare-header">
    <div class="compare-user">
      {#if data.me.imageUrl}
        <img class="compare-avatar" src={data.me.imageUrl} alt={nameOf(data.me)} />
      {:else}
        <div class="compare-avatar compare-avatar--empty">{nameOf(data.me).charAt(0).toUpperCase()}</div>
      {/if}
      <span class="compare-name">{nameOf(data.me)}</span>
    </div>

    <div class="compare-meter">
      <div class="compare-percent">{data.overlapPercent}%</div>
      <div class="compare-bar">
        <div class="compare-bar-fill" style:width="{data.overlapPercent}%"></div>
      </div>
      <span class="compare-meta">taste overlap</span>
      <div class="compare-breakdown">
        <div class="breakdown-row">
          <span class="breakdown-label">Artists</span>
          <div class="breakdown-bar"><div class="breakdown-fill" style:width="{data.overlapByType.artists}%"></div></div>
          <span class="breakdown-value">{data.overlapByType.artists}%</span>
        </div>
        <div class="breakdown-row">
          <span class="breakdown-label">Tracks</span>
          <div class="breakdown-bar"><div class="breakdown-fill" style:width="{data.overlapByType.tracks}%"></div></div>
          <span class="breakdown-value">{data.overlapByType.tracks}%</span>
        </div>
        <div class="breakdown-row">
          <span class="breakdown-label">Albums</span>
          <div class="breakdown-bar"><div class="breakdown-fill" style:width="{data.overlapByType.albums}%"></div></div>
          <span class="breakdown-value">{data.overlapByType.albums}%</span>
        </div>
      </div>
    </div>

    <div class="compare-user">
      <a href="/u/{encodeURIComponent(data.them.spotifyId)}" class="compare-user-link">
        {#if data.them.imageUrl}
          <img class="compare-avatar" src={data.them.imageUrl} alt={nameOf(data.them)} />
        {:else}
          <div class="compare-avatar compare-avatar--empty">{nameOf(data.them).charAt(0).toUpperCase()}</div>
        {/if}
        <span class="compare-name">{nameOf(data.them)}</span>
      </a>
    </div>
  </div>

  <!-- head-to-head all-time: no depende del rango -->
  <section class="compare-section">
    <h2>Head to head</h2>
    <div class="card h2h-card">
      {#each headToHead as row}
        <div class="h2h-row">
          <span class="h2h-value" class:h2h-winner={row.winner === 'me'}>{row.mine}</span>
          <span class="h2h-label">{row.label}</span>
          <span class="h2h-value h2h-value--right" class:h2h-winner={row.winner === 'them'}>{row.theirs}</span>
        </div>
      {/each}
    </div>
  </section>

  <!-- el rango afecta a compartidos y tops -->
  <div class="compare-ranges">
    {#each RANGES as r}
      <button class="range-btn" class:active={range === r.key} onclick={() => range = r.key}>{r.label}</button>
    {/each}
  </div>

  {#each SHARED_SECTIONS as section}
    {@const items = data[section.key]}
    {#if items.length > 0}
      <section class="compare-section">
        <h2>{section.title}</h2>
        <div class="shared-grid">
          {#each items.slice(0, 12) as item (item.id)}
            <a href="{section.hrefBase}/{item.id}" class="shared-item">
              {#if item.imageUrl}
                <img class="shared-img" class:shared-img--round={section.round} src={item.imageUrl} alt={item.name} />
              {:else}
                <div class="shared-img shared-img--empty" class:shared-img--round={section.round}></div>
              {/if}
              <span class="shared-name">{item.name}</span>
              <span class="shared-ranks">#{item.myRank} you · #{item.theirRank} them</span>
            </a>
          {/each}
        </div>
      </section>
    {/if}
  {/each}

  {#if data.sharedArtists.length === 0 && data.sharedTracks.length === 0 && data.sharedAlbums.length === 0}
    <div class="empty-state">
      <p>No shared favorites in this period — completely different worlds.</p>
    </div>
  {/if}

  <section class="compare-section">
    <div class="side-header">
      <h2>Tops side by side</h2>
      <div class="side-switcher">
        <button class="range-btn" class:active={sideEntity === 'artists'} onclick={() => sideEntity = 'artists'}>Artists</button>
        <button class="range-btn" class:active={sideEntity === 'tracks'} onclick={() => sideEntity = 'tracks'}>Tracks</button>
        <button class="range-btn" class:active={sideEntity === 'albums'} onclick={() => sideEntity = 'albums'}>Albums</button>
      </div>
    </div>
    <div class="side-by-side">
      <div class="side-col">
        <span class="side-label">You</span>
        {#each sideLists.mine as item, i (item.id)}
          <a href={item.href} class="side-row" class:side-row--shared={sharedIds.has(item.id)}>
            <span class="side-rank">{i + 1}</span>
            {#if item.imageUrl}
              <img class="side-img" class:side-img--round={item.round} src={item.imageUrl} alt={item.name} />
            {:else}
              <div class="side-img shared-img--empty" class:side-img--round={item.round}></div>
            {/if}
            <span class="side-name">{item.name}</span>
            <span class="side-stat">{formatDuration(item.totalMs)}</span>
          </a>
        {/each}
      </div>
      <div class="side-col">
        <span class="side-label">{nameOf(data.them)}</span>
        {#each sideLists.theirs as item, i (item.id)}
          <a href={item.href} class="side-row" class:side-row--shared={sharedIds.has(item.id)}>
            <span class="side-rank">{i + 1}</span>
            {#if item.imageUrl}
              <img class="side-img" class:side-img--round={item.round} src={item.imageUrl} alt={item.name} />
            {:else}
              <div class="side-img shared-img--empty" class:side-img--round={item.round}></div>
            {/if}
            <span class="side-name">{item.name}</span>
            <span class="side-stat">{formatDuration(item.totalMs)}</span>
          </a>
        {/each}
      </div>
    </div>
    <p class="side-hint">Highlighted rows appear in both lists.</p>
  </section>
{/if}

<style>
  .compare-header {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    gap: 1.5rem;
    align-items: start;
    margin-bottom: 1.25rem;
  }

  .compare-user {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.35rem;
    padding-top: 0.5rem;
  }

  .compare-user-link {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.35rem;
    text-decoration: none;
    color: inherit;
  }

  .compare-user-link:hover .compare-name {
    color: var(--accent);
  }

  .compare-avatar {
    width: 72px;
    height: 72px;
    border-radius: 50%;
    object-fit: cover;
  }

  .compare-avatar--empty {
    background: var(--bg-hover);
    color: var(--text-muted);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.4rem;
    font-weight: 600;
  }

  .compare-name {
    font-weight: 700;
    font-size: 1rem;
  }

  .compare-meta {
    font-size: 0.72rem;
    color: var(--text-muted);
  }

  .compare-meter {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.4rem;
    min-width: 200px;
  }

  .compare-percent {
    font-size: 2.4rem;
    font-weight: 800;
    font-family: var(--font-mono);
    color: var(--accent);
    line-height: 1;
  }

  .compare-bar {
    width: 100%;
    height: 8px;
    border-radius: 4px;
    background: var(--bg-hover);
    overflow: hidden;
  }

  .compare-bar-fill {
    height: 100%;
    background: var(--accent);
    border-radius: 4px;
    transition: width 0.4s ease;
  }

  .compare-breakdown {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin-top: 0.35rem;
  }

  .breakdown-row {
    display: grid;
    grid-template-columns: 3.2rem 1fr 2.2rem;
    align-items: center;
    gap: 0.4rem;
  }

  .breakdown-label {
    font-size: 0.62rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
  }

  .breakdown-bar {
    height: 4px;
    border-radius: 2px;
    background: var(--bg-hover);
    overflow: hidden;
  }

  .breakdown-fill {
    height: 100%;
    background: var(--accent);
    opacity: 0.7;
    border-radius: 2px;
    transition: width 0.4s ease;
  }

  .breakdown-value {
    font-size: 0.62rem;
    font-family: var(--font-mono);
    color: var(--text-muted);
    text-align: right;
  }

  .h2h-card {
    display: flex;
    flex-direction: column;
    padding: 0.5rem 1.25rem;
    max-width: 560px;
    margin: 0 auto;
  }

  .h2h-row {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    gap: 1rem;
    align-items: center;
    padding: 0.45rem 0;
    border-bottom: 1px solid var(--border);
  }

  .h2h-row:last-child {
    border-bottom: none;
  }

  .h2h-value {
    font-family: var(--font-mono);
    font-size: 0.85rem;
    color: var(--text-muted);
  }

  .h2h-value--right {
    text-align: right;
  }

  .h2h-winner {
    color: var(--accent);
    font-weight: 700;
  }

  .h2h-label {
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
    text-align: center;
  }

  .compare-ranges {
    display: flex;
    gap: 0.25rem;
    margin-bottom: 1.25rem;
    flex-wrap: wrap;
    justify-content: center;
  }

  .compare-section {
    margin-bottom: 1.75rem;
  }

  .compare-section h2 {
    font-size: 0.9rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
    margin-bottom: 0.75rem;
  }

  .shared-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
    gap: 0.75rem;
  }

  .shared-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.3rem;
    text-decoration: none;
    color: inherit;
    text-align: center;
  }

  .shared-item:hover .shared-name {
    color: var(--accent);
  }

  .shared-img {
    width: 100%;
    aspect-ratio: 1;
    object-fit: cover;
    border-radius: var(--radius);
  }

  .shared-img--round {
    border-radius: 50%;
  }

  .shared-img--empty {
    background: var(--border);
  }

  .shared-name {
    font-size: 0.78rem;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
  }

  .shared-ranks {
    font-size: 0.65rem;
    color: var(--text-muted);
    font-family: var(--font-mono);
  }

  .side-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    flex-wrap: wrap;
    margin-bottom: 0.75rem;
  }

  .side-header h2 {
    margin-bottom: 0;
  }

  .side-switcher {
    display: flex;
    gap: 0.25rem;
  }

  .side-by-side {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.25rem;
  }

  .side-col {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    min-width: 0;
  }

  .side-label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
    margin-bottom: 0.25rem;
  }

  .side-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    text-decoration: none;
    color: inherit;
    padding: 0.25rem 0.4rem;
    border-radius: var(--radius);
  }

  .side-row:hover {
    background: var(--bg-hover);
  }

  .side-row--shared {
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }

  .side-row--shared:hover {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
  }

  .side-rank {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    color: var(--text-muted);
    width: 1.4rem;
    text-align: right;
    flex-shrink: 0;
  }

  .side-img {
    width: 32px;
    height: 32px;
    border-radius: var(--radius);
    object-fit: cover;
    flex-shrink: 0;
  }

  .side-img--round {
    border-radius: 50%;
  }

  .side-name {
    font-size: 0.82rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
    min-width: 0;
  }

  .side-stat {
    font-size: 0.72rem;
    color: var(--text-muted);
    font-family: var(--font-mono);
    flex-shrink: 0;
  }

  .side-hint {
    font-size: 0.68rem;
    color: var(--text-muted);
    margin-top: 0.5rem;
  }

  @media (max-width: 640px) {
    .compare-header {
      grid-template-columns: 1fr 1fr;
    }
    .compare-meter {
      grid-column: 1 / -1;
      grid-row: 2;
    }
    .side-by-side {
      grid-template-columns: 1fr;
    }
  }
</style>
