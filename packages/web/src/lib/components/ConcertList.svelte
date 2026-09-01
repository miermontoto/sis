<script lang="ts">
  // Conciertos asistidos de un artista. Cada bolo se puede desplegar para ver el
  // setlist: las canciones que ya estaban en la librería enlazan a su track y
  // muestran cuántas veces se habían escuchado ANTES de esa fecha — que es lo
  // que separa "ya te la sabías" de "la descubriste allí". Las que no están se
  // pintan apagadas: son las que el usuario no tenía.
  import { api, type Concert } from '$lib/api';
  import { errorMessage } from '$lib/utils/errors';
  import { formatCalendarDate } from '$lib/utils/format';
  import IconTicket from '$lib/icons/IconTicket.svelte';
  import Setlist from '$lib/components/Setlist.svelte';

  let {
    concerts,
    onAdd,
    onEdit,
    onChanged,
  }: {
    concerts: Concert[];
    onAdd: () => void;
    onEdit: (concert: Concert) => void;
    onChanged: () => void;
  } = $props();

  let expanded = $state<number | null>(null);
  let busyId = $state<number | null>(null);
  let error = $state('');

  const place = (c: Concert) => [c.venue, c.city].filter(Boolean).join(' · ');

  async function remove(concert: Concert) {
    if (busyId !== null) return;
    busyId = concert.id;
    error = '';
    try {
      await api.deleteConcert(concert.id);
      onChanged();
    } catch (e) {
      error = errorMessage(e, 'Error deleting concert');
    } finally {
      busyId = null;
    }
  }
</script>

<div class="section-header">
  <h2 class="section-title">Concerts</h2>
  <button class="show-all-btn" onclick={onAdd}>Add</button>
</div>

{#if error}
  <div class="concert-error">{error}</div>
{/if}

{#if concerts.length === 0}
  <p class="concerts-empty">No concerts logged yet.</p>
{:else}
  <div class="concerts">
    {#each concerts as c (c.id)}
      <div class="concert">
        <div class="concert-row">
          <span class="concert-icon"><IconTicket size={14} /></span>
          <div class="concert-main">
            <div class="concert-date">{formatCalendarDate(c.date)}</div>
            <div class="concert-place">{place(c) || 'Venue unknown'}</div>
            {#if c.tour}<div class="concert-tour">{c.tour}</div>{/if}
            {#if c.songsTotal > 0}
              <button class="concert-setlist-toggle" onclick={() => (expanded = expanded === c.id ? null : c.id)}>
                {c.songsTotal} songs · {c.songsMatched} in your library
              </button>
            {/if}
            {#if c.notes}<p class="concert-notes">{c.notes}</p>{/if}
          </div>
          <div class="concert-actions">
            {#if c.setlistfmUrl}
              <a class="concert-action" href={c.setlistfmUrl} target="_blank" rel="noopener" title="View on setlist.fm">↗</a>
            {/if}
            <button class="concert-action" onclick={() => onEdit(c)} title="Edit">✎</button>
            <button class="concert-action" disabled={busyId === c.id} onclick={() => remove(c)} title="Remove">&times;</button>
          </div>
        </div>

        {#if expanded === c.id}
          <Setlist songs={c.songs} />
        {/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .concerts {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    margin-bottom: 1.5rem;
  }
  .concerts-empty {
    color: var(--text-muted);
    font-size: 0.82rem;
    margin: 0 0 1.5rem;
  }
  .concert-error {
    color: #ff4444;
    font-size: 0.8rem;
    margin-bottom: 0.5rem;
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
    gap: 0.6rem;
    padding: 0.6rem 0.7rem;
  }
  .concert-icon {
    color: var(--accent);
    display: flex;
    padding-top: 0.1rem;
    flex-shrink: 0;
  }
  .concert-main { flex: 1; min-width: 0; }
  .concert-date {
    font-size: 0.75rem;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
  .concert-place {
    font-size: 0.88rem;
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
  .concert-setlist-toggle {
    background: none;
    border: none;
    padding: 0.2rem 0 0;
    color: var(--accent);
    font: inherit;
    font-size: 0.75rem;
    cursor: pointer;
  }
  .concert-setlist-toggle:hover { text-decoration: underline; }

  /* los controles sólo aparecen al pasar por encima de la tarjeta: la lista se
     lee mucho más limpia sin tres glifos por fila compitiendo con el recinto */
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
