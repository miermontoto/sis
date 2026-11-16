<script lang="ts">
  // aniversarios de hoy: artistas que escuchaste por primera vez y álbumes que
  // salieron tal día como hoy (los mismos que avisa la push diaria), los más
  // escuchados primero
  import { untrack } from 'svelte';
  import { formatNumber } from '$lib/utils/format';
  import { openEntityContextMenu } from '$lib/utils/entity-context';
  import { fitRows } from '$lib/utils/fit-rows';
  import WidgetHeader from '../WidgetHeader.svelte';
  import { memoriesStore } from '../memories.svelte';
  import { reloadKey } from '../util';
  import type { WidgetProps } from '../components';

  let { size }: WidgetProps = $props();

  let first = true;
  $effect(() => {
    reloadKey();
    untrack(() => { memoriesStore.ensure(!first); first = false; });
  });

  let items = $derived(memoriesStore.data
    ? [...memoriesStore.data.firstListens, ...memoriesStore.data.releases].sort((a, b) => b.plays - a.plays)
    : []);
  const years = (n: number) => n === 1 ? '1 year' : `${n} years`;
</script>

<WidgetHeader title="Anniversaries" />
{#if memoriesStore.loading && !memoriesStore.data}
  <div class="w-ghost w-ghost--fill"></div>
{:else if items.length === 0}
  <p class="w-empty">No anniversaries today.</p>
{:else}
  <div class="w-fill an-list" use:fitRows data-size={size}>
    {#each items as a (a.type + a.id)}
      <a class="an-row" href="/{a.type}/{a.id}" title="{formatNumber(a.plays)} plays" oncontextmenu={openEntityContextMenu({ type: a.type, id: a.id, name: a.name, imageUrl: a.imageUrl, parentArtistId: a.artistId ?? undefined })}>
        {#if a.imageUrl}
          <img class="an-img" class:an-img--round={a.type === 'artist'} src={a.imageUrl} alt="" loading="lazy" />
        {:else}
          <span class="an-img an-img--empty" class:an-img--round={a.type === 'artist'}></span>
        {/if}
        <span class="an-text">
          <span class="an-name">{a.name}</span>
          <span class="an-sub">
            {#if a.type === 'artist'}First heard {years(a.years)} ago{:else}Released {years(a.years)} ago{#if a.artistName} · {a.artistName}{/if}{/if}
          </span>
        </span>
        <span class="an-badge w-figure">{a.years}y</span>
      </a>
    {/each}
  </div>
{/if}

<style>
  .an-list {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }
  .an-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    min-width: 0;
    text-decoration: none;
    color: inherit;
  }
  .an-img {
    width: 2.25rem;
    height: 2.25rem;
    border-radius: var(--radius);
    object-fit: cover;
    flex-shrink: 0;
  }
  .an-img--round { border-radius: 50%; }
  .an-img--empty { background: var(--bg-placeholder); }
  .an-text {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .an-name, .an-sub {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .an-name { font-weight: 600; font-size: var(--fs-sm); }
  .an-row:hover .an-name { color: var(--accent); }
  .an-sub { font-size: var(--fs-xs); color: var(--text-muted); }
  .an-badge { font-size: var(--fs-md); flex-shrink: 0; }
</style>
