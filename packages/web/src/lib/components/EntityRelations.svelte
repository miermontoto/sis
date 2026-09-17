<script lang="ts">
  // Todas las relaciones de una entidad en un solo sitio: los merges (hard, con
  // dirección) y —para artistas— los vínculos declarados (soft, simétricos). Antes
  // vivían separados: los merges en un banner de colores propio encima del hero y las
  // relaciones en chips del rail, contando la misma historia en dos idiomas distintos.
  // Ahora son la fila de siempre (TrackItem), con las acciones en el menú contextual
  // como cualquier otra lista de la app.
  import { api, type EntityRelation, type RelationKind, type RankingMetric } from '$lib/api';
  import { contextMenu, type ContextMenuAction } from '$lib/stores/context-menu.svelte';
  import { entityContextActions, type EntityType } from '$lib/utils/entity-context';
  import { errorMessage } from '$lib/utils/errors';
  import { toastStore } from '$lib/stores/toast.svelte';
  import TrackItem from './TrackItem.svelte';
  import MetricMeta from './MetricMeta.svelte';
  import IconMerge from '$lib/icons/IconMerge.svelte';
  import IconSwap from '$lib/icons/IconSwap.svelte';
  import IconTrash from '$lib/icons/IconTrash.svelte';

  let {
    entityType,
    entity,
    relations,
    metric = 'time',
    parentArtistId,
    onManageMerges,
    onManageRelated,
    onChanged,
  }: {
    entityType: EntityType;
    entity: { id: string; name: string; imageUrl: string | null };
    relations: EntityRelation[];
    metric?: RankingMetric;
    /** artista padre de un álbum/tema: sin él el modal de merges no sabe dónde buscar */
    parentArtistId?: string;
    onManageMerges: () => void;
    /** sólo artistas: las relaciones soft no existen para álbumes ni temas */
    onManageRelated?: () => void;
    onChanged: () => void;
  } = $props();

  // el orden de los grupos es el de la lista que manda la API: dónde vive esta página,
  // qué absorbe, y qué se ha declarado a mano
  const GROUPS: { kind: RelationKind; label: string }[] = [
    { kind: 'alias', label: 'Merged into' },
    { kind: 'absorbed', label: 'Includes plays from' },
    { kind: 'related', label: 'Related' },
  ];

  let busy = $state(false);
  let groups = $derived(GROUPS
    .map(g => ({ ...g, rows: relations.filter(r => r.kind === g.kind) }))
    .filter(g => g.rows.length > 0));

  const href = (r: EntityRelation) => `/${entityType}/${r.id}`;

  // promueve `id` a canónico de su grupo: el resto del grupo pasa a apuntar ahí
  async function makeCanonical(id: string) {
    if (busy) return;
    busy = true;
    try {
      await api.makeCanonical(entityType, id);
      onChanged();
    } catch (e) {
      toastStore.show(errorMessage(e, 'Error swapping merge direction'));
    } finally {
      busy = false;
    }
  }

  async function unmerge(r: EntityRelation) {
    if (busy) return;
    busy = true;
    try {
      await api.deleteMerge(r.ruleIds[0]);
      onChanged();
    } catch (e) {
      toastStore.show(errorMessage(e, 'Error removing merge'));
    } finally {
      busy = false;
    }
  }

  // ruleIds suele traer un solo id; hay varios cuando el otro lado quedó mergeado
  // después de crear las relaciones, y entonces hay que borrar todas las filas
  async function unrelate(r: EntityRelation) {
    if (busy) return;
    busy = true;
    try {
      await Promise.all(r.ruleIds.map(id => api.deleteArtistRelation(id)));
      onChanged();
    } catch (e) {
      toastStore.show(errorMessage(e, 'Error removing relation'));
    } finally {
      busy = false;
    }
  }

  // sube una relación soft a hard sin salir de la sección. La fila de artist_relations
  // no se borra: deja de listarse porque los dos quedan en el mismo grupo, y vuelve a
  // aparecer sola si algún día se deshace el merge
  async function mergeInto(r: EntityRelation) {
    if (busy) return;
    if (!confirm(`Merge ${r.name} into ${entity.name}? Its ${r.playCount} plays will be counted as ${entity.name}.`)) return;
    busy = true;
    try {
      await api.createMerge(entityType, r.id, entity.id);
      onChanged();
    } catch (e) {
      toastStore.show(errorMessage(e, 'Error merging'));
    } finally {
      busy = false;
    }
  }

  function openMenu(e: MouseEvent, r: EntityRelation) {
    // sin la entrada genérica de relaciones: la fila ya trae las suyas, y las dos juntas
    // eran dos puertas al mismo concepto (una apuntando además a la OTRA entidad)
    const actions: ContextMenuAction[] = entityContextActions({
      type: entityType, id: r.id, name: r.name, imageUrl: r.imageUrl, parentArtistId,
    }, { relations: false });
    if (r.kind === 'related') {
      actions.push(
        { label: `Merge into ${entity.name}`, icon: IconMerge, onClick: () => mergeInto(r) },
        { label: 'Remove relation', icon: IconTrash, danger: true, onClick: () => unrelate(r) },
      );
    } else {
      // en un alias el canónico que se promueve es esta página; en un absorbido, la fila
      actions.push(
        { label: r.kind === 'alias' ? 'Make this canonical' : 'Make canonical', icon: IconSwap, onClick: () => makeCanonical(r.kind === 'alias' ? entity.id : r.id) },
        { label: 'Unmerge', icon: IconTrash, danger: true, onClick: () => unmerge(r) },
      );
    }
    contextMenu.open(e, actions);
  }
</script>

<div class="section-header">
  <h2 class="section-title">Relations</h2>
  <div class="relation-actions">
    {#if onManageRelated}
      <button class="show-all-btn" onclick={onManageRelated}>Relate</button>
    {/if}
    <button class="show-all-btn" onclick={onManageMerges}>Merge</button>
  </div>
</div>

{#each groups as group (group.kind)}
  <div class="relation-group">
    <div class="relation-group-label">{group.label}</div>
    <div class="track-list">
      {#each group.rows as r (r.id)}
        <!-- el div sólo capta el botón derecho; los enlaces de dentro siguen siendo el
             control accesible de la fila, igual que en ConcertRow -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="relation-row" oncontextmenu={(e) => openMenu(e, r)}>
          <TrackItem
            compact
            imageUrl={r.imageUrl}
            imageHref={href(r)}
            imageRound={entityType === 'artist'}
            name={r.name}
            nameHref={href(r)}
          >
            {#snippet meta()}
              <MetricMeta playCount={r.playCount} totalMs={r.totalMs} {metric} />
            {/snippet}
          </TrackItem>
        </div>
      {/each}
    </div>
  </div>
{/each}

<style>
  .relation-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  /* el hueco entre grupos lo pone el contenedor, nunca la etiqueta ni la lista */
  .relation-group + .relation-group {
    margin-top: 1rem;
  }

  .relation-group-label {
    font-family: var(--font-mono);
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted);
    margin-bottom: 0.4rem;
  }
</style>
