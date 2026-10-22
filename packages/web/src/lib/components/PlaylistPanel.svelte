<script lang="ts">
  import { onMount } from 'svelte';
  import { api, type PlaylistPresenceItem } from '$lib/api';
  import { playlistMembershipStore } from '$lib/stores/playlist-membership.svelte';
  import IconCheckSmall from '$lib/icons/IconCheckSmall.svelte';
  import IconPlus from '$lib/icons/IconPlus.svelte';
  import IconHeartFilled from '$lib/icons/IconHeartFilled.svelte';

  // contenido del popover de playlists sin su disparador: lo comparten el popover de
  // filas y tarjetas (PlaylistPopover) y el flotante del menú contextual (PlaylistPicker)
  let {
    trackId,
    inPlaylists,
    onAdd,
    onRemove,
    liked,
    onToggleLiked,
  }: {
    // spotify id del track para las mutaciones (null = sin track editable)
    trackId: string | null;
    // playlists que ya contienen el track (fuente de verdad del padre)
    inPlaylists: PlaylistPresenceItem[];
    // callbacks para que el padre actualice inPlaylists de forma optimista
    onAdd: (pl: PlaylistPresenceItem) => void;
    onRemove: (playlistId: number) => void;
    // pertenencia a liked songs (undefined = aún no se sabe). Los liked son otra
    // playlist más en spotify, así que viven en la misma lista
    liked?: boolean;
    // con ella se pinta la fila de Liked Songs y ésta es su acción; sin ella el
    // consumidor ya trae su propio corazón
    onToggleLiked?: () => void;
  } = $props();

  let acting = $state<number | null>(null);
  let search = $state('');

  let ownedIds = $derived(new Set(playlistMembershipStore.owned.map(p => p.id)));
  let inIds = $derived(new Set(inPlaylists.map(p => p.id)));
  // añadibles = propias que aún no contienen el track
  let addablePlaylists = $derived(playlistMembershipStore.owned.filter(p => !inIds.has(p.id)));
  let addSearchResults = $derived.by(() => {
    const q = search.trim().toLowerCase();
    if (!q) return addablePlaylists.slice(0, 3);
    return addablePlaylists.filter(p => p.name.toLowerCase().includes(q));
  });

  async function add(pl: PlaylistPresenceItem) {
    if (!trackId || acting) return;
    acting = pl.id;
    try {
      await api.addTrackToPlaylist(pl.id, trackId);
      onAdd(pl);
    } catch (e) {
      console.error('error al agregar a playlist:', e);
    } finally {
      acting = null;
    }
  }

  async function remove(playlistId: number) {
    if (!trackId || acting) return;
    acting = playlistId;
    try {
      await api.removeTrackFromPlaylist(playlistId, trackId);
      onRemove(playlistId);
    } catch (e) {
      console.error('error al eliminar de playlist:', e);
    } finally {
      acting = null;
    }
  }

  onMount(() => { playlistMembershipStore.loadOwned(); });
</script>

<div class="like-popover-inner">
  {#if onToggleLiked}
    <div class="like-popover-item like-popover-item--owned">
      <span class="like-popover-item-link">
        <span class="like-popover-art like-popover-art--liked"><IconHeartFilled size={12} /></span>
        <span>Liked Songs</span>
      </span>
      <button
        class="like-popover-action"
        class:like-popover-action--remove={liked}
        class:like-popover-action--add={!liked}
        title={liked ? 'Remove from Liked Songs' : 'Save to Liked Songs'}
        onclick={onToggleLiked}
      >
        {#if liked}<IconCheckSmall />{:else}<IconPlus />{/if}
      </button>
    </div>
  {/if}
  {#if inPlaylists.length > 0}
    <div class="like-popover-title">In playlists</div>
  {/if}
  {#each inPlaylists as playlist}
    {#if ownedIds.has(playlist.id)}
      <div class="like-popover-item like-popover-item--owned">
        <a href="/playlists/{playlist.id}" class="like-popover-item-link">
          {#if playlist.imageUrl}
            <img class="like-popover-art" src={playlist.imageUrl} alt={playlist.name} />
          {:else}
            <div class="like-popover-art"></div>
          {/if}
          <span>{playlist.name}</span>
        </a>
        <button
          class="like-popover-action like-popover-action--remove"
          title="Remove from {playlist.name}"
          disabled={acting === playlist.id}
          onclick={() => remove(playlist.id)}
        >
          {#if acting === playlist.id}
            <span class="btn-spinner"></span>
          {:else}
            <IconCheckSmall />
          {/if}
        </button>
      </div>
    {:else}
      <a href="/playlists/{playlist.id}" class="like-popover-item">
        {#if playlist.imageUrl}
          <img class="like-popover-art" src={playlist.imageUrl} alt={playlist.name} />
        {:else}
          <div class="like-popover-art"></div>
        {/if}
        <span>{playlist.name}</span>
      </a>
    {/if}
  {/each}
  {#if trackId && playlistMembershipStore.owned.length > 0}
    <div class="like-popover-search">
      <input
        type="text"
        class="like-popover-search-input"
        placeholder="Add to playlist..."
        bind:value={search}
        onclick={(e) => e.stopPropagation()}
      />
    </div>
    {#each addSearchResults as playlist}
      <div class="like-popover-item like-popover-item--owned">
        <span class="like-popover-item-link">
          {#if playlist.imageUrl}
            <img class="like-popover-art" src={playlist.imageUrl} alt={playlist.name} />
          {:else}
            <div class="like-popover-art"></div>
          {/if}
          <span>{playlist.name}</span>
        </span>
        <button
          class="like-popover-action like-popover-action--add"
          title="Add to {playlist.name}"
          disabled={acting === playlist.id}
          onclick={() => add(playlist)}
        >
          {#if acting === playlist.id}
            <span class="btn-spinner"></span>
          {:else}
            <IconPlus />
          {/if}
        </button>
      </div>
    {/each}
  {/if}
</div>
