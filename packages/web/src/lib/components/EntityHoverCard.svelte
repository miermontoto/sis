<script lang="ts">
  import { page } from '$app/state';
  import { hoverCard } from '$lib/stores/hover-card.svelte';
  import { getRankingMetric, type EntityType, type RankingMetric } from '$lib/api';
  import { formatDuration, formatNumber, formatSmartDate, formatTrackLength } from '$lib/utils/format';
  import { medalColor } from '$lib/utils/medals';
  import { parseEntityPath, densifySeries, placeCard, sparkPath, ENTITY_CARD_WIDTH } from '$lib/utils/hover-card';

  // Tarjeta de detalle de una entidad al pasar el ratón por encima. Se monta una
  // sola vez en el layout y el disparo es delegado: cualquier <a> que apunte a
  // /track|/album|/artist la abre, sin que el call site tenga que enterarse. Para
  // excluir una zona basta un [data-no-hover-card] por encima de sus enlaces.
  // En un enlace-fila (el <a> ocupa la fila entera) sólo disparan portada y
  // nombre: encender la tarjeta desde cualquier punto de la fila estorba al
  // bajar por una lista.

  // retardo antes de abrir: bajar el ratón por una lista no debe encender una
  // tarjeta por fila. Con una ya abierta la intención de hover está demostrada,
  // así que cambiar de entidad es casi inmediato
  const OPEN_DELAY_MS = 450;
  const SWAP_DELAY_MS = 120;
  // margen para saltar del ancla a la tarjeta sin que se cierre por el camino
  const CLOSE_DELAY_MS = 200;
  const SPARK_H = 28;
  const MAX_GENRES = 3;

  // sólo con ratón: en táctil no hay hover y el gesto chocaría con el scroll
  const HOVER_QUERY = '(hover: hover) and (pointer: fine)';
  const ENTITY_LINK = 'a[href^="/track/"], a[href^="/album/"], a[href^="/artist/"]';
  // zonas que disparan dentro de un enlace-fila. Un enlace sin ninguna de estas
  // por debajo (nombre suelto, chip, portada enlazada) sigue disparando entero
  const HOT_ZONES = '.track-art-link, .track-art, .track-name, .chart-art-wrap, .chart-art, .chart-name';

  interface Pending {
    type: EntityType;
    id: string;
    anchor: HTMLAnchorElement;
    pointerX: number;
  }

  let cardEl = $state<HTMLDivElement | null>(null);
  let cardH = $state(0);
  let metric = $state<RankingMetric>('time');
  let pending: Pending | null = null;
  let openTimer: ReturnType<typeof setTimeout> | null = null;
  let closeTimer: ReturnType<typeof setTimeout> | null = null;
  let hoverCapable: MediaQueryList | null = null;

  function cancelOpen() {
    if (openTimer) { clearTimeout(openTimer); openTimer = null; }
    pending = null;
  }

  function cancelClose() {
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
  }

  function scheduleClose() {
    if (!hoverCard.state || closeTimer) return;
    closeTimer = setTimeout(() => { closeTimer = null; hoverCard.close(); }, CLOSE_DELAY_MS);
  }

  function closeNow() {
    cancelOpen();
    cancelClose();
    hoverCard.close();
  }

  // ¿el hover demuestra intención? si el enlace contiene portada o nombre como
  // descendientes es un enlace-fila y sólo cuentan esas zonas; contains() ata la
  // zona al propio enlace para no casar con un ancestro fuera de él
  function inHotZone(anchor: HTMLAnchorElement, target: Element): boolean {
    if (!anchor.querySelector(HOT_ZONES)) return true;
    const zone = target.closest(HOT_ZONES);
    return zone !== null && anchor.contains(zone);
  }

  // entidad a la que apunta un enlace: descartando lo que no es una ruta de
  // detalle, lo que sale de la app y la página que ya se está mirando
  function entityFromAnchor(a: HTMLAnchorElement): { type: EntityType; id: string } | null {
    const url = new URL(a.href, location.origin);
    if (url.origin !== location.origin || url.pathname === page.url.pathname) return null;
    return parseEntityPath(url.pathname);
  }

  function fire() {
    openTimer = null;
    if (!pending) return;
    const { type, id, anchor, pointerX } = pending;
    pending = null;
    // el ancla puede haber desaparecido durante la espera (lista repintada)
    if (!anchor.isConnected) return;
    metric = getRankingMetric();
    hoverCard.open(type, id, anchor.getBoundingClientRect(), pointerX);
  }

  // un solo handler arbitra entrada y salida: mouseover se dispara sobre lo que
  // sea que el puntero pisa, así que "ya no estoy sobre una entidad" es
  // simplemente un evento cuyo target no resuelve a ninguna
  function onMouseOver(e: MouseEvent) {
    if (!hoverCapable?.matches) return;
    const target = e.target as Element | null;
    if (!target?.closest) return;

    // dentro de la tarjeta: mantenerla viva para poder leerla
    if (cardEl?.contains(target)) { cancelOpen(); cancelClose(); return; }

    const anchor = target.closest(ENTITY_LINK) as HTMLAnchorElement | null;
    const entity =
      anchor && !anchor.closest('[data-no-hover-card]') && inHotZone(anchor, target)
        ? entityFromAnchor(anchor)
        : null;
    if (!entity || !anchor) { cancelOpen(); scheduleClose(); return; }

    const open = hoverCard.state;
    if (open && open.type === entity.type && open.id === entity.id) { cancelOpen(); cancelClose(); return; }

    // moverse dentro del mismo enlace no reprograma la apertura (si no, el
    // temporizador nunca llegaría a vencer), sólo actualiza dónde se abrirá
    if (pending && pending.type === entity.type && pending.id === entity.id) {
      pending.pointerX = e.clientX;
      return;
    }

    cancelClose();
    if (openTimer) clearTimeout(openTimer);
    pending = { ...entity, anchor, pointerX: e.clientX };
    openTimer = setTimeout(fire, open ? SWAP_DELAY_MS : OPEN_DELAY_MS);
  }

  $effect(() => {
    hoverCapable = window.matchMedia(HOVER_QUERY);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeNow(); };
    // la tarjeta se coloca respecto a un rect medido al abrir: en cuanto la página
    // se mueve bajo ella deja de corresponder, y perseguir el ancla es peor que
    // cerrar. capture:true para captar el scroll de cualquier contenedor
    document.addEventListener('mouseover', onMouseOver);
    document.addEventListener('mouseleave', closeNow);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', closeNow, true);
    window.addEventListener('resize', closeNow);
    return () => {
      cancelOpen();
      cancelClose();
      document.removeEventListener('mouseover', onMouseOver);
      document.removeEventListener('mouseleave', closeNow);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', closeNow, true);
      window.removeEventListener('resize', closeNow);
    };
  });

  // cerrar al navegar (el clic que abre la ruta viene casi siempre del propio enlace)
  $effect(() => {
    void page.url.pathname;
    closeNow();
  });

  let pos = $derived.by(() => {
    const s = hoverCard.state;
    if (!s) return null;
    return placeCard(s.rect, s.pointerX, cardH, {
      width: document.documentElement.clientWidth,
      height: window.innerHeight,
    });
  });

  let card = $derived(hoverCard.card);

  let subtitle = $derived(
    !card ? '' : card.type === 'artist' ? card.genres.slice(0, MAX_GENRES).join(' · ') : card.artists.join(', ')
  );

  // segunda línea de contexto: álbum y duración del track, año y nº de temas del
  // álbum. Un artista no tiene equivalente y se queda sin ella
  let meta = $derived.by(() => {
    if (!card) return '';
    if (card.type === 'track') {
      return [card.albumName, card.durationMs ? formatTrackLength(card.durationMs) : null].filter(Boolean).join(' · ');
    }
    if (card.type === 'album') {
      const tracks = card.totalTracks ? `${card.totalTracks} tracks` : null;
      return [card.releaseDate?.slice(0, 4), tracks].filter(Boolean).join(' · ');
    }
    return '';
  });

  // sparkline en coordenadas normalizadas: el viewBox se estira al ancho de la
  // tarjeta (preserveAspectRatio="none") y el trazo se mantiene fino con
  // vector-effect, así que no hace falta medir nada en px
  let spark = $derived(card ? sparkPath(densifySeries(card.series, card.seriesDays, metric)) : null);

  let ranks = $derived(hoverCard.ranks);
