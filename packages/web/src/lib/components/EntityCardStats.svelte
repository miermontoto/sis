<script lang="ts">
  // cifras de una entidad tal y como las enseña la tarjeta de hover: tira de rank de
  // los cuatro periodos, el par de MetricMeta en grande, barras semanales y
  // first/last. La comparten la tarjeta de hover y la hoja de now playing del móvil,
  // que añade `projected`: de dónde a dónde la ha movido la sesión en cada ventana
  // (el "#9→#7" de la tarjeta de sesión). Va en lugar del rank, que ya incluye los
  // plays de la sesión y diría "#7→#7"
  import type { EntityCard, Rankings, RankingMetric } from '$lib/api';
  import { formatDuration, formatNumber, formatShortDate, timeAgo } from '$lib/utils/format';
  import { medalColor } from '$lib/utils/medals';
  import { RANK_PERIODS } from '$lib/utils/rank-periods';
  import { densifySeries, bucketSeries } from '$lib/utils/hover-card';

  // alto mínimo de una barra con plays, en % del pico: una semana floja tiene que
  // seguir viéndose distinta de una vacía
  const MIN_BAR_PCT = 6;

  let { card, ranks, ranksFailed = false, metric, projected = {} }: {
    card: EntityCard;
    ranks: Rankings | null;
    ranksFailed?: boolean;
    metric: RankingMetric;
    projected?: Partial<Record<keyof Rankings, { from: number; to: number }>>;
  } = $props();

  // la métrica elegida en grande y en acento, la otra al lado en muted
  let figures = $derived.by(() => {
    const plays = `${formatNumber(card.playCount)} plays`;
    const time = formatDuration(card.totalMs);
    return metric === 'plays' ? { primary: plays, secondary: time } : { primary: time, secondary: plays };
  });

  // actividad por semanas sobre la serie diaria densificada; sin plays en la
  // ventana no hay nada que pintar
  let activity = $derived.by(() => {
    const weeks = bucketSeries(densifySeries(card.series, card.seriesDays, metric));
    const peak = Math.max(...weeks);
    if (!(peak > 0)) return null;
    return {
      weeks,
      peak,
      peakLabel: metric === 'plays' ? `${formatNumber(peak)} plays/wk` : `${formatDuration(peak)}/wk`,
    };
  });
</script>

<div class="hc-stats">
  <!-- la tira existe antes de que llegue el rank (shimmer): si apareciera después, la
       tarjeta de hover crecería ya colocada y placeCard, medido con la altura vieja,
       la dejaría pisando el ancla o fuera del viewport -->
  {#if !ranksFailed}
    <div class="hc-ranks">
      {#each RANK_PERIODS as period (period.key)}
        {@const rank = ranks?.[period.key]}
        {@const move = projected[period.key]}
        <div class="hc-rank" class:hc-rank--moving={!!move}>
          <span class="hc-label">{period.label}</span>
          {#if move}
            <span class="hc-rank-value">#{move.from}<span class="hc-rank-to">→#{move.to}</span></span>
          {:else if !ranks}
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

  <div class="hc-figures">
    <span class="hc-figure">{figures.primary}</span>
    <span class="hc-figure-alt">{figures.secondary}</span>
  </div>

  {#if activity}
    <div class="hc-activity">
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
</div>

<style>
  .hc-stats {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  /* etiqueta de grupo de la app (mono diminuta en mayúsculas): periodos del rank,
     eje de la actividad y first/last */
  .hc-label {
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
    letter-spacing: var(--track-wide);
    text-transform: uppercase;
    color: var(--text-muted);
  }

  /* celdas separadas por el fondo del contenedor asomando por el gap de 1px */
  .hc-ranks {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 1px;
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

  /* la ventana que la sesión mueve: el anillo verde de lo que está cambiando ahora */
  .hc-rank--moving {
    box-shadow: var(--live-ring);
  }

  .hc-rank-value {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: var(--fs-md);
    font-weight: 600;
    color: var(--text);
    white-space: nowrap;
  }

  .hc-rank-to {
    color: var(--accent);
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

  .hc-activity {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .hc-bars {
    display: flex;
    align-items: flex-end;
    gap: 3px;
    height: 40px;
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
    letter-spacing: var(--track);
  }

  .hc-when {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
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
</style>
