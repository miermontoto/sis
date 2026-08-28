<script lang="ts">
  // round: en carátulas circulares la esquina inferior izquierda cae fuera del
  // círculo, así que las barras se centran en la base
  let { round = false }: { round?: boolean } = $props();
</script>

<!-- ecualizador animado que se superpone a la carátula de lo que suena ahora.
     los estilos son globales (.live-eq en app.css) para que funcione también
     dentro de componentes con estilos scopeados -->
<div class="live-eq" class:live-eq--round={round}><span></span><span></span><span></span></div>
