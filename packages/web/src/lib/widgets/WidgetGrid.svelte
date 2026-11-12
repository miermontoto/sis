<script lang="ts">
  // dashboard de widgets por secciones de horizonte temporal (Today → Looking back),
  // cada una con su cabecera (que la pliega) y su rejilla, empaquetada como la
  // pantalla de inicio de iOS: columnas cuadradas medidas en vivo (gridColumns),
  // partidas en medias filas para los tamaños compactos, y `grid-auto-flow: dense`
  // rellenando huecos. Todas las secciones comparten la medida. En modo edición se
  // arrastra (ratón: al moverse; táctil: pulsación larga, como iOS, para que deslizar
  // siga haciendo scroll) dentro de la sección, y soltar sobre el centro de otro
  // widget los apila. La barra de edición y los modales viven aquí también
  import { flip } from 'svelte/animate';
  import { onDestroy } from 'svelte';
  import WidgetSlotView from './WidgetSlotView.svelte';
  import WidgetGallery from './WidgetGallery.svelte';
  import WidgetSlotEditor from './WidgetSlotEditor.svelte';
  import { dashboardStore } from './dashboard-store.svelte';
  import { getLocale } from '$lib/api';
  import { SECTIONS, SIZE_SPAN, type SectionKey } from './registry';
  import {
    gridColumns, effectiveSize, removeSlot, resizeSlot, stepSlot, placeSlot, stackSlot, canStack, updateSettings,
    sectionSlots, toggleCollapsed,
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

  let rootEl = $state<HTMLElement | null>(null);
  let cols = $state(2);
  let cellPx = $state(0);
  let gapPx = $state(0);

  // columnas y ancho de celda del ancho real, medidos en el contenedor (las rejillas
  // de las secciones miden lo mismo). Las filas son medias celdas: dos y un hueco
  // dan una celda cuadrada, así un small es 1×1 y un tile, la mitad de alto
  $effect(() => {
    if (!rootEl) return;
    const el = rootEl;
    const measure = () => {
      gapPx = parseFloat(getComputedStyle(el).getPropertyValue('--detail-gap')) * parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const w = el.clientWidth;
      cols = gridColumns(w, gapPx);
      cellPx = Math.max(0, (w - gapPx * (cols - 1)) / cols);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  });
  let rowPx = $derived(Math.max(0, (cellPx - gapPx) / 2));

  let layout = $derived(dashboardStore.layout);
  let editing = $derived(dashboardStore.editing);
  // secciones con algún widget, en su orden fijo
  let sections = $derived(SECTIONS.map(sec => ({ ...sec, slots: sectionSlots(layout, sec.key) })).filter(sec => sec.slots.length > 0));
  const todayLabel = new Date().toLocaleDateString(getLocale(), { weekday: 'long', day: 'numeric', month: 'long' });

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
    if (!editing || !rootEl) return;
    const el = rootEl;
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
    if (!rootEl || !drag) return null;
    const own = rootEl.querySelector<HTMLElement>(`[data-slot="${drag.id}"]`)?.closest<HTMLElement>('[data-section]');
    if (!own) return null;
    // sólo dentro de su sección: la sección la dicen los ajustes del widget
    for (const el of own.querySelectorAll<HTMLElement>('[data-slot]')) {
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

  function keyMove(id: string, delta: -1 | 1) {
    dashboardStore.apply(l => stepSlot(l, id, delta));
    // el foco sigue al slot que se ha movido (el DOM lo recoloca en su sitio)
    requestAnimationFrame(() => rootEl?.querySelector<HTMLElement>(`[data-slot="${id}"]`)?.focus());
  }

  const toggleSection = (key: SectionKey) => dashboardStore.apply(l => toggleCollapsed(l, key));

  // --- modales ---
  let galleryOpen = $state(false);
  let editingSlotId = $state<string | null>(null);
  let editingSlot = $derived(editingSlotId ? layout.slots.find(s => s.id === editingSlotId) ?? null : null);

  function resetLayout() {
    if (confirm('Reset the dashboard to the default widgets?')) dashboardStore.reset();
  }
</script>

<div
  class="wgrid-wrap"
  bind:this={rootEl}
  style:--wgrid-cols={cols}
  style:--wgrid-row="{rowPx}px"
>
  {#if editing}
    <div class="wgrid-toolbar" role="toolbar" aria-label="Edit dashboard">
      <span class="wgrid-toolbar-hint">Drag to move within a section · drop onto a widget to stack · a widget's range picks its section</span>
      <button type="button" class="range-btn" onclick={() => { galleryOpen = true; }}>+ Add widget</button>
      <button type="button" class="range-btn" onclick={resetLayout}>Reset</button>
      <button type="button" class="range-btn active" onclick={() => { dashboardStore.editing = false; }}>Done</button>
    </div>
  {/if}

  {#each sections as sec (sec.key)}
    {@const collapsed = layout.collapsed.includes(sec.key)}
    <section class="wsec" data-section={sec.key} aria-label={sec.label}>
      <h2 class="wsec-header">
        <button type="button" class="wsec-toggle" aria-expanded={!collapsed} onclick={() => toggleSection(sec.key)}>
          <span class="wsec-title">{sec.label}</span>
          {#if sec.key === 'today'}<span class="wsec-sub">{todayLabel}</span>{/if}
          {#if collapsed}<span class="wsec-sub">{sec.slots.length} {sec.slots.length === 1 ? 'widget' : 'widgets'}</span>{/if}
          <svg class="wsec-chevron" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.6" /></svg>
        </button>
      </h2>
      {#if !collapsed}
        <div class="wgrid" class:wgrid--editing={editing}>
          {#each sec.slots as slot, i (slot.id)}
            {@const size = effectiveSize(slot.size, cols)}
            {@const span = SIZE_SPAN[size]}
            <div class="wgrid-item" style:grid-column="span {span.cols}" style:grid-row="span {span.rows}" animate:flip={{ duration: drag ? 0 : FLIP_MS }}>
              <WidgetSlotView
                {slot}
                {size}
                metrics={{ cell: cellPx, row: rowPx, gap: gapPx, cols }}
                index={i}
                total={sec.slots.length}
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
      {/if}
    </section>
  {/each}

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
  <WidgetGallery {cellPx} onclose={() => { galleryOpen = false; }} />
{/if}
{#if editingSlot}
  <WidgetSlotEditor slot={editingSlot} onclose={() => { editingSlotId = null; }} />
{/if}

<style>
  /* el hueco entre barra, secciones y pie lo pone el contenedor */
  .wgrid-wrap {
    display: flex;
    flex-direction: column;
    gap: calc(var(--detail-gap) * 1.5);
  }
  .wsec {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  /* cabecera de sección: un nivel por encima de los títulos de los widgets */
  .wsec-header {
    margin: 0;
    font: inherit;
  }
  .wsec-toggle {
    display: inline-flex;
    align-items: baseline;
    gap: 0.6rem;
    padding: 0;
    background: none;
    border: none;
    color: var(--text);
    font: inherit;
    cursor: pointer;
  }
  .wsec-title {
    font-family: var(--font-mono);
    font-size: var(--fs-lg);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: var(--track-wide);
  }
  .wsec-sub {
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    color: var(--text-muted);
    text-transform: lowercase;
  }
  .wsec-chevron {
    align-self: center;
    color: var(--text-muted);
    transition: transform 0.15s;
  }
  .wsec-toggle[aria-expanded='false'] .wsec-chevron { transform: rotate(-90deg); }
  .wsec-toggle:hover .wsec-title,
  .wsec-toggle:hover .wsec-chevron { color: var(--accent); }

  .wgrid {
    display: grid;
    grid-template-columns: repeat(var(--wgrid-cols), minmax(0, 1fr));
    grid-auto-rows: var(--wgrid-row);
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
    .wsec-title { font-size: var(--fs-md); }
  }
  @media (prefers-reduced-motion: reduce) {
    .wsec-chevron { transition: none; }
  }
</style>
