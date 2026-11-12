<script lang="ts">
  // cuándo escuchas: medium, 24 barras (una por hora); large y xl, la rejilla de
  // hora × día de la semana (desde el inicio de semana del usuario), con la hora de
  // ahora marcada y la franja más fuerte dicha en texto. CSS puro, como la tira de
  // la semana: son 168 celdas y echarts no aporta nada aquí
  import { untrack } from 'svelte';
  import { WEEK_START_SHIFT_DAYS } from '@sis/shared';
  import { api, getWeekStart, type HeatmapItem } from '$lib/api';
  import { formatNumber, getLocalizedDayNames } from '$lib/utils/format';
  import WidgetHeader from '../WidgetHeader.svelte';
  import { reloadKey, rangePhrase } from '../util';
  import type { WidgetProps } from '../components';

  let { size, settings }: WidgetProps = $props();

  const HOURS = 24;
  const DAYS = 7;
  const MINUTES_PER_HOUR = 60;
  const PCT = 100;
  const HOUR_TICKS = [0, 6, 12, 18];
  // el lunes de strftime('%w') es 1; el inicio de semana de los charts se expresa
  // como desplazamiento desde el lunes (domingo −1, viernes +4)
  const MONDAY = 1;

  let range = $derived(String(settings.range));
  let items = $state<HeatmapItem[]>([]);
  let loading = $state(true);
  let seq = 0;

  $effect(() => {
    const r = range;
    reloadKey();
    untrack(() => {
      const my = ++seq;
      loading = true;
      api.heatmap(r)
        .then(h => { if (my === seq) items = h; })
        .catch(e => console.error('clock widget:', e))
        .finally(() => { if (my === seq) loading = false; });
    });
  });

  // el servidor agrupa en horas UTC (como /insights): se pasan a la hora local con
  // el desfase de ahora, redondeado a la hora. Aproximado en rangos que cruzan un
  // cambio de horario, que mueve una hora la mitad del año
  const offset = Math.round(-new Date().getTimezoneOffset() / MINUTES_PER_HOUR);
  const firstDow = (MONDAY + WEEK_START_SHIFT_DAYS[getWeekStart()] + DAYS) % DAYS;
  const dayNames = getLocalizedDayNames();

  // grid[fila = día desde el inicio de semana][hora local]
  let grid = $derived.by(() => {
    const g = Array.from({ length: DAYS }, () => new Array<number>(HOURS).fill(0));
    for (const it of items) {
      const shifted = it.hour + offset;
      const hour = ((shifted % HOURS) + HOURS) % HOURS;
      const dow = (it.day_of_week + Math.floor(shifted / HOURS) + DAYS) % DAYS;
      g[(dow - firstDow + DAYS) % DAYS][hour] += it.play_count;
    }
    return g;
  });
  let byHour = $derived(Array.from({ length: HOURS }, (_, h) => grid.reduce((s, row) => s + row[h], 0)));
  let maxCell = $derived(Math.max(1, ...grid.flat()));
  let maxHour = $derived(Math.max(1, ...byHour));
  let total = $derived(byHour.reduce((a, b) => a + b, 0));
  let peak = $derived.by(() => {
    let best = { day: 0, hour: 0, v: -1 };
    grid.forEach((row, d) => row.forEach((v, h) => { if (v > best.v) best = { day: d, hour: h, v }; }));
    return best;
  });

  const now = new Date();
  const nowHour = now.getHours();
  const nowRow = (now.getDay() - firstDow + DAYS) % DAYS;
  const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;
  const dayName = (row: number) => dayNames[(row + firstDow) % DAYS];
</script>

<WidgetHeader title="Listening clock" href="/insights">
  {#snippet actions()}
    {#if !loading && total > 0 && size !== 'medium'}
      <span class="data-label">peak {dayName(peak.day)} {hourLabel(peak.hour)}</span>
    {:else}
      <span class="data-label">{rangePhrase(range)}</span>
    {/if}
  {/snippet}
</WidgetHeader>

{#if loading && items.length === 0}
  <div class="w-ghost w-ghost--fill"></div>
{:else if total === 0}
  <p class="w-empty">No plays {rangePhrase(range)}.</p>
{:else if size === 'medium'}
  <div class="w-fill clock-hours">
    <div class="clock-bars">
      {#each byHour as v, h (h)}
        <span class="clock-bar" class:clock-bar--now={h === nowHour} style:height="{Math.max(3, (v / maxHour) * PCT)}%" title="{hourLabel(h)} · {formatNumber(v)} plays"></span>
      {/each}
    </div>
    <div class="clock-axis">
      {#each HOUR_TICKS as h (h)}<span style:left="{(h / HOURS) * PCT}%">{h}</span>{/each}
    </div>
  </div>
{:else}
  <div class="w-fill clock-heat" style:--clock-label-w={size === 'xl' ? '2.25rem' : '1.75rem'}>
    {#each grid as row, d (d)}
      <span class="clock-day" class:clock-day--now={d === nowRow}>{dayName(d)}</span>
      {#each row as v, h (h)}
        <span
          class="clock-cell"
          class:clock-cell--now={d === nowRow && h === nowHour}
          style:--clock-level={v === 0 ? 0 : 0.12 + 0.88 * (v / maxCell)}
          title="{dayName(d)} {hourLabel(h)} · {formatNumber(v)} plays"
        ></span>
      {/each}
    {/each}
    <span></span>
    {#each Array(HOURS) as _, h (h)}
      <span class="clock-tick">{HOUR_TICKS.includes(h) ? h : ''}</span>
    {/each}
  </div>
{/if}

<style>
  .clock-hours {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .clock-bars {
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: flex-end;
    gap: 2px;
  }
  .clock-bar {
    flex: 1;
    border-radius: 2px 2px 0 0;
    background: var(--accent-a40);
  }
  .clock-bar--now { background: var(--accent); }
  .clock-axis {
    position: relative;
    height: 0.9rem;
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
    color: var(--text-muted);
  }
  .clock-axis span { position: absolute; }

  .clock-heat {
    display: grid;
    grid-template-columns: var(--clock-label-w) repeat(24, minmax(0, 1fr));
    grid-template-rows: repeat(7, minmax(0, 1fr)) auto;
    gap: 2px;
  }
  .clock-day {
    align-self: center;
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
    color: var(--text-muted);
    text-transform: uppercase;
    overflow: hidden;
    white-space: nowrap;
  }
  .clock-day--now { color: var(--accent); }
  .clock-cell {
    border-radius: 2px;
    background: color-mix(in srgb, var(--accent) calc(var(--clock-level) * 100%), var(--fg-a05));
  }
  .clock-cell--now { outline: 1px solid var(--text); outline-offset: -1px; }
  .clock-tick {
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
    color: var(--text-muted);
    line-height: 1;
  }
</style>
