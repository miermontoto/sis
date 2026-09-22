<script lang="ts">
  // Marca de "esta fila es un álbum lógico". Las colecciones rankean como cualquier
  // disco y aparecen mezcladas con ellos en las listas de álbumes, así que sin esto no
  // hay forma de saber que una fila agrega varias: el nombre no siempre lo delata.
  //
  // Se pinta a partir del id (`collection:N`), que es el marcador de identidad que usa
  // toda la app (isCollectionKey, isSpotifyId, la ruta), y se queda en nada cuando la
  // fila es un disco normal: los consumidores lo montan siempre, sin condicionar.
  import { isCollectionKey } from '$lib/api';

  let { id }: { id: string | null | undefined } = $props();
</script>

{#if isCollectionKey(id)}
  <span class="collection-badge" title="Collection: this entry groups several albums or tracks">coll</span>
{/if}

<style>
  /* la geometría del alias-badge a escala de fila: neutro y sin color propio, que es
     un hecho sobre la entidad, no un aviso */
  .collection-badge {
    display: inline-block;
    font-family: var(--font-mono);
    font-size: 0.58rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
    border: 1px solid var(--border);
    border-radius: 3px;
    padding: 0 0.25rem;
    line-height: 1.4;
    vertical-align: middle;
    position: relative;
    top: -0.05em;
    margin-left: 0.4rem;
    flex-shrink: 0;
  }
</style>
