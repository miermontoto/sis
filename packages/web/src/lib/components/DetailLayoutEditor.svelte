<script lang="ts">
  // editor de disposición del dashboard y las vistas de detalle: tablero
  // drag-and-drop con zonas (main / rail / oculto) por tipo de vista — el
  // dashboard es de columna única y no ofrece rail. reordena y mueve secciones
  // arrastrando; el ojo oculta/muestra. persiste en settings (sync server +
  // localStorage) tras cada cambio.
  import { getDetailLayout, setDetailLayout } from '$lib/api/settings';
  import {
    defaultLayout, sectionLabel, moveSection, toggleSectionHidden,
    type LayoutKind, type DetailLayout,
  } from '$lib/detail-layout';

  type Zone = keyof DetailLayout; // 'main' | 'rail' | 'hidden'
  const ZONES: Zone[] = ['main', 'rail', 'hidden'];
  const KINDS: LayoutKind[] = ['dashboard', 'artist', 'album', 'track'];
  const KIND_LABELS: Record<LayoutKind, string> = { dashboard: 'Dashboard', artist: 'Artists', album: 'Albums', track: 'Tracks' };

  let kind = $state<LayoutKind>('dashboard');
  let board = $state<DetailLayout>(getDetailLayout('dashboard'));
  let dragKey = $state<string | null>(null);

  // zonas de columna visibles según la vista (el dashboard no tiene rail)
  let columnZones = $derived<Zone[]>(kind === 'dashboard' ? ['main'] : ['main', 'rail']);

  // contenedor raíz: las zonas se localizan por [data-zone] para hit-testing
  // durante el arrastre (bind:this no admite expresiones dinámicas)
  let rootEl = $state<HTMLElement | null>(null);
  const zoneEl = (z: Zone): HTMLElement | null => rootEl?.querySelector(`[data-zone="${z}"]`) ?? null;

  function selectKind(k: LayoutKind) {
    if (k === kind) return;
    kind = k;
    board = getDetailLayout(k);
    dragKey = null;
  }

  function persist() {
    setDetailLayout(kind, board);
  }

  function reset() {
    board = defaultLayout(kind);
    persist();
  }

  function sameBoard(a: DetailLayout, b: DetailLayout): boolean {
    return ZONES.every(z => a[z].length === b[z].length && a[z].every((k, i) => k === b[z][i]));
  }

  // --- drag and drop (pointer events, touch-friendly) ---

  function onHandleDown(e: PointerEvent, key: string) {
    e.preventDefault();
    dragKey = key;
    // capturamos en el handle: seguimos recibiendo move/up aunque el puntero
    // salga del chip hacia otra zona
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  // localiza zona + índice de inserción bajo el puntero. el índice se calcula
  // sobre los chips que NO son el arrastrado, así casa con el array tras quitarlo
  function locate(clientX: number, clientY: number): { zone: Zone; index: number } {
    let zone: Zone = (ZONES.find(z => board[z].includes(dragKey!)) ?? 'main');
    for (const z of ZONES) {
      const el = zoneEl(z);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
        zone = z;
        break;
      }
    }
    const el = zoneEl(zone)!;
    const chips = [...el.querySelectorAll<HTMLElement>('[data-key]')].filter(c => c.dataset.key !== dragKey);
    let index = chips.length;
    for (let i = 0; i < chips.length; i++) {
      const r = chips[i].getBoundingClientRect();
      if (clientY < r.top + r.height / 2) { index = i; break; }
    }
    return { zone, index };
  }

  function onHandleMove(e: PointerEvent) {
    if (!dragKey) return;
    const { zone, index } = locate(e.clientX, e.clientY);
    const next = moveSection(board, dragKey, zone, index);
    if (!sameBoard(next, board)) board = next;
  }

  function onHandleUp() {
    if (!dragKey) return;
    dragKey = null;
    persist();
  }

  function toggleHidden(key: string) {
    board = toggleSectionHidden(kind, board, key);
    persist();
  }

  const ZONE_LABEL: Record<Zone, string> = { main: 'Main column', rail: 'Side column', hidden: 'Hidden' };
  // en columna única "main column" no significa nada: es simplemente el orden
  let mainLabel = $derived(kind === 'dashboard' ? 'Sections' : ZONE_LABEL.main);
</script>

