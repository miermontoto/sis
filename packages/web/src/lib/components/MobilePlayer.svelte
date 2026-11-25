<script lang="ts">
  // now playing del móvil, con el lenguaje del escritorio y no el de un reproductor:
  // el mini player es la fila live de las listas (con el progreso como relleno), la
  // hoja es la ficha del tema que suena con los controles anclados al pie, y los
  // momentos de la sesión se pegan encima de la fila. Sustituye a la hoja tipo
  // spotify (carátula enorme centrada) y a la tarjeta flotante de momentos.
  // La hoja va en el historial (shallow routing, page.state): el botón atrás la
  // cierra y navegar desde dentro la cierra sola
  import { untrack } from 'svelte';
  import { cubicOut } from 'svelte/easing';
  import { page } from '$app/state';
  import { pushState } from '$app/navigation';
  import NowPlaying from './NowPlaying.svelte';
  import NowPlayingSheet from './NowPlayingSheet.svelte';
  import SessionMoment from './SessionMoment.svelte';
  import DetailBackdrop from './DetailBackdrop.svelte';
  import MetricMeta from './MetricMeta.svelte';
  import IconRankUp from '$lib/icons/IconRankUp.svelte';
  import IconChevronRight from '$lib/icons/IconChevronRight.svelte';
  import { nowPlayingStore } from '$lib/stores/now-playing.svelte';
  import { projectionsStore } from '$lib/stores/projections.svelte';
  import { playUpdatesStore } from '$lib/stores/play-updates.svelte';
  import { sessionUpCount } from '$lib/utils/session-ranks';
  import { resolveEntityColor } from '$lib/utils/color';
  import {
    api, getRankingMetric, getSessionRankDisplay, onSessionRankDisplayChange,
    type EntityCard, type SessionRankDisplay, type SessionTrackingDisplay,
  } from '$lib/api';

  let { sessionTracking }: { sessionTracking: SessionTrackingDisplay } = $props();

  const SHEET_MS = 260;
  // arrastre hacia abajo desde el asa que cierra la hoja; menos vuelve a su sitio
  const DRAG_CLOSE_PX = 90;
  // lo que se queda en la fila el aviso de lo que subió mientras no mirabas
  const NOTICE_MS = 5_000;
  // holgura bajo la barra de arriba para dar una sección por alcanzada
  const JUMP_SLOP_PX = 8;

  type Jump = 'track' | 'session' | 'next';

  let rankMode = $state<SessionRankDisplay>(getSessionRankDisplay());
  $effect(() => onSessionRankDisplayChange(() => { rankMode = getSessionRankDisplay(); }));

  let track = $derived(nowPlayingStore.data?.playing ? nowPlayingStore.data.track ?? null : null);
  let trackId = $derived(track?.id ?? null);
  let controllable = $derived(nowPlayingStore.data?.controllable !== false);
  let section = $derived(page.state.nowPlayingSheet);
  // la sesión del móvil sólo con "Mobile+Desktop"; en "Desktop" se queda en el sidebar
  let session = $derived(sessionTracking === 'all' && (projectionsStore.data?.sessionTrackCount ?? 0) > 0 ? projectionsStore.data : null);
  let upCount = $derived(session ? sessionUpCount(session.session, rankMode) : 0);
  let unseen = $derived(session ? projectionsStore.unseen : 0);

  let momentActive = $state(false);
  let sheetEl = $state<HTMLElement | null>(null);
  let barEl = $state<HTMLElement | null>(null);
  let heroEl = $state<HTMLElement | null>(null);
  let sessionEl = $state<HTMLElement | null>(null);
  let nextEl = $state<HTMLElement | null>(null);
  // el hero ya no se ve: la fila del tema baja a los controles del pie y la barra de
  // arriba se vuelve opaca
  let docked = $state(false);
  let activeJump = $state<Jump>('track');

  let jumps = $derived([
    { key: 'track' as const, label: 'Track', el: heroEl },
    { key: 'session' as const, label: 'Session', el: sessionEl },
    { key: 'next' as const, label: 'Up next', el: nextEl },
  ].filter((j): j is { key: Jump; label: string; el: HTMLElement } => j.el !== null));

  function openSheet(target: 'player' | 'session') {
    // abrir la hoja es ver la sesión: lo que subió sin mirar deja de estar pendiente
    projectionsStore.markSeen();
    notice = null;
    if (!page.state.nowPlayingSheet) pushState('', { nowPlayingSheet: target });
  }

  function closeSheet() {
    if (page.state.nowPlayingSheet) history.back();
  }

  // sin nada sonando la hoja no tiene ficha que enseñar
  $effect(() => {
    if (section && !track) untrack(closeSheet);
  });

  // por rects y no con scrollIntoView: a mitad de la entrada la hoja está desplazada y
  // el navegador movería también el documento de debajo. La barra de arriba es sticky
  // y taparía el título de la sección
  function scrollToEl(el: HTMLElement, smooth: boolean) {
    if (!sheetEl) return;
    const top = el === heroEl ? 0 : sheetEl.scrollTop + el.getBoundingClientRect().top - sheetEl.getBoundingClientRect().top - (barEl?.offsetHeight ?? 0);
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    sheetEl.scrollTo({ top, behavior: smooth && !reduce ? 'smooth' : 'auto' });
  }

  // al abrir: foco dentro (lector de pantalla, Escape). Abierta desde el chip o un
  // momento, salta a la sesión en cuanto existe su sección, una sola vez por apertura
  let pendingJump = false;
  $effect(() => {
    if (!sheetEl) return;
    untrack(() => {
      sheetEl?.focus({ preventScroll: true });
      pendingJump = section === 'session';
    });
  });

  $effect(() => {
    if (!sheetEl || !sessionEl || !pendingJump) return;
    pendingJump = false;
    untrack(() => { if (sessionEl) scrollToEl(sessionEl, false); });
  });

  $effect(() => {
    if (!sheetEl || !heroEl) return;
    const io = new IntersectionObserver(([entry]) => { docked = !entry.isIntersecting; }, {
      root: sheetEl,
      rootMargin: `-${barEl?.offsetHeight ?? 0}px 0px 0px 0px`,
    });
    io.observe(heroEl);
    return () => { io.disconnect(); docked = false; };
  });

  // sección activa del salto: la última cuyo comienzo ya pasó bajo la barra; al fondo
  // de la hoja, la última (una sección corta nunca llega arriba)
  let scrollFrame = 0;
  function onSheetScroll() {
    if (scrollFrame) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0;
      if (!sheetEl) return;
      const atEnd = sheetEl.scrollTop + sheetEl.clientHeight >= sheetEl.scrollHeight - JUMP_SLOP_PX;
      const edge = sheetEl.getBoundingClientRect().top + (barEl?.offsetHeight ?? 0) + JUMP_SLOP_PX;
      activeJump = atEnd && jumps.length > 0
        ? jumps[jumps.length - 1].key
        : jumps.reduce<Jump>((active, j) => j.el.getBoundingClientRect().top <= edge ? j.key : active, 'track');
    });
  }

  // tinte del fondo: el color del álbum (manual o extraído), como los heroes
  let tint = $state('');
  $effect(() => {
    const album = track?.album;
    if (!section || !album) return;
    let cancelled = false;
    resolveEntityColor(album.color, album.imageUrl).then((rgb) => { if (!cancelled) tint = rgb.join(','); });
    return () => { cancelled = true; };
  });

  // lo que subió sin nadie mirando, dicho una vez en la fila: al llegar el lote con la
  // app delante (los plays de la ausencia aterrizan justo al volver) o al volver con
  // algo ya contado
  let notice = $state<string | null>(null);
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  let lastAwaySeq = projectionsStore.away?.seq ?? 0;

  function showNotice(count: number) {
    notice = `${count} ${count === 1 ? 'move' : 'moves'} while away`;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { notice = null; }, NOTICE_MS);
  }

  $effect(() => {
    const batch = projectionsStore.away;
    if (!batch || batch.seq <= lastAwaySeq) return;
    lastAwaySeq = batch.seq;
    if (session && !section && document.visibilityState === 'visible') untrack(() => showNotice(batch.count));
  });

  function onVisibility() {
    if (document.visibilityState === 'visible' && unseen > 0 && !section) showNotice(unseen);
  }

  $effect(() => () => clearTimeout(noticeTimer));

  // solo-last.fm: sin controles, la fila lleva la cifra del tema como cualquier fila
  // de lista. La ficha vale hasta que cambia el historial: se relee con cada play
  let figureCard = $state<EntityCard | null>(null);
  $effect(() => {
    const id = trackId;
    void playUpdatesStore.confirmed?.seq;
    figureCard = null;
    if (!id || controllable) return;
    const ctrl = new AbortController();
    api.entityCard('track', id, ctrl.signal).then((c) => { if (!ctrl.signal.aborted) figureCard = c; }).catch(() => {});
    return () => ctrl.abort();
  });

  function slideUp(_node: HTMLElement) {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    return { duration: reduce ? 0 : SHEET_MS, easing: cubicOut, css: (t: number) => `transform: translateY(${(1 - t) * 100}%)` };
  }

  let dragStart: number | null = null;
  let dragY = $state(0);

  function dragDown(e: PointerEvent) {
    dragStart = e.clientY;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function dragMove(e: PointerEvent) {
    if (dragStart !== null) dragY = Math.max(0, e.clientY - dragStart);
  }

  function dragEnd() {
    if (dragStart === null) return;
    const close = dragY > DRAG_CLOSE_PX;
    dragStart = null;
    dragY = 0;
    if (close) closeSheet();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && section) closeSheet();
  }
