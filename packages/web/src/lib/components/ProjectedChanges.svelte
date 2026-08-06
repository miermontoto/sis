<script lang="ts">
  import { tick } from 'svelte';
  import { projectionsStore } from '$lib/stores/projections.svelte';
  import { formatDuration } from '$lib/utils/format';
  import IconTrack from '$lib/icons/IconTrack.svelte';
  import IconArtist from '$lib/icons/IconArtist.svelte';
  import IconAlbum from '$lib/icons/IconAlbum.svelte';
  import { getSessionRankDisplay, onSessionRankDisplayChange } from '$lib/api';
  import type { ProjectionResult, RankProjection, SessionRankDisplay } from '$lib/api';

  const RANGE_LABELS: Record<string, string> = { thisYear: 'YTD', all: 'ALL' };
  const TAB_MAP: Record<string, string> = { track: 'tracks', artist: 'artists', album: 'albums' };
  const DISPLACED_LIMIT = 5; // máximo de desplazados listados en el tooltip
  const TOOLTIP_CLOSE_MS = 120; // margen para cruzar del cambio al tooltip sin cerrarlo

  let displayMode = $state<SessionRankDisplay>(getSessionRankDisplay());

  $effect(() => {
    return onSessionRankDisplayChange(() => { displayMode = getSessionRankDisplay(); });
  });

  const ALLOWED_RANGES: Record<string, Set<string>> = {
    'all': new Set(['all']),
    'all+ytd': new Set(['all', 'thisYear']),
  };

  function filterChanges(changes: RankProjection[]): RankProjection[] {
    const allowed = ALLOWED_RANGES[displayMode];
    if (!allowed) return [];
    return changes.filter(c => allowed.has(c.range));
  }

  // en modo solo-ALL la etiqueta de rango es redundante (no hay YTD con qué contrastar)
  function rangeLabel(range: string): string {
    return displayMode === 'all' ? '' : `${RANGE_LABELS[range] ?? range} `;
  }

  function rankingHref(r: ProjectionResult, range: string): string {
    return `/top?tab=${TAB_MAP[r.entityType] ?? 'tracks'}&range=${range === 'thisYear' ? 'thisYear' : 'all'}&focus=${r.entityId}`;
  }

  function bestChange(changes: RankProjection[]): RankProjection | null {
    if (changes.length === 0) return null;
    return changes.reduce((best, c) => Math.abs(c.delta) > Math.abs(best.delta) ? c : best);
  }

  let data = $derived(projectionsStore.data);

  // tooltip de desplazados: fixed (escapa el scroll del sidebar) posicionado por hover.
  // se ancla al borde derecho/inferior del cambio para replicar el antiguo tooltip absoluto.
  type Displaced = RankProjection['displaced'];
  let displacedHover = $state<{ entityType: string; items: Displaced; x: number; y: number } | null>(null);
  let closeTimer: ReturnType<typeof setTimeout> | null = null;

  function openDisplaced(e: MouseEvent, r: ProjectionResult, best: RankProjection) {
    if (best.displaced.length === 0) return;
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    displacedHover = { entityType: r.entityType, items: best.displaced, x: rect.right, y: rect.bottom + 4 };
  }

  function keepDisplaced() {
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
  }

  function scheduleClose() {
    if (closeTimer) clearTimeout(closeTimer);
    closeTimer = setTimeout(() => { displacedHover = null; closeTimer = null; }, TOOLTIP_CLOSE_MS);
  }

  let nameEls = new Map<string, HTMLElement>();
  let overflowing = $state<Set<string>>(new Set());

  function trackOverflow(el: HTMLElement, id: string) {
    nameEls.set(id, el);
    checkOverflows();
    return { destroy() { nameEls.delete(id); } };
  }

  function checkOverflows() {
    tick().then(() => {
      const next = new Set<string>();
      for (const [id, el] of nameEls) {
        if (el.scrollWidth > el.clientWidth) next.add(id);
      }
      overflowing = next;
    });
  }

  $effect(() => {
    void data;
    checkOverflows();
  });
</script>

