<script lang="ts">
  // Detalle de un concierto asistido: el setlist como lista de tracks, con la
  // misma fila (TrackItem) que el resto de listas de la app, más la atribución
  // editable de cada canción.
  //
  // El matching automático es una heurística por nombre y falla de formas
  // previsibles —títulos repetidos entre discos, directos, temas que no
  // encontró—, así que cada fila se puede reasignar a mano o desvincular.
  import { isAbortError, errorMessage } from '$lib/utils/errors';
  import { page } from '$app/stores';
  import { onMount, untrack } from 'svelte';
  import { api, createFetchController, type Concert, type ConcertSong } from '$lib/api';
  import { formatCalendarDate, formatNumber } from '$lib/utils/format';
  import TrackItem from '$lib/components/TrackItem.svelte';
  import SearchModal from '$lib/components/SearchModal.svelte';
  import ConcertModal from '$lib/components/ConcertModal.svelte';
  import IconTicket from '$lib/icons/IconTicket.svelte';
  import IconExternalLink from '$lib/icons/IconExternalLink.svelte';

  const concertId = $derived(Number($page.params.id ?? 0));

  let data = $state<Concert | null>(null);
  let loading = $state(true);
  let error = $state('');
  let busyPosition = $state<number | null>(null);
  // canción cuya atribución se está reasignando (el buscador de tracks es global)
  let editingSong = $state<ConcertSong | null>(null);
  let showTrackPicker = $state(false);
  let showEditModal = $state(false);
  const fetchCtrl = createFetchController();

  async function load(id: number) {
    const signal = fetchCtrl.reset();
    loading = true;
    try {
      const res = await api.concert(id, signal);
      if (signal.aborted) return;
      data = res;
    } catch (e) {
      if (isAbortError(e)) return;
      error = errorMessage(e, 'Error loading concert');
    } finally {
      if (!signal.aborted) loading = false;
    }
  }

  let initialized = false;
  onMount(() => { initialized = true; });

  $effect(() => {
    const id = concertId;
    if (!initialized || !id) return;
    untrack(() => load(id));
  });

  let place = $derived(data ? [data.venue, data.city, data.country].filter(Boolean).join(' · ') : '');
  // el "ya te las sabías": canciones del setlist que ya habías escuchado antes
  let knownBefore = $derived(data?.songs.filter(s => (s.playsBefore ?? 0) > 0).length ?? 0);
  let debuts = $derived(data?.songs.filter(s => s.trackId && (s.playsBefore ?? 0) === 0).length ?? 0);

  async function reassign(trackId: string | null) {
    const song = editingSong;
    if (!data || !song) return;
    busyPosition = song.position;
    error = '';
    try {
      data = await api.setConcertSongTrack(data.id, song.position, trackId);
    } catch (e) {
      error = errorMessage(e, 'Error updating attribution');
    } finally {
      busyPosition = null;
      editingSong = null;
    }
  }

  function openPicker(song: ConcertSong) {
    editingSong = song;
    showTrackPicker = true;
  }

  // subtítulo de cada fila: artistas si hay track, y el motivo si no lo hay
  const artistNames = (song: ConcertSong) => song.track?.artists.map(a => a.name).join(', ') ?? '';
</script>

