<script lang="ts">
  // variación porcentual respecto al periodo anterior: verde sube, rojo baja. sin
  // periodo anterior (o con cero) no hay base con la que comparar y no se pinta
  let { value, previous }: { value: number; previous: number | null | undefined } = $props();

  const PCT = 100;
  let pct = $derived(previous == null || previous === 0 ? null : Math.round(((value - previous) / previous) * PCT));
</script>

{#if pct !== null}
  <span class="report-delta data-count" class:up={pct > 0} class:down={pct < 0} title="vs. previous period">
    {pct > 0 ? '▲' : pct < 0 ? '▼' : '='} {Math.abs(pct)}%
  </span>
{/if}

<style>
  .report-delta {
    font-size: 0.7rem;
    letter-spacing: 0.03em;
    color: var(--text-muted);
    white-space: nowrap;
  }
  .report-delta.up { color: var(--accent); }
  .report-delta.down { color: var(--danger); }
</style>
