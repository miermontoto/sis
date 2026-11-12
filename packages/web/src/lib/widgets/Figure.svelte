<script lang="ts">
  // una cifra de ritmo diario con su etiqueta y su línea de contexto (ayer, la
  // semana anterior, el récord, el siguiente hito): la celda del widget de stats
  // y el cuerpo del de cifra suelta. Las de tiempo son un botón que cambia de
  // unidad (min → h → d…), como las tarjetas de stats de siempre
  import { nextMilestone } from '@sis/shared';
  import ReportDelta from '$lib/components/reports/ReportDelta.svelte';
  import { formatNumber } from '$lib/utils/format';
  import { createDurationUnit } from '$lib/utils/duration-unit.svelte';
  import { statFlashStore } from '$lib/stores/stat-flash.svelte';
  import { dailyData, FLASH_KEY_TIME, FLASH_KEY_TOTALS } from './daily-data.svelte';

  let { figure, hero = false }: { figure: string; hero?: boolean } = $props();

  const DAY_MS = 86_400_000;
  type Source = 'days' | 'year' | 'health' | 'streaks';
  const SOURCE: Record<string, Source> = {
    playsToday: 'days', timeToday: 'days', playsWeek: 'days', timeWeek: 'days',
    streak: 'streaks', totalPlays: 'health', playsYear: 'year', timeYear: 'year',
  };

  let source = $derived(SOURCE[figure] ?? 'days');
  $effect(() => { dailyData.ensure(source); });

  const unit = createDurationUnit('hours');

  let today = $derived(dailyData.week.at(-1));
  let yesterday = $derived(dailyData.week.at(-2));
  let week = $derived(dailyData.week.reduce((a, d) => ({ plays: a.plays + d.plays, ms: a.ms + d.ms }), { plays: 0, ms: 0 }));
  let prev = $derived(dailyData.prevWeek.reduce((a, d) => ({ plays: a.plays + d.plays, ms: a.ms + d.ms }), { plays: 0, ms: 0 }));
  // días transcurridos del año (UTC, como los buckets), para la media diaria
  let yearDays = $derived(Math.max(1, Math.ceil((Date.now() - Date.UTC(new Date().getUTCFullYear(), 0, 1)) / DAY_MS)));
  let total = $derived(dailyData.health?.totalPlays ?? 0);

  // ms de la cifra si es de tiempo (null = cifra de plays o días)
  let ms = $derived(
    figure === 'timeToday' ? today?.ms ?? 0
    : figure === 'timeWeek' ? week.ms
    : figure === 'timeYear' ? dailyData.year.ms
    : null,
  );

  let value = $derived(
    ms !== null ? unit.format(ms)
    : figure === 'playsToday' ? formatNumber(today?.plays ?? 0)
    : figure === 'playsWeek' ? formatNumber(week.plays)
    : figure === 'playsYear' ? formatNumber(dailyData.year.plays)
    : figure === 'streak' ? `${dailyData.streaks?.currentStreak ?? 0}d`
    : formatNumber(total),
  );

  const LABELS: Record<string, string> = {
    playsToday: 'plays today', timeToday: 'listened today', playsWeek: 'plays this week', timeWeek: 'this week',
    streak: 'streak', totalPlays: 'total plays', playsYear: 'plays this year', timeYear: 'this year',
  };

  let loading = $derived(dailyData.loading(source));
  let flashKey = $derived(source === 'streaks' || source === 'health' ? FLASH_KEY_TOTALS : FLASH_KEY_TIME);
</script>

{#snippet sub()}
  {#if figure === 'playsToday'}{formatNumber(yesterday?.plays ?? 0)} yesterday
  {:else if figure === 'timeToday'}{unit.format(yesterday?.ms ?? 0)} yesterday
  {:else if figure === 'playsWeek'}<ReportDelta value={week.plays} previous={prev.plays} /> vs last week
  {:else if figure === 'timeWeek'}<ReportDelta value={week.ms} previous={prev.ms} /> vs last week
  {:else if figure === 'streak'}best {dailyData.streaks?.longestStreak ?? 0}d
  {:else if figure === 'totalPlays'}{formatNumber(nextMilestone(total) - total)} to {formatNumber(nextMilestone(total))}
  {:else if figure === 'playsYear'}{formatNumber(Math.round(dailyData.year.plays / yearDays))} a day
  {:else if figure === 'timeYear'}{unit.format(dailyData.year.ms / yearDays)} a day
  {/if}
{/snippet}

{#snippet body()}
  {#if loading}
    <span class="w-ghost fig-ghost"></span>
  {:else}
    <span class="w-figure fig-value" class:stat-flash={statFlashStore.isFlashing(flashKey)}>{value}</span>
  {/if}
  <span class="w-caption fig-label">{LABELS[figure] ?? figure}</span>
  <span class="w-sub fig-sub">{#if !loading}{@render sub()}{/if}</span>
{/snippet}

{#if ms !== null && unit.canCycle(ms)}
  <button type="button" class="fig fig--button" class:fig--hero={hero} onclick={() => unit.next(ms ?? 0)} title="Change unit">
    {@render body()}
  </button>
{:else}
  <div class="fig" class:fig--hero={hero}>{@render body()}</div>
{/if}

<style>
  .fig {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.2rem;
    min-width: 0;
    min-height: 0;
    text-align: center;
    container-type: inline-size;
  }
  .fig--button {
    font: inherit;
    color: inherit;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
  }
  .fig--button:hover .fig-value { text-decoration: underline dotted; text-underline-offset: 0.2em; }
  .fig-value {
    font-size: clamp(0.95rem, 15cqi, 1.7rem);
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .fig--hero .fig-value { font-size: clamp(1.4rem, 22cqi, 2.6rem); }
  .fig-label, .fig-sub {
    max-width: 100%;
    text-wrap: balance;
  }
  .fig-sub {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    column-gap: 0.3rem;
    min-height: 1em;
  }
  .fig-ghost {
    width: 3rem;
    height: 1.4rem;
  }
</style>
