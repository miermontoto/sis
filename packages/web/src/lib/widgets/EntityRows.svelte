<script lang="ts" module>
  import type { TopTrackItem, TopAlbumItem, TopArtistItem } from '$lib/api';
  // una lista top de cualquier tipo, ya pedida por el widget
  export type EntityList =
    | { type: 'track'; items: TopTrackItem[] }
    | { type: 'album'; items: TopAlbumItem[] }
    | { type: 'artist'; items: TopArtistItem[] };
</script>

<script lang="ts">
  // filas compactas de una lista top (temas, álbumes o artistas) dentro de un
  // widget: los temas con TrackList, el resto con TrackItem, que son las mismas
  // filas de toda la app (ecualizador de lo que suena, RankCell, menú contextual).
  // `columns` las reparte en dos columnas de arriba abajo (xl); fitRows recorta
  // las que no caben en el alto del slot
  import TrackList from '$lib/components/TrackList.svelte';
  import TrackItem from '$lib/components/TrackItem.svelte';
  import MetricMeta from '$lib/components/MetricMeta.svelte';
  import type { RankingMetric } from '$lib/api';
  import { fitRows } from '$lib/utils/fit-rows';

  let { list, metric, ranked = true, columns = 1, rankOffset = 0 }: {
    list: EntityList;
    metric: RankingMetric;
    ranked?: boolean;
    columns?: 1 | 2;
    // primer puesto de la lista (el collage de un large enseña del 1 al 5 y la lista sigue en el 6)
    rankOffset?: number;
  } = $props();
</script>

<div class="w-fill erows" class:erows--cols={columns === 2} use:fitRows={'.track-list'}>
  {#if list.type === 'track'}
    <TrackList items={list.items} showRank={ranked} {metric} compact ranks={rankOffset ? list.items.map((_, i) => rankOffset + i + 1) : undefined} />
  {:else if list.type === 'album'}
    <div class="track-list">
      {#each list.items as item, i (item.albumId)}
        {#if item.album}
          {@const album = item.album}
          <TrackItem compact rank={ranked ? rankOffset + i + 1 : undefined} imageUrl={album.imageUrl} imageHref="/album/{item.albumId}" name={album.name} nameHref="/album/{item.albumId}" entity={{ type: 'album', id: item.albumId, name: album.name, imageUrl: album.imageUrl ?? null, parentArtistId: item.artists?.[0]?.id }}>
            {#snippet subtitle()}
              {#each item.artists ?? [] as ar, j (ar.id)}{#if j > 0}, {/if}<a href="/artist/{ar.id}" class="artist-link">{ar.name}</a>{/each}
            {/snippet}
            {#snippet meta()}<MetricMeta playCount={item.playCount} totalMs={item.totalMs} {metric} />{/snippet}
          </TrackItem>
        {/if}
      {/each}
    </div>
  {:else}
    <div class="track-list">
      {#each list.items as item, i (item.artistId)}
        {#if item.artist}
          {@const artist = item.artist}
          <TrackItem compact rank={ranked ? rankOffset + i + 1 : undefined} imageUrl={artist.imageUrl} imageHref="/artist/{item.artistId}" imageRound name={artist.name} nameHref="/artist/{item.artistId}" entity={{ type: 'artist', id: item.artistId, name: artist.name, imageUrl: artist.imageUrl ?? null }}>
            {#snippet meta()}<MetricMeta playCount={item.playCount} totalMs={item.totalMs} {metric} />{/snippet}
          </TrackItem>
        {/if}
      {/each}
    </div>
  {/if}
</div>

<style>
  /* dos columnas de arriba abajo con alto fijo: lo que no cabe salta a una tercera
     columna a la derecha, que fitRows oculta */
  .erows--cols :global(.track-list) {
    display: block;
    columns: 2;
    column-gap: 1rem;
    column-fill: auto;
    height: 100%;
  }
  .erows--cols :global(.track-list > *) {
    break-inside: avoid;
    margin-bottom: var(--track-list-gap);
  }
</style>
