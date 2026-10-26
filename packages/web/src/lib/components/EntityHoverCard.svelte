<script lang="ts">
  import { page } from '$app/state';
  import { hoverCard } from '$lib/stores/hover-card.svelte';
  import { getRankingMetric, isCollectionKey, type EntityType, type RankingMetric, type Rankings } from '$lib/api';
  import { formatDuration, formatNumber, formatShortDate, formatTrackLength, timeAgo } from '$lib/utils/format';
  import { medalColor } from '$lib/utils/medals';
  import { parseEntityPath, densifySeries, bucketSeries, placeCard, ENTITY_CARD_WIDTH } from '$lib/utils/hover-card';

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
  const MAX_GENRES = 3;
  // alto mínimo de una barra con plays, en % del pico: una semana floja tiene que
  // seguir viéndose distinta de una vacía
  const MIN_BAR_PCT = 6;

  // tira de posiciones: los cuatro periodos que ya trae /stats/rankings. label
  // null = el año en curso, que se rotula con su número
  interface RankPeriod {
    key: keyof Rankings;
    label: string | null;
  }
  const RANK_PERIODS: RankPeriod[] = [
    { key: 'all', label: 'all-time' },
    { key: 'thisYear', label: null },
    { key: 'month', label: 'month' },
    { key: 'week', label: 'week' },
  ];

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
  // el "this year" del servidor arranca el 1 de enero UTC
  let year = $state(new Date().getUTCFullYear());
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
    year = new Date().getUTCFullYear();
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
      const tracks = card.totalTracks ? `${card.totalTracks} ${card.totalTracks === 1 ? 'track' : 'tracks'}` : null;
      return [card.releaseDate?.slice(0, 4), tracks].filter(Boolean).join(' · ');
    }
    return '';
  });

  // tipo rotulado sobre el nombre: una colección viaja por el eje álbum, pero no
  // es un álbum
  let kind = $derived(!card ? '' : isCollectionKey(card.id) ? 'collection' : card.type);

  // el mismo par que MetricMeta: la métrica elegida en grande y en acento, la
  // otra al lado en muted
  let figures = $derived.by(() => {
    if (!card) return null;
    const plays = `${formatNumber(card.playCount)} plays`;
    const time = formatDuration(card.totalMs);
    return metric === 'plays' ? { primary: plays, secondary: time } : { primary: time, secondary: plays };
  });

  // actividad por semanas sobre la serie diaria densificada; sin plays en la
  // ventana no hay nada que pintar
  let activity = $derived.by(() => {
    if (!card) return null;
    const weeks = bucketSeries(densifySeries(card.series, card.seriesDays, metric));
    const peak = Math.max(...weeks);
    if (!(peak > 0)) return null;
    return {
      weeks,
      peak,
      peakLabel: metric === 'plays' ? `${formatNumber(peak)} plays/wk` : `${formatDuration(peak)}/wk`,
    };
  });

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
          <div class="hc-label">{kind}</div>
          <div class="hc-name">{card.name}</div>
          {#if subtitle}<div class="hc-sub">{subtitle}</div>{/if}
          {#if meta}<div class="hc-meta">{meta}</div>{/if}
        </div>
      </div>

      <!-- la tira existe antes de que llegue el rank (shimmer): si apareciera
           después, la tarjeta crecería ya colocada y placeCard, medido con la
           altura vieja, la dejaría pisando el ancla o fuera del viewport -->
      {#if !hoverCard.ranksFailed}
        <div class="hc-ranks">
          {#each RANK_PERIODS as period (period.key)}
            {@const rank = ranks?.[period.key]}
            <div class="hc-rank">
              <span class="hc-label">{period.label ?? year}</span>
              {#if !ranks}
                <span class="hc-rank-value"><span class="ghost-text"></span></span>
              {:else if rank}
                <span class="hc-rank-value" style:color={medalColor(rank)}>#{rank}</span>
              {:else}
                <span class="hc-rank-value hc-rank-value--none">—</span>
              {/if}
            </div>
          {/each}
        </div>
      {/if}

      {#if figures}
        <div class="hc-figures">
          <span class="hc-figure">{figures.primary}</span>
          <span class="hc-figure-alt">{figures.secondary}</span>
        </div>
      {/if}

      {#if activity}
        <div class="hc-bars">
          {#each activity.weeks as value, i (i)}
            <div
              class="hc-bar"
              class:hc-bar--now={i === activity.weeks.length - 1}
              class:hc-bar--zero={value === 0}
              style:height={value > 0 ? `${Math.max(MIN_BAR_PCT, Math.round((value / activity.peak) * 100))}%` : undefined}
            ></div>
          {/each}
        </div>
        <div class="hc-axis hc-label">
          <span>last {activity.weeks.length} weeks</span>
          <span>peak {activity.peakLabel}</span>
        </div>
      {/if}

      {#if card.firstPlayed || card.lastPlayed}
        <div class="hc-when">
          {#if card.firstPlayed}
            <div class="hc-when-item"><span class="hc-label">first</span><span class="hc-when-value">{formatShortDate(card.firstPlayed)}</span></div>
          {/if}
          {#if card.lastPlayed}
            <div class="hc-when-item"><span class="hc-label">last</span><span class="hc-when-value">{timeAgo(card.lastPlayed)}</span></div>
          {/if}
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
    box-shadow: 0 12px 32px color-mix(in srgb, var(--shadow-color) 50%, transparent);
    padding: 0.75rem;
    pointer-events: auto;
    animation: hover-card-in 0.12s ease-out;
  }

  @keyframes hover-card-in {
    from { opacity: 0; transform: translateY(-2px); }
    to { opacity: 1; transform: none; }
  }

  /* etiqueta de grupo de la app (mono diminuta en mayúsculas): tipo, periodos
     del rank, eje de la actividad y first/last */
  .hc-label {
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
    letter-spacing: var(--track-wide);
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .hc-head {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .hc-art {
    width: 56px;
    height: 56px;
    border-radius: var(--radius);
    object-fit: cover;
    flex-shrink: 0;
    background: var(--bg-hover);
  }

  .hc-art--round { border-radius: 50%; }

  .hc-title {
    min-width: 0;
    line-height: 1.35;
  }

  .hc-name {
    font-size: var(--fs-base);
    font-weight: 600;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .hc-sub,
  .hc-meta {
    font-size: var(--fs-xs);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .hc-sub { color: var(--text-secondary); }
  .hc-meta { color: var(--text-muted); }

  /* celdas separadas por el fondo del contenedor asomando por el gap de 1px */
  .hc-ranks {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 1px;
    margin-top: 0.75rem;
    background: var(--border);
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }

  .hc-rank {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 0.25rem 0 0.2rem;
    line-height: 1.35;
    background: var(--bg-sunken);
  }

  .hc-rank-value {
    font-family: var(--font-mono);
    font-size: var(--fs-md);
    font-weight: 600;
    color: var(--text);
  }

  .hc-rank-value--none {
    font-weight: 400;
    color: var(--text-faint);
  }

  .hc-rank-value .ghost-text { vertical-align: middle; }

  .hc-figures {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
    margin-top: 0.75rem;
    font-family: var(--font-mono);
    white-space: nowrap;
  }

  .hc-figure {
    font-size: var(--fs-xl);
    line-height: 1.1;
    color: var(--accent);
  }

  .hc-figure-alt {
    font-size: var(--fs-sm);
    color: var(--text-muted);
  }

  .hc-bars {
    display: flex;
    align-items: flex-end;
    gap: 3px;
    height: 40px;
    margin-top: 0.6rem;
  }

  .hc-bar {
    flex: 1;
    background: var(--accent);
    opacity: 0.5;
    border-radius: 1px 1px 0 0;
  }

  /* la semana en curso, la única que aún puede crecer */
  .hc-bar--now { opacity: 1; }

  .hc-bar--zero {
    height: 2px;
    background: var(--border);
    opacity: 1;
  }

  .hc-axis {
    display: flex;
    justify-content: space-between;
    margin-top: 0.25rem;
    letter-spacing: var(--track);
  }

  .hc-when {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
    margin-top: 0.6rem;
    padding-top: 0.6rem;
    border-top: 1px solid var(--border);
  }

  .hc-when-item {
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
    min-width: 0;
  }

  .hc-when-value {
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .hc-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 56px;
    font-size: var(--fs-xs);
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
