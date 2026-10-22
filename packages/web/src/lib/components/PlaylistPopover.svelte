<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import type { PlaylistPresenceItem } from '$lib/api';
  import { playlistMembershipStore } from '$lib/stores/playlist-membership.svelte';
  import { positionPopover } from '$lib/utils/popover';
  import IconHeartFilled from '$lib/icons/IconHeartFilled.svelte';
  import PlaylistPanel from './PlaylistPanel.svelte';

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
    // una columna de "+" por cada tema de un disco es ruido, no afordancia. Para
    // esos temas la puerta es "Add to playlist" del menú contextual (PlaylistPicker)
    inline?: boolean;
  } = $props();

  // hover-intent: el cierre se retrasa para poder mover el ratón del trigger al
  // popover (posicionado con position: fixed); el click en la badge lo fija aparte
  let hover = $state(false);
  let pinned = $state(false);
  let hideTimer: ReturnType<typeof setTimeout> | null = null;

  let open = $derived(hover || pinned);
  // la marca sólo se pinta cuando SABEMOS que está (undefined = aún cargando)
  let likedMark = $derived(inline && liked === true);

  // las playlists propias se piden al primer hover/click, no al abrir el panel: el "+"
  // vacío de la tarjeta (no inline) depende de que existan antes de abrirlo
  function openHover() {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    hover = true;
    playlistMembershipStore.loadOwned();
  }
  function closeHover() {
    hideTimer = setTimeout(() => { hover = false; }, 120);
  }
  function togglePin() {
    pinned = !pinned;
    if (pinned) playlistMembershipStore.loadOwned();
  }

  // cierra el pin al hacer click fuera del wrap (el popover es descendiente del
  // wrap en el DOM aunque se pinte con position: fixed, así que no cuenta como fuera)
  function handleClickOutside(e: MouseEvent) {
    if (pinned && !(e.target as Element)?.closest('.like-wrap')) pinned = false;
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
  {#if inPlaylists.length > 0 || likedMark || (!inline && trackId && playlistMembershipStore.owned.length > 0)}
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
        <PlaylistPanel {trackId} {inPlaylists} {onAdd} {onRemove} {liked} onToggleLiked={likeButton ? undefined : onToggleLiked} />
      </div>
    {/if}
  {/if}
</div>
