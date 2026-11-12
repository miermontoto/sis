<script lang="ts">
  // un hueco de la rejilla (el span lo pone el item de la rejilla, que es quien
  // lleva el animate:flip): la card del widget o, si el slot tiene varios, la pila
  // que se pasa con el dedo (scroll-snap horizontal, puntos y flechas al pasar el
  // ratón). En modo edición tiembla como en iOS y enseña sus controles: quitar,
  // ajustes y tamaño. El arrastre lo gobierna la rejilla (necesita todos los rects)
  import { untrack } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import WidgetBody from './WidgetBody.svelte';
  import { SIZE_SHORT, SIZE_LABELS, widgetDef, type WidgetSettings, type WidgetSize } from './registry';
  import { commonSizes, nextSize, type WidgetSlot } from './layout';

  let {
    slot, size, index, total, editing, dragging = false, dragOffset = null, drop = null,
    onpointerdown, onremove, onresize, onedit, onitemsettings, onkeymove,
  }: {
    slot: WidgetSlot;
    size: WidgetSize;
    index: number;
    total: number;
    editing: boolean;
    dragging?: boolean;
    dragOffset?: { x: number; y: number } | null;
    drop?: 'before' | 'after' | 'stack' | null;
    onpointerdown: (e: PointerEvent) => void;
    onremove: () => void;
    onresize: (size: WidgetSize) => void;
    onedit: () => void;
    onitemsettings: (itemId: string, patch: Partial<WidgetSettings>) => void;
    onkeymove: (delta: number) => void;
  } = $props();

  const PAGE_KEY = (id: string) => `sis:widgetPage:${id}`;
  const MS_PER_SEC = 1000;

  let isStack = $derived(slot.items.length > 1);
  let sizes = $derived(commonSizes(slot.items));
  let label = $derived(isStack
    ? `Stack: ${slot.items.map(i => widgetDef(i.type)?.label ?? i.type).join(', ')}`
    : widgetDef(slot.items[0]?.type)?.label ?? 'Widget');

  // --- pila: página visible, recordada por dispositivo ---
  let pager = $state<HTMLElement | null>(null);
  let page = $state(0);
  // páginas ya montadas: la visible y sus vecinas, para que el dedo no deslice
  // sobre un hueco; una vez montada se queda (no repite su petición)
  const mounted = new SvelteSet<number>();
  let hovered = $state(false);
  let focused = $state(false);

  function readPage(): number {
    try { return Math.max(0, Math.min(slot.items.length - 1, Number(localStorage.getItem(PAGE_KEY(slot.id))) || 0)); } catch { return 0; }
  }
  function storePage(p: number) {
    try { localStorage.setItem(PAGE_KEY(slot.id), String(p)); } catch { /* sin storage: sin memoria */ }
  }
  function markMounted(p: number) {
    for (const n of [p - 1, p, p + 1]) if (n >= 0 && n < slot.items.length) mounted.add(n);
  }

  // al montar (y si cambia el número de widgets) coloca la pila en su página
  $effect(() => {
    if (!isStack || !pager) return;
    slot.items.length;
    untrack(() => {
      page = readPage();
      markMounted(page);
      pager!.scrollLeft = page * pager!.clientWidth;
    });
  });

  let scrollFrame = 0;
  function onPagerScroll() {
    if (scrollFrame) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0;
      if (!pager || pager.clientWidth === 0) return;
      const p = Math.round(pager.scrollLeft / pager.clientWidth);
      if (p !== page) { page = p; storePage(p); }
      markMounted(p);
    });
  }

  const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  function goTo(p: number) {
    if (!pager) return;
    const n = slot.items.length;
    const target = ((p % n) + n) % n;
    markMounted(target);
    pager.scrollTo({ left: target * pager.clientWidth, behavior: reducedMotion() ? 'auto' : 'smooth' });
  }

  // auto-rotación: quieta con el ratón encima, con el foco dentro, en modo edición
  // y con la pestaña oculta (al volver no hay que ver tres saltos de golpe)
  $effect(() => {
    if (!isStack || slot.rotateSec <= 0 || editing) return;
    const id = setInterval(() => {
      if (hovered || focused || document.visibilityState !== 'visible') return;
      goTo(page + 1);
    }, slot.rotateSec * MS_PER_SEC);
    return () => clearInterval(id);
  });

  // --- teclado en modo edición: flechas mueven, s cambia el tamaño, supr quita ---
  function onKeydown(e: KeyboardEvent) {
    if (!editing || e.target !== e.currentTarget) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); onkeymove(-1); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); onkeymove(1); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); onremove(); }
    else if (e.key === 's' && sizes.length > 1) { e.preventDefault(); onresize(nextSize(slot)); }
    else if (e.key === 'Enter') { e.preventDefault(); onedit(); }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_static_element_interactions -->
