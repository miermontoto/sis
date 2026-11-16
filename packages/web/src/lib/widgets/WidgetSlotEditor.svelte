<script lang="ts">
  // ajustes de un slot: tamaño, y si es una pila, su rotación y el orden de sus
  // widgets (subir, bajar, sacar de la pila, quitar). Debajo, los ajustes del widget
  // elegido. Todo se aplica al momento: no hay "guardar"
  import WidgetModal from './WidgetModal.svelte';
  import WidgetSettingsForm from './WidgetSettingsForm.svelte';
  import { dashboardStore } from './dashboard-store.svelte';
  import { SIZE_LABELS, widgetDef } from './registry';
  import {
    commonSizes, resizeSlot, setRotate, moveItem, unstackItem, removeItem, updateSettings, ROTATE_OPTIONS,
    type WidgetSlot,
  } from './layout';

  let { slot, onclose }: { slot: WidgetSlot; onclose: () => void } = $props();

  let isStack = $derived(slot.items.length > 1);
  let selectedId = $state<string | null>(null);
  // si el elegido sale de la pila (o no hay elegido) se edita el primero
  let selected = $derived(slot.items.find(i => i.id === selectedId) ?? slot.items[0]);
  let title = $derived(isStack ? 'Widget stack' : widgetDef(selected.type)?.label ?? 'Widget');

  const rotateLabel = (sec: number) => sec === 0 ? 'Off' : sec < 60 ? `${sec}s` : `${sec / 60} min`;
  const apply = dashboardStore.apply;
</script>

<WidgetModal {title} {onclose}>
  <div class="wse">
    <div class="wse-row">
      <span class="wse-label">Size</span>
      <div class="wse-control">
        {#each commonSizes(slot.items) as s (s)}
          <button type="button" class="range-btn" class:active={slot.size === s} onclick={() => apply(l => resizeSlot(l, slot.id, s))}>{SIZE_LABELS[s]}</button>
        {/each}
      </div>
    </div>

    {#if isStack}
      <div class="wse-row">
        <span class="wse-label">Rotate</span>
        <div class="wse-control">
          {#each ROTATE_OPTIONS as sec (sec)}
            <button type="button" class="range-btn" class:active={slot.rotateSec === sec} onclick={() => apply(l => setRotate(l, slot.id, sec))}>{rotateLabel(sec)}</button>
          {/each}
        </div>
      </div>

      <div class="wse-row">
        <span class="wse-label">Widgets in this stack</span>
        <div class="wse-items">
          {#each slot.items as item, i (item.id)}
            <div class="wse-item" class:wse-item--selected={item.id === selected.id}>
              <button type="button" class="wse-item-name" onclick={() => { selectedId = item.id; }} aria-pressed={item.id === selected.id}>
                {widgetDef(item.type)?.label ?? item.type}
              </button>
              <button type="button" class="wse-icon" aria-label="Move up" title="Move up" disabled={i === 0} onclick={() => apply(l => moveItem(l, slot.id, item.id, i - 1))}>↑</button>
              <button type="button" class="wse-icon" aria-label="Move down" title="Move down" disabled={i === slot.items.length - 1} onclick={() => apply(l => moveItem(l, slot.id, item.id, i + 1))}>↓</button>
              <button type="button" class="wse-icon" aria-label="Take out of the stack" title="Take out of the stack" onclick={() => apply(l => unstackItem(l, slot.id, item.id))}>⇱</button>
              <button type="button" class="wse-icon wse-icon--danger" aria-label="Remove" title="Remove" onclick={() => apply(l => removeItem(l, slot.id, item.id))}>×</button>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <div class="wse-settings">
      {#if isStack}<div class="wse-label">{widgetDef(selected.type)?.label} settings</div>{/if}
      <WidgetSettingsForm type={selected.type} settings={selected.settings} onchange={(patch) => apply(l => updateSettings(l, slot.id, selected.id, patch))} />
    </div>
  </div>
</WidgetModal>

<style>
  .wse {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .wse-row {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .wse-label {
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    text-transform: uppercase;
    letter-spacing: var(--track-wide);
    color: var(--text-muted);
  }
  .wse-control {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }
  .wse-items {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .wse-item {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.2rem 0.3rem;
  }
  .wse-item--selected {
    border-color: var(--accent-a40);
    background: var(--accent-a05);
  }
  .wse-item-name {
    flex: 1;
    text-align: left;
    background: none;
    border: none;
    color: var(--text);
    font: inherit;
    font-size: var(--fs-sm);
    padding: 0.25rem;
    cursor: pointer;
  }
  .wse-icon {
    width: 1.75rem;
    height: 1.75rem;
    background: none;
    border: 1px solid transparent;
    border-radius: var(--radius);
    color: var(--text-muted);
    cursor: pointer;
    font-size: var(--fs-md);
  }
  .wse-icon:hover:not(:disabled) { color: var(--text); border-color: var(--border); }
  .wse-icon:disabled { opacity: 0.3; cursor: default; }
  .wse-icon--danger:hover:not(:disabled) { color: var(--danger); }
  .wse-settings {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    padding-top: 0.9rem;
    border-top: 1px solid var(--border);
  }
</style>
