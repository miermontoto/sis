<script lang="ts">
  // tira de los últimos siete días: una barra por día (tiempo o plays según la
  // métrica), hoy resaltado y cada día enlazando a su historial. CSS puro, sin
  // echarts: son siete barras y la página ya carga bastante
  import type { RankingMetric } from '$lib/api';
  import { formatDuration, formatNumber, getLocalizedDayNames } from '$lib/utils/format';

  export interface WeekStripDay {
    /** YYYY-MM-DD (UTC, como los buckets de /listening-time) */
    key: string;
    plays: number;
    ms: number;
  }

  let { days, metric = 'time', flash = false }: {
    days: WeekStripDay[];
    metric?: RankingMetric;
    // acaba de terminar un play: parpadea la barra de hoy
    flash?: boolean;
  } = $props();

  const PCT = 100;
  // una barra vacía sigue teniendo un pie visible: así el día sin plays se lee
  // como "cero", no como hueco
  const MIN_HEIGHT_PCT = 3;
  const DAY_NAMES = getLocalizedDayNames();

  const value = (d: WeekStripDay) => metric === 'plays' ? d.plays : d.ms;
  const label = (d: WeekStripDay) => metric === 'plays' ? `${formatNumber(d.plays)} plays` : formatDuration(d.ms);
  // el día de la semana sale de la clave UTC, que es la que etiqueta el bucket
  const dayName = (d: WeekStripDay) => DAY_NAMES[new Date(d.key + 'T00:00:00Z').getUTCDay()];
  let max = $derived(Math.max(1, ...days.map(value)));
  const heightPct = (d: WeekStripDay) => Math.max(MIN_HEIGHT_PCT, (value(d) / max) * PCT);
</script>

<div class="week-strip">
  {#each days as d, i (d.key)}
    {@const today = i === days.length - 1}
    <a class="week-day" class:week-day--today={today} href="/history?date={d.key}" title="{dayName(d)} · {label(d)}">
      <span class="week-value data-count" class:stat-flash={today && flash}>{label(d)}</span>
      <span class="week-bar-track">
        <span class="week-bar" style:height="{heightPct(d)}%"></span>
      </span>
      <span class="week-label">{today ? 'Today' : dayName(d)}</span>
    </a>
  {/each}
</div>

<style>
  .week-strip {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: 0.5rem;
    height: 7.5rem;
  }
  .week-day {
    display: flex;
    flex-direction: column;
    align-items: center;
    min-width: 0;
    text-decoration: none;
    color: var(--text-muted);
  }
  .week-value {
    font-size: var(--fs-xs);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
    opacity: 0;
    transition: opacity 0.1s;
  }
  .week-day:hover .week-value,
  .week-day--today .week-value {
    opacity: 1;
  }
  .week-bar-track {
    flex: 1;
    width: 100%;
    display: flex;
    align-items: flex-end;
    margin: 0.25rem 0;
  }
  .week-bar {
    display: block;
    width: 100%;
    border-radius: 3px 3px 0 0;
    background: var(--border);
    transition: height 0.3s ease, background 0.1s;
  }
  .week-day:hover .week-bar {
    background: var(--text-muted);
  }
  .week-day--today .week-bar {
    background: var(--accent);
  }
  .week-label {
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    text-transform: uppercase;
    letter-spacing: var(--track);
  }
  .week-day--today .week-label {
    color: var(--accent);
  }
</style>
