<script lang="ts">
  import { isAbortError } from '$lib/utils/errors';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { api, createFetchController, type ProfileResponse, type TimeRange } from '$lib/api';
  import { formatDuration, formatNumber, formatSmartDate } from '$lib/utils/format';
  import TrackList from '$lib/components/TrackList.svelte';
  import CoverGrid from '$lib/components/CoverGrid.svelte';
  import { toastStore } from '$lib/stores/toast.svelte';
  import { canShare, publicHref, shareEntity } from '$lib/utils/share';
  import IconShare from '$lib/icons/IconShare.svelte';

  let profile = $state<ProfileResponse | null>(null);
  let loading = $state(true);
  let notFound = $state(false);
  let range = $state<TimeRange>('month');
  let followActing = $state(false);
  const fetchCtrl = createFetchController();

  const RANGES: { key: TimeRange; label: string }[] = [
    { key: 'week', label: '7D' },
    { key: 'month', label: '30D' },
    { key: '3months', label: '3M' },
    { key: '6months', label: '6M' },
    { key: 'year', label: '1Y' },
    { key: 'thisYear', label: 'YTD' },
    { key: 'all', label: 'All' },
  ];

  async function loadData(id: string) {
    const signal = fetchCtrl.reset();
    loading = true;
    notFound = false;
    try {
      const result = await api.socialProfile(id, range, signal);
      if (signal.aborted) return;
      profile = result;
    } catch (e) {
      if (isAbortError(e)) return;
      profile = null;
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
      profile = null;
      prevId = id;
    }
    loadData(id);
  });

  async function toggleFollow() {
    const id = $page.params.id;
    if (!profile || followActing || !id) return;
    followActing = true;
    const wasFollowing = profile.isFollowing;
    profile = { ...profile, isFollowing: !wasFollowing }; // optimista
    try {
      if (wasFollowing) await api.unfollow(id);
      else await api.follow(id);
      toastStore.show(wasFollowing ? 'Unfollowed' : 'Following');
    } catch {
      profile = { ...profile, isFollowing: wasFollowing }; // revertir
      toastStore.show('Error updating follow');
    } finally {
      followActing = false;
    }
  }

  async function shareProfile() {
    const url = publicHref();
    if (canShare()) {
      await shareEntity(profile?.summary.displayName ?? 'Profile', url);
    } else {
      await navigator.clipboard.writeText(url);
      toastStore.show('Link copied');
    }
  }

  let displayName = $derived(profile?.summary.displayName ?? $page.params.id);
</script>

<svelte:head>
  <title>{displayName} — SIS</title>
</svelte:head>

