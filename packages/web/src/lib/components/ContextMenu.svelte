<script lang="ts">
  import { contextMenu } from '$lib/stores/context-menu.svelte';
  import { page } from '$app/state';

  let menuEl: HTMLDivElement | undefined = $state();

  // ajustar posición para no salir del viewport
  let adjustedPos = $derived.by(() => {
    const s = contextMenu.state;
    if (!s || !menuEl) return s ? { x: s.x, y: s.y } : null;
    const rect = menuEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let x = s.x;
    let y = s.y;
    if (x + rect.width > vw - 8) x = Math.max(8, vw - rect.width - 8);
    if (y + rect.height > vh - 8) y = Math.max(8, vh - rect.height - 8);
    return { x, y };
  });

  function onDocPointer(e: MouseEvent) {
    if (!contextMenu.state) return;
    if (menuEl && menuEl.contains(e.target as Node)) return;
    contextMenu.close();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && contextMenu.state) contextMenu.close();
  }

  function onScroll() {
    if (contextMenu.state) contextMenu.close();
  }

  $effect(() => {
    if (!contextMenu.state) return;
    document.addEventListener('mousedown', onDocPointer, true);
    document.addEventListener('contextmenu', onDocPointer, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDocPointer, true);
      document.removeEventListener('contextmenu', onDocPointer, true);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  });

  // cerrar al cambiar de ruta
  $effect(() => {
    void page.url.pathname;
    contextMenu.close();
  });

  async function runAction(a: ReturnType<typeof contextMenu.state extends null ? never : () => any>) {
    const fn = a.onClick as () => void | Promise<void>;
    contextMenu.close();
    await fn();
  }
</script>

{#if contextMenu.state && adjustedPos}
  <div
    bind:this={menuEl}
    class="ctx-menu"
    role="menu"
    style="left: {adjustedPos.x}px; top: {adjustedPos.y}px;"
  >
    {#each contextMenu.state.actions as action}
      <button
        class="ctx-item"
        class:ctx-item--danger={action.danger}
        disabled={action.disabled}
        onclick={() => runAction(action)}
        role="menuitem"
      >
        {action.label}
      </button>
    {/each}
  </div>
{/if}

<style>
  .ctx-menu {
    position: fixed;
    min-width: 180px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
    padding: 0.25rem 0;
    z-index: 500;
  }
  .ctx-item {
    display: block;
    width: 100%;
    text-align: left;
    padding: 0.45rem 0.85rem;
    border: none;
    background: transparent;
    color: var(--text);
    font-size: 0.85rem;
    cursor: pointer;
  }
  .ctx-item:hover:not(:disabled) { background: var(--bg-hover); }
  .ctx-item:disabled { opacity: 0.4; cursor: not-allowed; }
  .ctx-item--danger { color: #ff4444; }
  .ctx-item--danger:hover:not(:disabled) { background: rgba(255, 68, 68, 0.08); }
</style>
