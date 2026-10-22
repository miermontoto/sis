<script lang="ts">
  import { untrack } from 'svelte';
  import { page } from '$app/state';
  import { playlistPicker } from '$lib/stores/playlist-picker.svelte';
  import { playlistMembershipStore } from '$lib/stores/playlist-membership.svelte';
  import { positionPopover } from '$lib/utils/popover';
  import PlaylistPanel from './PlaylistPanel.svelte';

  let popoverEl: HTMLDivElement | undefined = $state();

  let target = $derived(playlistPicker.target);
  // en una lista sin badges (charts, búsqueda) la pertenencia puede no conocerse, y
  // sin ella no se sabe qué playlists ya lo tienen: "añadir" podría duplicarlo
  let inPlaylists = $derived(target ? playlistMembershipStore.get(target.trackId) : undefined);

  // `untrack`: ensure() lee la misma pertenencia que escribe su respuesta
  $effect(() => {
    const id = target?.trackId;
    if (id) untrack(() => playlistMembershipStore.ensure([id]));
  });

  // mousedown y no click: el click que eligió la entrada aún burbujea cuando esto se
  // monta, y un listener de click lo vería y cerraría el selector en el acto
  function onDocPointer(e: MouseEvent) {
    if (popoverEl && popoverEl.contains(e.target as Node)) return;
    playlistPicker.close();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') playlistPicker.close();
  }

  // sin cierre por scroll, a diferencia del menú: en el móvil enfocar el buscador
  // desplaza la página para dejar sitio al teclado
  $effect(() => {
    if (!target) return;
    document.addEventListener('mousedown', onDocPointer, true);
    document.addEventListener('contextmenu', onDocPointer, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocPointer, true);
      document.removeEventListener('contextmenu', onDocPointer, true);
      document.removeEventListener('keydown', onKey);
    };
  });

  // cerrar al cambiar de ruta (los enlaces a cada playlist navegan desde dentro)
  $effect(() => {
    void page.url.pathname;
    playlistPicker.close();
  });
</script>

{#if target}
  {@const trackId = target.trackId}
  <!-- ancla de tamaño cero en el punto del menú: positionPopover coloca el panel
       debajo y lo clampa al viewport, igual que se abría el menú -->
  <div class="playlist-picker-anchor" style="left: {target.x}px; top: {target.y}px;">
    <div class="like-popover" bind:this={popoverEl} use:positionPopover={'below'}>
      {#if inPlaylists}
        <PlaylistPanel
          {trackId}
          {inPlaylists}
          liked={playlistMembershipStore.isLiked(trackId)}
          onToggleLiked={() => playlistMembershipStore.toggleLiked(trackId)}
          onAdd={(pl) => playlistMembershipStore.add(trackId, pl)}
          onRemove={(id) => playlistMembershipStore.remove(trackId, id)}
        />
      {:else}
        <div class="like-popover-inner"><span class="btn-spinner"></span></div>
      {/if}
    </div>
  </div>
{/if}

<style>
  /* la capa del menú contextual al que sustituye: tiene que quedar por encima de los
     modales y de la hoja de now playing, desde donde también se abre */
  .playlist-picker-anchor {
    position: fixed;
    z-index: 500;
  }
</style>
