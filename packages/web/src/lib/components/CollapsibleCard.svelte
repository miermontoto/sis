<script lang="ts">
  import type { Snippet } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import { RAIL_COLUMN_QUERY } from '$lib/detail-layout';
  import IconChevronRight from '$lib/icons/IconChevronRight.svelte';

  // card del rail que, en una sola columna (el rail va al final de la página),
  // se pliega a su cabecera. con el rail a la derecha siempre va abierta y no
  // hay botón. plegada por defecto; abrirla o cerrarla se recuerda por card en
  // el navegador (preferencia de vista, no ajuste sincronizado). plegada no se
  // monta el cuerpo: una gráfica de echarts dentro de un display:none mide 0×0
  let { storageKey, title, actions, children, class: className = '' }: {
    storageKey: string;
    title: Snippet;
    actions?: Snippet;
    children: Snippet;
    class?: string;
  } = $props();

  const OPEN = 'open';
  const CLOSED = 'closed';

  const railColumn = new MediaQuery(RAIL_COLUMN_QUERY);
  // la clave es fija durante la vida de la card: leerla una vez al montar es lo buscado
  // svelte-ignore state_referenced_locally
  let open = $state(localStorage.getItem(storageKey) === OPEN);
  let collapsed = $derived(!railColumn.current && !open);

  function toggle() {
    open = !open;
    localStorage.setItem(storageKey, open ? OPEN : CLOSED);
  }
</script>

<div class="card {className}" class:collapsed>
  <div class="section-header collapsible-header">
    {@render title()}
    <div class="collapsible-actions">
      {#if !collapsed}{@render actions?.()}{/if}
      {#if !railColumn.current}
        <button type="button" class="collapsible-toggle" class:open onclick={toggle} aria-expanded={open} aria-label={open ? 'Collapse' : 'Expand'}>
          <IconChevronRight size={14} />
        </button>
      {/if}
    </div>
  </div>
  {#if !collapsed}{@render children()}{/if}
</div>

<style>
  /* título + acciones: si no caben, las acciones bajan de línea a la derecha */
  .collapsible-header {
    flex-wrap: wrap;
    row-gap: 0.5rem;
  }
  .collapsible-actions {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin-left: auto;
  }
  /* plegada la cabecera es lo único que hay: sin hueco hasta un cuerpo que no existe */
  .collapsed > .collapsible-header {
    margin-bottom: 0;
  }
  .collapsible-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.25rem;
    margin: -0.25rem;
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    transition: color 0.05s, transform 0.15s ease;
  }
  .collapsible-toggle:hover {
    color: var(--text);
  }
  .collapsible-toggle.open {
    transform: rotate(90deg);
  }
</style>
