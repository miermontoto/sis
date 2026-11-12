<script lang="ts">
  // los bolos del log: los que vienen (fecha de hoy en adelante) primero, del más
  // cercano al más lejano, y después los últimos a los que fuiste. Filas de
  // ConcertRow, la fila de bolo de toda la app (menú contextual incluido)
  import { untrack } from 'svelte';
  import { api, type Concert } from '$lib/api';
  import ConcertRow from '$lib/components/ConcertRow.svelte';
  import { fitRows } from '$lib/utils/fit-rows';
  import WidgetHeader from '../WidgetHeader.svelte';
  import { localToday } from '../memories.svelte';
  import { reloadKey } from '../util';
  import type { WidgetProps } from '../components';

  let { size }: WidgetProps = $props();

  let concerts = $state<Concert[]>([]);
  let loading = $state(true);

  $effect(() => {
    reloadKey();
    untrack(() => {
      loading = true;
      api.concerts()
        .then(r => { concerts = r.concerts; })
        .catch(e => console.error('concerts widget:', e))
        .finally(() => { loading = false; });
    });
  });

  // las fechas son de calendario (YYYY-MM-DD): se comparan como texto
  let today = $derived(localToday());
  let upcoming = $derived(concerts.filter(c => c.date >= today).sort((a, b) => a.date.localeCompare(b.date)));
  let past = $derived(concerts.filter(c => c.date < today).sort((a, b) => b.date.localeCompare(a.date)));
  let rows = $derived([...upcoming, ...past]);
</script>

<WidgetHeader title="Concerts" href="/concerts">
  {#snippet actions()}
    {#if upcoming.length > 0}<span class="data-label">{upcoming.length} upcoming</span>{/if}
  {/snippet}
</WidgetHeader>
{#if loading && concerts.length === 0}
  <div class="w-ghost w-ghost--fill"></div>
{:else if concerts.length === 0}
  <p class="w-empty">Log the shows you go to from an artist's page and they show up here.</p>
{:else}
  <div class="w-fill" use:fitRows={'.track-list'} data-size={size}>
    <div class="track-list">
      {#each rows as c (c.id)}
        <ConcertRow concert={c} compact />
      {/each}
    </div>
  </div>
{/if}
