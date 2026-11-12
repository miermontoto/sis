<script lang="ts">
  // cabecera de un widget: título (enlazado a la vista que amplía lo que enseña)
  // y, a la derecha, lo que el widget quiera (una etiqueta, un selector). Es la
  // misma .section-header de las cards de la app, más prieta
  import type { Snippet } from 'svelte';

  let { title, href, actions }: { title: string; href?: string; actions?: Snippet } = $props();
</script>

<div class="section-header widget-header">
  <h3 class="section-title">
    {#if href}<a {href} class="section-link">{title}</a>{:else}{title}{/if}
  </h3>
  {#if actions}<div class="section-actions">{@render actions()}</div>{/if}
</div>

<style>
  .widget-header {
    margin: 0 0 0.6rem;
    gap: 0.5rem;
    flex-shrink: 0;
    min-width: 0;
  }
  .widget-header .section-title {
    font-size: var(--fs-sm);
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
