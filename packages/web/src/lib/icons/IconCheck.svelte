<script lang="ts">
  let { size = 14, strokeWidth = 2.5, color = 'currentColor' }: { size?: number; strokeWidth?: number; color?: string } = $props();
</script>
<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} stroke-width={strokeWidth} stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
