<script lang="ts">
  // Badge de records del hero. Los bolos a los que fuiste van dentro, como una
  // sección más: son otra distinción de la entidad y no merecen un segundo botón
  // idéntico al lado (el ticket en el trigger ya dice que ahí hay directo).
  //
  // Ausencia NO es prueba de lo contrario: un concierto dado de alta a mano no
  // tiene setlist, así que un tema puede haber sonado sin que aquí conste.
  import { api, createFetchController, type Accolade, type ConcertRef, type EntityType, type RankingMetric } from '$lib/api';
  import HoverPopover from '$lib/components/HoverPopover.svelte';
  import IconTicket from '$lib/icons/IconTicket.svelte';
  import { formatCalendarDate, formatDuration, formatNumber } from '$lib/utils/format';

  let {
    entityType,
    entityId,
    concerts = [],
    showRecords = true,
  }: {
    entityType: EntityType;
    entityId: string;
    // en el artista, los bolos suyos; en el tema, aquellos cuyo setlist lo incluía.
    // llegan con la respuesta de detalle, así que no cuestan una petición aparte
    concerts?: ConcertRef[];
    // una entidad fusionada no tiene records propios (son del target), pero sus
    // bolos sí se muestran: por eso el badge se pinta igual y sólo se salta el fetch
    showRecords?: boolean;
  } = $props();

  // el artista se ve, el tema se escucha
  let liveVerb = $derived(entityType === 'track' ? 'Heard live' : 'Seen live');
  const place = (c: ConcertRef) => [c.venue, c.city].filter(Boolean).join(' · ');

  let chartType = $derived(entityType === 'artist' ? 'artists' : entityType === 'album' ? 'albums' : 'tracks');

  function accoladeHref(a: Accolade): string | null {
    if (a.week) return `/charts?type=${chartType}&granularity=week&period=${a.week}`;
    return null;
  }

  let accolades = $state<Accolade[]>([]);
  let metric = $state<RankingMetric>('time');
  let loading = $state(true);
  let open = $state(false);
  const fetchCtrl = createFetchController();

  const labels: Record<string, string> = {
    peakWeek: 'Peak week',
    dominance: 'Dominance',
    biggestDebut: 'Biggest debut',
    weeksAtNo1: 'Weeks at #1',
    bubblingUnder: 'Bubbling under',
    weeksInChart: 'Weeks in charts',
    longestRun: 'Longest chart run',
    mostNo1Tracks: '#1 tracks',
    mostNo1Albums: '#1 albums',
    inMostPlaylists: 'In most playlists',
    longestGap: 'Longest gap',
    goldenOldies: 'Golden oldie',
    latestDiscoveries: 'Latest discovery',
    mostDistinctTracks: 'Distinct tracks',
    oneHitWonders: 'One-hit wonder',
    mostAccolades: 'Most records',
    mostConcerts: 'Seen live',
    mostHeardLive: 'Heard live',
  };

  function labelFor(a: Accolade): string {
    if (a.type === 'yearEnd' && a.year != null) return `${a.year} year-end`;
    return labels[a.type] ?? a.type;
  }


  function medal(rank: number): string {
    if (rank === 1) return '\u{1F947}';
    if (rank === 2) return '\u{1F948}';
    if (rank === 3) return '\u{1F949}';
    return `#${rank}`;
  }

  function formatValue(a: Accolade): string {
    if (a.type === 'inMostPlaylists') return `${a.value} playlist${a.value !== 1 ? 's' : ''}`;
    if (a.type === 'weeksAtNo1' || a.type === 'weeksInChart' || a.type === 'longestRun') return `${a.value} wk${a.value !== 1 ? 's' : ''}`;
    if (a.type === 'mostNo1Tracks' || a.type === 'mostNo1Albums' || a.type === 'mostAccolades') return String(a.value);
    if (a.type === 'longestGap') return `${formatNumber(a.value)} day${a.value !== 1 ? 's' : ''}`;
    if (a.type === 'dominance') return `${a.value.toFixed(1)}%`;
    if (a.type === 'mostDistinctTracks') return `${a.value} track${a.value !== 1 ? 's' : ''}`;
    if (a.type === 'mostConcerts' || a.type === 'mostHeardLive') return `${a.value} show${a.value !== 1 ? 's' : ''}`;
    if (a.type === 'goldenOldies' ||
        a.type === 'latestDiscoveries' ||
        a.type === 'oneHitWonders') {
      return `${formatNumber(a.value)} plays`;
    }
    if (metric === 'plays') return `${formatNumber(a.value)} plays`;
    return formatDuration(a.value);
  }

  // el record de directo (nº de bolos) se pinta en la cabecera de la sección de
  // conciertos, no como una fila más: ahí abajo están esos mismos bolos listados y
  // una fila "Seen live · 1 show" encima sólo repetiría el título
  const liveType = $derived(entityType === 'track' ? 'mostHeardLive' : 'mostConcerts');
  let liveAccolade = $derived(concerts.length > 0 ? accolades.find(a => a.type === liveType) ?? null : null);

  // separar year-end finishes del resto para renderizarlos en su propia sección
  let regularAccolades = $derived(accolades.filter(a => a.type !== 'yearEnd' && a.type !== liveAccolade?.type));
  // agrupar year-end por rank y juntar los años en un array ordenado desc
  let yearEndGroups = $derived.by(() => {
    const byRank = new Map<number, number[]>();
    for (const a of accolades) {
      if (a.type !== 'yearEnd' || a.year == null) continue;
      const arr = byRank.get(a.rank) ?? [];
      arr.push(a.year);
      byRank.set(a.rank, arr);
    }
    return [...byRank.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([rank, years]) => ({ rank, years: years.sort((a, b) => b - a) }));
  });

  // resumen compacto: agrupar por rank (gold/silver/bronze/#N) y mostrar los 3 primeros grupos
  let triggerGroups = $derived.by(() => {
    const counts = new Map<number, number>();
    for (const a of accolades) counts.set(a.rank, (counts.get(a.rank) ?? 0) + 1);
    return [...counts.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([rank, count]) => ({ rank, count }));
  });
  let triggerPreview = $derived(triggerGroups.slice(0, 3));
  let triggerOverflow = $derived.by(() => {
    const shown = triggerPreview.reduce((s, g) => s + g.count, 0);
    return Math.max(0, accolades.length - shown);
  });

  // etiqueta del trigger: enumera lo que hay dentro, que puede ser sólo directo
  let triggerLabel = $derived([
    accolades.length > 0 ? `${accolades.length} record${accolades.length !== 1 ? 's' : ''}` : null,
    concerts.length > 0 ? `${liveVerb}${concerts.length > 1 ? ` · ${concerts.length} times` : ''}` : null,
  ].filter(Boolean).join(' · '));

  $effect(() => {
    void entityId;
    open = false;
    if (!showRecords) {
      accolades = [];
      loading = false;
      return;
    }
    const signal = fetchCtrl.reset();
    loading = true;
    accolades = [];
    api.accolades(entityType, entityId, signal)
      .then(r => {
        if (signal.aborted) return;
        metric = r.metric;
        accolades = [...r.accolades].sort((a, b) => a.rank - b.rank);
        loading = false;
      })
      .catch(() => { if (!signal.aborted) { accolades = []; loading = false; } });
    return () => fetchCtrl.abort();
  });

