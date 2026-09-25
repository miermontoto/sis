<script lang="ts">
  // Tira de pestañas de la cabecera de un modal. La usan el de merges y el de
  // relaciones para leerse como uno solo: son dos operaciones distintas sobre lo
  // mismo, y tenerlas como dos entradas seguidas del menú era decir dos veces
  // "relaciones". No reutiliza la de ImagePicker: aquella vive dentro de un panel
  // con flex-wrap y está dimensionada para él.
  let { tabs, active, onselect }: {
    tabs: { value: string; label: string }[];
    active: string;
    onselect: (value: string) => void;
  } = $props();
</script>

<div class="modal-tabs">
  {#each tabs as tab (tab.value)}
    <button
      class="modal-tab"
      class:modal-tab--active={tab.value === active}
      aria-current={tab.value === active ? 'true' : undefined}
      onclick={() => { if (tab.value !== active) onselect(tab.value); }}
    >{tab.label}</button>
  {/each}
</div>

<style>
  .modal-tabs {
    display: flex;
    gap: 0.35rem;
    padding: 0.6rem 1.25rem;
    border-bottom: 1px solid var(--border);
  }

  .modal-tab {
    flex: 1;
    padding: 0.3rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: none;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    text-transform: uppercase;
    letter-spacing: var(--track);
    cursor: pointer;
    transition: color 0.05s, border-color 0.05s;
  }
  .modal-tab:hover:not(.modal-tab--active) {
    color: var(--text);
  }
  .modal-tab--active {
    border-color: var(--accent);
    color: var(--accent);
  }
</style>
