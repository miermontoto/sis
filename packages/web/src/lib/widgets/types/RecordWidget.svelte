<script lang="ts">
  // uno de tus records, distinto cada día: entre las listas destacables con datos se
  // elige una por el número de día (estable durante el día, sin estado guardado).
  // medium: el nº 1 de esa lista; large: el podio. Enlaza a su sección de /records,
  // la misma ancla que usan los accolades
  import { untrack } from 'svelte';
  import { api, getWeekStart, getRecordsUnique, type RecordEntry, type RecordsResponse } from '$lib/api';
  import TrackItem from '$lib/components/TrackItem.svelte';
  import { formatDuration, formatNumber } from '$lib/utils/format';
  import WidgetHeader from '../WidgetHeader.svelte';
  import { widgetMetric, reloadKey, pluralOf, isEntity } from '../util';
  import type { WidgetProps } from '../components';
  import type { EntityType } from '$lib/utils/entity-context';

  let { size, settings }: WidgetProps = $props();

  const DAY_MS = 86_400_000;
  const PODIUM = 3;

  // las listas que se leen bien sueltas, con cómo se dice su cifra
  type Unit = 'metric' | 'percent' | 'weeks' | 'count' | 'avgRank';
  const SPOTLIGHT: { key: string; label: string; unit: Unit }[] = [
    { key: 'peakWeekPlays', label: 'Peak week', unit: 'metric' },
    { key: 'dominance', label: 'Dominance', unit: 'percent' },
    { key: 'mostWeeksAtNo1', label: 'Most weeks at #1', unit: 'weeks' },
    { key: 'biggestDebuts', label: 'Biggest debut', unit: 'metric' },
    { key: 'mostWeeksInTop5', label: 'Most weeks in the charts', unit: 'weeks' },
    { key: 'longestChartRun', label: 'Longest chart run', unit: 'weeks' },
    { key: 'mostAccolades', label: 'Most records', unit: 'count' },
    { key: 'averageYearFinish', label: 'Best average year-end finish', unit: 'avgRank' },
  ];
  const TYPES: EntityType[] = ['track', 'album', 'artist'];

  let metric = $derived(widgetMetric(settings));
  let records = $state<Partial<RecordsResponse> | null>(null);
  let loading = $state(true);
  let seq = 0;

  $effect(() => {
    const m = metric;
    reloadKey();
    untrack(() => {
      const my = ++seq;
      loading = true;
      api.records(getWeekStart(), m, undefined, getRecordsUnique())
        .then(r => { if (my === seq) records = r; })
        .catch(e => console.error('record widget:', e))
        .finally(() => { if (my === seq) loading = false; });
    });
  });

  // candidatos con datos, del tipo pedido o de los tres
  let pick = $derived.by(() => {
    if (!records) return null;
    const types = isEntity(settings.entity) ? [settings.entity] : TYPES;
    const pool = types.flatMap(type => SPOTLIGHT.flatMap(def => {
      const list = (records![pluralOf(type) as keyof RecordsResponse] as unknown as Record<string, RecordEntry[] | undefined> | undefined)?.[def.key];
      return list && list.length > 0 ? [{ type, def, list }] : [];
    }));
    return pool.length > 0 ? pool[Math.floor(Date.now() / DAY_MS) % pool.length] : null;
  });

  function value(entry: RecordEntry, unit: Unit): string {
    const v = entry.value;
    if (unit === 'percent') return `${v.toFixed(1)}%`;
    if (unit === 'weeks') return `${v} wk${v !== 1 ? 's' : ''}`;
    if (unit === 'count') return `${v} record${v !== 1 ? 's' : ''}`;
    if (unit === 'avgRank') return `avg #${v.toFixed(1)}`;
    return metric === 'plays' ? `${formatNumber(v)} plays` : formatDuration(v);
  }
</script>

{#if loading && !records}
  <WidgetHeader title="Record spotlight" href="/records" />
  <div class="w-ghost w-ghost--fill"></div>
{:else if !pick}
  <WidgetHeader title="Record spotlight" href="/records" />
  <p class="w-empty">Records show up once you have a few weeks of charts.</p>
{:else}
  {@const { type, def, list } = pick}
  <WidgetHeader title={def.label} href="/records?tab={pluralOf(type)}#{def.key}">
    {#snippet actions()}<span class="data-label">{pluralOf(type)}</span>{/snippet}
  </WidgetHeader>
  {#if size === 'medium'}
    {@const top = list[0]}
    <a class="rec-lead" href="/{type}/{top.entityId}">
      {#if top.imageUrl}<img class="rec-img" class:rec-img--round={type === 'artist'} src={top.imageUrl} alt="" loading="lazy" />{/if}
      <span class="rec-text">
        <span class="rec-name">{top.name}</span>
        {#if top.artistName}<span class="rec-sub">{top.artistName}</span>{/if}
        <span class="w-figure rec-value">{value(top, def.unit)}</span>
        {#if top.week}<span class="w-sub">week {top.week}</span>{/if}
      </span>
    </a>
  {:else}
    <div class="w-fill track-list">
      {#each list.slice(0, PODIUM) as entry, i (entry.entityId + i)}
        <TrackItem compact rank={i + 1} imageUrl={entry.imageUrl} imageHref="/{type}/{entry.entityId}" imageRound={type === 'artist'} name={entry.name} nameHref="/{type}/{entry.entityId}" entity={{ type, id: entry.entityId, name: entry.name, imageUrl: entry.imageUrl, parentArtistId: entry.artistId ?? undefined }}>
          {#snippet meta()}<span class="track-plays">{value(entry, def.unit)}</span>{/snippet}
        </TrackItem>
      {/each}
    </div>
  {/if}
{/if}

<style>
  .rec-lead {
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    gap: 0.8rem;
    text-decoration: none;
    color: inherit;
  }
  .rec-img {
    height: 100%;
    max-height: 6rem;
    aspect-ratio: 1;
    object-fit: cover;
    border-radius: var(--radius);
    flex-shrink: 0;
  }
  .rec-img--round { border-radius: 50%; }
  .rec-text {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    min-width: 0;
  }
  .rec-name, .rec-sub {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .rec-name { font-weight: 600; }
  .rec-lead:hover .rec-name { color: var(--accent); }
  .rec-sub { font-size: var(--fs-xs); color: var(--text-muted); }
  .rec-value { font-size: var(--fs-xl); }
</style>
