<script lang="ts">
  // tarjeta del nº 1 de cada columna del report (artista / álbum / tema): imagen
  // grande, nombre y valor, con el cambio de puesto respecto al periodo anterior
  import RankChange from '$lib/components/RankChange.svelte';
  import MetricMeta from '$lib/components/MetricMeta.svelte';
  import type { RankingMetric } from '$lib/api';
  import { openEntityContextMenu, type EntityContext } from '$lib/utils/entity-context';

  let {
    label,
    href,
    imageUrl,
    round = false,
    name,
    sub = '',
    playCount,
    totalMs,
    metric = 'time',
    rankChange = null,
    isNew = false,
    isReentry = false,
    entity,
  }: {
    label: string;
    href: string;
    imageUrl: string | null;
    round?: boolean;
    name: string;
    sub?: string;
    playCount: number;
    totalMs: number;
    metric?: RankingMetric;
    rankChange?: number | null;
    isNew?: boolean;
    isReentry?: boolean;
    entity?: EntityContext;
  } = $props();

  let onContextMenu = $derived(entity ? openEntityContextMenu(entity) : undefined);
</script>

<a {href} class="card report-top-card" oncontextmenu={onContextMenu}>
  <span class="data-label">{label}</span>
  {#if imageUrl}
    <img class="report-top-img" class:report-top-img--round={round} src={imageUrl} alt="" />
  {:else}
    <div class="report-top-img report-top-img--empty" class:report-top-img--round={round}></div>
  {/if}
  <span class="report-top-name">{name}</span>
  <!-- siempre en el flujo: sin subtítulo la tarjeta sería más baja que sus vecinas -->
  <span class="report-top-sub">{sub}</span>
  <span class="report-top-value">
    <MetricMeta {playCount} {totalMs} {metric} />
    <RankChange {rankChange} {isNew} {isReentry} />
  </span>
</a>

<style>
  .report-top-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 0.4rem;
    color: inherit;
    text-decoration: none;
    transition: border-color 0.05s;
  }
  .report-top-card:hover {
    border-color: var(--accent);
    color: inherit;
  }
  .report-top-img {
    width: 112px;
    height: 112px;
    object-fit: cover;
    border-radius: var(--radius);
    background: var(--border);
    margin: 0.25rem 0;
  }
  .report-top-img--round { border-radius: 50%; }
  .report-top-name {
    font-weight: 600;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }
  .report-top-sub {
    font-size: var(--fs-sm);
    color: var(--text-muted);
    min-height: 1.3em;
  }
  .report-top-value {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.15rem;
  }
</style>
