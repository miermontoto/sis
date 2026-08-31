<script lang="ts">
  // selector de imagen de una entidad: pinta la imagen activa y, al pulsarla, abre el
  // historial de imágenes observadas más un hueco para subir una propia. lo comparten
  // el detalle de álbum (portadas) y el de artista (fotos): mismo widget sobre dos
  // tablas espejo (album_covers / artist_images).
  import { formatShortDate } from '$lib/utils/format';
  import IconImage from '$lib/icons/IconImage.svelte';

  // shape común de AlbumCover y ArtistImage (source se pinta tal cual en el tooltip)
  interface EntityImage {
    id: number;
    imageUrl: string;
    source: string;
    observedAt: string;
  }

  let {
    imageUrl,
    images,
    alt,
    noun,
    round = false,
    open = $bindable(false),
    onSelect,
    onUpload,
  }: {
    imageUrl: string | null;
    images: EntityImage[];
    alt: string;
    // sustantivo de la acción ("cover", "picture"): las etiquetas se construyen con él
    noun: string;
    round?: boolean;
    open?: boolean;
    onSelect: (imageUrl: string) => void | Promise<void>;
    onUpload: (file: File) => void | Promise<void>;
  } = $props();

  let containerEl: HTMLDivElement | undefined = $state();
  let uploading = $state(false);

  // sin nada que elegir el botón sigue valiendo para subir la primera imagen
  let actionLabel = $derived(images.length > 1 || imageUrl === null ? `Change ${noun}` : `Upload ${noun}`);

  function handleOutside(e: PointerEvent) {
    if (containerEl && !containerEl.contains(e.target as Node)) open = false;
  }

  function handleKey(e: KeyboardEvent) {
    if (e.key === 'Escape') open = false;
  }

  $effect(() => {
    if (!open) return;
    document.addEventListener('pointerdown', handleOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('pointerdown', handleOutside);
      document.removeEventListener('keydown', handleKey);
    };
  });

  async function handleUpload(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    uploading = true;
    try {
      await onUpload(file);
    } finally {
      uploading = false;
      // permite reintentar el mismo fichero: sin esto un segundo change no dispara
      input.value = '';
    }
  }
</script>

<div class="picker-container" bind:this={containerEl}>
  <button class="picker-trigger" onclick={() => { open = !open; }} aria-label={actionLabel}>
    {#if imageUrl}
      <img class="detail-image" class:detail-image--round={round} src={imageUrl} {alt} />
    {:else}
      <div class="detail-image detail-image--placeholder" class:detail-image--round={round}></div>
    {/if}
    <span class="picker-hint"><IconImage /></span>
  </button>
  {#if open}
    <div class="picker-list">
      <!-- key por url, no por id: la fila optimista de una subida aún no tiene id real -->
      {#each images as image (image.imageUrl)}
        <button
          class="picker-thumb"
          class:picker-thumb--active={imageUrl === image.imageUrl}
          onclick={() => onSelect(image.imageUrl)}
          title="{image.source} - {formatShortDate(image.observedAt)}"
        >
          <img src={image.imageUrl} alt="" />
        </button>
      {/each}
      <label class="picker-thumb picker-thumb--upload" title="Upload {noun}">
        {#if uploading}
          <div class="spinner" style="width:16px;height:16px;"></div>
        {:else}
          +
        {/if}
        <input type="file" accept="image/*" onchange={handleUpload} hidden />
      </label>
    </div>
  {/if}
</div>

<style>
  .picker-container {
    position: relative;
    flex-shrink: 0;
  }
  .picker-trigger {
    cursor: pointer;
    position: relative;
    display: block;
    padding: 0;
    border: none;
    background: none;
    font: inherit;
    color: inherit;
  }
  .picker-hint {
    position: absolute;
    bottom: 4px;
    right: 4px;
    background: rgba(0, 0, 0, 0.7);
    color: #fff;
    font-size: 0.7rem;
    font-weight: 700;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: opacity 0.05s;
    pointer-events: none;
  }
  .picker-trigger:hover .picker-hint {
    opacity: 1;
  }
  .picker-list {
    position: absolute;
    top: calc(100% + 0.5rem);
    left: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    max-width: 200px;
    padding: 0.5rem;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
    z-index: 20;
  }
  .picker-thumb {
    width: 40px;
    height: 40px;
    border-radius: var(--radius);
    border: 2px solid transparent;
    padding: 0;
    cursor: pointer;
    overflow: hidden;
    background: var(--bg-card);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: border-color 0.05s;
  }
  .picker-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .picker-thumb--active {
    border-color: var(--accent);
  }
  .picker-thumb:hover:not(.picker-thumb--active) {
    border-color: var(--text-muted);
  }
  .picker-thumb--upload {
    border: 2px dashed var(--border);
    color: var(--text-muted);
    font-size: 1.1rem;
    font-weight: 600;
  }
  .picker-thumb--upload:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
</style>
