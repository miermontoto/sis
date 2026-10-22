<script lang="ts">
  // Línea de artistas del hero de álbum y tema. Junto a cada uno, la posición de esta
  // entidad dentro de su catálogo: la fila que ocupa en sus top albums/tracks all-time,
  // la misma que enseña la página del artista que enlaza el nombre
  import { api, createFetchController, type ArtistScopedRank, type RankingMetric } from '$lib/api';
  import { attributionVersion } from '$lib/stores/attribution';
  import { medalColor } from '$lib/utils/medals';

  let {
    entityType,
    entityId,
    artists,
    metric,
    ranked = true,
  }: {
    entityType: 'track' | 'album';
    entityId: string;
    artists: { id: string; name: string }[];
    metric: RankingMetric;
    // un alias o un álbum dentro de una colección rankean con otro id: no tienen fila propia
    ranked?: boolean;
  } = $props();

  let ranks = $state<Record<string, ArtistScopedRank>>({});
  const fetchCtrl = createFetchController();

  // los ids como string: el detalle se relee con cada play confirmado y trae un array
  // nuevo con los mismos artistas, que no debe relanzar un escaneo por artista
  let artistKey = $derived(artists.map(a => a.id).join(','));

  $effect(() => {
    const ids = artistKey ? artistKey.split(',') : [];
    // merges, colecciones y créditos mueven las posiciones (ver attributionVersion)
    void attributionVersion();
    ranks = {};
    if (!ranked || ids.length === 0) return;
    const signal = fetchCtrl.reset();
    api.artistScopedRanks(entityType, entityId, ids, metric, signal)
      .then(r => { if (!signal.aborted) ranks = r; })
      .catch(() => {});
    return () => fetchCtrl.abort();
  });
</script>

<p class="detail-subtitle">
  {#each artists as artist, i}
    {@const pos = ranks[artist.id]}
    <!-- con un solo tema/álbum del artista en la biblioteca, el #1 no dice nada -->
    <a href="/artist/{artist.id}">{artist.name}</a>{#if pos && pos.total > 1}{' '}<span class="artist-rank" title="#{pos.rank} of {pos.total} {entityType}s by {artist.name}, all time" style:color={medalColor(pos.rank)}>(#{pos.rank} {entityType})</span>{/if}{#if i < artists.length - 1}{', '}{/if}
  {/each}
</p>

<style>
  .artist-rank {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: var(--fs-sm);
    white-space: nowrap;
  }
</style>