</script>

<!-- los bolos no se esperan: vienen con el detalle, así que el badge ya puede
     pintarse mientras los accolades siguen en vuelo -->
{#if concerts.length > 0 || (!loading && accolades.length > 0)}
  <HoverPopover label={triggerLabel} tone="gold" bind:open>
    {#snippet trigger()}
      {#each triggerPreview as g}
        <span class="trigger-medal" class:trigger-medal--text={g.rank > 3}>
          {medal(g.rank)}{#if g.count > 1}<span class="trigger-times">×{g.count}</span>{/if}
        </span>
      {/each}
      {#if triggerOverflow > 0}<span class="trigger-more">+{triggerOverflow}</span>{/if}
      {#if concerts.length > 0}
        <span class="trigger-live">
          <IconTicket size={14} />{#if concerts.length > 1}<span class="trigger-live-count">{concerts.length}</span>{/if}
        </span>
      {/if}
    {/snippet}

    {#if regularAccolades.length > 0}
      <div class="popover-title">Records</div>
      <ul class="popover-list">
        {#each regularAccolades as a}
          {@const href = accoladeHref(a)}
          <li>
            {#if href}
              <a {href} class="popover-row popover-row--link">
                <span class="popover-medal" class:popover-medal--text={a.rank > 3}>{medal(a.rank)}</span>
                <span class="popover-label">{labelFor(a)}</span>
                <span class="popover-value">{formatValue(a)}</span>
              </a>
            {:else}
              <div class="popover-row">
                <span class="popover-medal" class:popover-medal--text={a.rank > 3}>{medal(a.rank)}</span>
                <span class="popover-label">{labelFor(a)}</span>
                <span class="popover-value">{formatValue(a)}</span>
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}

    {#if yearEndGroups.length > 0}
      <div class="popover-title" class:popover-title--gap={regularAccolades.length > 0}>Year-end finishes</div>
      <div class="popover-pills">
        {#each yearEndGroups as g}
          <span class="popover-pill" class:popover-pill--text={g.rank > 3}>
            <span class="pill-medal">{medal(g.rank)}</span>
            {#if g.years.length > 1}<span class="pill-count">×{g.years.length}</span>{/if}
            <span class="pill-years">{#each g.years as year, yi}{#if yi > 0},{' '}{/if}<a href="/top?tab={chartType}&range=custom&startDate={year}-01-01&endDate={year}-12-31&focus={entityId}" class="pill-year-link">{year}</a>{/each}</span>
          </span>
        {/each}
      </div>
    {/if}

    {#if concerts.length > 0}
      <div class="popover-title live-title" class:popover-title--gap={regularAccolades.length > 0 || yearEndGroups.length > 0}>
        <span>{liveVerb}</span>
        {#if liveAccolade}
          <span class="live-title-rank">{medal(liveAccolade.rank)} {formatValue(liveAccolade)}</span>
        {/if}
      </div>
      <ul class="popover-list">
        {#each concerts as c (c.id)}
          <li>
            <a class="popover-row popover-row--link" href="/concert/{c.id}">
              <span class="live-date">{formatCalendarDate(c.date)}</span>
              <span class="live-place">
                <!-- {' · '} y no un literal: svelte recorta los espacios pegados al
                     borde de un bloque y el separador salía sin ellos -->
                {#if entityType === 'track'}{c.artistName}{#if place(c)}{' · '}{/if}{/if}{place(c)}
              </span>
            </a>
          </li>
        {/each}
      </ul>
    {/if}
  </HoverPopover>
{/if}

<style>
  /* el trigger, el panel y las filas los estila HoverPopover; aquí sólo queda
     lo propio de los records: medallas y pills de year-end */
  .trigger-medal {
    font-size: 0.9rem;
    line-height: 1;
    display: inline-flex;
    align-items: center;
  }
  .trigger-medal--text {
    font-family: var(--font-mono);
    font-size: 0.65rem;
    font-weight: 700;
  }
  .trigger-times {
    font-family: var(--font-mono);
    font-size: 0.55rem;
    font-weight: 700;
    opacity: 0.7;
    margin-left: 0.05rem;
  }
  .trigger-more {
    font-size: 0.6rem;
    font-weight: 700;
    opacity: 0.7;
    margin-left: 0.1rem;
  }
  /* el ticket mantiene el verde aunque el trigger se ponga dorado al hover: es el
     único distintivo que no es una posición en un ranking, sino haber estado allí */
  .trigger-live {
    display: inline-flex;
    align-items: center;
    gap: 0.15rem;
    color: var(--accent);
  }
  .trigger-live-count {
    font-size: 0.72rem;
    font-variant-numeric: tabular-nums;
  }

  /* la cabecera de la sección de directo lleva a la derecha el record: la medalla
     y el número de bolos (HoverPopover pinta el resto del .popover-title) */
  .live-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .live-title-rank {
    color: var(--text);
    white-space: nowrap;
  }

  /* la fecha hace de columna fija a la izquierda, como la medalla en los records */
  .live-date {
    font-size: 0.8rem;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .live-place {
    font-size: 0.8rem;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .popover-pills {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    padding: 0.1rem 0.2rem 0.2rem;
  }
  .popover-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.2rem 0.55rem 0.2rem 0.4rem;
    border-radius: 999px;
    background: rgba(29, 185, 84, 0.08);
    border: 1px solid rgba(29, 185, 84, 0.2);
    font-size: 0.75rem;
    color: var(--text);
    line-height: 1.2;
    white-space: nowrap;
  }
  .popover-pill--text .pill-medal {
    font-size: 0.7rem;
    font-weight: 700;
    color: var(--text-muted);
  }
  .pill-medal {
    font-size: 0.9rem;
    line-height: 1;
  }
  .pill-count {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: 0.65rem;
    font-weight: 700;
    color: var(--text);
    background: var(--border);
    border-radius: 999px;
    padding: 0 0.35rem;
    min-width: 1rem;
    text-align: center;
  }
  .pill-years {
    color: var(--text-muted);
    font-size: 0.7rem;
  }
  .pill-year-link {
    color: var(--text-muted);
    text-decoration: none;
    transition: color 0.05s;
  }
  .pill-year-link:hover {
    color: var(--text);
    text-decoration: underline;
  }
  .popover-medal {
    font-size: 1rem;
    line-height: 1;
    min-width: 1.4rem;
    text-align: center;
  }
  .popover-medal--text {
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--text-muted);
  }
</style>
