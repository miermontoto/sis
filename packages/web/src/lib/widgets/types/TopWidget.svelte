<script lang="ts">
  // top de temas, álbumes o artistas para cualquier rango. small: el nº 1 a sangre
  // con su carátula; medium/large/tall: lista (o collage, para álbumes y artistas:
  // large y tall ponen el collage arriba y siguen la lista desde el 6); xl: lista a
  // dos columnas o el collage entero, que es un 2:1 como el propio slot. Suma el play
  // optimista a sus filas como hacía el dashboard
  import { untrack } from 'svelte';
  import { api, type TopTrackItem, type TopAlbumItem, type TopArtistItem } from '$lib/api';
  import TopCollage from '$lib/components/TopCollage.svelte';
  import EntityTypePicker from '$lib/components/EntityTypePicker.svelte';
  import { nowPlayingStore } from '$lib/stores/now-playing.svelte';
  import { playUpdatesStore, targetIdsFor } from '$lib/stores/play-updates.svelte';
  import { statFlashStore } from '$lib/stores/stat-flash.svelte';
  import { applyPlayToTopRows, rankMoves } from '$lib/utils/optimistic-play';
  import { openEntityContextMenu, trackEntity } from '$lib/utils/entity-context';
  import { formatDuration, formatNumber } from '$lib/utils/format';
  import WidgetHeader from '../WidgetHeader.svelte';
  import EntityRows, { type EntityList } from '../EntityRows.svelte';
  import { widgetMetric, reloadKey, entityOf, pluralOf, rangePhrase, LIST_MAX, roomForActions } from '../util';
  import type { WidgetProps } from '../components';

  let { size, settings, onsettings }: WidgetProps = $props();

  // un tope fijo (y no el de cada tamaño) para que cambiar de tamaño no repita la petición
  const FETCH_LIMIT = 20;
  const COLLAGE_COUNT = 5;

  let entity = $derived(entityOf(settings));
  let range = $derived(String(settings.range));
  let collage = $derived(settings.style === 'collage' && entity !== 'track');
  let metric = $derived(widgetMetric(settings));
  let title = $derived(`Top ${pluralOf(entity)} ${rangePhrase(range)}`);
  let href = $derived(`/top?range=${range}&tab=${pluralOf(entity)}`);

  let list = $state<EntityList | null>(null);
  let loading = $state(true);
  let seq = 0;

  $effect(() => {
    const [e, r, m] = [entity, range, metric];
    reloadKey();
    untrack(() => load(e, r, m));
  });

  function load(e: typeof entity, r: string, m: typeof metric) {
    const my = ++seq;
    loading = true;
    const request: Promise<EntityList> =
      e === 'track' ? api.topTracks(r, FETCH_LIMIT, m).then(items => ({ type: 'track' as const, items }))
      : e === 'album' ? api.topAlbums(r, FETCH_LIMIT, m).then(items => ({ type: 'album' as const, items }))
      : api.topArtists(r, FETCH_LIMIT, m).then(items => ({ type: 'artist' as const, items }));
    request
      .then(l => { if (my === seq) list = l; })
      .catch(err => console.error('top widget:', err))
      .finally(() => { if (my === seq) loading = false; });
  }

  // play recién terminado: todos los rangos acaban en "ahora", así que siempre cuenta
  let lastOptimistic = playUpdatesStore.optimistic?.seq ?? 0;
  $effect(() => {
    const update = playUpdatesStore.optimistic;
    if (!update || update.seq <= lastOptimistic) return;
    lastOptimistic = update.seq;
    untrack(() => {
      if (!list) return;
      const ids = targetIdsFor(update, pluralOf(list.type) as 'tracks' | 'albums' | 'artists');
      const before = rowIds(list);
      list = list.type === 'track' ? { type: 'track', items: applyPlayToTopRows(list.items, t => t.trackId, ids, update.playedMs, metric) }
        : list.type === 'album' ? { type: 'album', items: applyPlayToTopRows(list.items, a => a.albumId, ids, update.playedMs, metric) }
        : { type: 'artist', items: applyPlayToTopRows(list.items, a => a.artistId, ids, update.playedMs, metric) };
      statFlashStore.move(rankMoves(before, rowIds(list)));
    });
  });

  function rowIds(l: EntityList): string[] {
    return l.type === 'track' ? l.items.map(t => t.trackId) : l.type === 'album' ? l.items.map(a => a.albumId) : l.items.map(a => a.artistId);
  }

  const value = (plays: number, ms: number) => metric === 'plays' ? `${formatNumber(plays)} plays` : formatDuration(ms);

  // una fila de cualquier tipo reducida a lo que pintan el nº 1 y el collage
  type Card = { id: string; href: string; name: string; sub: string | null; imageUrl: string | null; stat: string; round: boolean; live: boolean; menu: (e: MouseEvent) => void };
  function cards(l: EntityList): Card[] {
    if (l.type === 'track') return l.items.filter(t => t.track).map((t: TopTrackItem) => ({
      id: t.trackId, href: `/track/${t.trackId}`, name: t.track!.name, sub: t.track!.artists?.map(a => a.name).join(', ') ?? null,
      imageUrl: t.track!.album?.imageUrl ?? null, stat: value(t.playCount, t.totalMs), round: false,
      live: nowPlayingStore.isLive('track', t.trackId), menu: openEntityContextMenu(trackEntity(t.track!)),
    }));
    if (l.type === 'album') return l.items.filter(a => a.album).map((a: TopAlbumItem) => ({
      id: a.albumId, href: `/album/${a.albumId}`, name: a.album!.name, sub: a.artists?.map(x => x.name).join(', ') ?? null,
      imageUrl: a.album!.imageUrl ?? null, stat: value(a.playCount, a.totalMs), round: false,
      live: nowPlayingStore.isLive('album', a.albumId),
      menu: openEntityContextMenu({ type: 'album', id: a.albumId, name: a.album!.name, imageUrl: a.album!.imageUrl ?? null, parentArtistId: a.artists?.[0]?.id }),
    }));
    return l.items.filter(a => a.artist).map((a: TopArtistItem) => ({
      id: a.artistId, href: `/artist/${a.artistId}`, name: a.artist!.name, sub: null,
      imageUrl: a.artist!.imageUrl ?? null, stat: value(a.playCount, a.totalMs), round: true,
      live: nowPlayingStore.isLive('artist', a.artistId),
      menu: openEntityContextMenu({ type: 'artist', id: a.artistId, name: a.artist!.name, imageUrl: a.artist!.imageUrl ?? null }),
    }));
  }

  let all = $derived(list ? cards(list) : []);
  let lead = $derived(all[0] ?? null);
  // lo que queda tras el collage de un large: sigue la lista desde el 6
  let rest = $derived.by((): EntityList | null => {
    if (!list) return null;
    const from = collage ? COLLAGE_COUNT : 0;
    const max = LIST_MAX[size];
    return list.type === 'track' ? { type: 'track', items: list.items.slice(from, from + max) }
      : list.type === 'album' ? { type: 'album', items: list.items.slice(from, from + max) }
      : { type: 'artist', items: list.items.slice(from, from + max) };
  });
