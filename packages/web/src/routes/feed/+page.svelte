<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { api, type FeedResponse, type FeedPlayItem, type DirectoryUser } from '$lib/api';
  import { formatDuration, formatNumber, timeAgo } from '$lib/utils/format';
  import { toastStore } from '$lib/stores/toast.svelte';

  let feed = $state<FeedResponse | null>(null);
  let loading = $state(true);
  let intervalId: ReturnType<typeof setInterval> | null = null;
  // directorio de la instancia filtrado a no-seguidos (sustituye a la vista Users);
  // se congela al cargar: seguir a alguien no lo saca de la lista, permite deshacer
  let discover = $state<DirectoryUser[]>([]);
  let acting = $state<string | null>(null);

  async function poll() {
    try {
      feed = await api.socialFeed();
    } catch {
      // mantener el último estado en errores transitorios
    } finally {
      loading = false;
    }
  }

  async function toggleFollow(user: DirectoryUser) {
    if (acting) return;
    acting = user.spotifyId;
    const wasFollowing = user.isFollowing;
    discover = discover.map(u => u.spotifyId === user.spotifyId ? { ...u, isFollowing: !wasFollowing } : u);
    try {
      if (wasFollowing) await api.unfollow(user.spotifyId);
      else await api.follow(user.spotifyId);
      poll();
    } catch {
      discover = discover.map(u => u.spotifyId === user.spotifyId ? { ...u, isFollowing: wasFollowing } : u);
      toastStore.show('Error updating follow');
    } finally {
      acting = null;
    }
  }

  onMount(() => {
    poll();
    intervalId = setInterval(poll, 30_000);
    api.socialUsers()
      .then(users => { discover = users.filter(u => !u.isFollowing); })
      .catch(() => { discover = []; });
  });

  onDestroy(() => {
    if (intervalId) clearInterval(intervalId);
  });

  // agrupa plays consecutivos del mismo usuario en bloques de sesión
  interface PlayGroup {
    user: FeedPlayItem['user'];
    plays: FeedPlayItem[];
  }

  let playGroups = $derived.by<PlayGroup[]>(() => {
    if (!feed) return [];
    const groups: PlayGroup[] = [];
    for (const play of feed.recentPlays) {
      const last = groups[groups.length - 1];
      if (last && last.user.spotifyId === play.user.spotifyId) {
        last.plays.push(play);
      } else {
        groups.push({ user: play.user, plays: [play] });
      }
    }
    return groups;
  });
</script>

<svelte:head>
  <title>Feed — SIS</title>
</svelte:head>

<div class="page-header">
  <h1>Feed</h1>
  <p>Recent activity from people you follow</p>
</div>

