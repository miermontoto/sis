<script lang="ts">
  let { size = 14 }: { size?: number } = $props();
</script>
<!-- entrada de concierto: el recorte lateral es lo que la hace legible a 12px,
     donde una nota musical o un micro se leerían como una mancha -->
<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4Z"/><path d="M13 6v2"/><path d="M13 16v2"/></svg>
