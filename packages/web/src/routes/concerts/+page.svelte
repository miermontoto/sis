<script lang="ts">
  // Registro global de conciertos: todos los bolos del usuario en orden
  // cronológico inverso, agrupados por año, con los totales arriba. La página de
  // artista tiene su propia sección acotada a ese artista; ésta es la vista
  // completa y el único sitio desde donde se puede dar de alta un bolo de
  // cualquiera (el modal pide el artista antes de nada).
  import { isAbortError, errorMessage } from '$lib/utils/errors';
  import { onMount } from 'svelte';
  import { api, createFetchController, type Concert, type ConcertStats } from '$lib/api';
  import { formatCalendarDate, formatNumber } from '$lib/utils/format';
  import ConcertModal from '$lib/components/ConcertModal.svelte';
  import SearchModal from '$lib/components/SearchModal.svelte';
  import IconTicket from '$lib/icons/IconTicket.svelte';

  let concerts = $state<Concert[]>([]);
  let stats = $state<ConcertStats | null>(null);
  let loading = $state(true);
  let error = $state('');
  let busyId = $state<number | null>(null);
  let showModal = $state(false);
  let editing = $state<Concert | null>(null);
  // el artista se elige con el buscador global en modo pick, no con un buscador
  // propio: mismo debounce, mismo pool y mismas teclas que el resto de la app
  let showArtistPicker = $state(false);
  let pickedArtist = $state<{ id: string; name: string } | null>(null);
  const fetchCtrl = createFetchController();

  async function load() {
    const signal = fetchCtrl.reset();
    loading = true;
    try {
      const res = await api.concerts(signal);
      if (signal.aborted) return;
      concerts = res.concerts;
      stats = res.stats;
    } catch (e) {
      if (isAbortError(e)) return;
      error = errorMessage(e, 'Error loading concerts');
    } finally {
      if (!signal.aborted) loading = false;
    }
  }

  onMount(load);

  // agrupado por año sobre la lista ya ordenada por fecha descendente: basta
  // arrastrar el año anterior, sin reordenar ni construir un índice aparte
  let byYear = $derived.by(() => {
    const groups: { year: string; items: Concert[] }[] = [];
    for (const c of concerts) {
      const year = c.date.slice(0, 4);
      if (groups.at(-1)?.year !== year) groups.push({ year, items: [] });
      groups.at(-1)!.items.push(c);
    }
    return groups;
  });

  // altura relativa de las barras del desglose anual
  let maxYear = $derived(Math.max(1, ...(stats?.byYear ?? []).map(y => y.count)));

  const place = (c: Concert) => [c.venue, c.city, c.country].filter(Boolean).join(' · ');

  async function remove(concert: Concert) {
    if (busyId !== null) return;
    busyId = concert.id;
    error = '';
    try {
      await api.deleteConcert(concert.id);
      await load();
    } catch (e) {
      error = errorMessage(e, 'Error deleting concert');
    } finally {
      busyId = null;
    }
  }

  // editar entra directo (el artista ya está fijado); dar de alta pasa antes por
  // el buscador
  function openModal(concert: Concert | null) {
    editing = concert;
    if (concert) {
      pickedArtist = { id: concert.artistId, name: concert.artistName };
      showModal = true;
      return;
    }
    pickedArtist = null;
    showArtistPicker = true;
  }
</script>

<div class="page-header">
  <h1>Concerts</h1>
  <p>Every show you have logged, and how much of each setlist you already knew.</p>
</div>

<div class="concerts-toolbar">
  <button class="concerts-add" onclick={() => openModal(null)}>Add concert</button>
</div>

