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
  import IconTicket from '$lib/icons/IconTicket.svelte';

  let {
    concerts,
    kind,
  }: {
    concerts: ConcertRef[];
    // el artista se ve, el tema se escucha
    kind: 'artist' | 'track';
  } = $props();

  let open = $state(false);

  let count = $derived(concerts.length);
  let verb = $derived(kind === 'artist' ? 'Seen live' : 'Heard live');
  let label = $derived(`${verb}${count > 1 ? ` · ${count} times` : ''}`);

  // mismo gesto que Accolades: se abre al pasar por encima y se cierra al salir,
  // con el click como alternativa accesible desde teclado
  function handlePointerEnter() { open = true; }
  function handlePointerLeave() { open = false; }

  function handleKey(e: KeyboardEvent) {
    if (e.key === 'Escape') open = false;
  }

  $effect(() => {
    if (!open) return;
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  });

  const place = (c: ConcertRef) => [c.venue, c.city].filter(Boolean).join(' · ');
</script>

{#if count > 0}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="live-root"
    onpointerenter={handlePointerEnter}
    onpointerleave={handlePointerLeave}
  >
    <button
      type="button"
      class="live-trigger"
      class:live-trigger--open={open}
      aria-expanded={open}
      aria-haspopup="true"
      aria-label={label}
      title={label}
      onclick={() => (open = !open)}
    >
      <IconTicket size={14} />
      {#if count > 1}<span class="live-count">{count}</span>{/if}
    </button>

    {#if open}
      <div class="live-popover" role="region" aria-label={label}>
        <div class="live-title">{verb}</div>
        <ul class="live-list">
          {#each concerts as c (c.id)}
            <li>
              <a class="live-row" href="/concert/{c.id}">
                <span class="live-date">{formatCalendarDate(c.date)}</span>
                <span class="live-place">
                  {#if kind === 'track'}{c.artistName}{#if place(c)} · {/if}{/if}{place(c)}
                </span>
              </a>
            </li>
          {/each}
        </ul>
      </div>
    {/if}
  </div>
{/if}

<style>
  .live-root {
    position: relative;
    flex-shrink: 0;
    align-self: center;
  }
  /* mismas medidas que .accolades-trigger: los dos viven en la misma fila del
     hero y cualquier diferencia de alto se nota como un escalón */
  .live-trigger {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    height: 32px;
    padding: 0 0.45rem;
    border-radius: var(--radius);
    background: none;
    border: 1px solid var(--border);
    color: var(--accent);
    font: inherit;
    cursor: pointer;
    transition: color 0.05s, border-color 0.05s, background 0.05s;
  }
  .live-trigger:hover,
  .live-trigger--open {
    border-color: var(--accent);
    background: rgba(29, 185, 84, 0.08);
  }
  .live-count {
    font-size: 0.72rem;
    font-variant-numeric: tabular-nums;
  }

  .live-popover {
    position: absolute;
    top: calc(100% + 0.35rem);
    right: 0;
    z-index: 30;
    min-width: 200px;
    max-width: min(320px, 80vw);
    padding: 0.5rem 0.6rem;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  }
  .live-title {
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted);
    margin-bottom: 0.3rem;
  }
  .live-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .live-row {
    display: flex;
    gap: 0.5rem;
    padding: 0.15rem 0;
    color: var(--text);
    text-decoration: none;
    font-size: 0.78rem;
  }
  .live-row:hover { color: var(--accent); }
  .live-date {
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .live-place {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
</style>