<!-- en modo edición el slot es el asa de arrastre y el control de teclado (flechas,
     s, supr, intro); fuera de él no es interactivo y no entra en el orden de tab -->
<div
  class="wslot"
  class:wslot--editing={editing}
  class:wslot--dragging={dragging}
  class:wslot--drop-before={drop === 'before'}
  class:wslot--drop-after={drop === 'after'}
  class:wslot--drop-stack={drop === 'stack'}
  data-slot={slot.id}
  style:transform={dragOffset ? `translate(${dragOffset.x}px, ${dragOffset.y}px)` : null}
  style:--wiggle-delay="{(index % 5) * -0.07}s"
  tabindex={editing ? 0 : undefined}
  role={editing ? 'group' : undefined}
  aria-label={editing ? `${label}, ${SIZE_LABELS[slot.size].toLowerCase()}, ${index + 1} of ${total}. Arrows move, S resizes, Delete removes, Enter opens settings` : undefined}
  onpointerdown={editing ? onpointerdown : undefined}
  oncontextmenu={editing ? (e) => e.preventDefault() : undefined}
  onkeydown={onKeydown}
  onpointerenter={() => { hovered = true; }}
  onpointerleave={() => { hovered = false; }}
  onfocusin={() => { focused = true; }}
  onfocusout={() => { focused = false; }}
