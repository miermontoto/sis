<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import { api } from '$lib/api';
  import { positionPopover } from '$lib/utils/popover';
  import IconCheckSmall from '$lib/icons/IconCheckSmall.svelte';
  import IconPlus from '$lib/icons/IconPlus.svelte';

  // referencia mínima de playlist, común a now-playing y detalle de track
  type PlaylistRef = { id: number; spotifyId: string; name: string; imageUrl: string | null };

  let {
    trackId,
    inPlaylists,
    onAdd,
    onRemove,
    likeButton,
  }: {
    // spotify id del track para las mutaciones (null = sin track editable)
    trackId: string | null;
    // playlists que ya contienen el track (fuente de verdad del padre)
    inPlaylists: PlaylistRef[];
    // callbacks para que el padre actualice inPlaylists de forma optimista
    onAdd: (pl: PlaylistRef) => void;
    onRemove: (playlistId: number) => void;
    // botón de like: lo inyecta el padre porque su estado/estilo difiere
    likeButton?: Snippet;
  } = $props();

  // playlists propias/editables del usuario (independientes del track); se cargan
  // una sola vez de forma perezosa la primera vez que se abre el popover
  let ownedPlaylists = $state<PlaylistRef[]>([]);
  let ownedLoaded = false;
  let acting = $state<number | null>(null);
  let search = $state('');

  // hover-intent: el cierre se retrasa para poder mover el ratón del trigger al
  // popover (posicionado con position: fixed); el click en la badge lo fija aparte
  let hover = $state(false);
  let pinned = $state(false);
  let hideTimer: ReturnType<typeof setTimeout> | null = null;

  let open = $derived(hover || pinned);
  let ownedIds = $derived(new Set(ownedPlaylists.map(p => p.id)));
  let inIds = $derived(new Set(inPlaylists.map(p => p.id)));
  // añadibles = propias que aún no contienen el track
  let addablePlaylists = $derived(ownedPlaylists.filter(p => !inIds.has(p.id)));
  let addSearchResults = $derived.by(() => {
    const q = search.trim().toLowerCase();
    if (!q) return addablePlaylists.slice(0, 3);
    return addablePlaylists.filter(p => p.name.toLowerCase().includes(q));
  });

  async function loadOwned() {
    if (ownedLoaded) return;
    ownedLoaded = true;
    try {
      const res = await api.libraryPlaylists(200, 0);
      ownedPlaylists = res.items
        .filter(p => p.isOwned)
        .map(p => ({ id: p.id, spotifyId: p.spotifyId, name: p.name, imageUrl: p.imageUrl }));
    } catch {
      ownedLoaded = false; // permite reintentar en el próximo open
      ownedPlaylists = [];
    }
  }

  function openHover() {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    hover = true;
    loadOwned();
  }
  function closeHover() {
    hideTimer = setTimeout(() => { hover = false; }, 120);
  }
  function togglePin() {
    pinned = !pinned;
    if (pinned) loadOwned();
    else search = '';
  }

  async function add(pl: PlaylistRef) {
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

  // cierra el pin al hacer click fuera del wrap (el popover es descendiente del
  // wrap en el DOM aunque se pinte con position: fixed, así que no cuenta como fuera)
  function handleClickOutside(e: MouseEvent) {
    if (pinned && !(e.target as Element)?.closest('.like-wrap')) {
      pinned = false;
      search = '';
    }
  }

  onMount(() => {
    document.addEventListener('click', handleClickOutside);
    return () => {
      document.removeEventListener('click', handleClickOutside);
      if (hideTimer) clearTimeout(hideTimer);
    };
  });
</script>

<div class="like-wrap" onmouseenter={openHover} onmouseleave={closeHover}>
  {@render likeButton?.()}
  {#if inPlaylists.length > 0 || (trackId && ownedPlaylists.length > 0)}
    <span class="like-badge" onclick={togglePin}>{#if inPlaylists.length > 0}+{inPlaylists.length}{/if}</span>
    {#if open}
      <div class="like-popover" use:positionPopover>
        <div class="like-popover-inner">
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
          {#if trackId && ownedPlaylists.length > 0}
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
      </div>
    {/if}
  {/if}
</div>