{#if data && data.sessionTrackCount > 0}
  <div class="session-card">
    <div class="session-header">
      <span class="session-title">Session</span>
      <span class="session-count">{data.sessionTrackCount} tracks · {formatDuration(data.sessionTotalMs)}</span>
    </div>
    {#if displayMode !== 'none' && data.session.some(r => bestChange(filterChanges(r.changes)) !== null)}
      <div class="session-list">
        {#each data.session as r}
          {@const best = bestChange(filterChanges(r.changes))}
          {#if best}
            <div class="session-row">
              <span class="session-thumb" class:session-thumb--art={r.imageUrl} class:session-thumb--round={r.entityType === 'artist'}>
                {#if r.imageUrl}
                  <img class="session-thumb-img" src={r.imageUrl} alt="" loading="lazy" />
                  <span class="session-thumb-badge" aria-hidden="true">
                    {#if r.entityType === 'track'}<IconTrack size={8} />
                    {:else if r.entityType === 'artist'}<IconArtist size={8} />
                    {:else}<IconAlbum size={8} />
                    {/if}
                  </span>
                {:else if r.entityType === 'track'}<IconTrack size={12} />
                {:else if r.entityType === 'artist'}<IconArtist size={12} />
                {:else}<IconAlbum size={12} />
                {/if}
              </span>
              <a href="/{r.entityType}/{r.entityId}" class="session-name" class:session-name--marquee={overflowing.has(r.entityId)} use:trackOverflow={r.entityId}><span class="session-name-text">{r.entityName}</span></a>
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <span class="session-change-wrap" onmouseenter={(e) => openDisplaced(e, r, best)} onmouseleave={scheduleClose}>
                <a href={rankingHref(r, best.range)} class="session-change" class:up={best.delta > 0} class:down={best.delta < 0}>
                  {rangeLabel(best.range)}#{best.currentRank}→#{best.projectedRank}
                </a>
              </span>
            </div>
          {/if}
        {/each}
      </div>
    {/if}
  </div>
{/if}

{#if displacedHover}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="displaced-tooltip"
    style="left: {displacedHover.x}px; top: {displacedHover.y}px;"
    onmouseenter={keepDisplaced}
    onmouseleave={scheduleClose}
  >
    {#each displacedHover.items.slice(0, DISPLACED_LIMIT) as d}
      <div class="displaced-row">
        <span class="displaced-arrow">▲</span>
        {#if d.imageUrl}<img class="displaced-img" src={d.imageUrl} alt="" />{/if}
        <a href="/{displacedHover.entityType}/{d.id}" class="displaced-name">{d.name}</a>
      </div>
    {/each}
    {#if displacedHover.items.length > DISPLACED_LIMIT}
      <div class="displaced-more">+{displacedHover.items.length - DISPLACED_LIMIT} más</div>
    {/if}
  </div>
{/if}

<style>
  .session-card {
    padding: 0.6rem;
    background: linear-gradient(135deg, rgba(74, 158, 255, 0.08), rgba(74, 158, 255, 0.02));
    border: 1px solid rgba(74, 158, 255, 0.15);
    border-radius: var(--radius, 8px);
    font-size: 0.7rem;
    color: var(--text-secondary, #aaa);
  }

  .session-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .session-list {
    margin-top: 0.4rem;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    /* tope ~5 filas; a partir de ahí scroll interno en vez de crecer sin límite */
    max-height: 8rem;
    overflow-y: auto;
    overflow-x: hidden;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.15) transparent;
  }

  .session-list::-webkit-scrollbar {
    width: 4px;
  }

  .session-list::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.15);
    border-radius: 2px;
  }

  .session-title {
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 600;
    color: var(--text-muted, #666);
  }

  .session-count {
    font-size: 0.6rem;
    color: var(--text-muted, #555);
  }

  .session-row {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.15rem 0;
    color: inherit;
    min-width: 0;
  }

  .session-thumb {
    position: relative;
    flex-shrink: 0;
    width: 18px;
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0.6; /* glifo de fallback atenuado */
  }

  /* con imagen real: plena opacidad */
  .session-thumb--art {
    opacity: 1;
  }

  .session-thumb-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.05); /* fondo tenue mientras carga */
  }

  /* artistas en círculo, álbumes/tracks con esquinas suaves */
  .session-thumb--round .session-thumb-img {
    border-radius: 50%;
  }

  /* badge de tipo sobre la portada: recupera la diferenciación track/álbum/artista
     que antes daba el icono, ahora que la miniatura ocupa su lugar */
  .session-thumb-badge {
    position: absolute;
    right: -2px;
    bottom: -2px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 11px;
    height: 11px;
    border-radius: 50%;
    color: var(--text, #e0e8e8);
    background: var(--bg, #080a0c);
    box-shadow: 0 0 0 1.5px var(--bg-card, #0f1214);
  }

  .session-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-decoration: none;
    color: inherit;
    text-overflow: ellipsis;
  }

  .session-name:hover {
    color: var(--text-primary, #fff);
  }

  .session-name--marquee {
    text-overflow: clip;
    mask-image: linear-gradient(to right, transparent 0, #000 4%, #000 96%, transparent 100%);
  }

  .session-name--marquee .session-name-text {
    display: inline-block;
    padding-left: 100%;
    animation: session-marquee 8s linear infinite;
  }

  @keyframes session-marquee {
    0% { transform: translateX(0); }
    100% { transform: translateX(-100%); }
  }

  .session-change-wrap {
    flex-shrink: 0;
  }

  .session-change {
    font-weight: 600;
    font-size: 0.6rem;
    font-variant-numeric: tabular-nums;
    text-decoration: none;
  }

  .session-change:hover {
    text-decoration: underline;
  }

  .session-change.up {
    color: #1db954;
  }

  .session-change.down {
    color: #e34234;
  }

  /* fixed + translateX(-100%): ancla el borde derecho en la coordenada x del cambio,
     escapando el overflow del sidebar y del scroll interno de la lista */
  .displaced-tooltip {
    position: fixed;
    transform: translateX(-100%);
    z-index: 1000;
    padding: 0.4rem 0.5rem;
    background: var(--bg-elevated, #1e1e1e);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    white-space: nowrap;
    min-width: max-content;
  }

  .displaced-row {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.1rem 0;
    font-size: 0.6rem;
    color: var(--text-secondary, #aaa);
  }

  .displaced-arrow {
    color: #1db954;
    font-size: 0.5rem;
    flex-shrink: 0;
  }

  .displaced-img {
    width: 16px;
    height: 16px;
    border-radius: 2px;
    object-fit: cover;
    flex-shrink: 0;
  }

  .displaced-name {
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 160px;
    text-decoration: none;
    color: inherit;
  }

  .displaced-name:hover {
    color: var(--text-primary, #fff);
  }

  .displaced-more {
    font-size: 0.55rem;
    color: var(--text-muted, #666);
    padding-top: 0.1rem;
  }
</style>
