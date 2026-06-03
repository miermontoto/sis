<script lang="ts">
  import { page } from '$app/stores';
  import { api, PublicShareError, type ProfileResponse, type TimeRange } from '$lib/api';
  import { formatDuration, formatNumber, formatSmartDate } from '$lib/utils/format';

  // vista pública sin sesión: usa exclusivamente publicFetch (vía api.publicShareProfile),
  // nunca apiFetch (que redirige a /login en 401 y usa cache namespaced).

  let profile = $state<ProfileResponse | null>(null);
  let loading = $state(true);
  let errorKind = $state<'none' | 'not_found' | 'revoked' | 'error'>('none');
  let range = $state<TimeRange>('month');

  const RANGES: { key: TimeRange; label: string }[] = [
    { key: 'week', label: '7D' },
    { key: 'month', label: '30D' },
    { key: '3months', label: '3M' },
    { key: '6months', label: '6M' },
    { key: 'year', label: '1Y' },
    { key: 'thisYear', label: 'YTD' },
    { key: 'all', label: 'All' },
  ];

  async function loadData(token: string, withRange?: TimeRange) {
    loading = true;
    errorKind = 'none';
    try {
      const result = await api.publicShareProfile(token, withRange);
      profile = result;
      range = result.range;
    } catch (e) {
      profile = null;
      if (e instanceof PublicShareError) {
        errorKind = e.status === 410 ? 'revoked' : 'not_found';
      } else {
        errorKind = 'error';
      }
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    const token = $page.params.token;
    if (token) loadData(token);
  });

  function changeRange(r: TimeRange) {
    const token = $page.params.token;
    if (profile?.rangeLocked || !token) return;
    range = r;
    loadData(token, r);
  }

  let displayName = $derived(profile?.summary.displayName ?? '');
</script>

<svelte:head>
  <title>{displayName ? `${displayName} — SIS` : 'SIS'}</title>
</svelte:head>

