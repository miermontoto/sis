<script lang="ts">
  import { onMount } from 'svelte';
  import { api, type DirectoryUser } from '$lib/api';
  import { formatNumber } from '$lib/utils/format';
  import { toastStore } from '$lib/stores/toast.svelte';

  let users = $state<DirectoryUser[]>([]);
  let loading = $state(true);
  let acting = $state<string | null>(null);

  onMount(async () => {
    try {
      users = await api.socialUsers();
    } catch {
      users = [];
    } finally {
      loading = false;
    }
  });

  async function toggleFollow(user: DirectoryUser) {
    if (acting) return;
    acting = user.spotifyId;
    const wasFollowing = user.isFollowing;
    users = users.map(u => u.spotifyId === user.spotifyId ? { ...u, isFollowing: !wasFollowing } : u);
    try {
      if (wasFollowing) await api.unfollow(user.spotifyId);
      else await api.follow(user.spotifyId);
    } catch {
      users = users.map(u => u.spotifyId === user.spotifyId ? { ...u, isFollowing: wasFollowing } : u);
      toastStore.show('Error updating follow');
    } finally {
      acting = null;
    }
  }
</script>

<svelte:head>
  <title>Users — SIS</title>
</svelte:head>

<div class="page-header">
  <h1>Users</h1>
  <p>Everyone on this instance</p>
</div>

{#if loading}
  <div class="loading"><div class="spinner"></div></div>
{:else if users.length === 0}
  <div class="empty-state">
    <p>No other users here yet.</p>
  </div>
{:else}
  <div class="users-grid">
    {#each users as user (user.spotifyId)}
      <div class="card user-card">
        <a href="/u/{encodeURIComponent(user.spotifyId)}" class="user-link">
          <div class="user-avatar-wrap" class:user-avatar-wrap--live={!!user.nowPlaying}>
            {#if user.imageUrl}
              <img class="user-avatar" src={user.imageUrl} alt={user.displayName || user.spotifyId} />
            {:else}
              <div class="user-avatar user-avatar--empty">
                {(user.displayName || user.spotifyId).charAt(0).toUpperCase()}
              </div>
            {/if}
          </div>
          <div class="user-info">
            <span class="user-name">{user.displayName || user.spotifyId}</span>
            <span class="user-plays">{formatNumber(user.totalPlays)} plays</span>
            {#if user.followsYou}
              <span class="user-badge">Follows you</span>
            {/if}
          </div>
        </a>

        <div class="user-activity">
          {#if user.nowPlaying}
            <div class="user-activity-row">
              {#if user.nowPlaying.albumImageUrl}
                <img class="user-activity-img" src={user.nowPlaying.albumImageUrl} alt="" />
              {/if}
              <div class="user-activity-text">
                <span class="user-activity-label"><span class="live-dot"></span> Listening now</span>
                <span class="user-activity-value">{user.nowPlaying.name} — {user.nowPlaying.artists}</span>
              </div>
            </div>
          {:else if user.topArtist}
            <div class="user-activity-row">
              {#if user.topArtist.imageUrl}
                <img class="user-activity-img user-activity-img--round" src={user.topArtist.imageUrl} alt="" />
              {/if}
              <div class="user-activity-text">
                <span class="user-activity-label">On repeat this month</span>
                <span class="user-activity-value">{user.topArtist.name}</span>
              </div>
            </div>
          {:else}
            <div class="user-activity-row">
              <span class="user-activity-idle">No recent activity</span>
            </div>
          {/if}
        </div>

        <div class="user-actions">
          <button
            class="user-btn"
            class:user-btn--active={user.isFollowing}
            disabled={acting === user.spotifyId}
            onclick={() => toggleFollow(user)}
          >
            {user.isFollowing ? 'Following' : 'Follow'}
          </button>
          <a class="user-btn" href="/compare/{encodeURIComponent(user.spotifyId)}">Compare</a>
        </div>
      </div>
    {/each}
  </div>
{/if}

<style>
  .users-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 0.85rem;
  }

  .user-card {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 1rem 1.1rem;
  }

  .user-link {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    text-decoration: none;
    color: inherit;
    min-width: 0;
  }

  .user-link:hover .user-name {
    color: var(--accent);
  }

  .user-avatar-wrap {
    border-radius: 50%;
    padding: 2px;
    border: 2px solid transparent;
    flex-shrink: 0;
  }

  .user-avatar-wrap--live {
    border-color: var(--accent);
  }

  .user-avatar {
    width: 52px;
    height: 52px;
    border-radius: 50%;
    object-fit: cover;
    display: block;
  }

  .user-avatar--empty {
    background: var(--bg-hover);
    color: var(--text-muted);
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 600;
    font-size: 1.2rem;
  }

  .user-info {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    min-width: 0;
  }

  .user-name {
    font-weight: 700;
    font-size: 0.95rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .user-plays {
    font-size: 0.72rem;
    color: var(--text-muted);
    font-family: var(--font-mono);
  }

  .user-badge {
    font-size: 0.62rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--accent);
  }

  .user-activity {
    border-top: 1px solid var(--border);
    padding-top: 0.6rem;
    min-height: 2.6rem;
  }

  .user-activity-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    min-width: 0;
  }

  .user-activity-img {
    width: 34px;
    height: 34px;
    border-radius: var(--radius);
    object-fit: cover;
    flex-shrink: 0;
  }

  .user-activity-img--round {
    border-radius: 50%;
  }

  .user-activity-text {
    display: flex;
    flex-direction: column;
    gap: 0.05rem;
    min-width: 0;
  }

  .user-activity-label {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.62rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
  }

  .user-activity-value {
    font-size: 0.78rem;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .user-activity-idle {
    font-size: 0.75rem;
    color: var(--text-muted);
    font-style: italic;
  }

  .user-actions {
    display: flex;
    gap: 0.5rem;
  }

  .user-btn {
    flex: 1;
    text-align: center;
    background: var(--bg-card);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: var(--radius);
    padding: 0.4rem 0.8rem;
    font-size: 0.75rem;
    cursor: pointer;
    text-decoration: none;
    transition: border-color 0.15s, color 0.15s;
  }

  .user-btn:hover {
    border-color: var(--accent);
  }

  .user-btn--active {
    border-color: var(--accent);
    color: var(--accent);
  }
</style>
