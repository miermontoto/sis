<script lang="ts">
  // cuentagotas sobre una imagen (la portada): una paleta con sus colores
  // representativos y la propia imagen en un canvas del que se lee el píxel bajo el
  // puntero. Al pasar por encima se previsualiza (onHover) y al pulsar se elige
  // (onPick). El canvas es un extra de ratón: la paleta y el input nativo del picker
  // que lo aloja son la vía por teclado
  import { readImagePixels, paletteFromPixels, rgbToHex, type Rgb } from '$lib/utils/color';

  let { imageUrl, onHover, onPick }: {
    imageUrl: string;
    onHover: (hex: string | null) => void;
    onPick: (hex: string) => void;
  } = $props();

  // resolución a la que se muestrea la paleta y a la que se dibuja el canvas: el
  // cuentagotas lee píxeles de esta copia, no de la imagen a tamaño real
  const PALETTE_SAMPLE_SIZE = 64;
  const PALETTE_SIZE = 6;
  const CANVAS_WIDTH = 256;

  let palette = $state<Rgb[]>([]);
  let canvas = $state<HTMLCanvasElement | null>(null);
  // false cuando la imagen no carga o el canvas queda contaminado (sin CORS no se
  // pueden leer sus píxeles): entonces el cuentagotas no tiene nada que ofrecer
  let readable = $state(true);

  // urls ya procesadas: el prop llega como getter sobre el estado del padre, y al
  // guardar un pick el padre reasigna su objeto entero, con lo que estos efectos se
  // relanzan con la misma url. Reprocesar no es gratis ni inocuo: el decode escalado
  // del jpeg no es estable bit a bit entre pasadas y la paleta cambiaba de swatches
  // a la vista del usuario justo al elegir uno
  let paletteUrl = '';
  let drawnUrl = '';

  $effect(() => {
    const url = imageUrl;
    if (url === paletteUrl) return;
    paletteUrl = url;
    readImagePixels(url, PALETTE_SAMPLE_SIZE).then((px) => {
      if (url === paletteUrl) palette = px ? paletteFromPixels(px, PALETTE_SIZE) : [];
    });
  });

  $effect(() => {
    const el = canvas;
    const url = imageUrl;
    if (!el || url === drawnUrl) return;
    drawnUrl = url;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (url !== drawnUrl) return;
      // se conserva la proporción: las portadas subidas a mano no siempre son cuadradas
      el.width = CANVAS_WIDTH;
      el.height = Math.max(1, Math.round(CANVAS_WIDTH * img.naturalHeight / img.naturalWidth));
      el.getContext('2d')?.drawImage(img, 0, 0, el.width, el.height);
      readable = true;
    };
    img.onerror = () => { readable = false; };
    img.src = url;
  });

  // píxel del canvas bajo el puntero, en hex; null si no se puede leer
  function sampleAt(e: MouseEvent): string | null {
    const el = canvas;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const x = Math.min(el.width - 1, Math.max(0, Math.floor((e.clientX - rect.left) * el.width / rect.width)));
    const y = Math.min(el.height - 1, Math.max(0, Math.floor((e.clientY - rect.top) * el.height / rect.height)));
    try {
      const [r, g, b] = el.getContext('2d')!.getImageData(x, y, 1, 1).data;
      return rgbToHex([r, g, b]);
    } catch {
      readable = false;
      return null;
    }
  }

  function pick(e: MouseEvent) {
    const hex = sampleAt(e);
    if (hex) onPick(hex);
  }
</script>

{#if palette.length > 0}
  <div class="eyedropper-palette" role="group" aria-label="Colors from the image">
    {#each palette as rgb (rgbToHex(rgb))}
      {@const hex = rgbToHex(rgb)}
      <button
        class="eyedropper-swatch"
        style:background={hex}
        title={hex}
        aria-label="Use {hex}"
        onpointerenter={() => onHover(hex)}
        onpointerleave={() => onHover(null)}
        onfocus={() => onHover(hex)}
        onblur={() => onHover(null)}
        onclick={() => onPick(hex)}
      ></button>
    {/each}
  </div>
{/if}
{#if readable}
  <!-- extra de ratón sobre contenido ya accesible: la paleta de arriba y el input
       nativo del picker cubren teclado y lector de pantalla -->
  <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
  <canvas
    bind:this={canvas}
    class="eyedropper-canvas"
    title="Click a pixel to use its color"
    onpointerdown={(e) => onHover(sampleAt(e))}
    onpointermove={(e) => onHover(sampleAt(e))}
    onpointerleave={() => onHover(null)}
    onclick={pick}
  ></canvas>
{/if}

<style>
  /* el componente vive dentro del panel flex-wrap del picker: cada bloque ocupa su fila */
  .eyedropper-palette {
    flex: 0 0 100%;
    display: flex;
    gap: 0.3rem;
  }
  .eyedropper-swatch {
    width: 24px;
    height: 24px;
    border-radius: var(--radius);
    border: 2px solid transparent;
    padding: 0;
    cursor: pointer;
    transition: border-color 0.05s;
  }
  .eyedropper-swatch:hover,
  .eyedropper-swatch:focus-visible {
    border-color: var(--text);
  }
  .eyedropper-canvas {
    flex: 0 0 100%;
    width: 100%;
    height: auto;
    display: block;
    border-radius: var(--radius);
    cursor: crosshair;
    /* arrastrar el dedo por la portada muestrea en vez de hacer scroll */
    touch-action: none;
  }
</style>
