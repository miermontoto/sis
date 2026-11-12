<script lang="ts">
  // galería de "añadir widget": los tipos agrupados por familia a la izquierda y,
  // a la derecha, el elegido pintado de verdad (con sus datos y sus ajustes por
  // defecto) en el tamaño elegido, como la galería de iOS. Sólo se pinta una vista
  // previa a la vez: veinte widgets vivos serían veinte peticiones
  import WidgetModal from './WidgetModal.svelte';
  import WidgetBody from './WidgetBody.svelte';
  import { dashboardStore } from './dashboard-store.svelte';
  import { addWidget } from './layout';
  import { WIDGETS, FAMILY_LABELS, SIZE_SPAN, SIZE_LABELS, SIZE_SHORT, resolveSettings, type WidgetFamily, type WidgetSize } from './registry';

  let { cellPx, onclose }: { cellPx: number; onclose: () => void } = $props();

  // la celda de la vista previa: la del dashboard, sin pasar de lo que cabe ni de
  // un tope (en un monitor ancho la celda real no entra en el modal)
  const PREVIEW_CELL_MAX_PX = 170;
  const PREVIEW_GAP_PX = 12;

  const families = Object.keys(FAMILY_LABELS) as WidgetFamily[];
  let type = $state(WIDGETS[0].type);
  let def = $derived(WIDGETS.find(w => w.type === type)!);
  let size = $state<WidgetSize>(WIDGETS[0].defaultSize);
  let settings = $derived(resolveSettings(def, undefined));

  function pick(t: string) {
    type = t;
    size = WIDGETS.find(w => w.type === t)!.defaultSize;
  }

  let previewWidth = $state(0);
  let cell = $derived.by(() => {
    const span = SIZE_SPAN[size];
    const fit = (previewWidth - PREVIEW_GAP_PX * (span.cols - 1)) / span.cols;
    return Math.max(0, Math.min(cellPx || PREVIEW_CELL_MAX_PX, PREVIEW_CELL_MAX_PX, fit));
  });
  let box = $derived({
    w: cell * SIZE_SPAN[size].cols + PREVIEW_GAP_PX * (SIZE_SPAN[size].cols - 1),
    h: cell * SIZE_SPAN[size].rows + PREVIEW_GAP_PX * (SIZE_SPAN[size].rows - 1),
  });

  function add() {
    dashboardStore.apply(l => addWidget(l, type, size));
    onclose();
    // el nuevo entra el primero: se lleva la vista arriba para verlo
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
</script>

<WidgetModal title="Add widget" wide {onclose}>
  <div class="wg">
    <nav class="wg-list" aria-label="Widgets">
      {#each families as family (family)}
        <div class="wg-family">{FAMILY_LABELS[family]}</div>
        {#each WIDGETS.filter(w => w.family === family) as w (w.type)}
          <button type="button" class="wg-item" class:wg-item--active={w.type === type} aria-pressed={w.type === type} onclick={() => pick(w.type)}>
            {w.label}
          </button>
        {/each}
      {/each}
    </nav>

    <div class="wg-detail">
      <div class="wg-title">{def.label}</div>
      <p class="wg-desc">{def.description}</p>
      <div class="wg-sizes" role="radiogroup" aria-label="Size">
        {#each def.sizes as s (s)}
          <button type="button" class="range-btn" class:active={s === size} role="radio" aria-checked={s === size} title={SIZE_LABELS[s]} onclick={() => { size = s; }}>{SIZE_SHORT[s]}</button>
        {/each}
      </div>
      <div class="wg-preview" bind:clientWidth={previewWidth}>
        {#if cell > 0}
          <!-- la vista previa no es interactiva: es una foto viva del widget -->
          <div class="card widget wg-preview-card" style:width="{box.w}px" style:height="{box.h}px" inert>
            {#key `${type}:${size}`}
              <WidgetBody {type} {size} {settings} />
            {/key}
          </div>
        {/if}
      </div>
      <div class="wg-actions">
        <button type="button" class="range-btn active" onclick={add}>Add {def.label}</button>
      </div>
    </div>
  </div>
</WidgetModal>

<style>
  .wg {
    display: grid;
    grid-template-columns: 13rem minmax(0, 1fr);
    gap: 1.25rem;
    height: 100%;
    min-height: 0;
  }
  .wg-list {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    overflow-y: auto;
    min-height: 0;
    padding-right: 0.25rem;
  }
  .wg-family {
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
    text-transform: uppercase;
    letter-spacing: var(--track-wide);
    color: var(--text-muted);
    margin: 0.8rem 0 0.25rem;
  }
  .wg-family:first-child { margin-top: 0; }
  .wg-item {
    text-align: left;
    background: none;
    border: none;
    border-radius: var(--radius);
    color: var(--text);
    font: inherit;
    font-size: var(--fs-sm);
    padding: 0.4rem 0.55rem;
    cursor: pointer;
  }
  .wg-item:hover { background: var(--bg-hover); }
  .wg-item--active {
    background: var(--accent-a10);
    color: var(--accent);
  }
  .wg-detail {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    min-width: 0;
    min-height: 0;
  }
  .wg-title {
    font-weight: 600;
    font-size: var(--fs-lg);
  }
  .wg-desc {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--fs-sm);
    line-height: 1.45;
  }
  .wg-sizes {
    display: flex;
    gap: 0.35rem;
  }
  .wg-preview {
    flex: 1;
    min-height: 12rem;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem 0;
    border-radius: var(--radius);
    background: var(--fg-a03);
    overflow: hidden;
  }
  .wg-preview-card {
    flex-shrink: 0;
  }
  .wg-actions {
    display: flex;
    justify-content: flex-end;
  }

  @media (max-width: 768px) {
    .wg {
      grid-template-columns: 1fr;
      grid-template-rows: auto auto;
    }
    .wg-list {
      flex-direction: row;
      flex-wrap: wrap;
      gap: 0.25rem;
      max-height: 9rem;
    }
    .wg-family { flex-basis: 100%; margin: 0.4rem 0 0; }
    .wg-item { border: 1px solid var(--border); }
  }
</style>
