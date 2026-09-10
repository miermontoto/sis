<script lang="ts">
  // Columna de puesto de una fila de ranking: el número y, debajo, el badge que
  // corresponda. Tres vistas pintaban esto a mano (TrackItem y las filas de
  // artista y álbum de /top); el badge en vivo obliga a que la columna aparezca
  // aunque la vista no pinte deltas de lookback, así que vive en un solo sitio.
  import RankChange from './RankChange.svelte';
  import { statFlashStore } from '$lib/stores/stat-flash.svelte';
  import { medalColor } from '$lib/utils/medals';

  interface Props {
    rank: number;
    // entidad de la fila: con ella se consulta si acaba de moverse en vivo
    id?: string | null;
    // undefined = esta vista no pinta deltas de lookback (el badge en vivo sí sale)
    rankChange?: number | null;
    isNew?: boolean;
    isReentry?: boolean;
  }

  let { rank, id = null, rankChange, isNew = false, isReentry = false }: Props = $props();

  // el movimiento en vivo tiene prioridad mientras dura: es lo que acaba de
  // pasar delante del usuario, y el delta del lookback vuelve al retirarse
  let move = $derived(statFlashStore.moveOf(id));
</script>

{#if move !== null || rankChange !== undefined}
  <div class="rank-col">
    <span class="track-rank" style:color={medalColor(rank)}>{rank}</span>
    {#if move !== null}
      <RankChange rankChange={move} isNew={false} live />
    {:else}
      <RankChange rankChange={rankChange ?? null} {isNew} {isReentry} />
    {/if}
  </div>
{:else}
  <span class="track-rank" style:color={medalColor(rank)}>{rank}</span>
{/if}
