<script lang="ts">
  // Detalle de un concierto asistido: hero como el resto de fichas (foto del
  // artista, fondo, acciones), las cifras del setlist y el setlist como lista de
  // tracks con la misma fila (TrackItem) que las demás listas de la app.
  //
  // El matching automático es una heurística por nombre y falla de formas
  // previsibles —títulos repetidos entre discos, directos, temas que no
  // encontró—, así que cada fila se puede reasignar a mano o desvincular: desde
  // su menú contextual y con el botón de la fila (alcanzable con teclado).
  import { isAbortError, errorMessage } from '$lib/utils/errors';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { onMount, untrack } from 'svelte';
  import { api, createFetchController, getArtistBackdrop, type Concert, type ConcertSong } from '$lib/api';
  import type { ArtistBackdrop } from '@sis/shared';
  import { formatCalendarDate, formatCalendarDateLong, formatNumber } from '$lib/utils/format';
  import { extractColor } from '$lib/utils/color';
  import { contextMenu, type ContextMenuAction } from '$lib/stores/context-menu.svelte';
  import { entityContextActions, isSpotifyId } from '$lib/utils/entity-context';
  import { nowPlayingStore } from '$lib/stores/now-playing.svelte';
  import { toastStore } from '$lib/stores/toast.svelte';
  import TrackItem from '$lib/components/TrackItem.svelte';
  import ConcertRow from '$lib/components/ConcertRow.svelte';
  import SearchModal from '$lib/components/SearchModal.svelte';
  import ConcertModal from '$lib/components/ConcertModal.svelte';
  import DetailBackdrop from '$lib/components/DetailBackdrop.svelte';
  import EntityActionsMenu from '$lib/components/EntityActionsMenu.svelte';
  import IconTicket from '$lib/icons/IconTicket.svelte';
  import IconPlay from '$lib/icons/IconPlay.svelte';
  import IconExternalLink from '$lib/icons/IconExternalLink.svelte';
  import IconLink from '$lib/icons/IconLink.svelte';
  import IconEdit from '$lib/icons/IconEdit.svelte';
  import IconTrash from '$lib/icons/IconTrash.svelte';

  const concertId = $derived(Number($page.params.id ?? 0));

  let data = $state<Concert | null>(null);
  // el resto de bolos del mismo artista, para saltar entre ellos
  let otherShows = $state<Concert[]>([]);
  let loading = $state(true);
  let error = $state('');
  let heroColor = $state('');
  let backdropMode = $state<ArtistBackdrop>('blur');
  let busyPosition = $state<number | null>(null);
  let playActing = $state(false);
  // canción cuya atribución se está reasignando (el buscador de tracks es global)
  let editingSong = $state<ConcertSong | null>(null);
  let showTrackPicker = $state(false);
  let showEditModal = $state(false);
  const fetchCtrl = createFetchController();

  async function load(id: number) {
    const signal = fetchCtrl.reset();
    loading = true;
    error = '';
    try {
      const res = await api.concert(id, signal);
      if (signal.aborted) return;
      data = res;
      // fetch aparte no bloqueante: la ficha no depende de él
      api.artistConcerts(res.artistId)
        .then(rows => { if (!signal.aborted) otherShows = rows.filter(c => c.id !== id); })
        .catch(() => {});
      if (res.artistImageUrl) {
        extractColor(res.artistImageUrl).then(([r, g, b]) => {
          if (!signal.aborted) heroColor = `${r},${g},${b}`;
        });
      } else {
        heroColor = '';
      }
    } catch (e) {
      if (isAbortError(e)) return;
      error = errorMessage(e, 'Error loading concert');
    } finally {
      if (!signal.aborted) loading = false;
    }
  }

  let initialized = false;
  let prevId = 0;

  onMount(() => {
    backdropMode = getArtistBackdrop();
    initialized = true;
  });

  // load va en untrack: lee estado que él mismo escribe y se volvería dep
  $effect(() => {
    const id = concertId;
    if (!initialized || !id) return;
    if (id !== prevId) {
      data = null;
      otherShows = [];
      prevId = id;
    }
    untrack(() => load(id));
  });

  let place = $derived(data ? [data.venue, data.city, data.country].filter(Boolean).join(' · ') : '');
  // el "ya te las sabías": canciones del setlist que ya habías escuchado antes
  let knownBefore = $derived(data?.songs.filter(s => (s.playsBefore ?? 0) > 0).length ?? 0);
  let debuts = $derived(data?.songs.filter(s => s.trackId && (s.playsBefore ?? 0) === 0).length ?? 0);
  // el setlist en Spotify: sólo los tracks resueltos con id real, en su orden
  let playableUris = $derived((data?.songs ?? [])
    .filter(s => s.trackId && isSpotifyId(s.trackId))
    .map(s => `spotify:track:${s.trackId}`));
  // posición de la primera canción del bis, para el separador "Encore"
  let encoreStart = $derived(data?.songs.find(s => s.isEncore)?.position ?? -1);

  let heroActions = $derived.by<ContextMenuAction[]>(() => {
    const d = data;
    if (!d) return [];
    const out: ContextMenuAction[] = [];
    const url = d.setlistfmUrl;
    if (url) out.push({ label: 'View on setlist.fm', icon: IconExternalLink, onClick: () => { window.open(url, '_blank'); } });
    out.push({ label: 'Edit concert', icon: IconEdit, onClick: () => { showEditModal = true; } });
    out.push({ label: 'Remove concert', icon: IconTrash, danger: true, onClick: remove });
    return out;
  });

  async function playSetlist() {
    if (playableUris.length === 0) return;
    playActing = true;
    await nowPlayingStore.playContext({ uris: playableUris });
    playActing = false;
  }

  async function reassign(song: ConcertSong, trackId: string | null) {
    if (!data) return;
    busyPosition = song.position;
    try {
      data = await api.setConcertSongTrack(data.id, song.position, trackId);
    } catch (e) {
      toastStore.show(errorMessage(e, 'Error updating attribution'));
    } finally {
      busyPosition = null;
      editingSong = null;
    }
  }

  function openPicker(song: ConcertSong) {
    editingSong = song;
    showTrackPicker = true;
  }

  // menú contextual de una canción: las acciones del track (si lo hay) más la
  // corrección de la atribución
  function songMenu(song: ConcertSong) {
    return (e: MouseEvent) => {
      const actions: ContextMenuAction[] = [];
      if (song.trackId && song.track) {
        actions.push(...entityContextActions({
          type: 'track',
          id: song.trackId,
          name: song.track.name,
          imageUrl: song.track.album?.imageUrl ?? null,
          parentArtistId: song.track.artists[0]?.id,
        }));
      }
      actions.push({
        label: song.trackId ? 'Attribute to another track' : 'Attribute to a track',
        icon: IconLink,
        onClick: () => openPicker(song),
      });
      if (song.trackId) {
        actions.push({ label: 'Remove attribution', icon: IconTrash, danger: true, onClick: () => reassign(song, null) });
      }
      contextMenu.open(e, actions);
    };
  }

  async function remove() {
    const d = data;
    if (!d) return;
    if (!confirm(`Remove ${d.artistName} · ${formatCalendarDate(d.date)}? Its setlist and attributions go with it.`)) return;
    try {
      await api.deleteConcert(d.id);
      goto('/concerts');
    } catch (e) {
      toastStore.show(errorMessage(e, 'Error removing concert'));
    }
  }
