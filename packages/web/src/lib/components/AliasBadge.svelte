<script lang="ts">
  // Marca de "esta página es un alias": la entidad está mergeada dentro de otra, así que
  // sus escuchas se cuentan allí y aquí casi todo sale vacío. Va pegada al nombre en el
  // hero, como el badge de "live", porque explica la página entera — la sección de
  // relaciones la repite como fila, pero el rail se puede reordenar y esconder.
  import IconMerge from '$lib/icons/IconMerge.svelte';
  import type { EntityType } from '$lib/utils/entity-context';

  let { entityType, target }: { entityType: EntityType; target: { id: string; name: string } } = $props();
</script>

<a
  class="alias-badge"
  href="/{entityType}/{target.id}"
  title="Merged into {target.name} — the plays are counted there"
><IconMerge size={10} /><span class="alias-badge-label">merged into</span>{target.name}</a>