</script>

<svelte:window onkeydown={onKey} />
<svelte:document onvisibilitychange={onVisibility} />

<div class="mobile-player">
  <div class="mp-dock">
    <div class="mp-row">
      {#if session}
        <SessionMoment onopen={() => openSheet('session')} bind:active={momentActive} />
      {/if}
      <NowPlaying mini fused={!!session && momentActive} {notice} onopen={openSheet}>
        {#snippet sessionChip()}
          {#if session && upCount > 0}
            <span class="mp-chip" class:mp-chip--unseen={unseen > 0} data-open="session" title="{upCount} up this session">
              <IconRankUp size={8} />{upCount}
            </span>
          {/if}
        {/snippet}
        {#snippet figure()}
          {#if figureCard}
            <span class="mp-figure"><MetricMeta playCount={figureCard.playCount} totalMs={figureCard.totalMs} metric={getRankingMetric()} /></span>
          {/if}
        {/snippet}
      </NowPlaying>
    </div>
  </div>

  {#if section && track}
    <div
      class="mp-sheet"
      role="dialog"
      aria-modal="true"
      aria-label="Now playing"
      tabindex="-1"
      bind:this={sheetEl}
      onscroll={onSheetScroll}
      transition:slideUp
      style:transform={dragY ? `translateY(${dragY}px)` : undefined}
    >
      <DetailBackdrop imageUrl={track.album?.imageUrl ?? null} color={tint} mode="blur" />
      <div class="mp-sheet-top" class:mp-sheet-top--solid={docked} bind:this={barEl}>
        <!-- el asa es un atajo táctil; el camino accesible es el botón de cerrar -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="mp-grab" onpointerdown={dragDown} onpointermove={dragMove} onpointerup={dragEnd} onpointercancel={dragEnd}>
          <span></span>
        </div>
        <div class="mp-sheet-bar">
          <button type="button" class="mp-close" title="Close" aria-label="Close now playing" onclick={closeSheet}>
            <IconChevronRight size={18} />
          </button>
          {#if jumps.length > 1}
            <nav class="mp-jumps" aria-label="Sections">
              {#each jumps as jump (jump.key)}
                <button type="button" class="range-btn" class:active={activeJump === jump.key} aria-current={activeJump === jump.key ? 'true' : undefined} onclick={() => scrollToEl(jump.el, true)}>{jump.label}</button>
              {/each}
            </nav>
          {/if}
        </div>
      </div>
      <div class="mp-sheet-body">
        <NowPlayingSheet {track} showSession={!!session} bind:heroEl bind:sessionEl bind:nextEl />
      </div>
      <div class="mp-deck">
        <NowPlaying deck {docked} />
      </div>
    </div>
  {/if}
</div>

<style>
  /* sólo existe en el layout móvil (app.css lo enseña bajo 768px) */
  .mobile-player {
    display: none;
  }

  @media (max-width: 768px) {
    .mobile-player {
      display: block;
    }
  }

  /* la fila va separada del filo del panel, como una fila de lista dentro de su
     card; los momentos se apoyan en su filo de arriba */
  .mp-dock {
    padding: 0.375rem 0.375rem 0;
  }

  .mp-row {
    position: relative;
  }

  /* el chip de la sesión: su contenedor azul con la cifra verde de lo que sube. Va
     dentro del área que abre la hoja (data-open la abre por la sesión) */
  .mp-chip {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
    height: 24px;
    padding: 0 0.375rem;
    margin-right: 0.125rem;
    border: 1px solid color-mix(in srgb, var(--info) 25%, transparent);
    border-radius: var(--radius);
    background: color-mix(in srgb, var(--info) 10%, transparent);
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--accent);
  }

  /* subió algo sin que lo vieras: la marca es el punto cuadrado del logo, en azul,
     hasta que se abre la hoja */
  .mp-chip--unseen {
    border-color: var(--info);
  }

  .mp-chip--unseen::after {
    content: '';
    position: absolute;
    top: -4px;
    right: -4px;
    width: 7px;
    height: 7px;
    background: var(--info);
    box-shadow: 0 0 0 2px var(--bg-card);
  }

  .mp-figure {
    flex-shrink: 0;
    padding-right: 0.25rem;
    text-align: right;
    line-height: 1.3;
  }

  /* a pantalla completa, por encima del resto del panel inferior. columna para que
     los controles del pie bajen al fondo aunque la ficha sea corta */
  .mp-sheet {
    position: fixed;
    inset: 0;
    z-index: 10;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    overscroll-behavior: contain;
    background: var(--bg);
    outline: none;
  }

  /* barra de arriba sticky: transparente sobre el fondo del hero y opaca en cuanto el
     hero se va, que entonces el contenido pasa por debajo */
  .mp-sheet-top {
    position: sticky;
    top: 0;
    z-index: 2;
    padding-top: var(--safe-top);
    transition: background 0.12s, box-shadow 0.12s;
  }

  .mp-sheet-top--solid {
    background: var(--bg);
    box-shadow: 0 1px var(--border);
  }

  .mp-grab {
    display: flex;
    justify-content: center;
    padding: 0.5rem 0 0.125rem;
    touch-action: none;
    cursor: grab;
  }

  .mp-grab span {
    width: 38px;
    height: 4px;
    border-radius: 2px;
    background: var(--fg-a15);
  }

  .mp-sheet-bar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0 max(1rem, var(--safe-right)) 0.375rem max(0.5rem, var(--safe-left));
  }

  .mp-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    padding: 0;
    border: none;
    border-radius: var(--radius);
    background: none;
    color: var(--text-muted);
    cursor: pointer;
  }

  /* el chevron de la librería apunta a la derecha: hacia abajo = cerrar */
  .mp-close :global(svg) {
    transform: rotate(90deg);
  }

  .mp-jumps {
    display: flex;
    gap: 0.25rem;
    margin-left: auto;
  }

  .mp-jumps .range-btn {
    padding: 0.3rem 0.55rem;
    font-size: var(--fs-2xs);
  }

  .mp-sheet-body {
    position: relative;
    z-index: 1;
    flex: 1 0 auto;
    padding: 0 max(1rem, var(--safe-right)) 0.5rem max(1rem, var(--safe-left));
  }

  /* los controles, anclados al pie donde llega el pulgar, con el degradado verde de
     lo que suena (la tarjeta de escritorio). esquivan la barra nativa de ios
     (--bottom-chrome), que va por encima del webview */
  .mp-deck {
    position: sticky;
    bottom: 0;
    z-index: 2;
    padding: 0.5rem max(1rem, var(--safe-right)) calc(0.75rem + var(--bottom-chrome)) max(1rem, var(--safe-left));
    background: var(--live-bg), var(--bg-card);
    border-top: 1px solid var(--accent-a25);
    box-shadow: 0 -16px 28px -18px color-mix(in srgb, var(--shadow-color) 60%, transparent);
  }
</style>