</script>

{#if loading && !data}
  <div class="loading"><div class="spinner"></div></div>
{:else if !data}
  <div class="empty-state">{error || 'Concert not found.'}</div>
{:else}
  {@const d = data}
  <DetailBackdrop imageUrl={d.artistImageUrl} color={heroColor} mode={backdropMode} />

  <div class="detail-body">
    <div class="detail-main">
      <div class="detail-hero-row">
        <div class="detail-hero">
          <a class="cover-link" href="/artist/{d.artistId}" aria-label="View artist {d.artistName}">
            {#if d.artistImageUrl}
              <img class="detail-image detail-image--round" src={d.artistImageUrl} alt={d.artistName} />
            {:else}
              <div class="detail-image detail-image--round concert-image--empty"><IconTicket size={32} /></div>
            {/if}
          </a>
          <div class="detail-header-info">
            <div class="data-label">Concert</div>
            <h1>{d.artistName}</h1>
            <p class="detail-subtitle">{formatCalendarDateLong(d.date)}</p>
            {#if place}<p class="detail-meta-line">{place}</p>{/if}
            {#if d.tour}<p class="detail-meta-line">{d.tour}</p>{/if}
          </div>
        </div>
        <div class="hero-actions">
          {#if playableUris.length > 0}
            <button class="play-entity-btn" title="Play the setlist on Spotify" disabled={playActing} onclick={playSetlist}>
              <IconPlay />
            </button>
          {/if}
          <EntityActionsMenu title="Actions" actions={heroActions} />
        </div>
      </div>

      {#if d.songsTotal > 0}
        <div class="stats-grid">
          <div class="card stat-card">
            <div class="stat-value">{formatNumber(d.songsTotal)}</div>
            <div class="stat-label">Songs played</div>
          </div>
          <div class="card stat-card">
            <div class="stat-value">{formatNumber(d.songsMatched)}</div>
            <div class="stat-label">In your library</div>
          </div>
          <div class="card stat-card">
            <div class="stat-value">{formatNumber(knownBefore)}</div>
            <div class="stat-label">Already knew</div>
          </div>
          <div class="card stat-card">
            <div class="stat-value">{formatNumber(debuts)}</div>
            <div class="stat-label">First heard live</div>
          </div>
        </div>

        <h2 class="section-title">Setlist</h2>
        <div class="track-list">
          {#each d.songs as song (song.position)}
            {@const plays = song.playsBefore ?? 0}
            {#if song.position === encoreStart}
              <div class="setlist-divider"><span>Encore</span></div>
            {/if}
            <!-- el div sólo capta el botón derecho; el control accesible es el
                 botón de atribución de la fila -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="setlist-row" class:setlist-row--unmatched={!song.trackId} oncontextmenu={songMenu(song)}>
              <TrackItem
                rank={song.position + 1}
                name={song.name}
                nameHref={song.trackId ? `/track/${song.trackId}` : undefined}
                imageUrl={song.track?.album?.imageUrl}
                imageHref={song.track?.album ? `/album/${song.track.album.id}` : undefined}
              >
                {#snippet subtitle()}
                  {#if song.trackId && song.track}
                    {#each song.track.artists as a, i (a.id)}
                      <a href="/artist/{a.id}" class="artist-link">{a.name}</a>{#if i < song.track.artists.length - 1}{', '}{/if}
                    {/each}
                  {:else}
                    <span class="song-unmatched">Not in your library</span>
                  {/if}
                  {#if song.coverArtist}<span class="song-tag">{song.coverArtist} cover</span>{/if}
                  {#if song.info}<span class="song-info">{song.info}</span>{/if}
                {/snippet}
                {#snippet meta()}
                  <!-- las escuchas previas en acento, como la métrica de cualquier
                       fila; el "primera vez" apagado, que en un setlist de
                       descubrimientos se repite en casi todas -->
                  {#if song.trackId && plays > 0}
                    <div class="track-plays">{formatNumber(plays)} plays</div>
                  {:else if song.trackId}
                    <div class="track-time">First time</div>
                  {/if}
                  <button
                    class="song-action"
                    class:song-action--quiet={!!song.trackId}
                    disabled={busyPosition === song.position}
                    onclick={() => openPicker(song)}
                    title={song.trackId ? 'Attribute to a different track' : 'Attribute to a track in your library'}
                  >
                    {song.trackId ? 'Change' : 'Attribute'}
                  </button>
                {/snippet}
              </TrackItem>
            </div>
          {/each}
        </div>
      {:else}
        <div class="empty-state">
          No setlist for this show. Concerts imported from setlist.fm bring theirs; this one was logged by hand.
        </div>
      {/if}
    </div>

    <aside class="detail-rail">
      {#if d.notes}
        <h2 class="section-title">Notes</h2>
        <div class="card"><p class="concert-notes">{d.notes}</p></div>
      {/if}
      {#if otherShows.length > 0}
        <h2 class="section-title">More shows</h2>
        <div class="track-list">
          {#each otherShows as c (c.id)}
            <ConcertRow concert={c} variant="artist" compact />
          {/each}
        </div>
      {/if}
    </aside>
  </div>

  <SearchModal
    bind:show={showTrackPicker}
    pick={{
      types: ['track'],
      placeholder: editingSong ? `Which track is "${editingSong.name}"?` : 'Search a track…',
      onPick: (entity) => { if (editingSong) reassign(editingSong, entity.id); },
    }}
  />

  <ConcertModal
    bind:show={showEditModal}
    artist={{ id: d.artistId, name: d.artistName }}
    editing={d}
    onSaved={() => load(concertId)}
  />
{/if}

<style>
  .cover-link {
    display: block;
    line-height: 0;
    flex-shrink: 0;
    border-radius: 50%;
    transition: opacity 0.05s;
  }
  .cover-link:hover {
    opacity: 0.85;
  }
  .concert-image--empty {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--accent);
  }

  .concert-notes {
    margin: 0;
    font-size: 0.85rem;
    line-height: 1.5;
    white-space: pre-wrap;
  }

  /* separador del bis dentro de la lista: mismo lenguaje que las etiquetas */
  .setlist-divider {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin-top: 0.5rem;
    font-family: var(--font-mono);
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .setlist-divider::before,
  .setlist-divider::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--border);
  }

  /* canción que no está en la librería: se apaga el nombre, no la fila entera,
     para que el botón de atribuir (la corrección que toca aquí) siga legible */
  .setlist-row--unmatched :global(.track-name) {
    color: var(--text-muted);
  }
  .setlist-row--unmatched :global(.track-art) {
    opacity: 0.5;
  }
  .song-unmatched {
    font-style: italic;
  }
  .song-tag,
  .song-info {
    margin-left: 0.45rem;
    font-size: 0.65rem;
    color: var(--text-muted);
  }
  .song-tag {
    font-family: var(--font-mono);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0 0.3rem;
  }
  .song-info {
    font-style: italic;
  }

  .song-action {
    display: inline-block;
    margin-top: 0.15rem;
    background: none;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 0.62rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 0.1rem 0.45rem;
    cursor: pointer;
    transition: color 0.05s, border-color 0.05s, opacity 0.05s;
  }
  .song-action:hover:not(:disabled) {
    color: var(--accent);
    border-color: var(--accent);
  }
  .song-action:disabled {
    opacity: 0.5;
    cursor: default;
  }
  /* en las filas ya resueltas el control sólo aparece al pasar por encima (o
     con foco): la lista se lee como un setlist, no como un formulario */
  .song-action--quiet {
    opacity: 0;
  }
  .setlist-row:hover .song-action--quiet,
  .song-action--quiet:focus-visible {
    opacity: 1;
  }
  /* sin puntero no hay hover (ni menú contextual garantizado): siempre visible */
  @media (hover: none) {
    .song-action--quiet {
      opacity: 1;
    }
  }
</style>
