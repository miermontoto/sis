<script lang="ts">
  import { projectionsStore } from '$lib/stores/projections.svelte';
  import { nowPlayingStore } from '$lib/stores/now-playing.svelte';
  import { formatDuration } from '$lib/utils/format';
  import { marquee } from '$lib/utils/marquee';
  import { bestChange, filterChanges, rangeLabel, rangeName, rankingHref, visibleSession } from '$lib/utils/session-ranks';
  import IconTrack from '$lib/icons/IconTrack.svelte';
  import IconArtist from '$lib/icons/IconArtist.svelte';
  import IconAlbum from '$lib/icons/IconAlbum.svelte';
  import DisplacedTooltip from '$lib/components/DisplacedTooltip.svelte';
  import TrackItem from '$lib/components/TrackItem.svelte';
  import { getSessionRankDisplay, onSessionRankDisplayChange } from '$lib/api';
  import type { ProjectionResult, RankProjection, SessionRankDisplay } from '$lib/api';

  // sheet: la sección de la hoja de now playing del móvil (filas táctiles, las dos
  // ventanas a la vez y a quién adelanta cada una al tocar las cifras)
  let { variant = 'card' }: { variant?: 'card' | 'sheet' } = $props();

  const TOOLTIP_CLOSE_MS = 120; // margen para cruzar del cambio al tooltip sin cerrarlo
  const DISPLACED_LIMIT = 5; // desplazados listados por ventana al desplegar una fila
  // grupos de la hoja, en el orden en que llega la respuesta (artista → álbum → tema)
  const SHEET_GROUPS: { type: ProjectionResult['entityType']; label: string }[] = [
    { type: 'artist', label: 'Artists' },
    { type: 'album', label: 'Albums' },
    { type: 'track', label: 'Tracks' },
  ];

  let displayMode = $state<SessionRankDisplay>(getSessionRankDisplay());

  $effect(() => {
    return onSessionRankDisplayChange(() => { displayMode = getSessionRankDisplay(); });
  });

  const entryKey = (r: ProjectionResult) => `${r.entityType}:${r.entityId}`;

  let data = $derived(projectionsStore.data);
  let visible = $derived(data ? visibleSession(data.session, displayMode) : []);

  // filas desplegadas de la hoja (a quién adelanta cada ventana)
  let expanded = $state<ReadonlySet<string>>(new Set());
  function toggleExpanded(key: string) {
    const next = new Set(expanded);
    if (!next.delete(key)) next.add(key);
    expanded = next;
  }

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

