<script lang="ts">
  // Posición de esta entidad dentro del catálogo de cada artista acreditado: la fila que
  // ocupa en sus top albums/tracks all-time, la misma que enseña la página del artista.
  // Se pinta como una cifra más de la línea de meta del hero ("· #3 in Eminem", el detalle
  // en el title): un .meta-stat, que recibe el separador del css (app.css) como sus vecinas
  import { api, createFetchController, type ArtistScopedRank, type RankingMetric } from '$lib/api';
  import { attributionVersion } from '$lib/stores/attribution';

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

  // con un solo tema/álbum del artista en la biblioteca, el #1 no dice nada
  let shown = $derived(artists.flatMap(a => {
    const pos = ranks[a.id];
    return pos && pos.total > 1 ? [{ ...pos, name: a.name }] : [];
  }));

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

<!-- el espacio explícito es el punto de corte entre cifras: svelte quita el que hay al
     principio y al final de cada bloque -->
{#each shown as s (s.name)}{' '}<span class="detail-meta meta-stat" title="#{s.rank} of {s.name}'s {s.total} {entityType}s, all time by {metric === 'plays' ? 'plays' : 'listening time'}">#{s.rank} in {s.name}</span>{/each}
