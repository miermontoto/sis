<script lang="ts">
  // rejilla de widgets del dashboard, empaquetada como la pantalla de inicio de iOS:
  // columnas cuadradas que se miden en vivo (gridColumns), cada slot ocupa las
  // celdas de su tamaño y `grid-auto-flow: dense` rellena los huecos. En modo
  // edición se arrastra (ratón: al moverse; táctil: pulsación larga, como iOS, para
  // que deslizar siga haciendo scroll), y soltar sobre el centro de otro widget
  // los apila. La barra de edición y los modales viven aquí también
  import { flip } from 'svelte/animate';
  import { onDestroy } from 'svelte';
  import WidgetSlotView from './WidgetSlotView.svelte';
  import WidgetGallery from './WidgetGallery.svelte';
  import WidgetSlotEditor from './WidgetSlotEditor.svelte';
  import { dashboardStore } from './dashboard-store.svelte';
  import { SIZE_SPAN } from './registry';
  import {
    gridColumns, effectiveSize, removeSlot, resizeSlot, moveSlot, placeSlot, stackSlot, canStack, updateSettings,
  } from './layout';

  const LONG_PRESS_MS = 280;
  // desplazamiento que arranca el arrastre con ratón, o que cancela la pulsación
  // larga en táctil (es un scroll)
  const MOUSE_SLOP_PX = 4;
  const TOUCH_SLOP_PX = 8;
  // fracción central del widget destino que significa "apilar" en vez de "al lado"
  const STACK_ZONE = 0.25;
  const AUTOSCROLL_EDGE_PX = 64;
  const AUTOSCROLL_MAX_PX = 18;
  const FLIP_MS = 220;

  let gridEl = $state<HTMLElement | null>(null);
  let cols = $state(2);
  let cellPx = $state(0);

  // columnas y alto de fila (= ancho de columna: celdas cuadradas) del ancho real
  $effect(() => {
    if (!gridEl) return;
    const el = gridEl;
    const measure = () => {
      const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
      const w = el.clientWidth;
      cols = gridColumns(w, gap);
      cellPx = Math.max(0, (w - gap * (cols - 1)) / cols);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  });

  let layout = $derived(dashboardStore.layout);
  let editing = $derived(dashboardStore.editing);

  // --- arrastre ---
  type Drag = { id: string; pointerId: number; touch: boolean; x0: number; y0: number; dx: number; dy: number; active: boolean };
  let drag = $state<Drag | null>(null);
  let drop = $state<{ targetId: string; mode: 'before' | 'after' | 'stack' } | null>(null);
  let pressTimer: ReturnType<typeof setTimeout> | null = null;
  let lastPointer = { x: 0, y: 0 };
  let scrollFrame = 0;
  // el desplazamiento de la página durante el arrastre se suma al del puntero:
  // el slot va en el flujo de la página y, si ésta se mueve, él se mueve con ella
  let scrollY0 = 0;

  function onSlotPointerDown(e: PointerEvent, id: string) {
    if (e.button !== 0 || (e.target as Element).closest('button, a, input, select, textarea')) return;
    const touch = e.pointerType !== 'mouse';
    drag = { id, pointerId: e.pointerId, touch, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0, active: false };
    lastPointer = { x: e.clientX, y: e.clientY };
    if (touch) pressTimer = setTimeout(activate, LONG_PRESS_MS);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  }

  function activate() {
    if (!drag) return;
    drag.active = true;
    scrollY0 = window.scrollY;
    if (drag.touch) navigator.vibrate?.(10);
    autoScroll();
  }

  // una pulsación larga que acaba en arrastre no debe hacer scroll: los touchmove
  // de después de activar se cancelan. El listener no pasivo vive todo el modo
  // edición y no sólo el arrastre porque chrome decide en el touchstart si un gesto se
  // puede bloquear: uno añadido al activar sólo funciona si otro listener no pasivo ya
  // lo hizo bloqueable. Hoy lo hace uno global de la app (medido 2026-11-12: el
  // arrastre táctil pasa con los dos enfoques); así no depende de él. Deslizar sin
  // pulsación larga sigue haciendo scroll: sólo se cancela con un arrastre activo
  $effect(() => {
    if (!editing || !gridEl) return;
    const el = gridEl;
    const block = (e: TouchEvent) => { if (drag?.active && e.cancelable) e.preventDefault(); };
    el.addEventListener('touchmove', block, { passive: false });
    return () => el.removeEventListener('touchmove', block);
  });

  function onMove(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    lastPointer = { x: e.clientX, y: e.clientY };
    const dist = Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0);
    if (!drag.active) {
      if (drag.touch && dist > TOUCH_SLOP_PX) cancel();
      else if (!drag.touch && dist > MOUSE_SLOP_PX) activate();
      return;
    }
    updateDrag();
  }

  function updateDrag() {
    if (!drag?.active) return;
    drag.dx = lastPointer.x - drag.x0;
    drag.dy = lastPointer.y - drag.y0 + (window.scrollY - scrollY0);
    drop = locateDrop(lastPointer.x, lastPointer.y);
  }

  // destino bajo el puntero, por rects (el slot arrastrado va pegado al dedo y
  // elementFromPoint lo devolvería a él)
  function locateDrop(x: number, y: number): typeof drop {
    if (!gridEl || !drag) return null;
    for (const el of gridEl.querySelectorAll<HTMLElement>('[data-slot]')) {
      const id = el.dataset.slot!;
      if (id === drag.id) continue;
      const r = el.getBoundingClientRect();
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
      const rx = (x - r.left) / r.width;
      const ry = (y - r.top) / r.height;
      const center = rx > STACK_ZONE && rx < 1 - STACK_ZONE && ry > STACK_ZONE && ry < 1 - STACK_ZONE;
      if (center && canStack(layout, drag.id, id)) return { targetId: id, mode: 'stack' };
      return { targetId: id, mode: rx < 0.5 ? 'before' : 'after' };
    }
    return drop;
  }

  // scroll de la página mientras el dedo o el ratón está pegado a un borde
  function autoScroll() {
    if (!drag?.active) return;
    const { y } = lastPointer;
    const h = window.innerHeight;
    const speed = y < AUTOSCROLL_EDGE_PX ? -(1 - y / AUTOSCROLL_EDGE_PX) : y > h - AUTOSCROLL_EDGE_PX ? 1 - (h - y) / AUTOSCROLL_EDGE_PX : 0;
    if (speed !== 0) {
      window.scrollBy(0, speed * AUTOSCROLL_MAX_PX);
      updateDrag();
    }
    scrollFrame = requestAnimationFrame(autoScroll);
  }

  function onUp(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const { id, active } = drag;
    const target = drop;
    cleanup();
    if (!active || !target) return;
    dashboardStore.apply(l => target.mode === 'stack' ? stackSlot(l, id, target.targetId) : placeSlot(l, id, target.targetId, target.mode));
  }

  const onCancel = () => cleanup();
  const cancel = () => cleanup();

  function cleanup() {
    if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
    if (scrollFrame) { cancelAnimationFrame(scrollFrame); scrollFrame = 0; }
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    drag = null;
    drop = null;
  }
  onDestroy(cleanup);

  // salir del modo edición con Escape (si no hay modal abierto, que se cierra antes)
  $effect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !galleryOpen && !editingSlotId) dashboardStore.editing = false; };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function keyMove(id: string, delta: number) {
    const i = layout.slots.findIndex(s => s.id === id);
    dashboardStore.apply(l => moveSlot(l, id, i + delta));
    // el foco sigue al slot que se ha movido (el DOM lo recoloca en su sitio)
    requestAnimationFrame(() => gridEl?.querySelector<HTMLElement>(`[data-slot="${id}"]`)?.focus());
  }

  // --- modales ---
  let galleryOpen = $state(false);
  let editingSlotId = $state<string | null>(null);
  let editingSlot = $derived(editingSlotId ? layout.slots.find(s => s.id === editingSlotId) ?? null : null);

  function resetLayout() {
    if (confirm('Reset the dashboard to the default widgets?')) dashboardStore.reset();
  }