{#if loading && !feed}
  <div class="loading"><div class="spinner"></div></div>
{:else if !feed || feed.users.length === 0}
  <div class="empty-state">
    <p>Nothing here yet — follow someone{#if discover.length > 0}&nbsp;below{/if} to see their activity.</p>
  </div>
{:else}
  <!-- strip de usuarios seguidos: quién está sonando ahora + resumen semanal -->
  <div class="feed-strip">
    {#each feed.users as item (item.user.spotifyId)}
      <a href="/u/{encodeURIComponent(item.user.spotifyId)}" class="strip-user" title={item.nowPlaying ? `${item.nowPlaying.name} — ${item.nowPlaying.artists}` : ''}>
        <div class="strip-avatar-wrap" class:strip-avatar-wrap--live={!!item.nowPlaying}>
          {#if item.user.imageUrl}
            <img class="strip-avatar" src={item.user.imageUrl} alt={item.user.displayName || item.user.spotifyId} />
          {:else}
            <div class="strip-avatar strip-avatar--empty">
              {(item.user.displayName || item.user.spotifyId).charAt(0).toUpperCase()}
            </div>
          {/if}
        </div>
        <span class="strip-name">{item.user.displayName || item.user.spotifyId}</span>
        {#if item.nowPlaying}
          <span class="strip-meta strip-meta--live">{item.nowPlaying.name}</span>
        {:else if item.recentPlays > 0}
          <span class="strip-meta">{formatNumber(item.recentPlays)} plays · {formatDuration(item.recentMs)}</span>
        {:else}
          <span class="strip-meta">quiet week</span>
        {/if}
      </a>
    {/each}
  </div>

  <!-- stream cronológico de plays -->
  {#if playGroups.length === 0}
    <div class="empty-state">
      <p>No plays from your follows yet.</p>
    </div>
  {:else}
    <div class="feed-stream">
      {#each playGroups as group, gi (gi)}
        <div class="stream-group">
          <a href="/u/{encodeURIComponent(group.user.spotifyId)}" class="stream-head">
            {#if group.user.imageUrl}
              <img class="stream-avatar" src={group.user.imageUrl} alt={group.user.displayName || group.user.spotifyId} />
            {:else}
              <div class="stream-avatar stream-avatar--empty">
                {(group.user.displayName || group.user.spotifyId).charAt(0).toUpperCase()}
              </div>
            {/if}
            <span class="stream-user">{group.user.displayName || group.user.spotifyId}</span>
            <span class="stream-time">{timeAgo(group.plays[0].playedAt)}</span>
          </a>
          <div class="stream-tracks">
            {#each group.plays as play (play.playedAt)}
              <div class="stream-track">
                {#if play.track.albumImageUrl}
                  <img class="stream-track-img" src={play.track.albumImageUrl} alt="" />
                {:else}
                  <div class="stream-track-img stream-track-img--empty"></div>
                {/if}
                <div class="stream-track-info">
                  <span class="stream-track-name">{play.track.name}</span>
                  <span class="stream-track-artists">{play.track.artists}</span>
                </div>
                <span class="stream-track-time">{timeAgo(play.playedAt)}</span>
              </div>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  {/if}
{/if}

<!-- usuarios de la instancia aún sin seguir: único punto de descubrimiento -->
{#if discover.length > 0}
  <div class="discover">
    <span class="discover-title">Discover</span>
    <div class="discover-row">
      {#each discover as user (user.spotifyId)}
        <div class="discover-user">
          <a href="/u/{encodeURIComponent(user.spotifyId)}" class="discover-link">
            {#if user.imageUrl}
              <img class="discover-avatar" src={user.imageUrl} alt={user.displayName || user.spotifyId} />
            {:else}
              <div class="discover-avatar discover-avatar--empty">
                {(user.displayName || user.spotifyId).charAt(0).toUpperCase()}
              </div>
            {/if}
            <span class="discover-name">{user.displayName || user.spotifyId}</span>
            <span class="discover-plays">{formatNumber(user.totalPlays)} plays</span>
          </a>
          <button
            class="discover-btn"
            class:discover-btn--active={user.isFollowing}
            disabled={acting === user.spotifyId}
            onclick={() => toggleFollow(user)}
          >
            {user.isFollowing ? 'Following' : 'Follow'}
          </button>
        </div>
      {/each}
    </div>
  </div>
{/if}

<style>
  .feed-strip {
    display: flex;
    gap: 1rem;
    overflow-x: auto;
    padding: 0.25rem 0 0.85rem;
    margin-bottom: 1.25rem;
    border-bottom: 1px solid var(--border);
  }

  .strip-user {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.3rem;
    text-decoration: none;
    color: inherit;
    width: 92px;
    flex-shrink: 0;
  }

  .strip-user:hover .strip-name {
    color: var(--accent);
  }

  .strip-avatar-wrap {
    border-radius: 50%;
    padding: 2px;
    border: 2px solid transparent;
  }

  .strip-avatar-wrap--live {
    border-color: var(--accent);
  }

  .strip-avatar {
    width: 56px;
    height: 56px;
    border-radius: 50%;
    object-fit: cover;
    display: block;
  }

  .strip-avatar--empty {
    background: var(--bg-hover);
    color: var(--text-muted);
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 600;
    font-size: 1.2rem;
  }

  .strip-name {
    font-size: 0.72rem;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }

  .strip-meta {
    font-size: 0.62rem;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
    text-align: center;
  }

  .strip-meta--live {
    color: var(--accent);
  }

  .feed-stream {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    max-width: 640px;
  }

  .stream-group {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
  }

  .stream-head {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.6rem 0.9rem;
    text-decoration: none;
    color: inherit;
    border-bottom: 1px solid var(--border);
  }

  .stream-head:hover .stream-user {
    color: var(--accent);
  }

  .stream-avatar {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
  }

  .stream-avatar--empty {
    background: var(--bg-hover);
    color: var(--text-muted);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.7rem;
    font-weight: 600;
  }

  .stream-user {
    font-size: 0.8rem;
    font-weight: 700;
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .stream-time {
    font-size: 0.68rem;
    color: var(--text-muted);
    font-family: var(--font-mono);
    flex-shrink: 0;
  }

  .stream-tracks {
    display: flex;
    flex-direction: column;
  }

  .stream-track {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    padding: 0.45rem 0.9rem;
  }

  .stream-track:not(:last-child) {
    border-bottom: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
  }

  .stream-track-img {
    width: 34px;
    height: 34px;
    border-radius: var(--radius);
    object-fit: cover;
    flex-shrink: 0;
  }

  .stream-track-img--empty {
    background: var(--border);
  }

  .stream-track-info {
    display: flex;
    flex-direction: column;
    gap: 0.05rem;
    min-width: 0;
    flex: 1;
  }

  .stream-track-name {
    font-size: 0.82rem;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .stream-track-artists {
    font-size: 0.7rem;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .stream-track-time {
    font-size: 0.65rem;
    color: var(--text-muted);
    font-family: var(--font-mono);
    flex-shrink: 0;
  }

  .discover {
    margin-top: 1.5rem;
    padding-top: 0.85rem;
    border-top: 1px solid var(--border);
  }

  .discover-title {
    display: block;
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
    margin-bottom: 0.6rem;
  }

  .discover-row {
    display: flex;
    gap: 1rem;
    overflow-x: auto;
    padding-bottom: 0.25rem;
  }

  .discover-user {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.4rem;
    width: 92px;
    flex-shrink: 0;
  }

  .discover-link {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.3rem;
    text-decoration: none;
    color: inherit;
    max-width: 100%;
  }

  .discover-link:hover .discover-name {
    color: var(--accent);
  }

  .discover-avatar {
    width: 56px;
    height: 56px;
    border-radius: 50%;
    object-fit: cover;
    display: block;
  }

  .discover-avatar--empty {
    background: var(--bg-hover);
    color: var(--text-muted);
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 600;
    font-size: 1.2rem;
  }

  .discover-name {
    font-size: 0.72rem;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }

  .discover-plays {
    font-size: 0.62rem;
    color: var(--text-muted);
    font-family: var(--font-mono);
  }

  .discover-btn {
    background: var(--bg-card);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: var(--radius);
    padding: 0.25rem 0.7rem;
    font-size: 0.68rem;
    cursor: pointer;
    transition: border-color 0.15s, color 0.15s;
  }

  .discover-btn:hover {
    border-color: var(--accent);
  }

  .discover-btn--active {
    border-color: var(--accent);
    color: var(--accent);
  }
</style>
