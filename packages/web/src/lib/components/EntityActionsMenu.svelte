<script lang="ts">
  import IconMenuDots from '$lib/icons/IconMenuDots.svelte';

  export interface MenuAction {
    label: string;
    onClick: () => void;
    danger?: boolean;
    disabled?: boolean;
  }

  let {
    actions,
    title = 'Actions',
  }: {
    actions: MenuAction[];
    title?: string;
  } = $props();

  let open = $state(false);
  let rootEl: HTMLDivElement;

  function toggle() {
    open = !open;
  }

  function close() {
    open = false;
  }

  function onDocClick(e: MouseEvent) {
    if (!open) return;
    if (rootEl && !rootEl.contains(e.target as Node)) close();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && open) close();
  }

  function runAction(a: MenuAction) {
    if (a.disabled) return;
    close();
    a.onClick();
  }

  $effect(() => {
    if (open) {
      document.addEventListener('mousedown', onDocClick);
      document.addEventListener('keydown', onKey);
      return () => {
        document.removeEventListener('mousedown', onDocClick);
        document.removeEventListener('keydown', onKey);
      };
    }
  });
</script>

<div class="actions-root" bind:this={rootEl}>
  <button class="actions-trigger" {title} onclick={toggle} class:actions-trigger--open={open}>
    <IconMenuDots />
  </button>
  {#if open}
    <div class="actions-menu" role="menu">
      {#each actions as action}
        <button
          class="actions-item"
          class:actions-item--danger={action.danger}
          disabled={action.disabled}
          onclick={() => runAction(action)}
          role="menuitem"
        >
          {action.label}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .actions-root {
    position: relative;
    display: inline-block;
  }

  .actions-trigger {
    width: 32px;
    height: 32px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border);
    background: transparent;
    border-radius: 6px;
    color: var(--text-muted);
    cursor: pointer;
    transition: color 0.15s, border-color 0.15s, background 0.15s;
  }
  .actions-trigger:hover,
  .actions-trigger--open {
    color: var(--text);
    border-color: var(--text-muted);
  }

  .actions-menu {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    min-width: 170px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
    overflow: hidden;
    z-index: 50;
  }

  .actions-item {
    display: block;
    width: 100%;
    text-align: left;
    padding: 0.55rem 0.85rem;
    border: none;
    background: transparent;
    color: var(--text);
    font-size: 0.85rem;
    font-family: var(--font);
    cursor: pointer;
    transition: background 0.1s, color 0.1s;
  }
  .actions-item:hover:not(:disabled) {
    background: var(--bg-hover);
  }
  .actions-item:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .actions-item--danger {
    color: #ff4444;
  }
  .actions-item--danger:hover:not(:disabled) {
    background: rgba(255, 68, 68, 0.08);
  }
</style>
