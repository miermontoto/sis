<script lang="ts">
  // Alta / edición de un concierto asistido. Dos vías: importar de setlist.fm
  // (con la fecha, el recinto y el setlist ya resueltos) o darlo de alta a mano.
  // La búsqueda es la pestaña por defecto sólo si el servidor tiene credenciales;
  // si no las tiene, el modal abre directamente en manual — un buscador vacío sin
  // explicación sería el peor sitio donde dejar al usuario.
  import { errorMessage } from '$lib/utils/errors';
  import { api, type Concert, type SetlistfmShow } from '$lib/api';
  import { formatCalendarDate } from '$lib/utils/format';
  import IconTicket from '$lib/icons/IconTicket.svelte';

  let {
    show = $bindable(false),
    artist,
    editing = null,
    onSaved = () => {},
  }: {
    show: boolean;
    // null = abierto sin contexto de artista (página global): el modal pide
    // primero a quién fuiste a ver
    artist: { id: string; name: string } | null;
    editing?: Concert | null;
    onSaved?: (concert: Concert | null) => void;
  } = $props();

  type Tab = 'setlistfm' | 'manual';

  // artista elegido en el buscador cuando el modal se abre sin contexto
  let picked = $state<{ id: string; name: string } | null>(null);
  let artistQuery = $state('');
  let artistResults = $state<{ id: string; name: string; imageUrl: string | null; playCount: number }[]>([]);
  let artistSearching = $state(false);
  let target = $derived(artist ?? picked);

  let tab = $state<Tab>('setlistfm');
  let error = $state('');
  let saving = $state(false);

  // setlist.fm
  let shows = $state<SetlistfmShow[]>([]);
  let importedIds = $state<string[]>([]);
  let configured = $state(true);
  let page = $state(1);
  let totalPages = $state(0);
  let searching = $state(false);
  let importingId = $state('');
  let loadedKey = '';

  // formulario manual
  let date = $state('');
  let venue = $state('');
  let city = $state('');
  let country = $state('');
  let tour = $state('');
  let notes = $state('');

  function resetForm() {
    date = editing?.date ?? '';
    venue = editing?.venue ?? '';
    city = editing?.city ?? '';
    country = editing?.country ?? '';
    tour = editing?.tour ?? '';
    notes = editing?.notes ?? '';
  }

  function close() {
    show = false;
    error = '';
    picked = null;
    artistQuery = '';
    artistResults = [];
  }

  // búsqueda de artista para el alta desde la página global. Se apoya en el
  // buscador global (sólo devuelve entidades con escuchas), que es exactamente
  // el pool válido: no se puede registrar un bolo de alguien que no está en la
  // librería porque el concierto cuelga de un artista existente
  async function searchArtists() {
    const q = artistQuery.trim();
    if (!q) { artistResults = []; return; }
    artistSearching = true;
    try {
      artistResults = (await api.search(q, 8)).artists;
    } catch (e) {
      error = errorMessage(e, 'Error searching artists');
    } finally {
      artistSearching = false;
    }
  }

  function pickArtist(a: { id: string; name: string }) {
    picked = a;
    error = '';
    loadShows(1);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && show) close();
  }

  async function loadShows(targetPage: number) {
    if (!target) return;
    searching = true;
    error = '';
    try {
      const res = await api.setlistfmShows(target!.id, targetPage);
      configured = res.configured;
      shows = res.shows;
      importedIds = res.importedIds;
      page = res.page;
      totalPages = res.totalPages;
      // sin credenciales no hay nada que buscar: el alta manual es la única vía
      if (!res.configured) tab = 'manual';
    } catch (e) {
      error = errorMessage(e, 'Error searching setlist.fm');
      shows = [];
    } finally {
      searching = false;
    }
  }

  async function importShow(showId: string) {
    importingId = showId;
    error = '';
    try {
      const created = await api.importSetlist(target!.id, showId);
      importedIds = [...importedIds, showId];
      onSaved(created);
      close();
    } catch (e) {
      error = errorMessage(e, 'Error importing setlist');
    } finally {
      importingId = '';
    }
  }

  async function submitManual(e: SubmitEvent) {
    e.preventDefault();
    if (saving || !date || !target) return;
    saving = true;
    error = '';
    const fields = {
      date,
      venue: venue.trim() || null,
      city: city.trim() || null,
      country: country.trim() || null,
      tour: tour.trim() || null,
      notes: notes.trim() || null,
    };
    try {
      const saved = editing
        ? await api.updateConcert(editing.id, fields)
        : await api.createConcert({ artistId: target!.id, ...fields });
      onSaved(saved);
      close();
    } catch (err) {
      error = errorMessage(err, 'Error saving concert');
    } finally {
      saving = false;
    }
  }

  // al abrir: editar entra siempre en manual y prellena; dar de alta arranca en
  // la búsqueda y la carga una sola vez por artista (loadedKey)
  $effect(() => {
    if (!show) return;
    resetForm();
    if (editing) {
      tab = 'manual';
      return;
    }
    tab = 'setlistfm';
    // sin artista todavía no hay nada que buscar: el paso de selección va antes
    if (!target) return;
    if (loadedKey !== target.id) {
      loadedKey = target.id;
      loadShows(1);
    }
  });

  let location = $derived((s: SetlistfmShow) => [s.venue, s.city, s.country].filter(Boolean).join(' · '));
