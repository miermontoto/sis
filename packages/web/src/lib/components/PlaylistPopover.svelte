<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import { api, type PlaylistPresenceItem } from '$lib/api';
  import { positionPopover } from '$lib/utils/popover';
  import IconCheckSmall from '$lib/icons/IconCheckSmall.svelte';
  import IconPlus from '$lib/icons/IconPlus.svelte';
  import IconHeartFilled from '$lib/icons/IconHeartFilled.svelte';

  let {
    trackId,
    inPlaylists,
    onAdd,
    onRemove,
    likeButton,
    liked,
    onToggleLiked,
    inline = false,
  }: {
    // spotify id del track para las mutaciones (null = sin track editable)
    trackId: string | null;
    // playlists que ya contienen el track (fuente de verdad del padre)
    inPlaylists: PlaylistPresenceItem[];
    // callbacks para que el padre actualice inPlaylists de forma optimista
    onAdd: (pl: PlaylistPresenceItem) => void;
    onRemove: (playlistId: number) => void;
    // botón de like: lo inyecta el padre porque su estado/estilo difiere
    likeButton?: Snippet;
    // pertenencia a liked songs (undefined = aún no se sabe). Los liked son otra
    // playlist más en spotify, así que viven en la misma lista
    liked?: boolean;
    // sin `likeButton` el consumidor no ofrece corazón propio, así que el popover
    // pone la fila de Liked Songs y ésta es su acción
    onToggleLiked?: (() => void);
    // variante de fila de lista: el badge va en flujo (no hay corazón del que
    // colgarse) y sólo afirma pertenencia, así que sin playlists no se pinta —
    // una columna de "+" por cada tema de un disco es ruido, no afordancia
    inline?: boolean;
  } = $props();

  // playlists propias/editables del usuario (independientes del track); se cargan
  // una sola vez de forma perezosa la primera vez que se abre el popover
  let ownedPlaylists = $state<PlaylistPresenceItem[]>([]);
  let ownedLoaded = false;
  let acting = $state<number | null>(null);
  let search = $state('');

  // hover-intent: el cierre se retrasa para poder mover el ratón del trigger al
  // popover (posicionado con position: fixed); el click en la badge lo fija aparte
  let hover = $state(false);
  let pinned = $state(false);
  let hideTimer: ReturnType<typeof setTimeout> | null = null;

  let open = $derived(hover || pinned);
  // la marca sólo se pinta cuando SABEMOS que está (undefined = aún cargando)
  let likedMark = $derived(inline && liked === true);
  // el corazón lo pone el popover sólo si el consumidor no trae el suyo
  let showLikedRow = $derived(!!onToggleLiked && !likeButton);
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
        .map(p => ({ id: p.id, spotifyId: p.spotifyId, name: p.name, imageUrl: p.imageUrl, isOwned: true }));
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

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="like-wrap" class:like-wrap--inline={inline} onmouseenter={openHover} onmouseleave={closeHover}>
  {@render likeButton?.()}
  {#if inPlaylists.length > 0 || likedMark || (!inline && trackId && ownedPlaylists.length > 0)}
    <!-- el corazón afirma un hecho distinto de la cifra (estar en los liked no es
         estar en N playlists), así que son dos marcas, no una suma. Click en
         cualquiera abre el popover, que es donde se quita y se pone -->
    {#if likedMark}
      <button type="button" class="like-badge like-badge--heart" title="In Liked Songs" onclick={togglePin}>
        <IconHeartFilled size={10} />
      </button>
    {/if}
    {#if inPlaylists.length > 0 || !inline}
      <button
        type="button"
        class="like-badge"
        class:like-badge--empty={inPlaylists.length === 0}
        title={inPlaylists.length > 0 ? `In ${inPlaylists.length} playlist${inPlaylists.length > 1 ? 's' : ''}` : 'Add to playlist'}
        onclick={togglePin}
      >+{#if inPlaylists.length > 0}{inPlaylists.length}{/if}</button>
    {/if}
    {#if open}
      <div class="like-popover" use:positionPopover>
        <div class="like-popover-inner">
          {#if showLikedRow}
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
