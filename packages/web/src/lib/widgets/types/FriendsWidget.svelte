<script lang="ts">
  // lo que escuchan las personas a las que sigues: quien está sonando primero y, si
  // no, su último tema con cuándo. Mismo endpoint y mismo poll (30s) que la tira de
  // avatares del sidebar
  import { api, type FriendActivity } from '$lib/api';
  import { timeAgo } from '$lib/utils/format';
  import { fitRows } from '$lib/utils/fit-rows';
  import WidgetHeader from '../WidgetHeader.svelte';
  import type { WidgetProps } from '../components';

  let { size }: WidgetProps = $props();

  const POLL_MS = 30_000;

  let friends = $state<FriendActivity[]>([]);
  let loaded = $state(false);

  $effect(() => {
    const poll = () => api.friendsActivity()
      .then(f => { friends = f; })
      .catch(() => { friends = []; })
      .finally(() => { loaded = true; });
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => clearInterval(id);
  });

  // sonando primero, luego por actividad más reciente
  let sorted = $derived([...friends].sort((a, b) =>
    Number(b.isPlaying) - Number(a.isPlaying) || (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')));
</script>

<WidgetHeader title="Friends" href="/feed" />
{#if !loaded}
  <div class="w-ghost w-ghost--fill"></div>
{:else if friends.length === 0}
  <p class="w-empty">Follow people from the <a href="/feed" class="section-link">feed</a> to see what they play.</p>
{:else}
  <div class="w-fill fr-list" use:fitRows data-size={size}>
    {#each sorted as f (f.spotifyId)}
      <a class="fr-row" href="/u/{f.spotifyId}">
        <span class="fr-avatar" class:fr-avatar--live={f.isPlaying}>
          {#if f.imageUrl}<img src={f.imageUrl} alt="" loading="lazy" />{:else}{(f.displayName ?? '?').slice(0, 1).toUpperCase()}{/if}
        </span>
        <span class="fr-text">
          <span class="fr-name">{f.displayName ?? f.spotifyId}</span>
          <span class="fr-track">
            {#if f.track}{f.track.name} · {f.track.artists}{:else}—{/if}
          </span>
        </span>
        <span class="fr-when" class:fr-when--live={f.isPlaying}>{f.isPlaying ? 'live' : f.updatedAt ? timeAgo(f.updatedAt) : ''}</span>
      </a>
    {/each}
  </div>
{/if}

<style>
  .fr-list {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }
  .fr-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    min-width: 0;
    text-decoration: none;
    color: inherit;
  }
  .fr-avatar {
    width: 2.1rem;
    height: 2.1rem;
    border-radius: 50%;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    background: var(--bg-placeholder);
    font-weight: 600;
    font-size: var(--fs-sm);
    border: 2px solid transparent;
  }
  .fr-avatar--live { border-color: var(--accent); }
  .fr-avatar img { width: 100%; height: 100%; object-fit: cover; }
  .fr-text {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .fr-name, .fr-track {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .fr-name { font-weight: 600; font-size: var(--fs-sm); }
  .fr-row:hover .fr-name { color: var(--accent); }
  .fr-track { font-size: var(--fs-xs); color: var(--text-muted); }
  .fr-when {
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
    color: var(--text-muted);
    flex-shrink: 0;
  }
  .fr-when--live { color: var(--accent); text-transform: uppercase; }
</style>
