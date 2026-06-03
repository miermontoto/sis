<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { api, type FeedResponse, type FeedPlayItem } from '$lib/api';
  import { formatDuration, formatNumber, timeAgo } from '$lib/utils/format';

  let feed = $state<FeedResponse | null>(null);
  let loading = $state(true);
  let intervalId: ReturnType<typeof setInterval> | null = null;

  async function poll() {
    try {
      feed = await api.socialFeed();
    } catch {
      // mantener el último estado en errores transitorios
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    poll();
    intervalId = setInterval(poll, 30_000);
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
    <p>Nothing here yet — follow someone from <a href="/users">Users</a> to see their activity.</p>
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
</style>