{#if variant === 'sheet'}
  {#if data && data.sessionTrackCount > 0}
    <section class="session-sheet">
      <div class="section-header session-sheet-header">
        <h2 class="section-title">This session</h2>
        <span class="session-count">{data.sessionTrackCount} tracks · {formatDuration(data.sessionTotalMs)}</span>
        <a class="session-sheet-history" href="/history">History</a>
      </div>
      {#if visible.length === 0}
        <p class="session-sheet-empty">No rank changes yet</p>
      {/if}
      {#each SHEET_GROUPS as group (group.type)}
        {@const rows = visible.filter(v => v.result.entityType === group.type)}
        {#if rows.length > 0}
          <div class="session-sheet-group">{group.label}</div>
          <div class="track-list session-sheet-list">
            {#each rows as { result: r, changes } (entryKey(r))}
              {@const best = bestChange(changes)!}
              {@const open = expanded.has(entryKey(r))}
              {#snippet passedLine()}passed {best.displaced[0].name}{#if best.displaced.length > 1}{' '}+{best.displaced.length - 1}{/if}{/snippet}
              {#snippet cells()}
                <button type="button" class="session-cells" aria-expanded={open} aria-label="Who {r.entityName} passed" onclick={() => toggleExpanded(entryKey(r))}>
                  {#each changes as c (c.range)}
                    <span class="session-cell" class:up={c.delta > 0} class:down={c.delta < 0}>
                      {#if displayMode !== 'all'}<span class="session-cell-range">{rangeName(c.range)}</span>{/if}
                      <span class="session-cell-value">#{c.currentRank}→#{c.projectedRank}</span>
                    </span>
                  {/each}
                </button>
              {/snippet}
              <div class="session-sheet-entry" class:session-sheet-entry--open={open}>
                <TrackItem
                  name={r.entityName}
                  nameHref="/{r.entityType}/{r.entityId}"
                  imageUrl={r.imageUrl}
                  imageHref="/{r.entityType}/{r.entityId}"
                  imageRound={r.entityType === 'artist'}
                  isLive={nowPlayingStore.isLive(r.entityType, r.entityId)}
                  entity={{ type: r.entityType, id: r.entityId, name: r.entityName, imageUrl: r.imageUrl }}
                  subtitle={best.displaced.length > 0 ? passedLine : undefined}
                  meta={cells}
                />
                {#if open}
                  <div class="session-passed">
                    {#each changes as c (c.range)}
                      <div class="session-passed-line">
                        <a href={rankingHref(r, c.range)} class="session-change" class:up={c.delta > 0} class:down={c.delta < 0}>{rangeLabel(c.range, displayMode)}#{c.currentRank}→#{c.projectedRank}</a>
                        {#if c.displaced.length > 0}
                          <span>passed</span>
                          {#each c.displaced.slice(0, DISPLACED_LIMIT) as d (d.id)}
                            <a class="session-passed-item" href="/{r.entityType}/{d.id}">
                              {#if d.imageUrl}<img src={d.imageUrl} alt="" class:round={r.entityType === 'artist'} />{/if}{d.name}
                            </a>
                          {/each}
                          {#if c.displaced.length > DISPLACED_LIMIT}<span class="session-passed-more">+{c.displaced.length - DISPLACED_LIMIT} more</span>{/if}
                        {:else}
                          <span>another session pick passed it</span>
                        {/if}
                      </div>
                    {/each}
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      {/each}
    </section>
  {/if}
{:else if data && data.sessionTrackCount > 0}
  <div class="session-card">
    <a class="session-header" href="/history">
      <span class="session-title">Session</span>
      <span class="session-count">{data.sessionTrackCount} tracks · {formatDuration(data.sessionTotalMs)}</span>
    </a>
    {#if visible.length > 0}
      <div class="session-list">
        <!-- keyado a propósito: la respuesta llega reordenada (artista → álbum → tema,
             luego por puesto proyectado), así que sin clave svelte reaprovecha la fila
             por índice y le reescribe el texto. El marquee del nombre heredaba entonces
             la animación a medio recorrido de la fila anterior y el título entraba ya
             desplazado, a veces fuera de vista -->
        {#each data.session as r (`${r.entityType}:${r.entityId}`)}
          {@const best = bestChange(filterChanges(r.changes, displayMode))}
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
                  {rangeLabel(best.range, displayMode)}#{best.currentRank}→#{best.projectedRank}
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
    background: linear-gradient(135deg, color-mix(in srgb, var(--info) 8%, transparent), color-mix(in srgb, var(--info) 2%, transparent));
    border: 1px solid color-mix(in srgb, var(--info) 15%, transparent);
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
    color: var(--text);
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
    scrollbar-color: var(--fg-a15) transparent;
  }

  .session-list::-webkit-scrollbar {
    width: 4px;
  }

  .session-list::-webkit-scrollbar-thumb {
    background: var(--fg-a15);
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
    background: var(--fg-a05); /* fondo tenue mientras carga */
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
    color: var(--text);
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
    color: var(--accent);
  }

  .session-change.down {
    color: var(--negative);
  }

  /* variante sheet: sección de la hoja de now playing del móvil. filas táctiles
     (TrackItem) agrupadas por tipo; las cifras son un botón que despliega a
     quién adelanta cada ventana, que en táctil no tiene tooltip */
  .session-sheet-header {
    margin-top: 0;
    gap: 0.6rem;
    justify-content: flex-start;
  }

  .session-sheet-history {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
    letter-spacing: var(--track);
    text-transform: uppercase;
    color: var(--info);
    text-decoration: none;
  }

  .session-sheet-empty {
    font-size: var(--fs-sm);
    color: var(--text-muted);
  }

  .session-sheet-group {
    margin: 0.9rem 0 0.35rem;
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
    font-weight: 600;
    letter-spacing: var(--track-wide);
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .session-sheet-list {
    --track-list-gap: 0.15rem;
  }

  .session-sheet-entry {
    border-radius: var(--radius);
  }

  .session-sheet-entry--open {
    background: var(--fg-a03);
  }

  .session-cells {
    display: flex;
    gap: 0.3rem;
    padding: 0;
    border: none;
    background: none;
    cursor: pointer;
    font: inherit;
  }

  .session-cell {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
    min-width: 3.6rem;
    padding: 0.35rem 0.45rem;
    border-radius: var(--radius);
    background: var(--fg-a05);
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }

  .session-cells[aria-expanded='true'] .session-cell {
    background: color-mix(in srgb, var(--info) 15%, transparent);
  }

  .session-cell-range {
    font-size: var(--fs-2xs);
    font-weight: 600;
    letter-spacing: var(--track-wide);
    color: var(--text-muted);
  }

  .session-cell-value {
    font-size: var(--fs-xs);
    font-weight: 700;
    white-space: nowrap;
  }

  .session-cell.up .session-cell-value {
    color: var(--accent);
  }

  .session-cell.down .session-cell-value {
    color: var(--negative);
  }

  .session-passed {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    padding: 0 0.75rem 0.8rem calc(0.75rem + 48px + 1rem);
  }

  .session-passed-line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem 0.5rem;
    font-size: var(--fs-xs);
    color: var(--text-muted);
  }

  .session-passed-item {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    color: var(--text);
    text-decoration: none;
  }

  .session-passed-item img {
    width: 16px;
    height: 16px;
    border-radius: 2px;
    object-fit: cover;
  }

  .session-passed-item img.round {
    border-radius: 50%;
  }

  .session-passed-more {
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
  }
</style>
