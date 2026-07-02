<script lang="ts">
  // layout de /settings: sin tabs. cada subruta (sessions, admin, merges) es una
  // página independiente con su propio back-link, enlazada desde la general.
  let { children } = $props();
</script>

{@render children?.()}