{#if loading && !data}
  <div class="loading"><div class="spinner"></div></div>
{:else if error && !data}
  <div class="concert-error">{error}</div>
{:else if data}
  {@const d = data}
  <div class="concert-hero">
    <a class="concert-hero-art" href="/artist/{d.artistId}" title={d.artistName}>
      {#if d.artistImageUrl}
        <img src={d.artistImageUrl} alt="" />
      {:else}
        <div class="concert-hero-art--empty"><IconTicket size={28} /></div>
      {/if}
    </a>
    <div class="concert-hero-info">
      <div class="concert-hero-eyebrow">Concert</div>
      <h1><a href="/artist/{d.artistId}">{d.artistName}</a></h1>
      <div class="concert-hero-meta">
        {formatCalendarDate(d.date)}{place ? ` · ${place}` : ''}
      </div>
      {#if d.tour}<div class="concert-hero-tour">{d.tour}</div>{/if}
      {#if d.notes}<p class="concert-hero-notes">{d.notes}</p>{/if}
    </div>
    <div class="concert-hero-actions">
      {#if d.setlistfmUrl}
        <a class="concert-action-btn" href={d.setlistfmUrl} target="_blank" rel="noopener" title="View on setlist.fm">
          <IconExternalLink />
        </a>
      {/if}
      <button class="concert-action-btn" onclick={() => (showEditModal = true)} title="Edit concert">✎</button>
    </div>
  </div>

  {#if error}<div class="concert-error">{error}</div>{/if}

  {#if d.songsTotal > 0}
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value">{formatNumber(d.songsTotal)}</div>
        <div class="stat-label">Songs played</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{formatNumber(d.songsMatched)}</div>
        <div class="stat-label">In your library</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{formatNumber(knownBefore)}</div>
        <div class="stat-label">Already knew</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{formatNumber(debuts)}</div>
        <div class="stat-label">First heard live</div>
      </div>
    </div>

    <h2 class="section-title">Setlist</h2>
    <div class="track-list">
      {#each d.songs as song (song.position)}
        {@const plays = song.playsBefore ?? 0}
        <TrackItem
          rank={song.position + 1}
          name={song.name}
          nameHref={song.trackId ? `/track/${song.trackId}` : undefined}
          imageUrl={song.track?.album?.imageUrl}
          imageHref={song.track?.album ? `/album/${song.track.album.id}` : undefined}
          dimmed={!song.trackId}
          entity={song.trackId && song.track
            ? { type: 'track', id: song.trackId, name: song.track.name, imageUrl: song.track.album?.imageUrl ?? null }
            : undefined}
        >
          {#snippet subtitle()}
            {#if song.trackId}
              {artistNames(song)}
            {:else}
              <span class="song-unmatched">Not in your library</span>
            {/if}
            {#if song.isEncore}<span class="song-tag">encore</span>{/if}
            {#if song.coverArtist}<span class="song-tag">{song.coverArtist} cover</span>{/if}
            {#if song.info}<span class="song-info">{song.info}</span>{/if}
          {/snippet}
          {#snippet meta()}
            <div class="song-meta">
              {#if song.trackId}
                <div class="song-plays" title="Plays before this show">
                  {plays === 0 ? 'first time' : `${formatNumber(plays)} plays`}
                </div>
              {/if}
              <button
                class="song-attribute"
                disabled={busyPosition === song.position}
                onclick={() => openPicker(song)}
                title={song.trackId ? 'Attribute to a different track' : 'Attribute to a track'}
              >
                {song.trackId ? 'Reattribute' : 'Attribute'}
              </button>
            </div>
          {/snippet}
        </TrackItem>
      {/each}
    </div>
  {:else}
    <p class="concert-empty">
      No setlist for this show. Concerts imported from setlist.fm bring theirs; this one was added manually.
    </p>
  {/if}

  <SearchModal
    bind:show={showTrackPicker}
    pick={{
      types: ['track'],
      placeholder: editingSong ? `Which track is "${editingSong.name}"?` : 'Search a track…',
      onPick: (entity) => reassign(entity.id),
    }}
  />

  <ConcertModal
    bind:show={showEditModal}
    artist={{ id: d.artistId, name: d.artistName }}
    editing={d}
    onSaved={() => load(concertId)}
  />

  {#if editingSong && !showTrackPicker && busyPosition === null}
    <!-- el buscador se cerró sin elegir: ofrecer desvincular es la otra
         corrección posible cuando el matcher se inventó un parecido -->
    <div class="unlink-bar">
      <span>"{editingSong.name}"</span>
      {#if editingSong.trackId}
        <button onclick={() => reassign(null)}>Remove attribution</button>
      {/if}
      <button onclick={() => (editingSong = null)}>Cancel</button>
    </div>
  {/if}
{/if}

<style>
  .concert-hero {
    display: flex;
    align-items: center;
    gap: 1.25rem;
    margin-bottom: 1.5rem;
  }
  .concert-hero-art img,
  .concert-hero-art--empty {
    width: 96px;
    height: 96px;
    border-radius: 50%;
    object-fit: cover;
    display: block;
    flex-shrink: 0;
  }
  .concert-hero-art--empty {
    background: var(--bg-card);
    border: 1px solid var(--border);
    color: var(--accent);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .concert-hero-info { flex: 1; min-width: 0; }
  .concert-hero-eyebrow {
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--accent);
  }
  .concert-hero-info h1 {
    margin: 0.1rem 0 0.2rem;
    font-size: 1.7rem;
    line-height: 1.15;
  }
  .concert-hero-info h1 a {
    color: inherit;
    text-decoration: none;
  }
  .concert-hero-info h1 a:hover { color: var(--accent); }
  .concert-hero-meta {
    color: var(--text-muted);
    font-size: 0.9rem;
  }
  .concert-hero-tour {
    color: var(--text-muted);
    font-size: 0.8rem;
    font-style: italic;
  }
  .concert-hero-notes {
    margin: 0.4rem 0 0;
    font-size: 0.82rem;
    color: var(--text-muted);
    white-space: pre-wrap;
  }
  .concert-hero-actions {
    display: flex;
    gap: 0.3rem;
    align-self: flex-start;
  }
  .concert-action-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 32px;
    min-width: 32px;
    border-radius: var(--radius);
    background: none;
    border: 1px solid var(--border);
    color: var(--text-muted);
    font: inherit;
    cursor: pointer;
    text-decoration: none;
  }
  .concert-action-btn:hover { color: var(--text); border-color: var(--text-muted); }

  .concert-error {
    color: #ff4444;
    font-size: 0.85rem;
    margin-bottom: 1rem;
  }
  .concert-empty {
    color: var(--text-muted);
    font-size: 0.85rem;
  }

  .song-unmatched { font-style: italic; }
  .song-tag,
  .song-info {
    margin-left: 0.4rem;
    font-size: 0.72rem;
    color: var(--text-muted);
  }
  .song-tag {
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 0 0.35rem;
  }
  .song-info { font-style: italic; }

  .song-meta {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex-shrink: 0;
  }
  .song-plays {
    font-size: 0.75rem;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  /* el control de atribución sólo aparece al pasar por encima: la lista se lee
     como un setlist, no como un formulario */
  .song-attribute {
    background: none;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text-muted);
    font: inherit;
    font-size: 0.7rem;
    padding: 0.1rem 0.45rem;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.05s, color 0.05s;
  }
  :global(.track-item:hover) .song-attribute,
  .song-attribute:focus-visible { opacity: 1; }
  .song-attribute:hover { color: var(--accent); border-color: var(--accent); }
  .song-attribute:disabled { opacity: 0.5; cursor: default; }

  .unlink-bar {
    position: fixed;
    bottom: 1.25rem;
    left: 50%;
    transform: translateX(-50%);
    z-index: 120;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.5rem 0.9rem;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 999px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
    font-size: 0.8rem;
  }
  .unlink-bar button {
    background: none;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text-muted);
    font: inherit;
    font-size: 0.75rem;
    padding: 0.15rem 0.6rem;
    cursor: pointer;
  }
  .unlink-bar button:hover { color: var(--text); }
</style>
