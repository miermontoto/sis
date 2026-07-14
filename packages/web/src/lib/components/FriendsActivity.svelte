<script lang="ts">
  import { api, type FriendActivity } from '$lib/api';
  import { goto } from '$app/navigation';
  import { onMount, onDestroy } from 'svelte';

  let friends = $state<FriendActivity[]>([]);
  // no renderizar hasta el primer poll: evita el flash de "discover" en usuarios con friends
  let loaded = $state(false);
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let hoveredId = $state<string | null>(null);

  async function poll() {
    try {
      friends = await api.friendsActivity();
    } catch {
      friends = [];
    } finally {
      loaded = true;
    }
  }

  // el contenedor entero navega al feed; los clics en avatares (anchors) van al perfil
  function openFeed(e: MouseEvent | KeyboardEvent) {
    if (e.target instanceof Element && e.target.closest('a')) return;
    goto('/feed');
  }

  onMount(() => {
    poll();
    intervalId = setInterval(poll, 30_000);
  });

  onDestroy(() => {
    if (intervalId) clearInterval(intervalId);
  });

  function positionTooltip(node: HTMLElement) {
    const parent = node.parentElement!;
    const pr = parent.getBoundingClientRect();
    const gap = 6;

    const tr = node.getBoundingClientRect();
    const pad = 8;

    // vertical: prefer above, fall back to below
    let top: number;
    if (pr.top - gap - tr.height >= 0) {
      top = pr.top - gap - tr.height;
    } else {
      top = pr.bottom + gap;
    }
    node.style.top = `${top}px`;

    // horizontal: center on avatar, clamp to viewport
    let left = pr.left + pr.width / 2 - tr.width / 2;
    left = Math.max(pad, Math.min(left, window.innerWidth - tr.width - pad));
    node.style.left = `${left}px`;
  }
</script>

{#if loaded}
  <div
    class="friends-activity"
    role="link"
    tabindex="0"
    title="Open feed"
    onclick={openFeed}
    onkeydown={(e) => { if (e.key === 'Enter') openFeed(e); }}
  >
    <span class="friends-label">Friends</span>
    {#if friends.length === 0}
      <span class="friends-empty">Discover users in the feed</span>
    {/if}
    <div class="friends-row">
      {#each friends as friend (friend.spotifyId)}
        <a
          class="friend-wrap"
          href="/u/{encodeURIComponent(friend.spotifyId)}"
          onmouseenter={() => hoveredId = friend.spotifyId}
          onmouseleave={() => hoveredId = null}
        >
          {#if friend.imageUrl}
            <img
              class="friend-avatar"
              class:playing={friend.isPlaying}
              src={friend.imageUrl}
              alt={friend.displayName || friend.spotifyId}
            />
          {:else}
            <div
              class="friend-avatar friend-avatar--empty"
              class:playing={friend.isPlaying}
            >
              {(friend.displayName || friend.spotifyId).charAt(0).toUpperCase()}
            </div>
          {/if}
          {#if hoveredId === friend.spotifyId}
            <div class="friend-tooltip" use:positionTooltip>
              <span class="tooltip-name">{friend.displayName || friend.spotifyId}</span>
              {#if friend.track}
                <span class="tooltip-track">{friend.track.name} — {friend.track.artists}</span>
              {:else}
                <span class="tooltip-idle">Not listening</span>
              {/if}
            </div>
          {/if}
        </a>
      {/each}
    </div>
  </div>
{/if}

<style>
  .friends-activity {
    padding: 0.25rem 0;
    cursor: pointer;
  }

  .friends-activity:hover .friends-label,
  .friends-activity:focus-visible .friends-label {
    color: var(--accent);
  }

  .friends-label {
    display: block;
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
    margin-bottom: 0.35rem;
    transition: color 0.15s;
  }

  .friends-empty {
    display: block;
    font-size: 0.7rem;
    color: var(--text-muted);
    font-style: italic;
  }

  .friends-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .friend-wrap {
    position: relative;
    display: block;
  }

  .friend-avatar {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    object-fit: cover;
    border: 2px solid transparent;
    transition: border-color 0.15s, opacity 0.15s;
    opacity: 0.45;
    cursor: pointer;
  }

  .friend-wrap:hover .friend-avatar {
    opacity: 1;
  }

  .friend-avatar.playing {
    border-color: var(--accent);
    opacity: 1;
  }

  .friend-avatar--empty {
    background: var(--bg-hover);
    color: var(--text-muted);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.7rem;
    font-weight: 600;
  }

  .friend-tooltip {
    position: fixed;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 6px 10px;
    white-space: nowrap;
    z-index: 50;
    pointer-events: none;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .tooltip-name {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text);
  }

  .tooltip-track {
    font-size: 0.7rem;
    color: var(--text-muted);
  }

  .tooltip-idle {
    font-size: 0.7rem;
    color: var(--text-muted);
    font-style: italic;
  }
</style>
