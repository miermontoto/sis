<script lang="ts">
  // now playing del móvil: el mini player sobre las pestañas, su hoja a pantalla
  // completa (reproductor + sesión) y los momentos de la sesión. Sustituye a la
  // banda de sesión que se desplazaba sola: en reposo la sesión es una línea
  // quieta del mini player, y la lista entera vive en la hoja.
  // La hoja va en el historial (shallow routing, page.state): el botón atrás la
  // cierra y navegar desde dentro la cierra sola
  import { untrack } from 'svelte';
  import { cubicOut } from 'svelte/easing';
  import { page } from '$app/state';
  import { pushState } from '$app/navigation';
  import NowPlaying from './NowPlaying.svelte';
  import ProjectedChanges from './ProjectedChanges.svelte';
  import SessionMoment from './SessionMoment.svelte';
  import DetailBackdrop from './DetailBackdrop.svelte';
  import IconRankUp from '$lib/icons/IconRankUp.svelte';
  import { nowPlayingStore } from '$lib/stores/now-playing.svelte';
  import { projectionsStore } from '$lib/stores/projections.svelte';
  import { sessionUpCount } from '$lib/utils/session-ranks';
  import { resolveEntityColor } from '$lib/utils/color';
  import { getSessionRankDisplay, onSessionRankDisplayChange, type SessionRankDisplay, type SessionTrackingDisplay } from '$lib/api';

  let { sessionTracking }: { sessionTracking: SessionTrackingDisplay } = $props();

  const SHEET_MS = 260;
  // arrastre hacia abajo desde el asa que cierra la hoja; menos vuelve a su sitio
  const DRAG_CLOSE_PX = 90;

  let rankMode = $state<SessionRankDisplay>(getSessionRankDisplay());
  $effect(() => onSessionRankDisplayChange(() => { rankMode = getSessionRankDisplay(); }));

  let track = $derived(nowPlayingStore.data?.playing ? nowPlayingStore.data.track ?? null : null);
  let section = $derived(page.state.nowPlayingSheet);
  // la sesión del móvil sólo con "Mobile+Desktop"; en "Desktop" se queda en el sidebar
  let session = $derived(sessionTracking === 'all' && (projectionsStore.data?.sessionTrackCount ?? 0) > 0 ? projectionsStore.data : null);
  let upCount = $derived(session ? sessionUpCount(session.session, rankMode) : 0);

  let sheetEl = $state<HTMLElement | null>(null);
  let sessionEl = $state<HTMLElement | null>(null);

  function openSheet(target: 'player' | 'session') {
    if (!page.state.nowPlayingSheet) pushState('', { nowPlayingSheet: target });
  }

  function closeSheet() {
    if (page.state.nowPlayingSheet) history.back();
  }

  // sin nada sonando la hoja no tiene reproductor que enseñar
  $effect(() => {
    if (section && !track) untrack(closeSheet);
  });

  // al abrir: foco dentro (lector de pantalla, Escape) y, si se abrió desde la
  // línea de sesión o un momento, directo a la sesión
  $effect(() => {
    if (!sheetEl) return;
    untrack(() => {
      sheetEl?.focus({ preventScroll: true });
      // por rects y no con scrollIntoView: a mitad de la entrada la hoja está
      // desplazada y el navegador movería también el documento de debajo
      if (section === 'session' && sheetEl && sessionEl) sheetEl.scrollTop += sessionEl.getBoundingClientRect().top - sheetEl.getBoundingClientRect().top;
    });
  });

  // tinte del fondo: el color del álbum (manual o extraído), como los heroes
  let tint = $state('');
  $effect(() => {
    const album = track?.album;
    if (!section || !album) return;
    let cancelled = false;
    resolveEntityColor(album.color, album.imageUrl).then((rgb) => { if (!cancelled) tint = rgb.join(','); });
    return () => { cancelled = true; };
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

<div class="mobile-player">
  {#if session}
    <SessionMoment onopen={() => openSheet('session')} />
  {/if}
  <NowPlaying mini onopen={openSheet}>
    {#snippet sessionLine()}
      {#if session}
        <span class="mp-session-line" data-open="session">
          Session
          {#if upCount > 0}<span class="mp-session-up"><IconRankUp size={8} />{upCount}</span>{/if}
          · {session.sessionTrackCount} tracks
        </span>
      {/if}
    {/snippet}
  </NowPlaying>

  {#if section && track}
    <div
      class="mp-sheet"
      role="dialog"
      aria-modal="true"
      aria-label="Now playing"
      tabindex="-1"
      bind:this={sheetEl}
      transition:slideUp
      style:transform={dragY ? `translateY(${dragY}px)` : undefined}
    >
      <DetailBackdrop imageUrl={track.album?.imageUrl ?? null} color={tint} mode="blur" />
      <!-- el asa es un atajo táctil; el camino accesible es el botón de cerrar de la hoja -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="mp-grab" onpointerdown={dragDown} onpointermove={dragMove} onpointerup={dragEnd} onpointercancel={dragEnd}>
        <span></span>
      </div>
      <div class="mp-sheet-body">
        <NowPlaying sheet onclose={closeSheet} />
        {#if session}
          <div class="mp-session" bind:this={sessionEl}>
            <ProjectedChanges variant="sheet" />
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  /* sólo existe en el layout móvil (app.css lo enseña bajo 768px). sin caja propia:
     los momentos se anclan al panel inferior fijo */
  .mobile-player {
    display: none;
  }

  @media (max-width: 768px) {
    .mobile-player {
      display: block;
    }
  }

  .mp-session-line {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    overflow: hidden;
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
    font-weight: 600;
    line-height: 1.3;
    letter-spacing: var(--track);
    text-transform: uppercase;
    color: var(--info);
  }

  .mp-session-up {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    color: var(--accent);
  }

  /* a pantalla completa, por encima del resto del panel inferior. el pie esquiva
     la barra nativa de ios (--bottom-chrome), que va por encima del webview */
  .mp-sheet {
    position: fixed;
    inset: 0;
    z-index: 10;
    overflow-y: auto;
    overscroll-behavior: contain;
    background: var(--bg);
    outline: none;
  }

  .mp-grab {
    position: relative;
    z-index: 1;
    display: flex;
    justify-content: center;
    padding: calc(0.5rem + var(--safe-top)) 0 0.25rem;
    touch-action: none;
    cursor: grab;
  }

  .mp-grab span {
    width: 38px;
    height: 4px;
    border-radius: 2px;
    background: var(--fg-a15);
  }

  .mp-sheet-body {
    position: relative;
    z-index: 1;
    padding: 0 max(1rem, var(--safe-right)) calc(1.5rem + var(--bottom-chrome)) max(1rem, var(--safe-left));
  }

  .mp-session {
    margin-top: var(--detail-gap);
  }
</style>
