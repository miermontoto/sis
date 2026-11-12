<script lang="ts">
  // tal día como hoy en años anteriores: medium enseña el año más reciente con su
  // tema del día (y el número de años con recuerdos); large, un año por fila.
  // Cada año abre el historial de ese día
  import { untrack } from 'svelte';
  import { formatDuration, formatNumber } from '$lib/utils/format';
  import { openEntityContextMenu, trackEntity } from '$lib/utils/entity-context';
  import { fitRows } from '$lib/utils/fit-rows';
  import WidgetHeader from '../WidgetHeader.svelte';
  import { memoriesStore, localToday } from '../memories.svelte';
  import { reloadKey } from '../util';
  import type { WidgetProps } from '../components';
  import type { MemoryYear } from '$lib/api';

  let { size }: WidgetProps = $props();

  let first = true;
  $effect(() => {
    reloadKey();
    untrack(() => { memoriesStore.ensure(!first); first = false; });
  });

  let years = $derived(memoriesStore.data?.onThisDay ?? []);
  let today = $derived(memoriesStore.data?.date ?? localToday());
  const dayHref = (y: MemoryYear) => `/history?date=${y.year}${today.slice(4)}`;
  const ago = (n: number) => n === 1 ? '1 year ago' : `${n} years ago`;
  let lead = $derived(years[0] ?? null);
</script>

{#snippet trackLine(y: MemoryYear)}
  {#if y.topTrack?.track}
    {@const track = y.topTrack.track}
    <a class="otd-track" href="/track/{y.topTrack.trackId}" oncontextmenu={openEntityContextMenu(trackEntity(track))} title="Most played that day">
      {#if track.album?.imageUrl}<img class="otd-art" src={track.album.imageUrl} alt="" loading="lazy" />{/if}
      <span class="otd-track-text">
        <span class="otd-track-name">{track.name}</span>
        <span class="otd-track-artist">{track.artists?.map(a => a.name).join(', ')}</span>
      </span>
    </a>
  {/if}
{/snippet}

<WidgetHeader title="On this day" href={lead ? dayHref(lead) : '/history'}>
  {#snippet actions()}
    {#if size === 'medium' && years.length > 1}<span class="data-label">{years.length} years</span>{/if}
  {/snippet}
</WidgetHeader>
{#if memoriesStore.loading && !memoriesStore.data}
  <div class="w-ghost w-ghost--fill"></div>
{:else if !lead}
  <p class="w-empty">Nothing played on this date in past years yet.</p>
{:else if size === 'medium'}
  <div class="w-fill otd-lead">
    <a class="otd-year" href={dayHref(lead)}>
      <span class="w-caption">{ago(lead.yearsAgo)} · {lead.year}</span>
      <span class="data-count">{formatNumber(lead.plays)} plays · {formatDuration(lead.totalMs)}</span>
    </a>
    {@render trackLine(lead)}
  </div>
{:else}
  <div class="w-fill otd-list" use:fitRows>
    {#each years as y (y.year)}
      <div class="otd-row">
        <a class="otd-year" href={dayHref(y)}>
          <span class="otd-year-num">{y.year}</span>
          <span class="w-sub">{formatNumber(y.plays)} plays</span>
        </a>
        {@render trackLine(y)}
      </div>
    {/each}
  </div>
{/if}

<style>
  .otd-lead {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .otd-year {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    text-decoration: none;
    color: inherit;
  }
  .otd-year:hover .data-count, .otd-year:hover .otd-year-num { color: var(--accent); }
  .otd-track {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
    text-decoration: none;
    color: inherit;
  }
  .otd-art {
    width: 2.25rem;
    height: 2.25rem;
    border-radius: var(--radius);
    object-fit: cover;
    flex-shrink: 0;
  }
  .otd-track-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .otd-track-name, .otd-track-artist {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .otd-track-name { font-weight: 600; font-size: var(--fs-sm); }
  .otd-track:hover .otd-track-name { color: var(--accent); }
  .otd-track-artist { font-size: var(--fs-xs); color: var(--text-muted); }
  .otd-list {
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
  }
  .otd-row {
    display: grid;
    grid-template-columns: 4.5rem minmax(0, 1fr);
    align-items: center;
    gap: 0.6rem;
  }
  .otd-year-num {
    font-family: var(--font-mono);
    font-weight: 700;
    color: var(--accent);
  }
</style>
