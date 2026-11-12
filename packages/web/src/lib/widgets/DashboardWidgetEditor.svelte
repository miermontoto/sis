<script lang="ts">
  // editor de lista de los widgets del dashboard (Settings → Display → Layouts): el
  // camino de teclado y lector de pantalla al modo edición en sitio. Mismas
  // operaciones (layout.ts) sobre el mismo store, y los mismos modales de ajustes y
  // de galería, así que no hay dos formas de configurar un widget
  import WidgetGallery from './WidgetGallery.svelte';
  import WidgetSlotEditor from './WidgetSlotEditor.svelte';
  import { dashboardStore } from './dashboard-store.svelte';
  import { SIZE_LABELS, widgetDef } from './registry';
  import { commonSizes, moveSlot, removeSlot, resizeSlot } from './layout';

  let layout = $derived(dashboardStore.layout);
  let galleryOpen = $state(false);
  let editingSlotId = $state<string | null>(null);
  let editingSlot = $derived(editingSlotId ? layout.slots.find(s => s.id === editingSlotId) ?? null : null);

  const label = (types: string[]) => types.map(t => widgetDef(t)?.label ?? t).join(' · ');

  function reset() {
    if (confirm('Reset the dashboard to the default widgets?')) dashboardStore.reset();
  }
</script>

<div class="dwe">
  <ol class="dwe-list">
    {#each layout.slots as slot, i (slot.id)}
      {@const types = slot.items.map(it => it.type)}
      <li class="dwe-row">
        <span class="dwe-name">
          {#if types.length > 1}<span class="dwe-stack">Stack</span>{/if}
          {label(types)}
        </span>
        <select class="dwe-size" aria-label="Size of {label(types)}" value={slot.size} onchange={(e) => dashboardStore.apply(l => resizeSlot(l, slot.id, e.currentTarget.value as typeof slot.size))}>
          {#each commonSizes(slot.items) as s (s)}<option value={s}>{SIZE_LABELS[s]}</option>{/each}
        </select>
        <button type="button" class="dwe-icon" aria-label="Move {label(types)} up" title="Move up" disabled={i === 0} onclick={() => dashboardStore.apply(l => moveSlot(l, slot.id, i - 1))}>↑</button>
        <button type="button" class="dwe-icon" aria-label="Move {label(types)} down" title="Move down" disabled={i === layout.slots.length - 1} onclick={() => dashboardStore.apply(l => moveSlot(l, slot.id, i + 1))}>↓</button>
        <button type="button" class="dwe-icon" aria-label="Settings for {label(types)}" title="Settings" onclick={() => { editingSlotId = slot.id; }}>⚙</button>
        <button type="button" class="dwe-icon dwe-icon--danger" aria-label="Remove {label(types)}" title="Remove" onclick={() => dashboardStore.apply(l => removeSlot(l, slot.id))}>×</button>
      </li>
    {/each}
  </ol>
  {#if layout.slots.length === 0}<p class="dwe-empty">No widgets.</p>{/if}
  <div class="dwe-actions">
    <button type="button" class="range-btn" onclick={() => { galleryOpen = true; }}>+ Add widget</button>
    <a class="range-btn" href="/" onclick={() => { dashboardStore.editing = true; }}>Edit on the dashboard</a>
    <button type="button" class="range-btn" onclick={reset}>Reset</button>
  </div>
</div>

{#if galleryOpen}
  <WidgetGallery cellPx={0} onclose={() => { galleryOpen = false; }} />
{/if}
{#if editingSlot}
  <WidgetSlotEditor slot={editingSlot} onclose={() => { editingSlotId = null; }} />
{/if}

<style>
  .dwe {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .dwe-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .dwe-row {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.3rem 0.4rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg);
  }
  .dwe-name {
    flex: 1;
    min-width: 0;
    font-size: var(--fs-sm);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .dwe-stack {
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
    text-transform: uppercase;
    letter-spacing: var(--track-wide);
    color: var(--accent);
    margin-right: 0.35rem;
  }
  .dwe-size {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text);
    font-size: var(--fs-xs);
    padding: 0.2rem 0.3rem;
  }
  .dwe-icon {
    width: 1.75rem;
    height: 1.75rem;
    background: none;
    border: 1px solid transparent;
    border-radius: var(--radius);
    color: var(--text-muted);
    cursor: pointer;
    font-size: var(--fs-md);
  }
  .dwe-icon:hover:not(:disabled) { color: var(--text); border-color: var(--border); }
  .dwe-icon:disabled { opacity: 0.3; cursor: default; }
  .dwe-icon--danger:hover:not(:disabled) { color: var(--danger); }
  .dwe-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }
  .dwe-actions a.range-btn { text-decoration: none; }
  .dwe-empty {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--fs-sm);
  }
  /* el suelo de 16px de @platform/ui en táctil: con una clase propia el select
     volvería a hacer zoom al enfocarse en ios */
  @media (hover: none) {
    .dwe-size { font-size: var(--fs-input-touch); }
  }
</style>
