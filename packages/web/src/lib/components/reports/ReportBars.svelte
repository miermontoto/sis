<script module lang="ts">
  // fila de la lista de barras: géneros, décadas… la barra se escala al mayor `value`
  export interface BarItem {
    key: string;
    label: string;
    value: number;
    /** texto a la derecha (ya formateado) */
    valueLabel: string;
    sublabel?: string;
    href?: string;
    /** imagen opcional a la izquierda (foto del artista líder de la década) */
    imageUrl?: string | null;
    round?: boolean;
    /** cambio de puesto respecto al periodo anterior; undefined = no se pinta */
    rankChange?: number | null;
    isNew?: boolean;
  }
</script>

<script lang="ts">
  import RankChange from '$lib/components/RankChange.svelte';

  let { items }: { items: BarItem[] } = $props();

  const PCT = 100;
  let max = $derived(Math.max(1, ...items.map(i => i.value)));
</script>

<div class="report-bars">
  {#each items as item (item.key)}
    <div class="report-bar">
      <div class="report-bar-row">
        {#if item.imageUrl}
          <img class="report-bar-art" class:report-bar-art--round={item.round} src={item.imageUrl} alt="" />
        {/if}
        <span class="report-bar-label">
          {#if item.href}<a href={item.href}>{item.label}</a>{:else}{item.label}{/if}
        </span>
        {#if item.sublabel}<span class="report-bar-sub">{item.sublabel}</span>{/if}
        {#if item.rankChange !== undefined}<RankChange rankChange={item.rankChange} isNew={item.isNew ?? false} />{/if}
        <span class="report-bar-value data-count">{item.valueLabel}</span>
      </div>
      <div class="report-bar-track"><div class="report-bar-fill" style:width="{(item.value / max) * PCT}%"></div></div>
    </div>
  {/each}
</div>

<style>
  .report-bars {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .report-bar-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.85rem;
    min-width: 0;
  }
  .report-bar-art {
    width: 22px;
    height: 22px;
    object-fit: cover;
    border-radius: var(--radius);
    background: var(--border);
    flex-shrink: 0;
  }
  .report-bar-art--round { border-radius: 50%; }
  .report-bar-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .report-bar-label a { color: inherit; }
  .report-bar-label a:hover { color: var(--accent); }
  .report-bar-sub {
    color: var(--text-muted);
    font-size: 0.75rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .report-bar-value {
    margin-left: auto;
    color: var(--text-muted);
    font-size: 0.75rem;
    white-space: nowrap;
  }
  .report-bar-track {
    height: 4px;
    margin-top: 0.3rem;
    background: var(--bg-hover);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .report-bar-fill {
    height: 100%;
    background: var(--accent);
    border-radius: var(--radius);
  }
</style>
