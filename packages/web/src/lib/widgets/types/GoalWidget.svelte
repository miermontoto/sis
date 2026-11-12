<script lang="ts">
  // objetivo de escucha (horas o plays) para el día, la semana, el mes o el año en
  // curso: un anillo de progreso; tile añade la cifra al lado, band y medium además
  // el ritmo (cuánto deberías llevar a estas alturas del periodo) y lo que falta por día. La semana es la de los charts
  // (inicio de semana y zona del usuario); las sumas van en días UTC, como el resto
  import { untrack } from 'svelte';
  import { periodBounds } from '@sis/shared';
  import { api, getWeekStart, type Granularity } from '$lib/api';
  import { playUpdatesStore } from '$lib/stores/play-updates.svelte';
  import { computeCurrentPeriod } from '$lib/utils/periods';
  import { formatNumber, formatHours } from '$lib/utils/format';
  import { utcDayKey } from '../daily-data.svelte';
  import { reloadKey } from '../util';
  import type { WidgetProps } from '../components';

  let { size, settings }: WidgetProps = $props();

  const DAY_MS = 86_400_000;
  const HOUR_MS = 3_600_000;
  const PCT = 100;
  const RING_R = 42;
  const RING_C = 2 * Math.PI * RING_R;
  const PERIOD_NOUN: Record<string, string> = { day: 'today', week: 'this week', month: 'this month', year: 'this year' };

  let period = $derived(String(settings.period));
  let unit = $derived(settings.unit === 'plays' ? 'plays' : 'time');
  let target = $derived(Number(settings.target));

  // límites del periodo en curso: el día UTC de hoy, o el periodo de los charts
  let bounds = $derived.by(() => {
    const now = new Date();
    if (period === 'day') {
      const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
      return { start, end: start + DAY_MS };
    }
    const ws = getWeekStart();
    const b = periodBounds(computeCurrentPeriod(period as Granularity, ws), period as Granularity, ws);
    return b ? { start: Date.parse(b.start), end: Date.parse(b.end) } : { start: now.getTime(), end: now.getTime() + DAY_MS };
  });

  let total = $state({ plays: 0, ms: 0 });
  let loading = $state(true);
  let seq = 0;

  $effect(() => {
    const { start } = bounds;
    reloadKey();
    untrack(() => {
      const my = ++seq;
      loading = true;
      api.listeningTime('custom', 'day', { startDate: utcDayKey(new Date(start)), endDate: utcDayKey(new Date()) })
        .then(items => { if (my === seq) total = items.reduce((a, d) => ({ plays: a.plays + d.play_count, ms: a.ms + d.total_ms }), { plays: 0, ms: 0 }); })
        .catch(e => console.error('goal widget:', e))
        .finally(() => { if (my === seq) loading = false; });
    });
  });

  // el play que acaba de terminar suma ya (el servidor lo confirma después)
  let lastOptimistic = playUpdatesStore.optimistic?.seq ?? 0;
  $effect(() => {
    const update = playUpdatesStore.optimistic;
    if (!update || update.seq <= lastOptimistic) return;
    lastOptimistic = update.seq;
    untrack(() => { total = { plays: total.plays + 1, ms: total.ms + update.playedMs }; });
  });

  let done = $derived(unit === 'plays' ? total.plays : total.ms / HOUR_MS);
  let pct = $derived(Math.min(PCT, (done / Math.max(target, 1)) * PCT));
  // lo que deberías llevar si repartieras el objetivo por igual en el periodo
  let elapsed = $derived(Math.min(1, Math.max(0, (Date.now() - bounds.start) / (bounds.end - bounds.start))));
  let expected = $derived(target * elapsed);
  let daysLeft = $derived(Math.max(1, Math.ceil((bounds.end - Date.now()) / DAY_MS)));
  let perDay = $derived(Math.max(0, target - done) / daysLeft);

  const fmt = (v: number) => unit === 'plays' ? formatNumber(Math.round(v)) : formatHours(v * HOUR_MS);
  // el objetivo es un entero: "1000h", no el "1000.0h" de formatHours
  const fmtTarget = (v: number) => unit === 'plays' ? formatNumber(v) : `${formatNumber(v)}h`;
  let paceText = $derived(
    done >= target ? 'Goal reached'
    : done >= expected ? `Ahead by ${fmt(done - expected)}`
    : `Behind by ${fmt(expected - done)}`,
  );
</script>

<div class="goal" class:goal--wide={size !== 'small'} class:goal--compact={size === 'tile' || size === 'band'}>
  <svg class="goal-ring" viewBox="0 0 100 100" role="img" aria-label="{Math.round(pct)}% of your {PERIOD_NOUN[period]} goal">
    <circle class="goal-track" cx="50" cy="50" r={RING_R} />
    {#if !loading}
      <circle class="goal-fill" class:goal-fill--done={done >= target} cx="50" cy="50" r={RING_R} stroke-dasharray="{(pct / PCT) * RING_C} {RING_C}" />
    {/if}
    <text class="goal-pct" x="50" y="50">{loading ? '' : `${Math.round(pct)}%`}</text>
    <text class="goal-of" x="50" y="66">{PERIOD_NOUN[period]}</text>
  </svg>
  {#if size !== 'small'}
    <div class="goal-text">
      <span class="w-figure goal-value">{loading ? '…' : fmt(done)}</span>
      <span class="w-caption">of {fmtTarget(target)} {PERIOD_NOUN[period]}</span>
      {#if !loading && size !== 'tile'}
        <span class="w-sub" class:goal-behind={done < expected && done < target}>{paceText}</span>
        {#if done < target && period !== 'day' && size === 'medium'}<span class="w-sub">{fmt(perDay)} a day to finish</span>{/if}
      {/if}
    </div>
  {/if}
</div>

<style>
  .goal {
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .goal--wide {
    justify-content: flex-start;
    gap: 1rem;
  }
  .goal-ring {
    height: 100%;
    max-height: 100%;
    aspect-ratio: 1;
    flex-shrink: 0;
  }
  .goal-track {
    fill: none;
    stroke: var(--fg-a08);
    stroke-width: 9;
  }
  .goal-fill {
    fill: none;
    stroke: var(--accent-a40);
    stroke-width: 9;
    stroke-linecap: round;
    transform: rotate(-90deg);
    transform-origin: 50% 50%;
    transition: stroke-dasharray 0.4s ease;
  }
  .goal-fill--done { stroke: var(--accent); }
  .goal-pct {
    fill: var(--accent);
    font-family: var(--font-mono);
    font-weight: 700;
    font-size: 19px;
    text-anchor: middle;
    dominant-baseline: middle;
  }
  .goal-of {
    fill: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 8.5px;
    text-anchor: middle;
    text-transform: uppercase;
  }
  .goal-text {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    min-width: 0;
  }
  .goal-value { font-size: var(--fs-2xl); }
  /* compactos: el anillo del alto de la media fila y la cifra más pequeña */
  .goal--compact { gap: 0.6rem; }
  .goal--compact .goal-value { font-size: var(--fs-xl); }
  .goal--compact .goal-of { display: none; }
  .goal--compact .goal-text { gap: 0; line-height: 1.25; }
  /* media fila de un portátil (~40px de contenido): cifra y "de cuánto", sin el ritmo */
  @container widget (max-height: 3.3rem) {
    .goal--compact .w-sub { display: none; }
  }
  .goal-behind { color: var(--negative); }
  @media (prefers-reduced-motion: reduce) {
    .goal-fill { transition: none; }
  }
</style>