</script>

{#if hoverCard.state && pos}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- mejora solo-hover: todo lo que resume la tarjeta sigue accesible en la
       página de la entidad, a un enter del enlace que la abre -->
  <div
    bind:this={cardEl}
    bind:clientHeight={cardH}
    class="hover-card"
    style="left: {pos.left}px; top: {pos.top}px; width: {ENTITY_CARD_WIDTH}px;"
    onmouseleave={scheduleClose}
  >
    {#if card}
      <div class="hc-head">
        {#if card.imageUrl}
          <img class="hc-art" class:hc-art--round={card.type === 'artist'} src={card.imageUrl} alt="" />
        {:else}
          <div class="hc-art" class:hc-art--round={card.type === 'artist'}></div>
        {/if}
        <div class="hc-title">
          <div class="hc-name">{card.name}</div>
          {#if subtitle}<div class="hc-sub">{subtitle}</div>{/if}
          {#if meta}<div class="hc-meta">{meta}</div>{/if}
        </div>
      </div>

      {#if ranks && (ranks.all || ranks.thisYear)}
        <div class="hc-ranks">
          {#if ranks.all}
            <span class="hc-rank" style:color={medalColor(ranks.all)}>#{ranks.all}<span class="hc-rank-label">all-time</span></span>
          {/if}
          {#if ranks.thisYear}
            <span class="hc-rank" style:color={medalColor(ranks.thisYear)}>#{ranks.thisYear}<span class="hc-rank-label">this year</span></span>
          {/if}
        </div>
      {/if}

      <div class="hc-stats">
        <div class="hc-stat">
          <span class="hc-stat-value">{formatNumber(card.playCount)}</span>
          <span class="hc-stat-label">plays</span>
        </div>
        <div class="hc-stat">
          <span class="hc-stat-value">{formatDuration(card.totalMs)}</span>
          <span class="hc-stat-label">listened</span>
        </div>
        {#if card.firstPlayed}
          <div class="hc-stat">
            <span class="hc-stat-value">{formatSmartDate(card.firstPlayed)}</span>
            <span class="hc-stat-label">first</span>
          </div>
        {/if}
        {#if card.lastPlayed}
          <div class="hc-stat">
            <span class="hc-stat-value">{formatSmartDate(card.lastPlayed)}</span>
            <span class="hc-stat-label">last</span>
          </div>
        {/if}
      </div>

      {#if spark}
        <div class="hc-spark">
          <svg viewBox="0 0 {spark.lastX} 1" preserveAspectRatio="none" height={SPARK_H} width="100%">
            <path class="hc-spark-area" d={spark.area} />
            <path class="hc-spark-line" d={spark.line} vector-effect="non-scaling-stroke" />
          </svg>
          <span class="hc-spark-label">last {card.seriesDays}d</span>
        </div>
      {/if}
    {:else if hoverCard.failed}
      <div class="hc-placeholder">No data</div>
    {:else}
      <div class="hc-placeholder"><span class="hc-loading"></span></div>
    {/if}
  </div>
{/if}

<style>
  /* por encima de los modales (200), por debajo del menú contextual (500): el
     clic derecho sobre una entidad debe ganarle a su propia tarjeta */
  .hover-card {
    position: fixed;
    z-index: 400;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
    padding: 0.6rem;
    pointer-events: auto;
    animation: hover-card-in 0.12s ease-out;
  }

  @keyframes hover-card-in {
    from { opacity: 0; transform: translateY(-2px); }
    to { opacity: 1; transform: none; }
  }

  .hc-head {
    display: flex;
    align-items: center;
    gap: 0.55rem;
  }

  .hc-art {
    width: 44px;
    height: 44px;
    border-radius: var(--radius);
    object-fit: cover;
    flex-shrink: 0;
    background: var(--bg-hover);
  }

  .hc-art--round { border-radius: 50%; }

  .hc-title { min-width: 0; }

  .hc-name {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .hc-sub,
  .hc-meta {
    font-size: 0.7rem;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .hc-ranks {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }

  .hc-rank {
    display: flex;
    align-items: baseline;
    gap: 0.25rem;
    font-family: var(--font-mono);
    font-size: 0.7rem;
    color: var(--text);
  }

  .hc-rank-label {
    font-family: var(--font-sans);
    font-size: 0.6rem;
    color: var(--text-muted);
  }

  .hc-stats {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.35rem 0.5rem;
    margin-top: 0.55rem;
    padding-top: 0.55rem;
    border-top: 1px solid var(--border);
  }

  .hc-stat {
    display: flex;
    align-items: baseline;
    gap: 0.3rem;
    min-width: 0;
  }

  .hc-stat-value {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .hc-stat-label {
    font-size: 0.6rem;
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .hc-spark {
    margin-top: 0.5rem;
    position: relative;
  }

  .hc-spark svg { display: block; }

  .hc-spark-area {
    fill: var(--accent);
    opacity: 0.15;
  }

  .hc-spark-line {
    fill: none;
    stroke: var(--accent);
    stroke-width: 1;
  }

  .hc-spark-label {
    position: absolute;
    right: 0;
    top: 0;
    font-size: 0.55rem;
    color: var(--text-muted);
  }

  .hc-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 56px;
    font-size: 0.7rem;
    color: var(--text-muted);
  }

  .hc-loading {
    width: 14px;
    height: 14px;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
</style>
