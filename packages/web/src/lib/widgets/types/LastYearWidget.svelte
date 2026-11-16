<script lang="ts">
  // lo que más sonó la misma semana de hace un año (días UTC, como el resto de
  // rangos custom)
  import { untrack } from 'svelte';
  import { api } from '$lib/api';
  import EntityTypePicker from '$lib/components/EntityTypePicker.svelte';
  import WidgetHeader from '../WidgetHeader.svelte';
  import EntityRows, { type EntityList } from '../EntityRows.svelte';
  import { utcDayKey, STRIP_DAYS } from '../daily-data.svelte';
  import { LIST_FETCH, widgetMetric, reloadKey, entityOf, pluralOf, LIST_MAX, roomForActions } from '../util';
  import type { WidgetProps } from '../components';

  let { size, settings, onsettings }: WidgetProps = $props();

  const DAY_MS = 86_400_000;

  let entity = $derived(entityOf(settings));
  let metric = $derived(widgetMetric(settings));
  const end = new Date();
  end.setUTCFullYear(end.getUTCFullYear() - 1);
  const range = { startDate: utcDayKey(new Date(end.getTime() - (STRIP_DAYS - 1) * DAY_MS)), endDate: utcDayKey(end) };
  const year = range.startDate.slice(0, 4);

  let list = $state<EntityList | null>(null);
  let loading = $state(true);
  let seq = 0;

  $effect(() => {
    const [e, m] = [entity, metric];
    reloadKey();
    untrack(() => {
      const my = ++seq;
      loading = true;
      const request: Promise<EntityList> =
        e === 'track' ? api.topTracks('custom', LIST_FETCH, m, range).then(items => ({ type: 'track' as const, items }))
        : e === 'album' ? api.topAlbums('custom', LIST_FETCH, m, range).then(items => ({ type: 'album' as const, items }))
        : api.topArtists('custom', LIST_FETCH, m, range).then(items => ({ type: 'artist' as const, items }));
      request
        .then(l => { if (my === seq) list = l; })
        .catch(err => console.error('last year widget:', err))
        .finally(() => { if (my === seq) loading = false; });
    });
  });

  let shown = $derived.by((): EntityList | null => {
    if (!list) return null;
    const n = LIST_MAX[size];
    return list.type === 'track' ? { type: 'track', items: list.items.slice(0, n) }
      : list.type === 'album' ? { type: 'album', items: list.items.slice(0, n) }
      : { type: 'artist', items: list.items.slice(0, n) };
  });
</script>

<WidgetHeader title="This week last year" href="/top?range=custom&tab={pluralOf(entity)}&startDate={range.startDate}&endDate={range.endDate}">
  {#snippet actions()}
    <span class="data-label">{year}</span>
    {#if onsettings && roomForActions(size)}
      <EntityTypePicker value={entity} onchange={(e) => onsettings({ entity: e })} variant="pills" iconsOnly />
    {/if}
  {/snippet}
</WidgetHeader>
{#if loading && !list}
  <div class="w-ghost w-ghost--fill"></div>
{:else if shown && shown.items.length > 0}
  <EntityRows list={shown} {metric} columns={size === 'xl' ? 2 : 1} />
{:else}
  <p class="w-empty">Nothing played this week in {year}.</p>
{/if}
