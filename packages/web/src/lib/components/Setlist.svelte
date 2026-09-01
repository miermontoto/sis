<script lang="ts">
  // Setlist de un concierto. Compartido por la sección del artista y la página
  // global: la lista de canciones es idéntica en ambas, lo que cambia alrededor
  // es el encabezado del bolo.
  //
  // Las canciones resueltas contra la librería enlazan a su track y llevan las
  // escuchas ANTERIORES a la fecha del bolo; las que no están se pintan apagadas
  // (que es información, no ruido: son las que el usuario no tenía).
  import type { ConcertSong } from '$lib/api';

  let { songs }: { songs: ConcertSong[] } = $props();
</script>

<ol class="setlist">
  {#each songs as song (song.position)}
    <li class="setlist-song" class:setlist-song--encore={song.isEncore} class:setlist-song--unknown={!song.trackId}>
      {#if song.trackId}
        <a href="/track/{song.trackId}">{song.name}</a>
      {:else}
        <span>{song.name}</span>
      {/if}
      {#if song.coverArtist}<em class="setlist-note">{song.coverArtist} cover</em>{/if}
      {#if song.info}<em class="setlist-note">{song.info}</em>{/if}
      {#if song.playsBefore !== undefined}
        <span class="setlist-plays" title="Plays before this show">{song.playsBefore}</span>
      {/if}
    </li>
  {/each}
</ol>

<style>
  .setlist {
    margin: 0;
    padding: 0.2rem 0.7rem 0.6rem 2.2rem;
    border-top: 1px solid var(--border);
    font-size: 0.8rem;
  }
  .setlist-song {
    padding: 0.12rem 0;
    color: var(--text);
  }
  .setlist-song a {
    color: inherit;
    text-decoration: none;
  }
  .setlist-song a:hover { color: var(--accent); }
  .setlist-song--unknown { color: var(--text-muted); }
  /* el bis se marca en el número, no con una fila separadora: mantiene la
     numeración continua del setlist real */
  .setlist-song--encore::marker { color: var(--accent); }
  .setlist-note {
    color: var(--text-muted);
    font-size: 0.72rem;
    margin-left: 0.35rem;
  }
  .setlist-plays {
    color: var(--text-muted);
    font-size: 0.68rem;
    margin-left: 0.35rem;
    font-variant-numeric: tabular-nums;
  }
</style>