</script>

{#if size === 'small'}
  {#if loading && !lead}
    <div class="w-ghost w-ghost--fill"></div>
  {:else if lead}
    <a class="top-lead" href={lead.href} oncontextmenu={lead.menu} title="{lead.name} · #1 {rangePhrase(range)}">
      {#if lead.imageUrl}<img class="top-lead-img" class:top-lead-img--round={lead.round} src={lead.imageUrl} alt="" loading="lazy" />{/if}
      <span class="top-lead-caption">
        <span class="w-caption">#1 {pluralOf(entity).slice(0, -1)} · {rangePhrase(range)}</span>
        <span class="top-lead-name">{lead.name}</span>
        <span class="track-plays">{lead.stat}</span>
      </span>
    </a>
  {:else}
    <p class="w-empty">No plays {rangePhrase(range)}.</p>
  {/if}
{:else}
  <WidgetHeader {title} {href}>
    {#snippet actions()}
      {#if onsettings && roomForActions(size)}
        <EntityTypePicker value={entity} onchange={(e) => onsettings({ entity: e })} variant="pills" iconsOnly />
      {/if}
    {/snippet}
  </WidgetHeader>
  {#if loading && !list}
    <div class="w-ghost w-ghost--fill"></div>
  {:else if all.length === 0}
    <p class="w-empty">No plays {rangePhrase(range)}.</p>
  {:else if collage && size !== 'medium'}
    <div class="top-collage" class:top-collage--fill={size === 'xl'}>
      <TopCollage items={all.slice(0, COLLAGE_COUNT).map((c, i) => ({ href: c.href, rank: i + 1, imageUrl: c.imageUrl, name: c.name, stat: c.stat, isLive: c.live, oncontextmenu: c.menu }))} />
    </div>
    {#if (size === 'large' || size === 'tall') && rest && rest.items.length > 0}
      <EntityRows list={rest} {metric} rankOffset={COLLAGE_COUNT} />
    {/if}
  {:else if collage}
    <div class="top-collage top-collage--fill">
      <TopCollage items={all.slice(0, COLLAGE_COUNT).map((c, i) => ({ href: c.href, rank: i + 1, imageUrl: c.imageUrl, name: c.name, stat: c.stat, isLive: c.live, oncontextmenu: c.menu }))} />
    </div>
  {:else if rest}
    <EntityRows list={rest} {metric} columns={size === 'xl' ? 2 : 1} />
  {/if}
{/if}

<style>
  /* small: el nº 1 a sangre, con la caption sobre un degradado */
  .top-lead {
    position: relative;
    flex: 1;
    min-height: 0;
    margin: calc(var(--widget-pad) * -1);
    display: flex;
    align-items: flex-end;
    text-decoration: none;
    color: inherit;
    overflow: hidden;
    background: var(--bg-placeholder);
  }
  .top-lead-img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .top-lead-caption {
    position: relative;
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    padding: 2.5rem var(--widget-pad) var(--widget-pad);
    background: linear-gradient(to top, rgba(0, 0, 0, 0.85), rgba(0, 0, 0, 0));
    color: #fff;
  }
  .top-lead-caption .w-caption { color: rgba(255, 255, 255, 0.75); }
  .top-lead-name {
    font-weight: 600;
    font-size: var(--fs-md);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .top-lead:hover .top-lead-name { text-decoration: underline; }

  .top-collage {
    flex-shrink: 0;
    margin-bottom: 0.6rem;
  }
  /* el collage es un 2:1; en un slot que no lo es (medium, xl con cabecera) llena
     el hueco y las teselas dejan de ser cuadradas, que con object-fit no se nota */
  .top-collage--fill {
    flex: 1;
    min-height: 0;
    margin-bottom: 0;
    display: flex;
  }
  .top-collage--fill :global(.collage) {
    aspect-ratio: auto;
    width: 100%;
    height: 100%;
  }
</style>
