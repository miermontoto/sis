<script lang="ts">
  // Fila de concierto para las listas (registro global, sección del artista,
  // "más bolos" del detalle): la misma fila (TrackItem) que el resto de listas
  // de la app. Dos variantes según lo que la lista ya da por sabido:
  //  - 'global': la lista mezcla artistas → foto y nombre del artista, y la
  //    fecha en la columna de la derecha (la lista va agrupada por año)
  //  - 'artist': el artista es el de la página → ficha con la fecha en el hueco
  //    de la carátula y el recinto como nombre
  // Las acciones (editar, borrar, setlist.fm) van en el menú contextual, como
  // en el resto de filas de la app; el detalle las repite en su menú del hero.
  import { goto } from '$app/navigation';
  import type { Concert } from '$lib/api';
  import { contextMenu, type ContextMenuAction } from '$lib/stores/context-menu.svelte';
  import { calendarDayMonth, formatCalendarDayMonth } from '$lib/utils/format';
  import TrackItem from './TrackItem.svelte';
  import IconTicket from '$lib/icons/IconTicket.svelte';
  import IconArtist from '$lib/icons/IconArtist.svelte';
  import IconExternalLink from '$lib/icons/IconExternalLink.svelte';
  import IconEdit from '$lib/icons/IconEdit.svelte';
  import IconTrash from '$lib/icons/IconTrash.svelte';

  let {
    concert,
    variant = 'global',
    compact = false,
    onEdit,
    onRemove,
  }: {
    concert: Concert;
    variant?: 'global' | 'artist';
    compact?: boolean;
    onEdit?: (concert: Concert) => void;
    onRemove?: (concert: Concert) => void;
  } = $props();

  const href = $derived(`/concert/${concert.id}`);
  const place = $derived([concert.venue, concert.city].filter(Boolean).join(' · '));
  // en la variante de artista el recinto hace de nombre; sin recinto, la ciudad
  const title = $derived(variant === 'artist'
    ? (concert.venue ?? concert.city ?? 'Venue unknown')
    : concert.artistName);
  // no se llama `subtitle`: el snippet del mismo nombre lo taparía dentro del template
  const subtitleText = $derived((variant === 'artist'
    ? [concert.venue ? concert.city : null, concert.country, concert.tour]
    : [place || 'Venue unknown', concert.tour]
  ).filter(Boolean).join(' · '));
  const tile = $derived(calendarDayMonth(concert.date));

  function openMenu(e: MouseEvent) {
    const actions: ContextMenuAction[] = [
      { label: 'Open concert', icon: IconTicket, onClick: () => goto(href) },
    ];
    if (variant === 'global') {
      actions.push({ label: 'View artist', icon: IconArtist, onClick: () => goto(`/artist/${concert.artistId}`) });
    }
    const url = concert.setlistfmUrl;
    if (url) actions.push({ label: 'View on setlist.fm', icon: IconExternalLink, onClick: () => { window.open(url, '_blank'); } });
    if (onEdit) actions.push({ label: 'Edit concert', icon: IconEdit, onClick: () => onEdit(concert) });
    if (onRemove) actions.push({ label: 'Remove concert', icon: IconTrash, danger: true, onClick: () => onRemove(concert) });
    contextMenu.open(e, actions);
  }
</script>

<!-- el div sólo capta el botón derecho; los enlaces de dentro siguen siendo el
     control accesible de la fila -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="concert-row" oncontextmenu={openMenu}>
  <TrackItem
    {compact}
    imageUrl={variant === 'global' ? concert.artistImageUrl : null}
    imageHref={variant === 'global' ? `/artist/${concert.artistId}` : undefined}
    imageRound
    name={title}
    nameHref={href}
  >
    {#snippet cover()}
      {#if variant === 'artist'}
        <a class="concert-tile" {href} aria-label={title}>
          <span class="concert-tile-month">{tile.month}</span>
          <span class="concert-tile-day">{tile.day}</span>
        </a>
      {:else}
        <a class="track-art track-art--round concert-art--empty" href="/artist/{concert.artistId}" aria-label={concert.artistName}>
          <IconTicket size={16} />
        </a>
      {/if}
    {/snippet}
    {#snippet subtitle()}{subtitleText}{/snippet}
    {#snippet meta()}
      <div class="track-plays">{variant === 'global' ? formatCalendarDayMonth(concert.date) : concert.date.slice(0, 4)}</div>
      <div class="track-time">
        {#if concert.songsTotal > 0}
          <!-- en móvil la versión larga se comía el nombre: allí va la corta -->
          <span class="concert-meta-long">{concert.songsTotal} songs · {concert.songsMatched} in library</span>
          <span class="concert-meta-short">{concert.songsMatched}/{concert.songsTotal} songs</span>
        {:else}
          no setlist
        {/if}
      </div>
    {/snippet}
  </TrackItem>
</div>

<style>
  .concert-meta-short {
    display: none;
  }
  @media (max-width: 768px) {
    .concert-meta-long {
      display: none;
    }
    .concert-meta-short {
      display: inline;
    }
  }

  /* ficha con la fecha en el hueco de la carátula: mismas medidas que .track-art */
  .concert-tile {
    width: 48px;
    height: 48px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius);
    background: var(--bg-card);
    border: 1px solid var(--border);
    color: var(--text);
    text-decoration: none;
    line-height: 1;
    font-family: var(--font-mono);
    transition: border-color 0.05s, color 0.05s;
  }
  .concert-tile:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  :global(.track-item.compact) .concert-tile {
    width: 36px;
    height: 36px;
  }
  .concert-tile-month {
    font-size: 0.55rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
  }
  .concert-tile-day {
    font-size: 1rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    margin-top: 2px;
  }
  :global(.track-item.compact) .concert-tile-day {
    font-size: 0.85rem;
  }

  .concert-art--empty {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    border: 1px solid var(--border);
    transition: color 0.05s, border-color 0.05s;
  }
  .concert-art--empty:hover {
    color: var(--accent);
    border-color: var(--accent);
  }
</style>
