<script lang="ts">
  // Conciertos asistidos de un artista, en su ficha. Cada fila lleva al detalle
  // del bolo (el setlist se pinta en un solo sitio); las acciones van en el menú
  // contextual de la fila, como en el resto de listas.
  import { api, type Concert } from '$lib/api';
  import { errorMessage } from '$lib/utils/errors';
  import { formatCalendarDate } from '$lib/utils/format';
  import { toastStore } from '$lib/stores/toast.svelte';
  import ConcertRow from './ConcertRow.svelte';

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

  let busy = $state(false);

  async function remove(concert: Concert) {
    if (busy) return;
    if (!confirm(`Remove the ${formatCalendarDate(concert.date)} show? Its setlist and attributions go with it.`)) return;
    busy = true;
    try {
      await api.deleteConcert(concert.id);
      onChanged();
    } catch (e) {
      toastStore.show(errorMessage(e, 'Error removing concert'));
    } finally {
      busy = false;
    }
  }
</script>

<div class="section-header">
  <h2 class="section-title"><a href="/concerts" class="section-link">Concerts</a></h2>
  <button class="show-all-btn" onclick={onAdd}>Add</button>
</div>

{#if concerts.length === 0}
  <p class="concerts-empty">No concerts logged yet.</p>
{:else}
  <div class="track-list concerts-list">
    {#each concerts as c (c.id)}
      <ConcertRow concert={c} variant="artist" compact {onEdit} onRemove={remove} />
    {/each}
  </div>
{/if}

<style>
  .concerts-list {
    margin-bottom: 1.5rem;
  }
  .concerts-empty {
    color: var(--text-muted);
    font-size: 0.82rem;
    margin: 0 0 1.5rem;
  }
</style>
