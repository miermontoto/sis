<script lang="ts">
  import { shortcutStore, type ShortcutDef } from '$lib/stores/keyboard-shortcuts.svelte';

  function close() { shortcutStore.showHelp = false; }

  const categories: { key: ShortcutDef['category']; label: string }[] = [
    { key: 'navigation', label: 'Navigation' },
    { key: 'now-playing', label: 'Now Playing' },
    { key: 'playback', label: 'Playback' },
    { key: 'ui', label: 'General' },
  ];

  let grouped = $derived.by(() => {
    const global = shortcutStore.globalShortcuts;
    const page = shortcutStore.pageShortcuts;
    const groups: { label: string; shortcuts: ShortcutDef[] }[] = [];

    for (const cat of categories) {
      const items = global.filter(s => s.category === cat.key);
      if (items.length > 0) groups.push({ label: cat.label, shortcuts: items });
    }

    if (page.length > 0) groups.push({ label: 'Page', shortcuts: page });
    return groups;
  });
</script>

{#if shortcutStore.showHelp}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="shortcuts-overlay" onmousedown={(e) => { if (e.target === e.currentTarget) close(); }}>
    <div class="shortcuts-modal">
      <div class="shortcuts-header">
        <span class="shortcuts-title">Keyboard Shortcuts</span>
        <button class="shortcuts-close" onclick={close}>&times;</button>
      </div>
      <div class="shortcuts-body">
        {#each grouped as group}
          <div class="shortcuts-group">
            <div class="shortcuts-group-title">{group.label}</div>
            {#each group.shortcuts as shortcut}
              <div class="shortcut-row">
                <span class="shortcut-desc">{shortcut.description}</span>
                <span class="shortcut-keys">
                  {#each shortcut.key.split('+') as part, i}
                    {#if i > 0}<span class="shortcut-plus">+</span>{/if}
                    <kbd>{part}</kbd>
                  {/each}
                </span>
              </div>
            {/each}
          </div>
        {/each}
      </div>
    </div>
  </div>
{/if}

<style>
  .shortcuts-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    z-index: 200;
    display: flex;
    justify-content: center;
    padding-top: 10vh;
  }

  .shortcuts-modal {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    width: 640px;
    max-width: calc(100% - 2rem);
    max-height: 75vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    align-self: flex-start;
  }

  .shortcuts-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.25rem;
    border-bottom: 1px solid var(--border);
  }

  .shortcuts-title {
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--text);
  }

  .shortcuts-close {
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 1.25rem;
    cursor: pointer;
    padding: 0;
    line-height: 1;
  }

  .shortcuts-close:hover {
    color: var(--text);
  }

  .shortcuts-body {
    overflow-y: auto;
    padding: 0.75rem 1.25rem 1.25rem;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 0.25rem 2rem;
  }

  .shortcuts-group {
    break-inside: avoid;
  }

  .shortcuts-group-title {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-muted);
    padding: 0.75rem 0 0.35rem;
  }

  .shortcut-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.3rem 0;
    gap: 1rem;
  }

  .shortcut-desc {
    font-size: 0.85rem;
    color: var(--text);
  }

  .shortcut-keys {
    display: flex;
    align-items: center;
    gap: 0.15rem;
    flex-shrink: 0;
  }

  .shortcut-plus {
    font-size: 0.7rem;
    color: var(--text-muted);
  }

  .shortcut-keys kbd {
    background: var(--bg-hover);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.1rem 0.4rem;
    font-size: 0.75rem;
    font-family: var(--font-sans);
    color: var(--text-muted);
    min-width: 1.4rem;
    text-align: center;
  }

  @media (max-width: 768px) {
    .shortcuts-overlay {
      display: none;
    }
  }
</style>
