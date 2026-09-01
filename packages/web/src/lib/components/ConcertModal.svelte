<script lang="ts">
  // Alta / edición de un concierto asistido. Dos vías: importar de setlist.fm
  // (con la fecha, el recinto y el setlist ya resueltos) o darlo de alta a mano.
  // La búsqueda es la pestaña por defecto sólo si el servidor tiene credenciales;
  // si no las tiene, el modal abre directamente en manual — un buscador vacío sin
  // explicación sería el peor sitio donde dejar al usuario.
  import { errorMessage } from '$lib/utils/errors';
  import { api, CONCERT_YEAR_OPTIONS, type Concert, type SetlistfmShow } from '$lib/api';
  import { formatCalendarDate } from '$lib/utils/format';
  import IconTicket from '$lib/icons/IconTicket.svelte';

  let {
    show = $bindable(false),
    artist,
    editing = null,
    onSaved = () => {},
    onChangeArtist,
  }: {
    show: boolean;
    // el artista se elige FUERA, con SearchModal en modo pick: este modal siempre
    // se abre ya sabiendo a quién fuiste a ver
    artist: { id: string; name: string };
    editing?: Concert | null;
    onSaved?: (concert: Concert | null) => void;
    // presente sólo donde el artista se puede cambiar (alta desde /concerts):
    // cierra este modal y devuelve el control al buscador
    onChangeArtist?: () => void;
  } = $props();

  type Tab = 'setlistfm' | 'manual';

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
  // filtro de año: un artista de gira larga acumula decenas de páginas y
  // paginar hasta el bolo al que fuiste no es viable. Arranca en el año actual,
  // que es el caso común ("acabo de ir a un concierto")
  const CURRENT_YEAR = new Date().getFullYear();
  const YEAR_CHOICES = Array.from({ length: CONCERT_YEAR_OPTIONS }, (_, i) => String(CURRENT_YEAR - i));
  let year = $state('');
  // marca que el año lo puso el default, no el usuario: si ese año no tiene
  // bolos se cae a "todos" en vez de dejar un vacío que parece un fallo
  let autoYear = false;
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
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && show) close();
  }

  async function loadShows(targetPage: number) {
    searching = true;
    error = '';
    try {
      const res = await api.setlistfmShows(artist.id, targetPage, year || null);
      configured = res.configured;
      shows = res.shows;
      importedIds = res.importedIds;
      page = res.page;
      totalPages = res.totalPages;
      // sin credenciales no hay nada que buscar: el alta manual es la única vía
      if (!res.configured) tab = 'manual';

      // el año por defecto no puede dejar al usuario ante un "no hay setlists"
      // que parece un error: si este año no hay bolos, se reintenta sin filtro.
      // Sólo cuando el año lo puso el default — si lo eligió el usuario, su
      // elección manda y el vacío es la respuesta correcta
      if (res.configured && res.shows.length === 0 && autoYear && year) {
        autoYear = false;
        year = '';
        searching = false;
        void loadShows(1);
        return;
      }
      autoYear = false;
      // memoizar SÓLO el resultado útil: si el servidor no tenía credenciales
      // (o la llamada falló), reabrir el modal debe reintentar en vez de
      // quedarse con el "no configurado" de la vez anterior — que es lo que
      // mantenía la pestaña deshabilitada tras configurar la key
      loadedKey = res.configured ? artist.id : '';
    } catch (e) {
      error = errorMessage(e, 'Error searching setlist.fm');
      shows = [];
      loadedKey = '';
    } finally {
      searching = false;
    }
  }

  async function importShow(showId: string) {
    importingId = showId;
    error = '';
    try {
      const created = await api.importSetlist(artist.id, showId);
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
    if (saving || !date) return;
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
        : await api.createConcert({ artistId: artist.id, ...fields });
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
    if (loadedKey !== artist.id) {
      year = String(CURRENT_YEAR);
      autoYear = true;
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

      <div class="concert-target">
        <IconTicket size={18} />
        <span>{artist.name}</span>
        {#if onChangeArtist && !editing}
          <button class="concert-change-artist" onclick={() => { close(); onChangeArtist(); }}>Change</button>
        {/if}
      </div>

      {#if !editing}
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

      {#if tab === 'setlistfm' && !editing && configured}
        <div class="concert-filter">
          <!-- desplegable en vez de caja de texto: aplica al seleccionar, sin
               depender de que el usuario pulse Enter o saque el foco -->
          <select
            class="concert-year"
            aria-label="Filter by year"
            disabled={searching}
            bind:value={year}
            onchange={() => { autoYear = false; loadShows(1); }}
          >
            <option value="">All years</option>
            {#each YEAR_CHOICES as y (y)}
              <option value={y}>{y}</option>
            {/each}
          </select>
          <span class="concert-filter-hint">
            {#if totalPages > 1}{totalPages} pages{:else if shows.length > 0}{shows.length} show{shows.length === 1 ? '' : 's'}{/if}
          </span>
        </div>
      {/if}

      {#if tab === 'setlistfm' && !editing}
        {#if !configured}
          <div class="concert-empty">
            setlist.fm is not configured on this server. Add a concert manually instead.
          </div>
        {:else if searching}
          <div class="concert-empty">Searching setlist.fm…</div>
        {:else if shows.length === 0}
          <div class="concert-empty">No setlists found for {artist.name}.</div>
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

  .concert-filter {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.6rem 1.25rem 0;
  }
  .concert-year {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text);
    font: inherit;
    font-size: 0.8rem;
    padding: 0.2rem 0.45rem;
  }
  .concert-year:focus { outline: none; border-color: var(--accent); }
  .concert-year:disabled { opacity: 0.6; }
  .concert-filter-hint {
    margin-left: auto;
    font-size: 0.72rem;
    color: var(--text-muted);
  }

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

  /* flex:1 + min-height:0 es lo que hace que la lista scrollee DENTRO del modal
     en vez de estirarlo: sin ellos toma su alto de contenido, el contenedor
     (max-height 80vh, overflow hidden) recorta lo que sobra y el paginador se
     queda fuera de la vista — con lo que la lista parece acabarse en el último
     bolo de la página 1 y no hay forma de llegar a las otras 26. Mismo patrón
     que .search-results en SearchModal. */
  .concert-list {
    overflow-y: auto;
    flex: 1;
    min-height: 0;
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
    flex-shrink: 0;
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
    min-height: 0;
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