{#if error}
  <div class="concerts-error">{error}</div>
{/if}

{#if loading && !stats}
  <div class="loading"><div class="spinner"></div></div>
{:else if stats}
  <div class="stats-grid">
    <div class="stat-card">
      <div class="stat-value">{formatNumber(stats.total)}</div>
      <div class="stat-label">Shows</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">{formatNumber(stats.artists)}</div>
      <div class="stat-label">Artists seen</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">{formatNumber(stats.venues)}</div>
      <div class="stat-label">Venues</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">{formatNumber(stats.countries)}</div>
      <div class="stat-label">Countries</div>
    </div>
  </div>

  {#if stats.byYear.length > 1}
    <h2 class="section-title">Shows per year</h2>
    <div class="year-bars">
      {#each stats.byYear as y (y.year)}
        <div class="year-bar" title="{y.year}: {y.count} show{y.count === 1 ? '' : 's'}">
          <div class="year-bar-fill" style:height="{(y.count / maxYear) * 100}%"></div>
          <span class="year-bar-label">{y.year.slice(2)}</span>
        </div>
      {/each}
    </div>
  {/if}

  {#if stats.topArtists.length > 0 && stats.topArtists[0].count > 1}
    <h2 class="section-title">Seen the most</h2>
    <div class="top-seen">
      {#each stats.topArtists.filter(a => a.count > 1).slice(0, 10) as a (a.artistId)}
        <a class="top-seen-chip" href="/artist/{a.artistId}">
          {#if a.imageUrl}
            <img src={a.imageUrl} alt="" />
          {:else}
            <div class="top-seen-thumb--empty"></div>
          {/if}
          <span>{a.name}</span>
          <em>{a.count}&times;</em>
        </a>
      {/each}
    </div>
  {/if}

  {#if concerts.length === 0}
    <p class="concerts-empty">
      No concerts logged yet. Add one here, or from any artist's page.
    </p>
  {:else}
    {#each byYear as group (group.year)}
      <h2 class="section-title">{group.year}</h2>
      <div class="concerts">
        {#each group.items as c (c.id)}
          <div class="concert">
            <div class="concert-row">
              <a class="concert-artist" href="/artist/{c.artistId}" title={c.artistName}>
                {#if c.artistImageUrl}
                  <img src={c.artistImageUrl} alt="" />
                {:else}
                  <div class="concert-artist-empty"><IconTicket size={14} /></div>
                {/if}
              </a>
              <div class="concert-main">
                <a class="concert-name" href="/concert/{c.id}">{c.artistName}</a>
                <div class="concert-place">{formatCalendarDate(c.date)}{place(c) ? ` · ${place(c)}` : ''}</div>
                {#if c.tour}<div class="concert-tour">{c.tour}</div>{/if}
                {#if c.songsTotal > 0}
                  <a class="concert-setlist-count" href="/concert/{c.id}">
                    {c.songsTotal} songs · {c.songsMatched} in your library
                  </a>
                {/if}
                {#if c.notes}<p class="concert-notes">{c.notes}</p>{/if}
              </div>
              <div class="concert-actions">
                {#if c.setlistfmUrl}
                  <a class="concert-action" href={c.setlistfmUrl} target="_blank" rel="noopener" title="View on setlist.fm">↗</a>
                {/if}
                <button class="concert-action" onclick={() => openModal(c)} title="Edit">✎</button>
                <button class="concert-action" disabled={busyId === c.id} onclick={() => remove(c)} title="Remove">&times;</button>
              </div>
            </div>
          </div>
        {/each}
      </div>
    {/each}
  {/if}
{/if}

<SearchModal
  bind:show={showArtistPicker}
  pick={{
    types: ['artist'],
    placeholder: 'Which artist did you see?',
    onPick: (entity) => {
      pickedArtist = { id: entity.id, name: entity.name };
      editing = null;
      showModal = true;
    },
  }}
/>

{#if pickedArtist}
  <ConcertModal
    bind:show={showModal}
    artist={pickedArtist}
    {editing}
    onSaved={load}
    onChangeArtist={() => (showArtistPicker = true)}
  />
{/if}

<style>
  .concerts-toolbar {
    display: flex;
    justify-content: flex-end;
    margin-bottom: 1rem;
  }
  .concerts-add {
    background: var(--accent);
    border: 1px solid var(--accent);
    color: #fff;
    border-radius: var(--radius);
    font: inherit;
    font-size: 0.82rem;
    padding: 0.3rem 0.9rem;
    cursor: pointer;
  }
  .concerts-add:hover { opacity: 0.85; }

  .concerts-error {
    color: #ff4444;
    font-size: 0.85rem;
    margin-bottom: 1rem;
  }
  .concerts-empty {
    color: var(--text-muted);
    font-size: 0.85rem;
  }

  /* desglose anual en CSS puro: son una decena de barras sin ejes ni tooltip,
     montar echarts para esto sería traer un canvas entero por cuatro divs */
  .year-bars {
    display: flex;
    align-items: flex-end;
    gap: 0.35rem;
    height: 90px;
    margin-bottom: 1.5rem;
  }
  .year-bar {
    flex: 1;
    max-width: 48px;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    align-items: center;
    gap: 0.2rem;
  }
  .year-bar-fill {
    width: 100%;
    background: var(--accent);
    opacity: 0.75;
    border-radius: 2px 2px 0 0;
    min-height: 2px;
  }
  .year-bar:hover .year-bar-fill { opacity: 1; }
  .year-bar-label {
    font-size: 0.65rem;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }

  .top-seen {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-bottom: 1.5rem;
  }
  .top-seen-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.25rem 0.7rem 0.25rem 0.25rem;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 999px;
    color: var(--text);
    text-decoration: none;
    font-size: 0.85rem;
    transition: border-color 0.05s, color 0.05s;
  }
  .top-seen-chip:hover { border-color: var(--accent); color: var(--accent); }
  .top-seen-chip img,
  .top-seen-thumb--empty {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
  }
  .top-seen-thumb--empty { background: var(--border); }
  .top-seen-chip em {
    font-style: normal;
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .concerts {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    margin-bottom: 1.5rem;
  }
  .concert {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .concert-row {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.65rem 0.75rem;
  }
  .concert-artist img,
  .concert-artist-empty {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
    display: block;
  }
  .concert-artist-empty {
    background: var(--border);
    color: var(--text-muted);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .concert-main { flex: 1; min-width: 0; }
  .concert-name {
    font-size: 0.92rem;
    color: var(--text);
    text-decoration: none;
  }
  .concert-name:hover { color: var(--accent); }
  .concert-place {
    font-size: 0.78rem;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .concert-tour {
    font-size: 0.74rem;
    color: var(--text-muted);
    font-style: italic;
  }
  .concert-notes {
    font-size: 0.78rem;
    color: var(--text-muted);
    margin: 0.3rem 0 0;
    white-space: pre-wrap;
  }
  .concert-setlist-count {
    display: inline-block;
    padding-top: 0.2rem;
    color: var(--accent);
    font-size: 0.75rem;
    text-decoration: none;
  }
  .concert-setlist-count:hover { text-decoration: underline; }

  .concert-actions {
    display: flex;
    gap: 0.1rem;
    flex-shrink: 0;
    opacity: 0;
    transition: opacity 0.05s;
  }
  .concert:hover .concert-actions,
  .concert-actions:focus-within { opacity: 1; }
  .concert-action {
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 0.9rem;
    line-height: 1;
    padding: 2px 4px;
    cursor: pointer;
    text-decoration: none;
  }
  .concert-action:hover { color: var(--text); }
  .concert-action:disabled { opacity: 0.5; cursor: default; }
</style>
