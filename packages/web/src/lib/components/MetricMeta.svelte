<script lang="ts">
  // cifra de un item de ranking: la métrica elegida en tinta y la otra debajo
  // en muted (tiempo + plays, o plays + tiempo). es el único sitio que pinta
  // ese par: listas, fichas del report y tarjetas de nº 1 lo comparten para
  // que un álbum o un artista no salga con una cifra suelta en blanco
  import type { RankingMetric } from '$lib/api';
  import { formatDuration, formatNumber } from '$lib/utils/format';

  let { playCount, totalMs, metric = 'time', flash = false }: {
    playCount: number;
    totalMs: number;
    metric?: RankingMetric;
    // la cifra acaba de cambiar por un play nuevo: parpadea
    flash?: boolean;
  } = $props();

  const plays = $derived(`${formatNumber(playCount)} plays`);
  const time = $derived(formatDuration(totalMs));
</script>

<div class="track-plays" class:stat-flash={flash}>{metric === 'plays' ? plays : time}</div>
<div class="track-time" class:stat-flash={flash}>{metric === 'plays' ? time : plays}</div>
