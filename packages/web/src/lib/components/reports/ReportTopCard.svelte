<script lang="ts">
  // tarjeta del nº 1 de cada columna del report (artista / álbum / tema): imagen
  // grande, nombre y valor, con el cambio de puesto respecto al periodo anterior
  import RankChange from '$lib/components/RankChange.svelte';
  import { openEntityContextMenu, type EntityContext } from '$lib/utils/entity-context';

  let {
    label,
    href,
    imageUrl,
    round = false,
    name,
    sub = '',
    value,
    rankChange = null,
    isNew = false,
    entity,
  }: {
    label: string;
    href: string;
    imageUrl: string | null;
    round?: boolean;
    name: string;
    sub?: string;
    value: string;
    rankChange?: number | null;
    isNew?: boolean;
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
    <span class="data-count">{value}</span>
    <RankChange {rankChange} {isNew} />
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
    font-size: 0.8rem;
    color: var(--text-muted);
    min-height: 1.3em;
  }
  .report-top-value {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.8rem;
    color: var(--text-muted);
  }
</style>
