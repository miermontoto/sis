<script lang="ts">
  import { refreshing } from '../stores/refreshing.svelte';

  let visible = $derived(refreshing.count > 0);
  let label = $derived(`Sincronizando (${refreshing.count})`);
</script>

{#if visible}
  <span class="refreshing-dot" title={label} aria-label={label} role="status"></span>
{/if}

<style>
  .refreshing-dot {
    display: inline-block;
    width: 7px;
    height: 7px;
    margin-left: 0.4em;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 0 0 rgba(29, 185, 84, 0.6);
    animation: refreshing-pulse 1.4s ease-in-out infinite;
    vertical-align: middle;
    flex-shrink: 0;
  }

  @keyframes refreshing-pulse {
    0%, 100% {
      transform: scale(1);
      box-shadow: 0 0 0 0 rgba(29, 185, 84, 0.6);
      opacity: 0.85;
    }
    50% {
      transform: scale(1.15);
      box-shadow: 0 0 0 6px rgba(29, 185, 84, 0);
      opacity: 1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .refreshing-dot {
      animation: none;
      opacity: 0.85;
    }
  }
</style>