{#if loading && !profile}
  <div class="loading"><div class="spinner"></div></div>
{:else if notFound}
  <div class="empty-state">
    <p>This profile isn't available.</p>
  </div>
{:else if profile}
  <div class="detail-hero-row">
    <div class="detail-hero">
      {#if profile.summary.imageUrl}
        <img class="detail-image detail-image--round profile-avatar" src={profile.summary.imageUrl} alt={displayName} />
      {:else}
        <div class="detail-image detail-image--round detail-image--placeholder profile-avatar"></div>
      {/if}
      <div class="detail-header-info">
        <h1>{displayName}</h1>
        {#if profile.nowPlaying}
          <p class="profile-np">
            <span class="live-dot"></span>
            {profile.nowPlaying.name} — {profile.nowPlaying.artists}
          </p>
        {/if}
      </div>
    </div>
    <div class="hero-actions profile-actions">
      <button class="profile-btn" class:profile-btn--active={profile.isFollowing} disabled={followActing} onclick={toggleFollow}>
        {profile.isFollowing ? 'Following' : 'Follow'}
      </button>
      <button class="profile-btn" onclick={() => goto(`/compare/${$page.params.id}`)}>Compare</button>
      <button class="profile-btn profile-btn--icon" title="Share" onclick={shareProfile}><IconShare /></button>
    </div>
  </div>

  <!-- resumen all-time: no depende del rango seleccionado -->
  <div class="stats-grid profile-stats">
    <div class="card stat-card">
      <div class="stat-value">{formatNumber(profile.summary.totalPlays)}</div>
      <div class="stat-label">Plays</div>
    </div>
    <div class="card stat-card">
      <div class="stat-value">{formatDuration(profile.summary.totalMs)}</div>
      <div class="stat-label">Listening time</div>
    </div>
    <div class="card stat-card">
      <div class="stat-value">{formatNumber(profile.summary.distinctArtists)}</div>
      <div class="stat-label">Artists</div>
    </div>
    <div class="card stat-card">
      <div class="stat-value">{formatNumber(profile.summary.distinctTracks)}</div>
      <div class="stat-label">Tracks</div>
    </div>
    <!-- sólo cuando hay algo que contar: un "0" en la tarjeta de identidad de
         quien no lleva registro de conciertos sería ruido, no un dato -->
    {#if profile.summary.concertsAttended > 0}
      <div class="card stat-card">
        <div class="stat-value">{formatNumber(profile.summary.concertsAttended)}</div>
        <div class="stat-label">Shows seen</div>
      </div>
    {/if}
    {#if profile.summary.firstPlayedAt}
      <div class="card stat-card">
        <div class="stat-value">{formatSmartDate(profile.summary.firstPlayedAt)}</div>
        <div class="stat-label">First play</div>
      </div>
    {/if}
  </div>

  <!-- el rango sólo afecta a los tops de abajo -->
  <div class="profile-ranges">
    {#each RANGES as r}
      <button class="range-btn" class:active={range === r.key} onclick={() => range = r.key}>{r.label}</button>
    {/each}
  </div>

  {#if profile.topArtists.length > 0}
    <section class="profile-section">
      <h2>Top artists</h2>
      <CoverGrid items={profile.topArtists.slice(0, 5).map((a, i) => ({
        href: `/artist/${a.artistId}`,
        rank: i + 1,
        imageUrl: a.artist?.imageUrl,
        name: a.artist?.name ?? a.artistId,
        stat: formatDuration(a.totalMs),
        round: true,
      }))} />
    </section>
  {/if}

  {#if profile.topAlbums.length > 0}
    <section class="profile-section">
      <h2>Top albums</h2>
      <CoverGrid items={profile.topAlbums.slice(0, 5).map((a, i) => ({
        href: `/album/${a.albumId}`,
        rank: i + 1,
        imageUrl: a.album?.imageUrl,
        name: a.album?.name ?? a.albumId,
        stat: formatDuration(a.totalMs),
      }))} />
    </section>
  {/if}

  {#if profile.topTracks.length > 0}
    <section class="profile-section">
      <h2>Top tracks</h2>
      <TrackList items={profile.topTracks} showRank />
    </section>
  {/if}

  {#if profile.topArtists.length === 0 && profile.topTracks.length === 0 && profile.topAlbums.length === 0}
    <div class="empty-state">
      <p>No listening activity in this period.</p>
    </div>
  {/if}
{/if}

<style>
  .profile-avatar {
    object-fit: cover;
  }

  .profile-np {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--text-muted);
    font-size: 0.85rem;
    margin-top: 0.25rem;
  }

  .profile-actions {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }

  .profile-btn {
    background: var(--bg-card);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: var(--radius);
    padding: 0.4rem 0.9rem;
    font-size: 0.8rem;
    cursor: pointer;
    transition: border-color 0.15s, color 0.15s;
  }

  .profile-btn:hover {
    border-color: var(--accent);
  }

  .profile-btn--active {
    border-color: var(--accent);
    color: var(--accent);
  }

  .profile-btn--icon {
    display: flex;
    align-items: center;
    padding: 0.4rem 0.5rem;
  }

  .profile-ranges {
    display: flex;
    gap: 0.25rem;
    margin: 1rem 0;
    flex-wrap: wrap;
  }

  .profile-stats {
    margin-bottom: 1.5rem;
  }

  .profile-section {
    margin-bottom: 1.75rem;
  }

  .profile-section h2 {
    font-size: 0.9rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
    margin-bottom: 0.75rem;
  }
</style>
