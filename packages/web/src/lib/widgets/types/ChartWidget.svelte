<script lang="ts">
  // el chart en curso (semana, mes o año abiertos) con sus marcas NEW / RE y el
  // cambio de puesto frente al periodo anterior, como /charts. La flecha es la misma
  // RankCell de toda la app, vía TrackItem
  import { untrack } from 'svelte';
  import { isGranularity } from '@sis/shared';
  import { api, getWeekStart, type ChartEntry, type Granularity } from '$lib/api';
  import TrackItem from '$lib/components/TrackItem.svelte';
  import MetricMeta from '$lib/components/MetricMeta.svelte';
  import EntityTypePicker from '$lib/components/EntityTypePicker.svelte';
  import { nowPlayingStore } from '$lib/stores/now-playing.svelte';
  import { computeCurrentPeriod } from '$lib/utils/periods';
  import { GRANULARITY_NOUNS } from '$lib/utils/report-periods';
  import { fitRows } from '$lib/utils/fit-rows';
  import WidgetHeader from '../WidgetHeader.svelte';
  import { widgetMetric, reloadKey, entityOf, pluralOf, LIST_MAX, roomForActions } from '../util';
  import type { WidgetProps } from '../components';

  let { size, settings, onsettings }: WidgetProps = $props();

  let entity = $derived(entityOf(settings));
  let granularity = $derived<Granularity>(isGranularity(String(settings.granularity)) ? settings.granularity as Granularity : 'week');
  let metric = $derived(widgetMetric(settings));
  const weekStart = getWeekStart();
  let period = $derived(computeCurrentPeriod(granularity, weekStart));

  let entries = $state<ChartEntry[]>([]);
  let loading = $state(true);
  let seq = 0;

  $effect(() => {
    const [e, g, p, m] = [entity, granularity, period, metric];
    reloadKey();
    untrack(() => {
      const my = ++seq;
      loading = true;
      api.chart(pluralOf(e), g, p, weekStart, m, LIST_MAX.xl)
        .then(r => { if (my === seq) entries = r.entries; })
        .catch(err => console.error('chart widget:', err))
        .finally(() => { if (my === seq) loading = false; });
    });
  });

  let shown = $derived(entries.slice(0, LIST_MAX[size]));
  let title = $derived(`This ${GRANULARITY_NOUNS[granularity].toLowerCase()}'s chart`);
  let href = $derived(`/charts?type=${pluralOf(entity)}&granularity=${granularity}&period=${period}`);
</script>

<WidgetHeader {title} {href}>
  {#snippet actions()}
    {#if onsettings && roomForActions(size)}
      <EntityTypePicker value={entity} onchange={(e) => onsettings({ entity: e })} variant="pills" iconsOnly />
    {/if}
  {/snippet}
</WidgetHeader>
{#if loading && entries.length === 0}
  <div class="w-ghost w-ghost--fill"></div>
{:else if entries.length === 0}
  <p class="w-empty">No plays yet this {GRANULARITY_NOUNS[granularity].toLowerCase()}.</p>
{:else}
  <div class="w-fill" class:chw--cols={size === 'xl'} use:fitRows={'.track-list'}>
    <div class="track-list">
      {#each shown as e (e.entityId)}
        {#snippet artistsLine()}
          {#each e.artists as a, i (a.id)}{#if i > 0}, {/if}<a href="/artist/{a.id}" class="artist-link">{a.name}</a>{/each}
        {/snippet}
        <TrackItem
          compact
          rank={e.rank}
          rankChange={e.rankChange}
          isNew={e.isNew}
          isReentry={e.isReentry}
          imageUrl={e.imageUrl}
          imageHref="/{entity}/{e.entityId}"
          imageRound={entity === 'artist'}
          name={e.name}
          nameHref="/{entity}/{e.entityId}"
          isLive={nowPlayingStore.isLive(entity, e.entityId)}
          entity={{ type: entity, id: e.entityId, name: e.name, imageUrl: e.imageUrl, parentArtistId: e.artistId ?? undefined }}
          subtitle={e.artists.length > 0 ? artistsLine : undefined}
        >
          {#snippet meta()}<MetricMeta playCount={e.plays} totalMs={e.totalMs} {metric} />{/snippet}
        </TrackItem>
      {/each}
    </div>
  </div>
{/if}

<style>
  /* xl: dos columnas de arriba abajo, como las listas top */
  .chw--cols :global(.track-list) {
    display: block;
    columns: 2;
    column-gap: 1rem;
    column-fill: auto;
    height: 100%;
  }
  .chw--cols :global(.track-list > *) {
    break-inside: avoid;
    margin-bottom: var(--track-list-gap);
  }
</style>
