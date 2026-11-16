<script lang="ts">
  // un cuadrado por día, más oscuro cuanto más escuchaste (la rejilla de
  // contribuciones de GitHub). Las columnas son semanas desde el inicio de semana
  // del usuario y caben las que dé el ancho; si el alto da para más de una banda
  // (large, xl) se apilan, de la más antigua arriba a la actual abajo. Días UTC,
  // como el resto de buckets diarios
  import { untrack } from 'svelte';
  import { WEEK_START_SHIFT_DAYS } from '@sis/shared';
  import { api, getWeekStart } from '$lib/api';
  import { formatDuration, formatNumber, formatCalendarDate } from '$lib/utils/format';
  import WidgetHeader from '../WidgetHeader.svelte';
  import { utcDayKey } from '../daily-data.svelte';
  import { reloadKey, widgetMetric } from '../util';
  import type { WidgetProps } from '../components';

  let { settings }: WidgetProps = $props();

  const DAY_MS = 86_400_000;
  const DAYS = 7;
  // tres años como mucho: con las celdas de escritorio creciendo con la pantalla, un
  // xl de 1920px llena tres bandas de ~50 semanas; con un tope menor las bandas se
  // quedaban cortas y la card vacía a los lados
  const MAX_WEEKS = 156;
  const MONDAY = 1;
  const CELL_MIN_PX = 9;
  // el tope crece con la card: a 16px un xl de pantalla ancha flotaba en blanco
  const CELL_MAX_PX = 24;
  const GAP_PX = 3;
  const BAND_GAP_PX = 10;
  const MAX_BANDS = 3;
  // niveles de intensidad (0 = sin plays), cortados por cuantiles de los días con plays
  const LEVELS = 4;

  let metric = $derived(widgetMetric(settings));
  let byDay = $state(new Map<string, { plays: number; ms: number }>());
  let loading = $state(true);
  let seq = 0;

  // la semana que contiene hoy empieza en `firstDow`; se piden MAX_WEEKS semanas enteras
  const firstDow = (MONDAY + WEEK_START_SHIFT_DAYS[getWeekStart()] + DAYS) % DAYS;
  const today = new Date();
  const todayKey = utcDayKey(today);
  const weekStartMs = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) - ((today.getUTCDay() - firstDow + DAYS) % DAYS) * DAY_MS;
  const firstMs = weekStartMs - (MAX_WEEKS - 1) * DAYS * DAY_MS;

  $effect(() => {
    reloadKey();
    untrack(() => {
      const my = ++seq;
      loading = true;
      api.listeningTime('custom', 'day', { startDate: utcDayKey(new Date(firstMs)), endDate: todayKey })
        .then(items => { if (my === seq) byDay = new Map(items.map(d => [d.period, { plays: d.play_count, ms: d.total_ms }])); })
        .catch(e => console.error('calendar widget:', e))
        .finally(() => { if (my === seq) loading = false; });
    });
  });

  // geometría: la banda más alta que deje celdas legibles y quepa más semanas
  let boxW = $state(0);
  let boxH = $state(0);
  let layout = $derived.by(() => {
    let best = { bands: 1, cell: CELL_MAX_PX, weeks: 0 };
    for (let bands = 1; bands <= MAX_BANDS; bands++) {
      const cell = Math.min(CELL_MAX_PX, (boxH - BAND_GAP_PX * (bands - 1)) / (DAYS * bands) - GAP_PX);
      if (cell < CELL_MIN_PX) break;
      const perBand = Math.floor((boxW + GAP_PX) / (cell + GAP_PX));
      const weeks = Math.min(MAX_WEEKS, perBand * bands);
      if (weeks > best.weeks) best = { bands, cell, weeks: Math.ceil(weeks / bands) * bands };
    }
    return best;
  });

  // semanas (columnas) de la más antigua a la actual, cada una con sus 7 días
  let weekCount = $derived(Math.min(layout.weeks, MAX_WEEKS));
  let weeks = $derived(Array.from({ length: weekCount }, (_w, i) => {
    const start = weekStartMs - (weekCount - 1 - i) * DAYS * DAY_MS;
    return Array.from({ length: DAYS }, (_d, d) => utcDayKey(new Date(start + d * DAY_MS)));
  }));
  let bands = $derived.by(() => {
    const per = Math.ceil(weeks.length / layout.bands);
    return Array.from({ length: layout.bands }, (_, b) => weeks.slice(b * per, (b + 1) * per));
  });

  const valueOf = (key: string) => { const d = byDay.get(key); return d ? (metric === 'plays' ? d.plays : d.ms) : 0; };
  // cortes por cuantiles de los días con plays: un solo día enorme no apaga el resto
  let cuts = $derived.by(() => {
    const vals = [...byDay.values()].map(d => metric === 'plays' ? d.plays : d.ms).filter(v => v > 0).sort((a, b) => a - b);
    return Array.from({ length: LEVELS - 1 }, (_, i) => vals[Math.floor((vals.length * (i + 1)) / LEVELS)] ?? Infinity);
  });
  const level = (v: number) => v <= 0 ? 0 : 1 + cuts.filter(c => v > c).length;
  let activeDays = $derived(weeks.flat().filter(k => valueOf(k) > 0).length);
  const label = (key: string) => {
    const d = byDay.get(key);
    return `${formatCalendarDate(key)} · ${d ? (metric === 'plays' ? `${formatNumber(d.plays)} plays` : formatDuration(d.ms)) : 'no plays'}`;
  };
</script>

<WidgetHeader title="Listening calendar" href="/history">
  {#snippet actions()}
    {#if !loading}<span class="data-label">{activeDays} of {weeks.flat().filter(k => k <= todayKey).length} days</span>{/if}
  {/snippet}
</WidgetHeader>

<div class="w-fill cal" bind:clientWidth={boxW} bind:clientHeight={boxH}>
  {#if loading && byDay.size === 0}
    <div class="w-ghost w-ghost--fill"></div>
  {:else if layout.weeks > 0}
    {#each bands as band, b (b)}
      <div class="cal-band" style:--cal-cell="{layout.cell}px" style:--cal-gap="{GAP_PX}px">
        {#each band as week (week[0])}
          <div class="cal-week">
            {#each week as key (key)}
              {#if key <= todayKey}
                <a class="cal-day" href="/history?date={key}" data-level={level(valueOf(key))} class:cal-day--today={key === todayKey} title={label(key)} aria-label={label(key)}></a>
              {:else}
                <span class="cal-day cal-day--future"></span>
              {/if}
            {/each}
          </div>
        {/each}
      </div>
    {/each}
  {/if}
</div>

<style>
  .cal {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 10px;
  }
  .cal-band {
    display: flex;
    justify-content: center;
    gap: var(--cal-gap);
  }
  .cal-week {
    display: flex;
    flex-direction: column;
    gap: var(--cal-gap);
  }
  .cal-day {
    display: block;
    width: var(--cal-cell);
    height: var(--cal-cell);
    border-radius: 2px;
    background: var(--fg-a05);
  }
  .cal-day[data-level='1'] { background: var(--accent-a25); }
  .cal-day[data-level='2'] { background: var(--accent-a40); }
  .cal-day[data-level='3'] { background: color-mix(in srgb, var(--accent) 70%, transparent); }
  .cal-day[data-level='4'] { background: var(--accent); }
  .cal-day--today { outline: 1px solid var(--text); outline-offset: -1px; }
  .cal-day--future { background: transparent; }
  a.cal-day:hover { outline: 1px solid var(--accent); outline-offset: 0; }
</style>