</script>

<div class="wgrid-wrap">
{#if editing}
  <div class="wgrid-toolbar" role="toolbar" aria-label="Edit dashboard">
    <span class="wgrid-toolbar-hint">Drag to move · drop onto a widget to stack</span>
    <button type="button" class="range-btn" onclick={() => { galleryOpen = true; }}>+ Add widget</button>
    <button type="button" class="range-btn" onclick={resetLayout}>Reset</button>
    <button type="button" class="range-btn active" onclick={() => { dashboardStore.editing = false; }}>Done</button>
  </div>
{/if}

<div
  class="wgrid"
  class:wgrid--editing={editing}
  bind:this={gridEl}
  style:--wgrid-cols={cols}
  style:--wgrid-cell="{cellPx}px"
>
  {#each layout.slots as slot, i (slot.id)}
    {@const size = effectiveSize(slot.size, cols)}
    {@const span = SIZE_SPAN[size]}
    <div class="wgrid-item" style:grid-column="span {span.cols}" style:grid-row="span {span.rows}" animate:flip={{ duration: drag ? 0 : FLIP_MS }}>
      <WidgetSlotView
        {slot}
        {size}
        index={i}
        total={layout.slots.length}
        {editing}
        dragging={drag?.active === true && drag.id === slot.id}
        dragOffset={drag?.active && drag.id === slot.id ? { x: drag.dx, y: drag.dy } : null}
        drop={drop?.targetId === slot.id ? drop.mode : null}
        onpointerdown={(e) => onSlotPointerDown(e, slot.id)}
        onremove={() => dashboardStore.apply(l => removeSlot(l, slot.id))}
        onresize={(s) => dashboardStore.apply(l => resizeSlot(l, slot.id, s))}
        onedit={() => { editingSlotId = slot.id; }}
        onitemsettings={(itemId, patch) => dashboardStore.apply(l => updateSettings(l, slot.id, itemId, patch))}
        onkeymove={(delta) => keyMove(slot.id, delta)}
      />
    </div>
  {/each}
</div>

{#if layout.slots.length === 0}
  <div class="card wgrid-empty">
    <p>No widgets on your dashboard.</p>
    <button type="button" class="range-btn" onclick={() => { dashboardStore.editing = true; galleryOpen = true; }}>+ Add widget</button>
  </div>
{/if}

{#if !editing}
  <div class="wgrid-footer">
    <button type="button" class="range-btn" onclick={() => { dashboardStore.editing = true; }}>Edit widgets</button>
  </div>
{/if}

</div>

{#if galleryOpen}
  <WidgetGallery cellPx={cellPx} onclose={() => { galleryOpen = false; }} />
{/if}
{#if editingSlot}
  <WidgetSlotEditor slot={editingSlot} onclose={() => { editingSlotId = null; }} />
{/if}

<style>
  /* el hueco entre barra, rejilla y pie lo pone el contenedor */
  .wgrid-wrap {
    display: flex;
    flex-direction: column;
    gap: var(--detail-gap);
  }
  .wgrid {
    display: grid;
    grid-template-columns: repeat(var(--wgrid-cols), minmax(0, 1fr));
    grid-auto-rows: var(--wgrid-cell);
    grid-auto-flow: row dense;
    gap: var(--detail-gap);
  }
  /* el item de la rejilla lleva el span; el slot de dentro la llena */
  .wgrid-item {
    min-width: 0;
    min-height: 0;
    display: grid;
  }
  .wgrid-item > :global(.wslot) {
    grid-column: 1;
    grid-row: 1;
  }

  /* la barra de edición se queda arriba mientras se recoloca: Done siempre a mano */
  .wgrid-toolbar {
    position: sticky;
    top: calc(var(--safe-top, 0px) + 0.5rem);
    z-index: 30;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.4rem;
    padding: 0.5rem 0.6rem;
    background: color-mix(in srgb, var(--bg-card) 92%, transparent);
    backdrop-filter: blur(8px);
    border: 1px solid var(--accent-a25);
    border-radius: var(--radius);
  }
  .wgrid-toolbar-hint {
    flex: 1;
    min-width: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    color: var(--text-muted);
  }
  /* en modo edición hay sitio para los controles que sobresalen de cada slot */
  .wgrid--editing {
    padding: 0.4rem 0.4rem 0;
  }

  .wgrid-footer {
    display: flex;
    justify-content: center;
  }
  .wgrid-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    text-align: center;
    color: var(--text-muted);
  }
  .wgrid-empty p { margin: 0; }

  @media (max-width: 768px) {
    .wgrid-toolbar-hint { flex-basis: 100%; }
  }
</style>
