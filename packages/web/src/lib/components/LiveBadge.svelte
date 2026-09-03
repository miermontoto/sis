<script lang="ts">
  // Indicador de "esto lo has vivido en directo", junto a las medallas de
  // Accolades. En un artista significa que lo has visto; en un tema, que sonó en
  // el setlist de algún bolo al que fuiste.
  //
  // Ausencia NO es prueba de lo contrario: un concierto dado de alta a mano no
  // tiene setlist, así que un tema puede haber sonado sin que aquí conste. Por
  // eso el badge sólo aparece cuando hay algo que afirmar, nunca como un "no".
  import { formatCalendarDate } from '$lib/utils/format';
  import type { ConcertRef } from '$lib/api';
  import HoverPopover from '$lib/components/HoverPopover.svelte';
  import IconTicket from '$lib/icons/IconTicket.svelte';

  let {
    concerts,
    kind,
  }: {
    concerts: ConcertRef[];
    // el artista se ve, el tema se escucha
    kind: 'artist' | 'track';
  } = $props();

  let count = $derived(concerts.length);
  let verb = $derived(kind === 'artist' ? 'Seen live' : 'Heard live');
  let label = $derived(`${verb}${count > 1 ? ` · ${count} times` : ''}`);

  const place = (c: ConcertRef) => [c.venue, c.city].filter(Boolean).join(' · ');
</script>

{#if count > 0}
  <HoverPopover {label} idleTone>
    {#snippet trigger()}
      <IconTicket size={14} />
      {#if count > 1}<span class="live-count">{count}</span>{/if}
    {/snippet}

    <div class="popover-title">{verb}</div>
    <ul class="popover-list">
      {#each concerts as c (c.id)}
        <li>
          <a class="popover-row popover-row--link" href="/concert/{c.id}">
            <span class="live-date">{formatCalendarDate(c.date)}</span>
            <span class="live-place">
              {#if kind === 'track'}{c.artistName}{#if place(c)} · {/if}{/if}{place(c)}
            </span>
          </a>
        </li>
      {/each}
    </ul>
  </HoverPopover>
{/if}

<style>
  .live-count {
    font-size: 0.72rem;
    font-variant-numeric: tabular-nums;
  }
  /* la fecha hace de columna fija a la izquierda, como la medalla en records */
  .live-date {
    font-size: 0.8rem;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .live-place {
    font-size: 0.8rem;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
