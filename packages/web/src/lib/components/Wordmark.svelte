<script lang="ts">
  import { WORDMARK } from '@sis/shared';

  // el logo: "sis" monospace con el punto de la i en acento. mide 1em de alto, así que se
  // dimensiona con font-size como el texto al que sustituye; las letras toman el
  // color del contexto (currentColor) y el punto siempre el acento
  let { class: className = '' }: { class?: string } = $props();

  const { viewBox, strokeWidth, letters, dot } = WORDMARK;
</script>

<svg class="wordmark {className}" viewBox={viewBox.join(' ')} role="img" aria-label="sis">
  <path d={letters} fill="none" stroke="currentColor" stroke-width={strokeWidth} stroke-linecap="square" stroke-linejoin="miter" />
  <rect x={dot.x} y={dot.y} width={dot.size} height={dot.size} fill="var(--accent, #1db954)" />
</svg>

<style>
  .wordmark {
    display: block;
    height: 1em;
    width: auto;
    flex: none;
  }
</style>
