<script lang="ts">
  import { placeTimelineLabels, yearTicks, type LeadHistory, type VersusSide } from '$lib/utils/artist-versus';
  import { formatMonthKeyShort } from '$lib/utils/format';
  import { periodLabel } from '$lib/utils/periods';

  // quién iba delante a lo largo del tiempo: una banda proporcional del primer mes al mes en
  // curso, con cada adelantamiento marcado en su sitio. La banda se lee de un vistazo y las
  // etiquetas dan la fecha; sin adelantamientos sigue diciendo desde cuándo manda uno.
  // Enlazada por mes con las gráficas: pasar por una marca las lleva a ese mes y al revés
  let {
    months,
    history,
    names,
    highlightedMonth = $bindable(''),
  }: {
    months: string[];
    history: LeadHistory;
    names: [string, string];
    highlightedMonth?: string;
  } = $props();

  const LABEL_WIDTH_PX = 128;
  const LABEL_GAP_PX = 8;
  const LANE_HEIGHT_PX = 40;
  const TICK_MIN_GAP_PX = 44;

  let width = $state(0);

  const nameOf = (side: VersusSide) => names[side === 'a' ? 0 : 1];
  const left = (index: number) => `${(index / months.length) * 100}%`;
  const month = (index: number) => periodLabel(months[index], 'month');

  let ticks = $derived(yearTicks(months, width, TICK_MIN_GAP_PX));
  let labels = $derived(placeTimelineLabels(
    history.changes.map(change => (change.index / months.length) * width),
    width,
    LABEL_WIDTH_PX,
    LABEL_GAP_PX,
  ));
  let laneCount = $derived(Math.max(0, ...labels.map(label => label.lane + 1)));
  let playhead = $derived(months.indexOf(highlightedMonth));

  function spanTitle(span: LeadHistory['spans'][number]): string {
    const end = span.end === months.length ? 'now' : month(span.end - 1);
    return `${nameOf(span.leader)} led · ${month(span.start)} – ${end}`;
  }
</script>

{#if history.leader && history.since}
  <p class="tl-headline">
    <span class="versus-key versus-key--{history.leader}"></span>
    <strong>{nameOf(history.leader)}</strong> has led since {periodLabel(history.since, 'month')}
    {#if history.changes.length > 0}· {history.changes.length} lead {history.changes.length === 1 ? 'change' : 'changes'}{/if}
  </p>
{/if}

<div class="tl" bind:clientWidth={width}>
  <div class="tl-ticks" aria-hidden="true">
    {#each ticks as tick (tick.index)}
      <span class="tl-tick" style:left={left(tick.index)}>{tick.label}</span>
    {/each}
  </div>

  <div class="tl-band" aria-hidden="true">
    {#each history.spans as span (span.start)}
      <div
        class="tl-span tl-span--{span.leader}"
        style:left={left(span.start)}
        style:width="{((span.end - span.start) / months.length) * 100}%"
        title={spanTitle(span)}
      ></div>
    {/each}
    {#if playhead >= 0}
      <div class="tl-playhead" style:left={left(playhead)}></div>
    {/if}
  </div>

  {#if history.changes.length > 0 && width > 0}
    <ol class="tl-events" style:height="{laneCount * LANE_HEIGHT_PX}px" style:--tl-lane-height="{LANE_HEIGHT_PX}px">
      {#each history.changes as change, i (change.month)}
        {@const label = labels[i]}
        <li
          class="tl-event tl-event--{change.leader}"
          class:tl-event--flip={label.flip}
          style:left={left(change.index)}
          style:width="{label.width}px"
          style:--tl-flip-width="{label.width}px"
          style:--tl-lane={label.lane}
        >
          <a
            title="{nameOf(change.leader)} took the lead · {periodLabel(change.month, 'month')}"
            href="/charts?type=artists&granularity=month&period={change.month}"
            onpointerenter={() => (highlightedMonth = change.month)}
            onpointerleave={() => (highlightedMonth = '')}
            onfocus={() => (highlightedMonth = change.month)}
            onblur={() => (highlightedMonth = '')}
          >
            <span class="tl-event-month">{formatMonthKeyShort(change.month)}</span>
            <span class="tl-event-name">{nameOf(change.leader)}</span>
          </a>
        </li>
      {/each}
    </ol>
  {/if}
</div>

<style>
  .tl-headline {
    margin: 0 0 0.75rem;
    font-size: var(--fs-md);
    color: var(--text-secondary);
  }
  .tl-headline .versus-key {
    margin-right: 0.35rem;
  }
  .tl-headline strong {
    color: var(--text);
  }
  .tl {
    position: relative;
  }
  .tl-ticks {
    position: relative;
    height: 1.25rem;
  }
  .tl-tick {
    position: absolute;
    bottom: 0;
    height: 100%;
    padding-left: 4px;
    border-left: 1px solid var(--border);
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    color: var(--text-muted);
  }
  .tl-band {
    position: relative;
    height: 0.75rem;
    border-radius: 4px;
    background: var(--bg-hover);
    overflow: hidden;
  }
  .tl-span {
    position: absolute;
    top: 0;
    bottom: 0;
    min-width: 2px;
  }
  /* el hueco lo pone cada tramo con su borde: con gap en un flex, el tramo se movería
     respecto a la marca de su adelantamiento, que va en porcentaje del eje */
  .tl-span + .tl-span {
    border-left: 2px solid var(--bg-card);
  }
  .tl-span--a {
    background: var(--versus-a);
  }
  .tl-span--b {
    background: var(--versus-b);
  }
  .tl-playhead {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    background: var(--text);
  }
  /* el tallo arranca en la banda: 0.5rem de hueco más los carriles que la etiqueta tiene encima */
  .tl-events {
    position: relative;
    margin: 0.5rem 0 0;
    padding: 0;
    list-style: none;
  }
  .tl-event {
    --tl-stem: var(--versus-a);
    position: absolute;
    top: calc(var(--tl-lane) * var(--tl-lane-height));
    height: calc(var(--tl-lane-height) - 4px);
    border-left: 1px solid var(--tl-stem);
  }
  .tl-event--b {
    --tl-stem: var(--versus-b);
  }
  .tl-event::before {
    content: '';
    position: absolute;
    left: -1px;
    bottom: 100%;
    width: 1px;
    height: calc(var(--tl-lane) * var(--tl-lane-height) + 0.5rem + 4px);
    background: var(--tl-stem);
    z-index: 0;
  }
  /* margen y no transform: un transform abriría un stacking context y el texto de esta
     etiqueta dejaría de ir por encima de los tallos de las demás */
  .tl-event--flip {
    margin-left: calc(-1 * var(--tl-flip-width));
    border-left: none;
    border-right: 1px solid var(--tl-stem);
    text-align: right;
  }
  .tl-event--flip::before {
    left: auto;
    right: -1px;
  }
  /* el fondo tapa sólo lo escrito: si un tallo tiene que pasar por aquí, va por debajo */
  .tl-event a {
    position: relative;
    z-index: 1;
    display: block;
    width: fit-content;
    max-width: 100%;
    height: 100%;
    padding: 0 0.4rem;
    color: inherit;
    text-decoration: none;
    background: var(--bg-card);
  }
  .tl-event--flip a {
    margin-left: auto;
  }
  .tl-event a:hover .tl-event-name,
  .tl-event a:focus-visible .tl-event-name {
    text-decoration: underline;
  }
  .tl-event-month {
    display: block;
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tl-event-name {
    display: block;
    font-size: var(--fs-sm);
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
