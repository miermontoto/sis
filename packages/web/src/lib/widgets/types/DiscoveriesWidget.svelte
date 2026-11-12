<script lang="ts">
  // lo nuevo para ti: artistas, álbumes o temas sin ningún play antes del rango (la
  // misma definición que la sección discovery de los reports), los más escuchados
  // primero
  import { untrack } from 'svelte';
  import { api, type TopTrackItem, type TopAlbumItem, type TopArtistItem } from '$lib/api';
  import EntityTypePicker from '$lib/components/EntityTypePicker.svelte';
  import WidgetHeader from '../WidgetHeader.svelte';
  import EntityRows, { type EntityList } from '../EntityRows.svelte';
  import { LIST_FETCH, widgetMetric, reloadKey, entityOf, pluralOf, rangePhrase, LIST_MAX, roomForActions } from '../util';
  import type { WidgetProps } from '../components';

  let { size, settings, onsettings }: WidgetProps = $props();

  let entity = $derived(entityOf(settings, 'artist'));
  let range = $derived(String(settings.range));
  let metric = $derived(widgetMetric(settings));

  let list = $state<EntityList | null>(null);
  let loading = $state(true);
  let seq = 0;

  $effect(() => {
    const [e, r, m] = [entity, range, metric];
    reloadKey();
    untrack(() => {
      const my = ++seq;
      loading = true;
      const request: Promise<EntityList> =
        e === 'track' ? api.discoveries<TopTrackItem>('track', r, LIST_FETCH, m).then(items => ({ type: 'track' as const, items }))
        : e === 'album' ? api.discoveries<TopAlbumItem>('album', r, LIST_FETCH, m).then(items => ({ type: 'album' as const, items }))
        : api.discoveries<TopArtistItem>('artist', r, LIST_FETCH, m).then(items => ({ type: 'artist' as const, items }));
      request
        .then(l => { if (my === seq) list = l; })
        .catch(err => console.error('discoveries widget:', err))
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

<WidgetHeader title="New {pluralOf(entity)} {rangePhrase(range)}">
  {#snippet actions()}
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
  <p class="w-empty">Nothing new {rangePhrase(range)}: everything you played you had heard before.</p>
{/if}