<div class="dl" bind:this={rootEl}>
  <div class="dl-tabs" role="tablist">
    {#each KINDS as k}
      <button class="dl-tab" class:dl-tab--active={kind === k} role="tab" aria-selected={kind === k} onclick={() => selectKind(k)}>
        {KIND_LABELS[k]}
      </button>
    {/each}
    <button class="dl-reset" onclick={reset} title="Reset to default order">Reset</button>
  </div>

  <div class="dl-columns" class:dl-columns--single={columnZones.length === 1} class:dl-columns--dragging={dragKey !== null}>
    {#each columnZones as z}
      <div class="dl-zone">
        <div class="dl-zone-title">{z === 'main' ? mainLabel : ZONE_LABEL[z]}</div>
        <div class="dl-list" data-zone={z}>
          {#each board[z] as key (key)}
            <div class="dl-chip" class:dl-chip--dragging={dragKey === key} data-key={key}>
              <button
                class="dl-handle"
                aria-label="Drag {sectionLabel(kind, key)}"
                onpointerdown={(e) => onHandleDown(e, key)}
                onpointermove={onHandleMove}
                onpointerup={onHandleUp}
                onpointercancel={onHandleUp}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><circle cx="3" cy="2.5" r="1.1"/><circle cx="9" cy="2.5" r="1.1"/><circle cx="3" cy="6" r="1.1"/><circle cx="9" cy="6" r="1.1"/><circle cx="3" cy="9.5" r="1.1"/><circle cx="9" cy="9.5" r="1.1"/></svg>
              </button>
              <span class="dl-label">{sectionLabel(kind, key)}</span>
              <button class="dl-eye" aria-label="Hide {sectionLabel(kind, key)}" title="Hide" onclick={() => toggleHidden(key)}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              </button>
            </div>
          {/each}
          {#if board[z].length === 0}
            <div class="dl-empty">Empty</div>
          {/if}
        </div>
      </div>
    {/each}
  </div>

  <div class="dl-zone dl-zone--hidden">
    <div class="dl-zone-title">{ZONE_LABEL.hidden}</div>
    <div class="dl-list dl-list--hidden" data-zone="hidden">
      {#each board.hidden as key (key)}
        <div class="dl-chip dl-chip--muted" class:dl-chip--dragging={dragKey === key} data-key={key}>
          <button
            class="dl-handle"
            aria-label="Drag {sectionLabel(kind, key)}"
            onpointerdown={(e) => onHandleDown(e, key)}
            onpointermove={onHandleMove}
            onpointerup={onHandleUp}
            onpointercancel={onHandleUp}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><circle cx="3" cy="2.5" r="1.1"/><circle cx="9" cy="2.5" r="1.1"/><circle cx="3" cy="6" r="1.1"/><circle cx="9" cy="6" r="1.1"/><circle cx="3" cy="9.5" r="1.1"/><circle cx="9" cy="9.5" r="1.1"/></svg>
          </button>
          <span class="dl-label">{sectionLabel(kind, key)}</span>
          <button class="dl-eye" aria-label="Show {sectionLabel(kind, key)}" title="Show" onclick={() => toggleHidden(key)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/><line x1="3" y1="3" x2="21" y2="21"/></svg>
          </button>
        </div>
      {/each}
      {#if board.hidden.length === 0}
        <div class="dl-empty">Drag a section here or tap the eye to hide it</div>
      {/if}
    </div>
  </div>
</div>

<style>
  .dl { display: flex; flex-direction: column; gap: 0.6rem; }
  .dl-tabs { display: flex; align-items: center; gap: 2px; }
  .dl-tab {
    background: none; border: none; color: var(--text-muted);
    padding: 0.25rem 0.6rem; border-radius: var(--radius); cursor: pointer;
    font-size: 0.78rem; font-weight: 500; transition: all 0.05s;
  }
  .dl-tab:hover { color: var(--text); }
  .dl-tab--active { background: var(--accent); color: #fff; }
  .dl-reset {
    margin-left: auto; background: none; border: 1px solid var(--border);
    color: var(--text-muted); padding: 0.2rem 0.55rem; border-radius: var(--radius);
    cursor: pointer; font-size: 0.72rem; transition: all 0.05s;
  }
  .dl-reset:hover { color: var(--accent); border-color: var(--accent); }

  .dl-columns { display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem; }
  .dl-columns--single { grid-template-columns: 1fr; }
  .dl-columns--dragging { user-select: none; }
  @media (max-width: 560px) { .dl-columns { grid-template-columns: 1fr; } }

  .dl-zone { display: flex; flex-direction: column; gap: 0.35rem; }
  .dl-zone-title {
    font-size: 0.66rem; text-transform: uppercase; letter-spacing: 0.05em;
    color: var(--text-muted); font-weight: 600;
  }
  .dl-list {
    display: flex; flex-direction: column; gap: 0.3rem;
    padding: 0.35rem; min-height: 44px;
    background: var(--bg); border: 1px dashed var(--border); border-radius: var(--radius);
  }
  .dl-list--hidden { background: transparent; }

  .dl-chip {
    display: flex; align-items: center; gap: 0.5rem;
    padding: 0.4rem 0.5rem;
    background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius);
  }
  .dl-chip--dragging { opacity: 0.5; border-color: var(--accent); }
  .dl-chip--muted { opacity: 0.75; }
  .dl-chip--muted .dl-label { color: var(--text-muted); text-decoration: line-through; }

  .dl-handle {
    display: flex; align-items: center; justify-content: center;
    background: none; border: none; color: var(--text-muted); cursor: grab;
    padding: 0.15rem; touch-action: none; flex-shrink: 0;
  }
  .dl-handle:active { cursor: grabbing; }
  .dl-handle svg { fill: currentColor; }

  .dl-label { flex: 1; min-width: 0; font-size: 0.82rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .dl-eye {
    display: flex; align-items: center; justify-content: center;
    background: none; border: none; color: var(--text-muted); cursor: pointer;
    padding: 0.15rem; flex-shrink: 0; transition: color 0.05s;
  }
  .dl-eye:hover { color: var(--accent); }

  .dl-empty {
    font-size: 0.72rem; color: var(--text-muted); text-align: center;
    padding: 0.4rem; opacity: 0.7;
  }
</style>
