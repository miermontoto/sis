<script lang="ts">
  // fondo de las vistas de detalle: banda a sangre detrás del hero con la imagen de la
  // entidad más el tinte de su color dominante. la imagen es opcional (mode 'off' o
  // entidad sin foto); el tinte se pinta igual, que es lo que había antes de esto.
  import type { ArtistBackdrop } from '@sis/shared';

  let { imageUrl = null, color = '', mode = 'off' }: {
    imageUrl?: string | null;
    // color dominante ya extraído por la página, como "r,g,b"
    color?: string;
    mode?: ArtistBackdrop;
  } = $props();

  // las comillas van escapadas porque la url entra cruda en un url("...") de css
  let cssUrl = $derived(imageUrl ? `url("${imageUrl.replaceAll('"', '%22')}")` : '');
  let showImage = $derived(mode !== 'off' && !!cssUrl);
</script>

{#if showImage || color}
  <div class="detail-backdrop" aria-hidden="true">
    {#if showImage}
      <div
        class="detail-backdrop-img"
        class:detail-backdrop-img--blur={mode === 'blur'}
        style:background-image={cssUrl}
      ></div>
    {/if}
    {#if color}
      <div class="detail-backdrop-tint" style:background="linear-gradient(180deg, rgba({color},0.18) 0%, transparent 100%)"></div>
    {/if}
  </div>
{/if}

<style>
  /* misma geometría que .detail-color-bg (app.css): sin ancestro posicionado la banda
     se ancla al bloque contenedor inicial, o sea a sangre y bajo el sidebar fijo */
  .detail-backdrop {
    --backdrop-blur: 40px;
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 320px;
    overflow: hidden;
    pointer-events: none;
    z-index: 0;
  }
  .detail-backdrop-img,
  .detail-backdrop-tint {
    position: absolute;
    inset: 0;
  }
  .detail-backdrop-img {
    background-position: center 28%;
    background-size: cover;
    background-repeat: no-repeat;
    /* el degradado funde la imagen con el fondo de la página en vez de cortarla */
    -webkit-mask-image: linear-gradient(180deg, #000 0%, rgba(0, 0, 0, 0.55) 45%, transparent 100%);
    mask-image: linear-gradient(180deg, #000 0%, rgba(0, 0, 0, 0.55) 45%, transparent 100%);
  }
  /* velo oscuro: una foto clara dejaría el título (--text) sin contraste */
  .detail-backdrop-img::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg, rgba(8, 10, 12, 0.55) 0%, rgba(8, 10, 12, 0.82) 100%);
  }
  /* el blur muestrea fuera del elemento (transparente) y dejaría un halo en los bordes.
     se desborda 3 sigma (el radio de blur() es la desviación típica) por arriba y por
     los lados para que ese halo caiga fuera del overflow del contenedor */
  .detail-backdrop-img--blur {
    inset: calc(-3 * var(--backdrop-blur)) calc(-3 * var(--backdrop-blur)) 0;
    filter: blur(var(--backdrop-blur)) saturate(1.4);
  }
</style>
