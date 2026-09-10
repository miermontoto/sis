<script module lang="ts">
  // selector de tipo de entidad, el único de la app: las tres entidades siempre
  // en el mismo orden (tracks → albums → artists) y con el mismo icono. dos
  // aspectos: pestañas subrayadas (`.tabs` global, cabeceras de página) y
  // botones `.range-btn` (dentro de cards y cabeceras de sección), estos
  // últimos también sólo con icono para donde no cabe la palabra (el rail)
  import type { EntityType } from '$lib/utils/entity-context';

  export type EntityTypePlural = 'tracks' | 'albums' | 'artists';
  export const ENTITY_TYPES: readonly EntityType[] = ['track', 'album', 'artist'];
  export const ENTITY_LABELS: Record<EntityType, string> = { track: 'Tracks', album: 'Albums', artist: 'Artists' };

  // las páginas con pestaña en la url (`?tab=tracks`) trabajan en plural; el
  // selector siempre en singular, y estas dos traducen en el borde
  const PLURAL: Record<EntityType, EntityTypePlural> = { track: 'tracks', album: 'albums', artist: 'artists' };
  const SINGULAR: Record<EntityTypePlural, EntityType> = { tracks: 'track', albums: 'album', artists: 'artist' };
  export const toPlural = (t: EntityType): EntityTypePlural => PLURAL[t];
  export const toSingular = (t: EntityTypePlural): EntityType => SINGULAR[t];
  export const isEntityType = (v: string | null): v is EntityType => ENTITY_TYPES.some(t => t === v);
</script>

<script lang="ts">
  import IconTrack from '$lib/icons/IconTrack.svelte';
  import IconAlbum from '$lib/icons/IconAlbum.svelte';
  import IconArtist from '$lib/icons/IconArtist.svelte';

  let { value, onchange, variant = 'tabs', iconsOnly = false }: {
    value: EntityType;
    onchange: (value: EntityType) => void;
    variant?: 'tabs' | 'pills';
    // sólo con `pills`: botones cuadrados sin etiqueta (queda en title/aria-label)
    iconsOnly?: boolean;
  } = $props();

  const ICONS = { track: IconTrack, album: IconAlbum, artist: IconArtist } as const;
  const ICON_SIZE = 14;
  const ICON_SIZE_COMPACT = 13;
</script>

{#if variant === 'tabs'}
  <div class="tabs">
    {#each ENTITY_TYPES as t (t)}
      {@const Icon = ICONS[t]}
      <button class="tab" class:active={value === t} onclick={() => onchange(t)}>
        <Icon size={ICON_SIZE} /> {ENTITY_LABELS[t]}
      </button>
    {/each}
  </div>
{:else}
  <div class="entity-pills">
    {#each ENTITY_TYPES as t (t)}
      {@const Icon = ICONS[t]}
      <button
        class="range-btn"
        class:range-btn--icon={iconsOnly}
        class:active={value === t}
        aria-pressed={value === t}
        aria-label={iconsOnly ? ENTITY_LABELS[t] : undefined}
        title={iconsOnly ? ENTITY_LABELS[t] : undefined}
        onclick={() => onchange(t)}
      >
        {#if iconsOnly}<Icon size={ICON_SIZE_COMPACT} />{:else}{ENTITY_LABELS[t]}{/if}
      </button>
    {/each}
  </div>
{/if}

<style>
  .entity-pills {
    display: flex;
    gap: 0.25rem;
  }
  /* botón de sólo icono: cuadrado, con el icono centrado */
  .range-btn--icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.4rem 0.55rem;
    line-height: 1;
  }
</style>
