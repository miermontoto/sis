<script lang="ts">
  // selector semana / mes / año, el único de la app (charts, cabecera del
  // report, latest reports del dashboard): mismo orden y mismas etiquetas.
  // con `hrefFor` cada opción es un enlace (el report navega de un periodo a
  // su hermano); si devuelve null esa opción no existe todavía y no se pinta
  import type { Granularity } from '$lib/api';
  import { GRANULARITIES, GRANULARITY_NOUNS } from '$lib/utils/report-periods';

  let { value, onchange, hrefFor }: {
    value: Granularity;
    onchange?: (value: Granularity) => void;
    hrefFor?: (value: Granularity) => string | null;
  } = $props();
</script>

<div class="granularity-picker">
  {#each GRANULARITIES as g (g)}
    {#if hrefFor}
      {@const href = hrefFor(g)}
      {#if href}
        <a class="range-btn" class:active={g === value} aria-current={g === value ? 'page' : undefined} {href}>{GRANULARITY_NOUNS[g]}</a>
      {/if}
    {:else}
      <button class="range-btn" class:active={g === value} aria-pressed={g === value} onclick={() => onchange?.(g)}>{GRANULARITY_NOUNS[g]}</button>
    {/if}
  {/each}
</div>

<style>
  .granularity-picker {
    display: flex;
    gap: 0.25rem;
  }
</style>
