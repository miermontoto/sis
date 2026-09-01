<script module lang="ts">
  // Entidad devuelta por el modo "pick". Va en el script de módulo para poder
  // importarse como tipo desde fuera del componente.
  export interface PickedEntity {
    type: 'artist' | 'album' | 'track' | 'playlist';
    id: string;
    name: string;
    imageUrl: string | null;
  }
</script>

<script lang="ts">
  import { goto } from '$app/navigation';
  import { api, type SearchResults } from '$lib/api';
  import { nowPlayingStore } from '$lib/stores/now-playing.svelte';
  import { contextMenu, type ContextMenuAction } from '$lib/stores/context-menu.svelte';
  import { isSpotifyId, openEntityContextMenu, type EntityContext } from '$lib/utils/entity-context';
  import IconPlay from '$lib/icons/IconPlay.svelte';
  import IconChevronRight from '$lib/icons/IconChevronRight.svelte';
  import IconTrack from '$lib/icons/IconTrack.svelte';
  import IconArtist from '$lib/icons/IconArtist.svelte';
  import IconAlbum from '$lib/icons/IconAlbum.svelte';

  // Modo "pick": el mismo buscador, pero eligiendo una entidad en vez de navegar
  // a ella. Lo usa el alta de conciertos para escoger artista. Sin `pick` el
  // componente se comporta exactamente como siempre (la instancia global del
  // layout, atajo de teclado incluido).
  let {
    show = $bindable(false),
    pick,
  }: {
    show: boolean;
    pick?: {
      types: PickedEntity['type'][];
      onPick: (entity: PickedEntity) => void;
      placeholder?: string;
    };
  } = $props();

  // orden de las secciones y tipo de entidad de cada una. En modo pick sólo se
  // pintan (y sólo entran en la navegación con teclado) las de los tipos pedidos
  const SECTION_ORDER = ['playlists', 'artists', 'albums', 'tracks'] as const;
  type Section = typeof SECTION_ORDER[number];
  const SECTION_TYPE: Record<Section, PickedEntity['type']> = {
    playlists: 'playlist', artists: 'artist', albums: 'album', tracks: 'track',
  };
  let visibleSections = $derived(SECTION_ORDER.filter(sec => !pick || pick.types.includes(SECTION_TYPE[sec])));

  let query = $state('');
  let results = $state<SearchResults | null>(null);
  let loading = $state(false);
  let selectedIndex = $state(-1);
  let inputEl: HTMLInputElement | undefined = $state();
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  // items planos para navegación con teclado, en el orden en que se pintan.
  // Llevan nombre e imagen porque en modo pick son lo que se devuelve al caller.
  let flatItems = $derived.by(() => {
    const r = results;
    if (!r) return [];
    const items: PickedEntity[] = [];
    for (const sec of visibleSections) {
      if (sec === 'playlists') for (const p of r.playlists) items.push({ type: 'playlist', id: String(p.id), name: p.name, imageUrl: p.imageUrl });
      else if (sec === 'artists') for (const a of r.artists) items.push({ type: 'artist', id: a.id, name: a.name, imageUrl: a.imageUrl });
      else if (sec === 'albums') for (const a of r.albums) items.push({ type: 'album', id: a.id, name: a.name, imageUrl: a.imageUrl });
      else for (const t of r.tracks) items.push({ type: 'track', id: t.id, name: t.name, imageUrl: t.albumImageUrl });
    }
    return items;
  });

  function close() {
    show = false;
    query = '';
    results = null;
    selectedIndex = -1;
  }

  // en modo pick devuelve la entidad al caller; si no, navega como siempre.
  // `pick` se captura antes de close() porque cerrar limpia el estado del modal
  function navigate(type: string, id: string) {
    if (pick) {
      const chosen = flatItems.find(i => i.type === type && i.id === id);
      const onPick = pick.onPick;
      close();
      if (chosen) onPick(chosen);
      return;
    }
    close();
    if (type === 'playlist') {
      goto(`/playlists/${id}`);
    } else {
      goto(`/${type}/${encodeURIComponent(id)}`);
    }
  }

  // las filas navegan en mousedown (se adelanta al blur del input), así que hay que filtrar
  // el botón derecho: dispara mousedown antes que contextmenu y se llevaría la navegación.
  function onRowMouseDown(e: MouseEvent, type: string, id: string) {
    if (e.button !== 0) return;
    navigate(type, id);
  }

  // el menú contextual global reemplaza al nativo; cerramos el modal antes de cada acción
  function entityMenu(entity: EntityContext) {
    return openEntityContextMenu(entity, close);
  }

  // las playlists no son una entidad del modelo de merges: menú mínimo propio
  function playlistMenu(playlist: SearchResults['playlists'][number]) {
    return (e: MouseEvent) => {
      const actions: ContextMenuAction[] = [];
      if (playlist.spotifyId) {
        const contextUri = `spotify:playlist:${playlist.spotifyId}`;
        actions.push({
          label: 'Play',
          icon: IconPlay,
          onClick: () => {
            close();
            nowPlayingStore.playContext({ context_uri: contextUri });
          },
        });
      }
      actions.push({
        label: 'Open',
        icon: IconChevronRight,
        onClick: () => navigate('playlist', String(playlist.id)),
      });
      contextMenu.open(e, actions);
    };
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, flatItems.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, -1);
    } else if (e.key === 'Enter' && e.shiftKey && !pick) {
      const idx = selectedIndex >= 0 ? selectedIndex : 0;
      const item = flatItems[idx];
      if (item) {
        if (item.type === 'playlist') {
          const pl = results?.playlists.find(p => String(p.id) === item.id);
          if (pl?.spotifyId) {
            e.preventDefault();
            playItem(e, 'playlist', item.id, pl.spotifyId);
          }
        } else if (isSpotifyId(item.id)) {
          e.preventDefault();
          playItem(e, item.type, item.id);
        }
      }
    } else if (e.key === 'Enter') {
      const idx = selectedIndex >= 0 ? selectedIndex : 0;
      const item = flatItems[idx];
      if (item) {
        e.preventDefault();
        navigate(item.type, item.id);
      }
    }
  }

  function doSearch(q: string) {
    if (q.length < 2) {
      results = null;
      loading = false;
      return;
    }
    loading = true;
    const currentQuery = q;
    api.search(q, 5).then((data) => {
      // descartar si el query cambió mientras esperábamos
      if (query !== currentQuery) return;
      results = data;
      selectedIndex = -1;
      loading = false;
    }).catch(() => {
      loading = false;
    });
  }

  $effect(() => {
    if (show && inputEl) {
      // pequeño delay para que el DOM renderice
      setTimeout(() => inputEl?.focus(), 10);
    }
  });

  $effect(() => {
    const q = query;
    clearTimeout(debounceTimer);
    if (q.length < 2) {
      results = null;
      return;
    }
    loading = true;
    debounceTimer = setTimeout(() => doSearch(q), 250);
  });

  // índice flat acumulado para mapear a selectedIndex. Se calcula sobre las
  // secciones VISIBLES: con offsets fijos, ocultar una en modo pick desalinearía
  // la selección con teclado respecto a las filas pintadas
  function flatIndex(section: Section, i: number): number {
    if (!results) return -1;
    let base = 0;
    for (const sec of visibleSections) {
      if (sec === section) return base + i;
      base += results[sec].length;
    }
    return -1;
  }

  // sólo cuentan las secciones visibles: en modo pick, resultados de un tipo que
  // no se puede elegir no son resultados
  let visibleCount = $derived(
    results ? visibleSections.reduce((n, sec) => n + results![sec].length, 0) : 0
  );
  let hasResults = $derived(!!results && visibleCount > 0);
  let noResults = $derived(!!results && visibleCount === 0);

  let playingId = $state<string | null>(null);
  let playError = $state('');

  async function playItem(e: MouseEvent | KeyboardEvent, type: 'artist' | 'album' | 'track' | 'playlist', id: string, spotifyId?: string) {
    // el botón derecho sobre el play deja pasar el contextmenu a la fila
    if (e instanceof MouseEvent && e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    if (playingId) return;
    playingId = id;
    playError = '';
    const opts = type === 'track'
      ? { uris: [`spotify:track:${id}`] }
      : type === 'playlist'
      ? { context_uri: `spotify:playlist:${spotifyId}` }
      : { context_uri: `spotify:${type}:${id}` };
    const result = await nowPlayingStore.playContext(opts);
    if (result && !result.success && result.error === 'no_active_device') {
      playError = 'No active device. Open Spotify to play.';
    }
    playingId = null;
  }
</script>

{#if show}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="search-overlay" onmousedown={(e) => { if (e.button === 0 && e.target === e.currentTarget) close(); }} onkeydown={onKeydown}>
    <div class="search-modal">
      <input
        bind:this={inputEl}
        bind:value={query}
        type="text"
        class="search-input"
        placeholder={pick?.placeholder ?? 'Search artists, albums, tracks, playlists...'}
        autocomplete="off"
        spellcheck="false"
      />

      {#if loading && !results}
        <div class="search-loading"><div class="spinner"></div></div>
      {/if}

      {#if hasResults}
        <div class="search-results">
          {#if visibleSections.includes('playlists') && results!.playlists.length > 0}
            <div class="search-section">
              <div class="search-section-title">Playlists</div>
              {#each results!.playlists as playlist, i}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div
                  class="search-result"
                  class:selected={selectedIndex === flatIndex('playlists', i)}
                  onmousedown={(e) => onRowMouseDown(e, 'playlist', String(playlist.id))}
                  oncontextmenu={pick ? undefined : playlistMenu(playlist)}
                  onmouseenter={() => selectedIndex = flatIndex('playlists', i)}
                >
                  {#if playlist.imageUrl}
                    <img src={playlist.imageUrl} alt="" class="search-thumb" loading="lazy" width="40" height="40" />
                  {:else}
                    <div class="search-thumb search-thumb--empty"></div>
                  {/if}
                  <div class="search-result-info">
                    <div class="search-result-name">{playlist.name}</div>
                    <div class="search-result-sub">{playlist.subtitle}</div>
                  </div>
                  {#if !pick && playlist.spotifyId}
                    <button class="search-play-btn" title="Play" disabled={playingId === String(playlist.id)} onmousedown={(e) => playItem(e, 'playlist', String(playlist.id), playlist.spotifyId!)}>
                      <IconPlay />
                    </button>
                  {/if}
                  <div class="search-result-plays">{playlist.trackCount} tracks</div>
                </div>
              {/each}
            </div>
          {/if}

          {#if visibleSections.includes('artists') && results!.artists.length > 0}
            <div class="search-section">
              <div class="search-section-title"><IconArtist size={14} /> Artists</div>
              {#each results!.artists as artist, i}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div
                  class="search-result"
                  class:selected={selectedIndex === flatIndex('artists', i)}
                  onmousedown={(e) => onRowMouseDown(e, 'artist', artist.id)}
                  oncontextmenu={pick ? undefined : entityMenu({ type: 'artist', id: artist.id, name: artist.name, imageUrl: artist.imageUrl })}
                  onmouseenter={() => selectedIndex = flatIndex('artists', i)}
                >
                  {#if artist.imageUrl}
                    <img src={artist.imageUrl} alt="" class="search-thumb search-thumb--round" loading="lazy" width="40" height="40" />
                  {:else}
                    <div class="search-thumb search-thumb--round search-thumb--empty"></div>
                  {/if}
                  <div class="search-result-info">
                    <div class="search-result-name">{artist.name}</div>
                    <div class="search-result-sub">Artist</div>
                  </div>
                  {#if !pick && isSpotifyId(artist.id)}
                    <button class="search-play-btn" title="Play" disabled={playingId === artist.id} onmousedown={(e) => playItem(e, 'artist', artist.id)}>
                      <IconPlay />
                    </button>
                  {/if}
                  {#if artist.playCount > 0}
                    <div class="search-result-plays">{artist.playCount} plays</div>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}

          {#if visibleSections.includes('albums') && results!.albums.length > 0}
            <div class="search-section">
              <div class="search-section-title"><IconAlbum size={14} /> Albums</div>
              {#each results!.albums as album, i}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div
                  class="search-result"
                  class:selected={selectedIndex === flatIndex('albums', i)}
                  onmousedown={(e) => onRowMouseDown(e, 'album', album.id)}
                  oncontextmenu={pick ? undefined : entityMenu({ type: 'album', id: album.id, name: album.name, imageUrl: album.imageUrl, parentArtistId: album.artistId ?? undefined })}
                  onmouseenter={() => selectedIndex = flatIndex('albums', i)}
                >
                  {#if album.imageUrl}
                    <img src={album.imageUrl} alt="" class="search-thumb" loading="lazy" width="40" height="40" />
                  {:else}
                    <div class="search-thumb search-thumb--empty"></div>
                  {/if}
                  <div class="search-result-info">
                    <div class="search-result-name">{album.name}</div>
                    <div class="search-result-sub">{album.artistName || 'Album'}</div>
                  </div>
                  {#if !pick && isSpotifyId(album.id)}
                    <button class="search-play-btn" title="Play" disabled={playingId === album.id} onmousedown={(e) => playItem(e, 'album', album.id)}>
                      <IconPlay />
                    </button>
                  {/if}
                  {#if album.playCount > 0}
                    <div class="search-result-plays">{album.playCount} plays</div>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}

          {#if visibleSections.includes('tracks') && results!.tracks.length > 0}
            <div class="search-section">
              <div class="search-section-title"><IconTrack size={14} /> Tracks</div>
              {#each results!.tracks as track, i}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div
                  class="search-result"
                  class:selected={selectedIndex === flatIndex('tracks', i)}
                  onmousedown={(e) => onRowMouseDown(e, 'track', track.id)}
                  oncontextmenu={pick ? undefined : entityMenu({ type: 'track', id: track.id, name: track.name, imageUrl: track.albumImageUrl, parentArtistId: track.artistId ?? undefined })}
                  onmouseenter={() => selectedIndex = flatIndex('tracks', i)}
                >
                  {#if track.albumImageUrl}
                    <img src={track.albumImageUrl} alt="" class="search-thumb" loading="lazy" width="40" height="40" />
                  {:else}
                    <div class="search-thumb search-thumb--empty"></div>
                  {/if}
                  <div class="search-result-info">
                    <div class="search-result-name">{track.name}</div>
                    <div class="search-result-sub">{track.artistName || 'Track'}</div>
                  </div>
                  {#if !pick && isSpotifyId(track.id)}
                    <button class="search-play-btn" title="Play" disabled={playingId === track.id} onmousedown={(e) => playItem(e, 'track', track.id)}>
                      <IconPlay />
                    </button>
                  {/if}
                  {#if track.playCount > 0}
                    <div class="search-result-plays">{track.playCount} plays</div>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}

        </div>
      {/if}

      {#if noResults && query.length >= 2}
        <div class="search-empty">No results for "{query}"</div>
      {/if}

      <div class="search-hint">
        {#if playError}
          <span class="search-play-error">{playError}</span>
        {:else}
          <span><kbd>↑↓</kbd> navigate</span>
          <span><kbd>↵</kbd> select</span>
          <span><kbd>⇧↵</kbd> play</span>
          <span><kbd>esc</kbd> close</span>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .search-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    z-index: 200;
    display: flex;
    justify-content: center;
    padding-top: 15vh;
  }

  .search-modal {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    width: 500px;
    max-width: calc(100% - 2rem);
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    align-self: flex-start;
    will-change: transform;
  }

  .search-input {
    width: 100%;
    padding: 1rem 1.25rem;
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--border);
    color: var(--text);
    font-size: 1rem;
    font-family: var(--font-sans);
    outline: none;
  }

  .search-input::placeholder {
    color: var(--text-muted);
  }

  .search-results {
    overflow-y: auto;
    flex: 1;
  }

  .search-section {
    padding: 0.5rem 0;
  }

  .search-section-title {
    padding: 0.25rem 1.25rem;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }

  .search-result {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    padding: 0.5rem 1.25rem;
    border: none;
    background: transparent;
    color: var(--text);
    cursor: pointer;
    text-align: left;
    font-family: var(--font-sans);
    transition: none;
  }

  .search-result:hover,
  .search-result.selected {
    background: var(--bg-hover);
  }

  .search-thumb {
    width: 40px;
    height: 40px;
    border-radius: var(--radius);
    object-fit: cover;
    flex-shrink: 0;
    background: var(--border);
  }

  .search-thumb--round {
    border-radius: 50%;
  }

  .search-thumb--empty {
    background: var(--border);
  }

  .search-result-info {
    flex: 1;
    min-width: 0;
  }

  .search-result-name {
    font-size: 0.9rem;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .search-result-sub {
    font-size: 0.8rem;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .search-play-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: none;
    border-radius: var(--radius);
    background: var(--accent);
    color: #fff;
    cursor: pointer;
    flex-shrink: 0;
    opacity: 0;
    transition: opacity 0.05s, background 0.05s;
  }

  .search-result:hover .search-play-btn,
  .search-result.selected .search-play-btn {
    opacity: 1;
  }

  .search-play-btn:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .search-play-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .search-play-error {
    color: var(--text-muted);
    font-style: italic;
  }

  .search-result-plays {
    font-size: 0.8rem;
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .search-loading {
    padding: 2rem;
    text-align: center;
  }

  .search-empty {
    padding: 2rem;
    text-align: center;
    color: var(--text-muted);
    font-size: 0.9rem;
  }

  .search-hint {
    display: flex;
    gap: 1rem;
    padding: 0.5rem 1.25rem;
    border-top: 1px solid var(--border);
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .search-hint kbd {
    background: var(--bg-hover);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0 0.3rem;
    font-size: 0.7rem;
  }
</style>