</script>

<svelte:window onkeydown={onKey} />

{#if show}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="concert-overlay" onmousedown={(e) => { if (e.target === e.currentTarget) close(); }}>
    <div class="concert-modal">
      <div class="concert-header">
        <h3>{editing ? 'Edit concert' : 'Add concert'}</h3>
        <button class="concert-close" onclick={close} aria-label="Close">&times;</button>
      </div>

      {#if target}
        <div class="concert-target">
          <IconTicket size={18} />
          <span>{target.name}</span>
          {#if !artist && !editing}
            <button class="concert-change-artist" onclick={() => { picked = null; loadedKey = ''; }}>Change</button>
          {/if}
        </div>
      {/if}

      {#if !target}
        <!-- paso previo del alta global: elegir el artista -->
        <div class="concert-picker">
          <input
            type="search"
            class="concert-search"
            placeholder="Search an artist…"
            bind:value={artistQuery}
            oninput={searchArtists}
          />
          {#if artistSearching}
            <div class="concert-empty">Searching…</div>
          {:else if artistQuery.trim() && artistResults.length === 0}
            <div class="concert-empty">No artists with plays match that search.</div>
          {:else}
            <div class="concert-list">
              {#each artistResults as a (a.id)}
                <button class="concert-item" onclick={() => pickArtist(a)}>
                  {#if a.imageUrl}
                    <img class="concert-artist-thumb" src={a.imageUrl} alt="" />
                  {:else}
                    <div class="concert-artist-thumb concert-artist-thumb--empty"></div>
                  {/if}
                  <div class="concert-item-info">
                    <div class="concert-item-venue">{a.name}</div>
                    <div class="concert-item-meta">{a.playCount} plays</div>
                  </div>
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {:else if !editing}
        <div class="concert-tabs">
          <button class="concert-tab" class:active={tab === 'setlistfm'} disabled={!configured} onclick={() => (tab = 'setlistfm')}>
            setlist.fm
          </button>
          <button class="concert-tab" class:active={tab === 'manual'} onclick={() => (tab = 'manual')}>
            Manual
          </button>
        </div>
      {/if}

      {#if error}
        <div class="concert-error">{error}</div>
      {/if}

      {#if !target}
        <!-- el paso de selección ya ocupa el cuerpo del modal -->
      {:else if tab === 'setlistfm' && !editing}
        {#if !configured}
          <div class="concert-empty">
            setlist.fm is not configured on this server. Add a concert manually instead.
          </div>
        {:else if searching}
          <div class="concert-empty">Searching setlist.fm…</div>
        {:else if shows.length === 0}
          <div class="concert-empty">No setlists found for {target.name}.</div>
        {:else}
          <div class="concert-list">
            {#each shows as s (s.id)}
              {@const already = importedIds.includes(s.id)}
              <button class="concert-item" disabled={already || !!importingId} onclick={() => importShow(s.id)}>
                <div class="concert-item-date">{formatCalendarDate(s.date)}</div>
                <div class="concert-item-info">
                  <div class="concert-item-venue">{location(s) || 'Unknown venue'}</div>
                  <div class="concert-item-meta">
                    {s.songs.length} song{s.songs.length === 1 ? '' : 's'}{s.tour ? ` · ${s.tour}` : ''}
                  </div>
                </div>
                <span class="concert-item-action">
                  {already ? 'Added' : importingId === s.id ? '…' : 'Add'}
                </span>
              </button>
            {/each}
          </div>
          {#if totalPages > 1}
            <div class="concert-pager">
              <button disabled={page <= 1 || searching} onclick={() => loadShows(page - 1)}>Previous</button>
              <span>{page} / {totalPages}</span>
              <button disabled={page >= totalPages || searching} onclick={() => loadShows(page + 1)}>Next</button>
            </div>
          {/if}
        {/if}
      {:else}
        <form class="concert-form" onsubmit={submitManual}>
          <label>
            <span>Date</span>
            <input type="date" bind:value={date} required />
          </label>
          <label>
            <span>Venue</span>
            <input type="text" bind:value={venue} placeholder="Wizink Center" />
          </label>
          <div class="concert-form-row">
            <label>
              <span>City</span>
              <input type="text" bind:value={city} placeholder="Madrid" />
            </label>
            <label>
              <span>Country</span>
              <input type="text" bind:value={country} placeholder="Spain" />
            </label>
          </div>
          <label>
            <span>Tour</span>
            <input type="text" bind:value={tour} placeholder="Optional" />
          </label>
          <label>
            <span>Notes</span>
            <textarea bind:value={notes} rows="3" placeholder="Who you went with, how it was…"></textarea>
          </label>
          <div class="concert-form-actions">
            <button type="submit" class="concert-save" disabled={saving || !date}>
              {editing ? 'Save' : 'Add concert'}
            </button>
            <button type="button" class="concert-cancel" onclick={close}>Cancel</button>
          </div>
        </form>
      {/if}
    </div>
  </div>
{/if}

<style>
  .concert-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    z-index: 200;
    display: flex;
    justify-content: center;
    padding-top: 10vh;
    backdrop-filter: blur(4px);
  }

  .concert-modal {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    width: 460px;
    max-width: calc(100% - 2rem);
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    align-self: flex-start;
  }

  .concert-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.25rem;
    border-bottom: 1px solid var(--border);
  }
  .concert-header h3 {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
  }
  .concert-close {
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 1.5rem;
    cursor: pointer;
    padding: 0;
    line-height: 1;
  }

  .concert-target {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.75rem 1.25rem;
    border-bottom: 1px solid var(--border);
    background: rgba(255, 255, 255, 0.02);
    font-size: 0.9rem;
    color: var(--accent);
  }
  .concert-target span { color: var(--text); }
  .concert-change-artist {
    margin-left: auto;
    background: none;
    border: none;
    color: var(--text-muted);
    font: inherit;
    font-size: 0.72rem;
    cursor: pointer;
    padding: 0;
  }
  .concert-change-artist:hover { color: var(--accent); }

  .concert-picker { display: flex; flex-direction: column; min-height: 0; }
  .concert-search {
    margin: 0.9rem 1.25rem 0;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text);
    font: inherit;
    font-size: 0.85rem;
    padding: 0.4rem 0.55rem;
  }
  .concert-search:focus { outline: none; border-color: var(--accent); }
  .concert-artist-thumb {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
  }
  .concert-artist-thumb--empty { background: var(--border); }

  .concert-tabs {
    display: flex;
    gap: 0.4rem;
    padding: 0.75rem 1.25rem 0;
  }
  .concert-tab {
    background: none;
    border: 1px solid var(--border);
    border-radius: 999px;
    color: var(--text-muted);
    font: inherit;
    font-size: 0.78rem;
    padding: 0.2rem 0.8rem;
    cursor: pointer;
    transition: color 0.05s, border-color 0.05s;
  }
  .concert-tab.active {
    color: var(--accent);
    border-color: var(--accent);
  }
  .concert-tab:disabled { opacity: 0.4; cursor: default; }

  .concert-error {
    margin: 0.75rem 1.25rem 0;
    padding: 0.5rem 0.75rem;
    color: #ff4444;
    font-size: 0.82rem;
    background: rgba(255, 68, 68, 0.1);
    border-radius: var(--radius);
  }

  .concert-empty {
    padding: 1.5rem 1.25rem;
    color: var(--text-muted);
    font-size: 0.85rem;
    text-align: center;
  }

  .concert-list {
    overflow-y: auto;
    padding: 0.5rem 0.75rem;
  }
  .concert-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    padding: 0.5rem 0.6rem;
    background: none;
    border: none;
    border-radius: var(--radius);
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: background 0.05s;
  }
  .concert-item:hover:not(:disabled) { background: rgba(255, 255, 255, 0.04); }
  .concert-item:disabled { opacity: 0.45; cursor: default; }

  .concert-item-date {
    font-size: 0.75rem;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    width: 5.5rem;
    flex-shrink: 0;
  }
  .concert-item-info { flex: 1; min-width: 0; }
  .concert-item-venue {
    font-size: 0.88rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .concert-item-meta {
    font-size: 0.74rem;
    color: var(--text-muted);
    margin-top: 0.1rem;
  }
  .concert-item-action {
    font-size: 0.75rem;
    color: var(--accent);
    flex-shrink: 0;
  }

  .concert-pager {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    padding: 0.6rem;
    border-top: 1px solid var(--border);
    font-size: 0.78rem;
    color: var(--text-muted);
  }
  .concert-pager button {
    background: none;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text-muted);
    font: inherit;
    font-size: 0.75rem;
    padding: 0.15rem 0.6rem;
    cursor: pointer;
  }
  .concert-pager button:hover:not(:disabled) { color: var(--text); }
  .concert-pager button:disabled { opacity: 0.4; cursor: default; }

  .concert-form {
    padding: 1rem 1.25rem 1.25rem;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
  }
  .concert-form label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.75rem;
    color: var(--text-muted);
    flex: 1;
    min-width: 0;
  }
  .concert-form-row { display: flex; gap: 0.7rem; }
  .concert-form input,
  .concert-form textarea {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text);
    font: inherit;
    font-size: 0.85rem;
    padding: 0.4rem 0.55rem;
    width: 100%;
    box-sizing: border-box;
  }
  .concert-form textarea { resize: vertical; }
  .concert-form input:focus,
  .concert-form textarea:focus {
    outline: none;
    border-color: var(--accent);
  }

  .concert-form-actions {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.3rem;
  }
  .concert-form-actions button {
    border: 1px solid var(--border);
    background: var(--bg-card);
    color: var(--text-muted);
    border-radius: var(--radius);
    padding: 0.3rem 0.9rem;
    font: inherit;
    font-size: 0.82rem;
    cursor: pointer;
    transition: all 0.05s;
  }
  .concert-form-actions .concert-save {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
  .concert-form-actions .concert-save:hover:not(:disabled) { opacity: 0.85; }
  .concert-form-actions .concert-cancel:hover { color: var(--text); }
  .concert-form-actions button:disabled { opacity: 0.5; cursor: default; }
</style>
