<script lang="ts">
  import { toastStore } from '$lib/stores/toast.svelte';
</script>

{#if toastStore.items.length > 0}
  <div class="toast-container">
    {#each toastStore.items as toast (toast.id)}
      <div class="toast">{toast.message}</div>
    {/each}
  </div>
{/if}

<style>
  .toast-container {
    position: fixed;
    bottom: 1.5rem;
    left: 50%;
    transform: translateX(-50%);
    z-index: 600;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    pointer-events: none;
  }
  .toast {
    background: var(--bg-card);
    border: 1px solid var(--border);
    color: var(--text);
    font-size: 0.8rem;
    padding: 0.5rem 1rem;
    border-radius: var(--radius);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    animation: toast-in 0.15s ease-out;
  }
  @keyframes toast-in {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }

  @media (max-width: 768px) {
    .toast-container {
      bottom: calc(env(safe-area-inset-bottom, 0px) + 4.5rem);
    }
  }
</style>
