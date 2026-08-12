<script lang="ts">
  import { errorMessage } from '$lib/utils/errors';
  import { api, type SearchResults } from '$lib/api';
  import IconTrack from '$lib/icons/IconTrack.svelte';
  import IconAlbum from '$lib/icons/IconAlbum.svelte';

  let { show = $bindable(false), onAdded }: { show: boolean; onAdded?: () => void } = $props();

  // separación mínima (ms) entre plays consecutivos: por encima de la ventana de
  // dedup de 30s del backend, para que varios plays del mismo track no se fusionen
  const MIN_SPACING_MS = 60_000;
  const MAX_PLAYS = 100;

  type Mode = 'search' | 'track' | 'album';
  let mode = $state<Mode>('search');

  // búsqueda
  let query = $state('');
  let results = $state<SearchResults | null>(null);
  let searching = $state(false);
  let inputEl: HTMLInputElement | undefined = $state();
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  // selección
  let pickedTrack = $state<SearchResults['tracks'][number] | null>(null);
  let pickedAlbum = $state<SearchResults['albums'][number] | null>(null);
  let albumTracks = $state<{ trackId: string; name: string; durationMs: number }[]>([]);
  let albumLoading = $state(false);

  // formulario
  let playedAtLocal = $state(nowLocal());
  let plays = $state(1);
  let submitting = $state(false);
  let error = $state('');
  let resultMsg = $state('');

  // valor para <input type="datetime-local"> (hora local, sin zona)
  function nowLocal(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function fmtDuration(ms: number): string {
    const min = Math.round(ms / 60_000);
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? `${h} h ${m} min` : `${h} h`;
  }

  let albumTotalMs = $derived(albumTracks.reduce((sum, t) => sum + (t.durationMs || 0), 0));

  function reset() {
    mode = 'search';
    query = '';
    results = null;
    searching = false;
    pickedTrack = null;
    pickedAlbum = null;
    albumTracks = [];
    plays = 1;
    error = '';
    resultMsg = '';
    playedAtLocal = nowLocal();
  }

  function close() {
    show = false;
    reset();
  }

  function backToSearch() {
    mode = 'search';
    pickedTrack = null;
    pickedAlbum = null;
    albumTracks = [];
    error = '';
    resultMsg = '';
  }

  function doSearch(q: string) {
    api.search(q, 6).then((data) => {
      if (query !== q) return;
      results = data;
      searching = false;
    }).catch(() => { searching = false; });
  }

  $effect(() => {
    const q = query;
    clearTimeout(debounceTimer);
    if (q.length < 2) { results = null; searching = false; return; }
    searching = true;
    debounceTimer = setTimeout(() => doSearch(q), 250);
  });

  // enfocar el buscador al abrir / volver a la búsqueda
  $effect(() => {
    if (show && mode === 'search' && inputEl) {
      setTimeout(() => inputEl?.focus(), 10);
    }
  });

  function pickTrack(t: SearchResults['tracks'][number]) {
    pickedTrack = t;
    mode = 'track';
    playedAtLocal = nowLocal();
    plays = 1;
    error = '';
  }

  async function pickAlbum(a: SearchResults['albums'][number]) {
    pickedAlbum = a;
    mode = 'album';
    playedAtLocal = nowLocal();
    error = '';
    albumLoading = true;
    albumTracks = [];
    try {
      // sort=natural fuerza la tracklist completa (ensureFullAlbumTracks) en orden natural
      const detail = await api.albumDetail(a.id, 'all', 'natural');
      albumTracks = detail.tracks
        .filter(t => t.track)
        .map(t => ({ trackId: t.trackId, name: t.track!.name, durationMs: t.track!.durationMs }));
      if (albumTracks.length === 0) error = 'No tracks found for this album';
    } catch {
      error = 'Failed to load album tracks';
    } finally {
      albumLoading = false;
    }
  }

  // encadena los plays: para un track repetido, separados por MIN_SPACING_MS;
  // para un álbum, cada track empieza tras la duración del anterior
  function buildScrobbles(): { trackId: string; playedAt: string }[] {
    const base = new Date(playedAtLocal).getTime();
    if (Number.isNaN(base)) return [];
    if (mode === 'track' && pickedTrack) {
      const n = Math.max(1, Math.min(Math.floor(plays) || 1, MAX_PLAYS));
      return Array.from({ length: n }, (_, i) => ({
        trackId: pickedTrack!.id,
        playedAt: new Date(base + i * MIN_SPACING_MS).toISOString(),
      }));
    }
    if (mode === 'album') {
      let cursor = base;
      return albumTracks.map(t => {
        const s = { trackId: t.trackId, playedAt: new Date(cursor).toISOString() };
        cursor += Math.max(t.durationMs || 0, MIN_SPACING_MS);
        return s;
      });
    }
    return [];
  }

  async function submit() {
    const scrobbles = buildScrobbles();
    if (scrobbles.length === 0) { error = 'Pick a valid date and time'; return; }
    submitting = true;
    error = '';
    resultMsg = '';
    try {
      const res = await api.addScrobbles(scrobbles);
      resultMsg = res.duplicates > 0
        ? `Added ${res.inserted} of ${res.total} — ${res.duplicates} already existed`
        : `Added ${res.inserted} scrobble${res.inserted === 1 ? '' : 's'}`;
      onAdded?.();
    } catch (e) {
      error = errorMessage(e, 'Failed to add scrobbles');
    } finally {
      submitting = false;
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
  }

  let hasResults = $derived(!!results && (results.tracks.length > 0 || results.albums.length > 0));
  let noResults = $derived(!!results && results.tracks.length === 0 && results.albums.length === 0);
</script>

{#if show}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="scrobble-overlay" onmousedown={(e) => { if (e.target === e.currentTarget) close(); }} onkeydown={onKeydown}>
    <div class="scrobble-modal">
      <div class="scrobble-head">
        {#if mode !== 'search'}
          <button class="head-btn" onclick={backToSearch} title="Back">←</button>
        {/if}
        <span class="scrobble-title">Add scrobble</span>
        <button class="head-btn" onclick={close} title="Close">✕</button>
      </div>

      {#if resultMsg}
        <div class="scrobble-body">
          <div class="done-panel">
            <div class="done-msg">{resultMsg}</div>
            <div class="done-actions">
              <button class="btn btn--primary" onclick={backToSearch}>Add another</button>
              <button class="btn" onclick={close}>Close</button>
            </div>
          </div>
        </div>
      {:else if mode === 'search'}
        <input
          bind:this={inputEl}
          bind:value={query}
          type="text"
          class="scrobble-input"
          placeholder="Search a track or album..."
          autocomplete="off"
          spellcheck="false"
        />
        <div class="scrobble-body scroll">
          {#if searching && !results}
            <div class="pad-center"><div class="spinner"></div></div>
          {:else if hasResults}
            {#if results!.tracks.length > 0}
              <div class="section-title"><IconTrack size={14} /> Tracks</div>
              {#each results!.tracks as track}
                <button class="result" onclick={() => pickTrack(track)}>
                  {#if track.albumImageUrl}
                    <img src={track.albumImageUrl} alt="" class="thumb" loading="lazy" width="40" height="40" />
                  {:else}
                    <div class="thumb thumb--empty"></div>
                  {/if}
                  <div class="result-info">
                    <div class="result-name">{track.name}</div>
                    <div class="result-sub">{track.artistName || 'Track'}</div>
                  </div>
                </button>
              {/each}
            {/if}
            {#if results!.albums.length > 0}
              <div class="section-title"><IconAlbum size={14} /> Albums</div>
              {#each results!.albums as album}
                <button class="result" onclick={() => pickAlbum(album)}>
                  {#if album.imageUrl}
                    <img src={album.imageUrl} alt="" class="thumb" loading="lazy" width="40" height="40" />
                  {:else}
                    <div class="thumb thumb--empty"></div>
                  {/if}
                  <div class="result-info">
                    <div class="result-name">{album.name}</div>
                    <div class="result-sub">{album.artistName || 'Album'}</div>
                  </div>
                </button>
              {/each}
            {/if}
          {:else if noResults && query.length >= 2}
            <div class="pad-center muted">No tracks or albums for "{query}"</div>
          {:else}
            <div class="pad-center muted">Search for a track or a whole album to scrobble.</div>
          {/if}
        </div>
      {:else}
        <!-- config: track o album -->
        <div class="scrobble-body">
          <div class="picked">
            {#if mode === 'track'}
              {#if pickedTrack?.albumImageUrl}
                <img src={pickedTrack.albumImageUrl} alt="" class="picked-art" width="56" height="56" />
              {:else}
                <div class="picked-art picked-art--empty"></div>
              {/if}
              <div class="picked-info">
                <div class="picked-name">{pickedTrack?.name}</div>
                <div class="picked-sub">{pickedTrack?.artistName || 'Track'}</div>
              </div>
            {:else}
              {#if pickedAlbum?.imageUrl}
                <img src={pickedAlbum.imageUrl} alt="" class="picked-art" width="56" height="56" />
              {:else}
                <div class="picked-art picked-art--empty"></div>
              {/if}
              <div class="picked-info">
                <div class="picked-name">{pickedAlbum?.name}</div>
                <div class="picked-sub">
                  {pickedAlbum?.artistName || 'Album'}
                  {#if albumLoading}· loading…{:else if albumTracks.length}· {albumTracks.length} tracks · {fmtDuration(albumTotalMs)}{/if}
                </div>
              </div>
            {/if}
          </div>

          <label class="field">
            <span class="field-label">{mode === 'album' ? 'Album started at' : 'Played at'}</span>
            <input type="datetime-local" class="field-input" bind:value={playedAtLocal} />
          </label>

          {#if mode === 'track'}
            <label class="field">
              <span class="field-label">Number of plays</span>
              <input type="number" class="field-input" bind:value={plays} min="1" max={MAX_PLAYS} />
            </label>
          {:else}
            <p class="hint-text">Tracks are laid out one after another from the start time, each at its own length.</p>
          {/if}

          {#if error}<div class="error-text">{error}</div>{/if}

          <div class="actions">
            <button
              class="btn btn--primary"
              onclick={submit}
              disabled={submitting || (mode === 'album' && (albumLoading || albumTracks.length === 0))}
            >
              {submitting ? 'Adding…' : mode === 'album' ? `Add album (${albumTracks.length})` : plays > 1 ? `Add ${plays} plays` : 'Add scrobble'}
            </button>
            <button class="btn" onclick={backToSearch} disabled={submitting}>Cancel</button>
          </div>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .scrobble-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    z-index: 200;
    display: flex;
    justify-content: center;
    padding-top: 15vh;
  }
  .scrobble-modal {
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
  }
  .scrobble-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.6rem 0.75rem;
    border-bottom: 1px solid var(--border);
  }
  .scrobble-title {
    flex: 1;
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--text);
  }
  .head-btn {
    background: transparent;
    border: none;
    color: var(--text-muted);
    font-size: 1rem;
    line-height: 1;
    padding: 0.2rem 0.4rem;
    cursor: pointer;
    border-radius: var(--radius);
  }
  .head-btn:hover {
    color: var(--text);
    background: var(--bg-hover);
  }
  .scrobble-input {
    width: 100%;
    padding: 0.9rem 1.25rem;
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--border);
    color: var(--text);
    font-size: 1rem;
    font-family: var(--font-sans);
    outline: none;
  }
  .scrobble-input::placeholder { color: var(--text-muted); }
  .scrobble-body { padding: 0.5rem 0; }
  .scrobble-body.scroll { overflow-y: auto; }
  .pad-center { padding: 2rem; text-align: center; }
  .muted { color: var(--text-muted); font-size: 0.9rem; }

  .section-title {
    padding: 0.25rem 1.25rem;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }
  .result {
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
  }
  .result:hover { background: var(--bg-hover); }
  .thumb {
    width: 40px;
    height: 40px;
    border-radius: var(--radius);
    object-fit: cover;
    flex-shrink: 0;
    background: var(--border);
  }
  .thumb--empty { background: var(--border); }
  .result-info { flex: 1; min-width: 0; }
  .result-name {
    font-size: 0.9rem;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .result-sub {
    font-size: 0.8rem;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .picked {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem 1.25rem 1rem;
  }
  .picked-art {
    width: 56px;
    height: 56px;
    border-radius: var(--radius);
    object-fit: cover;
    flex-shrink: 0;
    background: var(--border);
  }
  .picked-art--empty { background: var(--border); }
  .picked-info { min-width: 0; }
  .picked-name {
    font-size: 1rem;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .picked-sub {
    font-size: 0.8rem;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    padding: 0.4rem 1.25rem;
  }
  .field-label {
    font-size: 0.75rem;
    color: var(--text-muted);
  }
  .field-input {
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--text);
    font-size: 0.85rem;
    font-family: var(--font-sans);
    padding: 0.45rem 0.6rem;
    border-radius: var(--radius);
    outline: none;
    color-scheme: dark;
  }
  .field-input:focus { border-color: var(--accent); }

  .hint-text {
    padding: 0.2rem 1.25rem;
    margin: 0;
    font-size: 0.78rem;
    color: var(--text-muted);
  }
  .error-text {
    padding: 0.4rem 1.25rem;
    color: var(--danger);
    font-size: 0.8rem;
  }

  .actions,
  .done-actions {
    display: flex;
    gap: 0.5rem;
    padding: 0.75rem 1.25rem 0.5rem;
  }
  .btn {
    background: var(--bg-card);
    border: 1px solid var(--border);
    color: var(--text-muted);
    font-size: 0.8rem;
    padding: 0.45rem 0.9rem;
    border-radius: var(--radius);
    cursor: pointer;
    font-family: var(--font-sans);
    transition: color 0.05s, border-color 0.05s, background 0.05s;
  }
  .btn:hover:not(:disabled) { color: var(--text); border-color: var(--text-muted); }
  .btn:disabled { opacity: 0.5; cursor: default; }
  .btn--primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
  .btn--primary:hover:not(:disabled) { background: var(--accent-hover); border-color: var(--accent-hover); color: #fff; }

  .done-panel { padding: 1.5rem 1.25rem 0.5rem; text-align: center; }
  .done-msg { font-size: 0.95rem; color: var(--text); margin-bottom: 0.5rem; }
  .done-actions { justify-content: center; }
</style>
