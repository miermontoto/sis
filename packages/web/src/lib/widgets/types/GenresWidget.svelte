<script lang="ts">
  // mezcla de géneros del rango: la dona de siempre en large, y en medium las
  // cinco primeras como barras (una dona de 150px no deja leer ninguna etiqueta)
  import { untrack } from 'svelte';
  import { REPORT_GENRES_LIMIT } from '@sis/shared';
  import { api, type GenreItem } from '$lib/api';
  import GenrePie from '$lib/components/charts/GenrePie.svelte';
  import { formatNumber } from '$lib/utils/format';
  import WidgetHeader from '../WidgetHeader.svelte';
  import { reloadKey, rangePhrase } from '../util';
  import type { WidgetProps } from '../components';

  let { size, settings }: WidgetProps = $props();

  const BARS = 5;
  const PCT = 100;

  let range = $derived(String(settings.range));
  let genres = $state<GenreItem[]>([]);
  let loading = $state(true);
  let seq = 0;
  // la dona necesita un alto en px: el del hueco que deja la cabecera
  let pieHeight = $state(0);

  $effect(() => {
    const r = range;
    reloadKey();
    untrack(() => {
      const my = ++seq;
      loading = true;
      api.topGenres(r, REPORT_GENRES_LIMIT)
        .then(g => { if (my === seq) genres = g; })
        .catch(e => console.error('genres widget:', e))
        .finally(() => { if (my === seq) loading = false; });
    });
  });

  let top = $derived(genres.slice(0, BARS));
  let max = $derived(Math.max(1, ...top.map(g => g.play_count)));
</script>

<WidgetHeader title="Top genres {rangePhrase(range)}" href="/insights" />
{#if loading && genres.length === 0}
  <div class="w-ghost w-ghost--fill"></div>
{:else if genres.length === 0}
  <p class="w-empty">No genre data {rangePhrase(range)}: genres come from the artists you play.</p>
{:else if size === 'medium'}
  <div class="w-fill gw-bars">
    {#each top as g (g.genre)}
      <div class="gw-row" title="{g.genre} · {formatNumber(g.play_count)} plays">
        <span class="gw-name">{g.genre}</span>
        <span class="gw-track"><span class="gw-bar" style:width="{(g.play_count / max) * PCT}%"></span></span>
      </div>
    {/each}
  </div>
{:else}
  <div class="w-fill" bind:clientHeight={pieHeight}>
    {#if pieHeight > 0}<GenrePie {genres} unit="plays" height="{pieHeight}px" />{/if}
  </div>
{/if}

<style>
  .gw-bars {
    display: flex;
    flex-direction: column;
    justify-content: space-around;
    gap: 0.25rem;
  }
  .gw-row {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
    align-items: center;
    gap: 0.5rem;
    font-size: var(--fs-sm);
  }
  .gw-name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    text-transform: capitalize;
  }
  .gw-track {
    height: 0.45rem;
    border-radius: 0.25rem;
    background: var(--fg-a05);
    overflow: hidden;
  }
  .gw-bar {
    display: block;
    height: 100%;
    background: var(--accent);
  }
</style>
