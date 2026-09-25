<script lang="ts">
  import { projectionsStore } from '$lib/stores/projections.svelte';
  import { formatDuration } from '$lib/utils/format';
  import { marquee } from '$lib/utils/marquee';
  import IconTrack from '$lib/icons/IconTrack.svelte';
  import IconArtist from '$lib/icons/IconArtist.svelte';
  import IconAlbum from '$lib/icons/IconAlbum.svelte';
  import DisplacedTooltip from '$lib/components/DisplacedTooltip.svelte';
  import { getSessionRankDisplay, onSessionRankDisplayChange } from '$lib/api';
  import type { ProjectionResult, RankProjection, SessionRankDisplay } from '$lib/api';

  const RANGE_LABELS: Record<string, string> = { thisYear: 'YTD', all: 'ALL' };
  const TAB_MAP: Record<string, string> = { track: 'tracks', artist: 'artists', album: 'albums' };
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
</script>

{#if data && data.sessionTrackCount > 0}
  <div class="session-card">
    <a class="session-header" href="/history">
      <span class="session-title">Session</span>
      <span class="session-count">{data.sessionTrackCount} tracks · {formatDuration(data.sessionTotalMs)}</span>
    </a>
    {#if displayMode !== 'none' && data.session.some(r => bestChange(filterChanges(r.changes)) !== null)}
      <div class="session-list">
        <!-- keyado a propósito: la respuesta llega reordenada (artista → álbum → tema,
             luego por puesto proyectado), así que sin clave svelte reaprovecha la fila
             por índice y le reescribe el texto. El marquee del nombre heredaba entonces
             la animación a medio recorrido de la fila anterior y el título entraba ya
             desplazado, a veces fuera de vista -->
        {#each data.session as r (`${r.entityType}:${r.entityId}`)}
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
              <a href="/{r.entityType}/{r.entityId}" class="session-name marquee-line" use:marquee={r.entityName}><span>{r.entityName}</span></a>
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
  <DisplacedTooltip
    entityType={displacedHover.entityType}
    items={displacedHover.items}
    x={displacedHover.x}
    y={displacedHover.y}
    onenter={keepDisplaced}
    onleave={scheduleClose}
  />
{/if}

<style>
  .session-card {
    position: relative;
    padding: 0.6rem;
    background: linear-gradient(135deg, rgba(74, 158, 255, 0.08), rgba(74, 158, 255, 0.02));
    border: 1px solid rgba(74, 158, 255, 0.15);
    border-radius: var(--radius, 8px);
    font-size: var(--fs-xs);
    color: var(--text-secondary, #aaa);
  }

  /* la cabecera es el enlace al historial. la tarjeta entera no puede serlo
     (las filas ya llevan sus propios enlaces y se anidarían <a>), así que el
     enlace estira un overlay sobre toda la tarjeta y la lista se pone por
     encima: pinchar en cualquier hueco lleva al historial, las filas siguen
     yendo a lo suyo */
  .session-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    text-decoration: none;
    color: inherit;
  }

  .session-header::after {
    content: '';
    position: absolute;
    inset: 0;
  }

  .session-header:hover .session-title,
  .session-header:hover .session-count {
    color: var(--text-primary, #fff);
  }

  .session-list {
    position: relative; /* por encima del overlay de la cabecera */
    z-index: 1;
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
    font-size: var(--fs-xs);
    text-transform: uppercase;
    letter-spacing: var(--track);
    font-weight: 600;
    color: var(--text-muted, #666);
  }

  .session-count {
    font-size: var(--fs-2xs);
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

  /* el recorte, el difuminado y el marquee los pone `.marquee-line` (app.css) con
     `use:marquee`. `flex: 1` no es solo reparto: blockifica el <a>, y sin eso la
     action mide clientWidth 0 y nunca detecta el desborde */
  .session-name {
    flex: 1;
    min-width: 0;
    text-decoration: none;
    color: inherit;
  }

  .session-name:hover {
    color: var(--text-primary, #fff);
  }

  .session-change-wrap {
    flex-shrink: 0;
  }

  .session-change {
    font-weight: 600;
    font-size: var(--fs-2xs);
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
    color: var(--negative);
  }

</style>