>
  <div class="wslot-wiggle">
    <div class="card widget" class:widget--stack={isStack}>
      {#if !isStack}
        <div class="widget-page" inert={editing}>
          <WidgetBody type={slot.items[0].type} {size} settings={slot.items[0].settings} onsettings={(p) => onitemsettings(slot.items[0].id, p)} />
        </div>
      {:else}
        <div class="widget-pager" bind:this={pager} onscroll={onPagerScroll}>
          {#each slot.items as item, i (item.id)}
            <div class="widget-page" inert={editing || i !== page} aria-hidden={i !== page}>
              {#if mounted.has(i)}
                <WidgetBody type={item.type} {size} settings={item.settings} onsettings={(p) => onitemsettings(item.id, p)} />
              {/if}
            </div>
          {/each}
        </div>
        {#if !editing}
          <button type="button" class="wslot-arrow wslot-arrow--prev" aria-label="Previous widget" onclick={() => goTo(page - 1)}>‹</button>
          <button type="button" class="wslot-arrow wslot-arrow--next" aria-label="Next widget" onclick={() => goTo(page + 1)}>›</button>
        {/if}
        <div class="wslot-dots">
          {#each slot.items as item, i (item.id)}
            <button type="button" class="wslot-dot" class:wslot-dot--on={i === page} aria-label="Show {widgetDef(item.type)?.label ?? item.type}" aria-current={i === page} onclick={() => goTo(i)}></button>
          {/each}
        </div>
      {/if}
    </div>

    {#if editing}
      <button type="button" class="wslot-ctl wslot-ctl--remove" aria-label="Remove {label}" title="Remove" onclick={onremove}>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M1 5h8" stroke="currentColor" stroke-width="2" stroke-linecap="square" /></svg>
      </button>
      <button type="button" class="wslot-ctl wslot-ctl--edit" aria-label="Settings for {label}" title="Settings" onclick={onedit}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
      </button>
      {#if sizes.length > 1}
        <button type="button" class="wslot-ctl wslot-ctl--size" aria-label="Size: {SIZE_LABELS[slot.size]}. Change size" title="Change size" onclick={() => onresize(nextSize(slot))}>
          {SIZE_SHORT[slot.size]}
        </button>
      {/if}
    {/if}
  </div>
</div>

<style>
  .wslot {
    position: relative;
    min-width: 0;
    min-height: 0;
  }
  .wslot-wiggle {
    position: relative;
    height: 100%;
  }
  .widget {
    position: relative;
    height: 100%;
    padding: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  /* --- pila --- */
  .widget-pager {
    flex: 1;
    min-height: 0;
    display: flex;
    overflow-x: auto;
    overflow-y: hidden;
    scroll-snap-type: x mandatory;
    overscroll-behavior-x: contain;
    scrollbar-width: none;
  }
  .widget-pager::-webkit-scrollbar { display: none; }
  .widget-page {
    flex: 1 0 100%;
    min-width: 0;
    min-height: 0;
    height: 100%;
    display: flex;
    flex-direction: column;
    scroll-snap-align: start;
    scroll-snap-stop: always;
  }
  /* los puntos de la pila van sobre el pie: el contenido les deja sitio */
  .widget--stack :global(.widget-body) {
    padding-bottom: calc(var(--widget-pad) + 0.6rem);
  }
  .wslot-dots {
    position: absolute;
    left: 50%;
    bottom: 0.3rem;
    transform: translateX(-50%);
    display: flex;
    gap: 0.3rem;
    z-index: 2;
  }
  .wslot-dot {
    width: 6px;
    height: 6px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: var(--fg-a15);
    cursor: pointer;
  }
  .wslot-dot--on { background: var(--accent); }
  .wslot-arrow {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    z-index: 2;
    width: 1.5rem;
    height: 2.25rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-card);
    color: var(--text-muted);
    font-size: var(--fs-lg);
    line-height: 1;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.1s;
  }
  .wslot-arrow--prev { left: 0.25rem; }
  .wslot-arrow--next { right: 0.25rem; }
  .wslot-arrow:hover { color: var(--text); }
  .wslot-arrow:focus-visible { opacity: 1; }
  @media (hover: hover) {
    .wslot:hover .wslot-arrow { opacity: 0.9; }
  }

  /* --- modo edición --- */
  .wslot--editing {
    cursor: grab;
    touch-action: pan-y;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
  }
  .wslot--editing:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
    border-radius: var(--radius);
  }
  .wslot--editing .wslot-wiggle {
    animation: wslot-wiggle 0.28s ease-in-out infinite alternate;
    animation-delay: var(--wiggle-delay);
  }
  @keyframes wslot-wiggle {
    from { transform: rotate(-0.5deg); }
    to { transform: rotate(0.5deg); }
  }
  .wslot--dragging {
    z-index: 20;
    cursor: grabbing;
    transition: none;
  }
  .wslot--dragging .wslot-wiggle {
    animation: none;
    transform: scale(1.03);
    box-shadow: 0 1rem 2.5rem color-mix(in srgb, var(--shadow-color) 45%, transparent);
    border-radius: var(--radius);
  }
  .wslot--dragging .widget { opacity: 0.92; }
  /* dónde caería: una barra de acento a un lado o, encima, el aro de la pila */
  .wslot--drop-before::before,
  .wslot--drop-after::after {
    content: '';
    position: absolute;
    top: 8%;
    bottom: 8%;
    width: 3px;
    border-radius: 2px;
    background: var(--accent);
    z-index: 3;
  }
  .wslot--drop-before::before { left: calc(var(--detail-gap) / -2 - 1.5px); }
  .wslot--drop-after::after { right: calc(var(--detail-gap) / -2 - 1.5px); }
  .wslot--drop-stack .widget {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-a25);
  }

  .wslot-ctl {
    position: absolute;
    z-index: 4;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.6rem;
    height: 1.6rem;
    padding: 0;
    border-radius: 50%;
    border: 1px solid var(--border);
    background: var(--bg-card);
    color: var(--text);
    cursor: pointer;
    box-shadow: 0 2px 6px color-mix(in srgb, var(--shadow-color) 30%, transparent);
  }
  .wslot-ctl:hover { border-color: var(--accent); color: var(--accent); }
  .wslot-ctl--remove { top: -0.5rem; left: -0.5rem; }
  .wslot-ctl--remove:hover { border-color: var(--danger); color: var(--danger); }
  .wslot-ctl--edit { top: -0.5rem; right: -0.5rem; }
  .wslot-ctl--size {
    bottom: -0.5rem;
    right: -0.5rem;
    width: auto;
    min-width: 1.6rem;
    padding: 0 0.35rem;
    border-radius: 0.8rem;
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
    font-weight: 700;
  }

  @media (prefers-reduced-motion: reduce) {
    .wslot--editing .wslot-wiggle { animation: none; }
  }
</style>