<div class="share-page">
  {#if loading && !profile}
    <div class="loading"><div class="spinner"></div></div>
  {:else if errorKind === 'revoked'}
    <div class="share-error">
      <h1>Link revoked</h1>
      <p>The owner of this profile revoked this share link.</p>
    </div>
  {:else if errorKind === 'not_found' || errorKind === 'error'}
    <div class="share-error">
      <h1>Link not available</h1>
      <p>This share link doesn't exist or is no longer available.</p>
    </div>
  {:else if profile}
    <header class="share-header">
      {#if profile.summary.imageUrl}
        <img class="share-avatar" src={profile.summary.imageUrl} alt={displayName} />
      {:else}
        <div class="share-avatar share-avatar--empty">{(displayName || '?').charAt(0).toUpperCase()}</div>
      {/if}
      <div class="share-identity">
        <h1>{displayName}</h1>
        {#if profile.nowPlaying}
          <p class="share-np">
            <span class="share-live-dot"></span>
            {profile.nowPlaying.name} — {profile.nowPlaying.artists}
          </p>
        {/if}
      </div>
    </header>

    <!-- resumen all-time: no depende del rango -->
    <div class="share-stats">
      <div class="share-stat">
        <span class="share-stat-value">{formatNumber(profile.summary.totalPlays)}</span>
        <span class="share-stat-label">Plays</span>
      </div>
      <div class="share-stat">
        <span class="share-stat-value">{formatDuration(profile.summary.totalMs)}</span>
        <span class="share-stat-label">Listening time</span>
      </div>
      <div class="share-stat">
        <span class="share-stat-value">{formatNumber(profile.summary.distinctArtists)}</span>
        <span class="share-stat-label">Artists</span>
      </div>
      {#if profile.summary.firstPlayedAt}
        <div class="share-stat">
          <span class="share-stat-value">{formatSmartDate(profile.summary.firstPlayedAt)}</span>
          <span class="share-stat-label">First play</span>
        </div>
      {/if}
    </div>

    {#if !profile.rangeLocked}
      <div class="share-ranges">
        {#each RANGES as r}
          <button class="share-range-btn" class:active={range === r.key} onclick={() => changeRange(r.key)}>{r.label}</button>
        {/each}
      </div>
    {/if}

    {#if profile.topArtists.length > 0}
      <section class="share-section">
        <h2>Top artists</h2>
        <div class="share-covers">
          {#each profile.topArtists.slice(0, 5) as item, i (item.artistId)}
            <div class="share-cover">
              <span class="share-cover-rank">{i + 1}</span>
              {#if item.artist?.imageUrl}
                <img class="share-cover-img share-cover-img--round" src={item.artist.imageUrl} alt={item.artist?.name} />
              {:else}
                <div class="share-cover-img share-cover-img--round share-cover-img--empty"></div>
              {/if}
              <span class="share-cover-name">{item.artist?.name ?? ''}</span>
              <span class="share-cover-stat">{formatDuration(item.totalMs)}</span>
            </div>
          {/each}
        </div>
      </section>
    {/if}

    {#if profile.topAlbums.length > 0}
      <section class="share-section">
        <h2>Top albums</h2>
        <div class="share-covers">
          {#each profile.topAlbums.slice(0, 5) as item, i (item.albumId)}
            <div class="share-cover">
              <span class="share-cover-rank">{i + 1}</span>
              {#if item.album?.imageUrl}
                <img class="share-cover-img" src={item.album.imageUrl} alt={item.album?.name} />
              {:else}
                <div class="share-cover-img share-cover-img--empty"></div>
              {/if}
              <span class="share-cover-name">{item.album?.name ?? ''}</span>
              <span class="share-cover-stat">{formatDuration(item.totalMs)}</span>
            </div>
          {/each}
        </div>
      </section>
    {/if}

    {#if profile.topTracks.length > 0}
      <section class="share-section">
        <h2>Top tracks</h2>
        <ol class="share-tracks">
          {#each profile.topTracks as item (item.trackId)}
            <li class="share-track">
              {#if item.track?.album?.imageUrl}
                <img class="share-track-img" src={item.track.album.imageUrl} alt={item.track?.name} />
              {:else}
                <div class="share-track-img share-cover-img--empty"></div>
              {/if}
              <div class="share-track-info">
                <span class="share-track-name">{item.track?.name ?? ''}</span>
                <span class="share-track-artists">{item.track?.artists?.map(a => a.name).join(', ') ?? ''}</span>
              </div>
              <span class="share-track-stat">{formatDuration(item.totalMs)}</span>
            </li>
          {/each}
        </ol>
      </section>
    {/if}

    {#if profile.topArtists.length === 0 && profile.topTracks.length === 0 && profile.topAlbums.length === 0}
      <div class="share-error">
        <p>No listening activity in this period.</p>
      </div>
    {/if}
  {/if}

  <footer class="share-footer">
    powered by <span class="share-footer-brand">SIS</span>
  </footer>
</div>

<style>
  .share-page {
    max-width: 720px;
    margin: 0 auto;
    padding: 2rem 1.25rem 3rem;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }

  .share-error {
    text-align: center;
    padding: 4rem 1rem;
    color: var(--text-muted);
  }

  .share-error h1 {
    color: var(--text);
    margin-bottom: 0.5rem;
  }

  .share-header {
    display: flex;
    align-items: center;
    gap: 1.25rem;
    margin-bottom: 1.5rem;
  }

  .share-avatar {
    width: 88px;
    height: 88px;
    border-radius: 50%;
    object-fit: cover;
  }

  .share-avatar--empty {
    background: var(--bg-hover);
    color: var(--text-muted);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 2rem;
    font-weight: 700;
  }

  .share-identity h1 {
    margin: 0;
    font-size: 1.8rem;
  }

  .share-np {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--text-muted);
    font-size: 0.85rem;
    margin-top: 0.35rem;
  }

  .share-live-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent, #1db954);
    flex-shrink: 0;
    animation: share-pulse 2s infinite;
  }

  @keyframes share-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .share-ranges {
    display: flex;
    gap: 0.25rem;
    flex-wrap: wrap;
    margin-bottom: 1.25rem;
  }

  .share-range-btn {
    padding: 0.35rem 0.75rem;
    border-radius: var(--radius, 6px);
    border: 1px solid var(--border, #2a2f36);
    background: transparent;
    color: var(--text-muted, #9aa3ad);
    cursor: pointer;
    font-size: 0.75rem;
    text-transform: uppercase;
  }

  .share-range-btn.active {
    background: var(--accent, #1db954);
    border-color: var(--accent, #1db954);
    color: #000;
  }

  .share-stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
    gap: 0.75rem;
    margin-bottom: 1.75rem;
  }

  .share-stat {
    background: var(--bg-card, #11151a);
    border: 1px solid var(--border, #2a2f36);
    border-radius: var(--radius, 6px);
    padding: 0.9rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .share-stat-value {
    font-size: 1.25rem;
    font-weight: 700;
  }

  .share-stat-label {
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted, #9aa3ad);
  }

  .share-section {
    margin-bottom: 1.75rem;
  }

  .share-section h2 {
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted, #9aa3ad);
    margin-bottom: 0.75rem;
  }

  .share-covers {
    display: flex;
    gap: 0.75rem;
    overflow-x: auto;
  }

  .share-cover {
    display: flex;
    flex-direction: column;
    align-items: center;
    flex: 1 1 0;
    min-width: 0;
    position: relative;
    text-align: center;
  }

  .share-cover-rank {
    position: absolute;
    top: 2px;
    left: 2px;
    font-family: var(--font-mono, monospace);
    font-size: 0.65rem;
    font-weight: 700;
    background: rgba(0, 0, 0, 0.6);
    border-radius: var(--radius, 6px);
    padding: 0 4px;
    z-index: 1;
  }

  .share-cover-img {
    width: 100%;
    aspect-ratio: 1;
    object-fit: cover;
    border-radius: var(--radius, 6px);
  }

  .share-cover-img--round {
    border-radius: 50%;
  }

  .share-cover-img--empty {
    background: var(--border, #2a2f36);
  }

  .share-cover-name {
    font-size: 0.75rem;
    font-weight: 600;
    margin-top: 0.4rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }

  .share-cover-stat {
    font-size: 0.65rem;
    color: var(--text-muted, #9aa3ad);
  }

  .share-tracks {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    counter-reset: track;
  }

  .share-track {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    counter-increment: track;
  }

  .share-track::before {
    content: counter(track);
    font-family: var(--font-mono, monospace);
    font-size: 0.72rem;
    color: var(--text-muted, #9aa3ad);
    width: 1.4rem;
    text-align: right;
    flex-shrink: 0;
  }

  .share-track-img {
    width: 38px;
    height: 38px;
    border-radius: var(--radius, 6px);
    object-fit: cover;
    flex-shrink: 0;
  }

  .share-track-info {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
  }

  .share-track-name {
    font-size: 0.85rem;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .share-track-artists {
    font-size: 0.72rem;
    color: var(--text-muted, #9aa3ad);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .share-track-stat {
    font-size: 0.72rem;
    color: var(--text-muted, #9aa3ad);
    font-family: var(--font-mono, monospace);
    flex-shrink: 0;
  }

  .share-footer {
    margin-top: auto;
    padding-top: 2.5rem;
    text-align: center;
    font-size: 0.72rem;
    color: var(--text-muted, #9aa3ad);
  }

  .share-footer-brand {
    color: var(--accent, #1db954);
    font-weight: 700;
  }
</style>
