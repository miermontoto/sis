<script lang="ts">
  import { api, type SpotifyDevice } from '$lib/api';
  import IconWifi from '$lib/icons/IconWifi.svelte';

  let { show = $bindable(false) }: { show: boolean } = $props();

  let devices = $state<SpotifyDevice[]>([]);
  let loading = $state(false);
  let error = $state('');
  let rootEl: HTMLDivElement;
  let triggerEl: HTMLButtonElement;
  let menuStyle = $state('');

  async function fetchDevices() {
    loading = true;
    error = '';
    try {
      const data = await api.playbackDevices();
      devices = data?.devices ?? [];
      if (devices.length === 0) error = 'No devices found. Open Spotify on a device.';
    } catch {
      error = 'Could not load devices';
    } finally {
      loading = false;
    }
  }

  async function transfer(device: SpotifyDevice) {
    if (!device.id) return;
    try {
      await api.playbackTransfer(device.id, true);
    } catch {}
    show = false;
  }

  function close() {
    show = false;
  }

  function onDocClick(e: MouseEvent) {
    if (!show) return;
    if (rootEl && !rootEl.contains(e.target as Node)) close();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && show) close();
  }

  function updatePosition() {
    if (!triggerEl) return;
    const rect = triggerEl.getBoundingClientRect();
    const menuWidth = 260;
    let left = rect.right - menuWidth;
    if (left < 8) left = 8;
    menuStyle = `left:${left}px;bottom:${window.innerHeight - rect.top + 6}px`;
  }

  $effect(() => {
    if (show) {
      fetchDevices();
      updatePosition();
      document.addEventListener('mousedown', onDocClick);
      document.addEventListener('keydown', onKey);
      window.addEventListener('resize', updatePosition);
      return () => {
        document.removeEventListener('mousedown', onDocClick);
        document.removeEventListener('keydown', onKey);
        window.removeEventListener('resize', updatePosition);
      };
    }
  });

  function deviceIcon(type: string): string {
    switch (type.toLowerCase()) {
      case 'computer': return 'M4 6h16v10H4zm2 12h12';
      case 'smartphone': return 'M7 4h10a1 1 0 011 1v14a1 1 0 01-1 1H7a1 1 0 01-1-1V5a1 1 0 011-1zm5 14.5a.5.5 0 100-1 .5.5 0 000 1z';
      case 'speaker': return 'M12 2a7 7 0 017 7v6a7 7 0 01-14 0V9a7 7 0 017-7zm0 4a3 3 0 100 6 3 3 0 000-6z';
      case 'tv': return 'M3 4h18a1 1 0 011 1v12a1 1 0 01-1 1H3a1 1 0 01-1-1V5a1 1 0 011-1zm5 16h8';
      default: return 'M12 2a7 7 0 017 7v6a7 7 0 01-14 0V9a7 7 0 017-7zm0 4a3 3 0 100 6 3 3 0 000-6z';
    }
  }
</script>

<div class="dp-root" bind:this={rootEl}>
  <button
    bind:this={triggerEl}
    class="dp-trigger"
    class:dp-trigger--open={show}
    title="Devices"
    onclick={() => show = !show}
  >
    <IconWifi />
  </button>
  {#if show}
    <div class="dp-menu" role="listbox" style={menuStyle}>
      {#if loading}
        <div class="dp-status"><div class="spinner spinner--sm"></div></div>
      {:else if error}
        <div class="dp-status dp-status--error">{error}</div>
      {:else}
        {#each devices as device}
          <button
            class="dp-item"
            class:dp-item--active={device.is_active}
            onclick={() => transfer(device)}
            role="option"
            aria-selected={device.is_active}
          >
            <svg class="dp-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d={deviceIcon(device.type)} />
            </svg>
            <div class="dp-item-info">
              <div class="dp-item-name">{device.name}</div>
              <div class="dp-item-type">{device.type}</div>
            </div>
            {#if device.is_active}
              <div class="dp-active-dot" title="Active"></div>
            {/if}
          </button>
        {/each}
      {/if}
    </div>
  {/if}
</div>

<style>
  .dp-root {
    position: relative;
    display: inline-block;
  }

  .dp-trigger {
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    padding: 0.35rem;
    border-radius: 6px;
    transition: color 0.15s, background 0.15s;
    min-width: 30px;
    min-height: 30px;
  }

  .dp-trigger:hover {
    background: var(--bg-hover);
  }

  .dp-trigger:hover,
  .dp-trigger--open {
    color: var(--accent);
  }

  .dp-menu {
    position: fixed;
    min-width: 220px;
    max-width: 300px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    overflow: hidden;
    z-index: 200;
  }

  .dp-status {
    padding: 1rem;
    text-align: center;
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  .dp-status--error {
    color: var(--text-muted);
  }

  .dp-item {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    width: 100%;
    padding: 0.6rem 0.85rem;
    border: none;
    background: transparent;
    color: var(--text);
    cursor: pointer;
    text-align: left;
    font-family: var(--font);
    transition: background 0.1s;
  }

  .dp-item:hover {
    background: var(--bg-hover);
  }

  .dp-item--active {
    background: rgba(29, 185, 84, 0.06);
  }

  .dp-item--active:hover {
    background: rgba(29, 185, 84, 0.1);
  }

  .dp-icon {
    flex-shrink: 0;
    color: var(--text-muted);
  }

  .dp-item--active .dp-icon {
    color: var(--accent);
  }

  .dp-item-info {
    flex: 1;
    min-width: 0;
  }

  .dp-item-name {
    font-size: 0.85rem;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .dp-item-type {
    font-size: 0.7rem;
    color: var(--text-muted);
    text-transform: capitalize;
  }

  .dp-active-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent);
    flex-shrink: 0;
  }

  .spinner--sm {
    width: 18px;
    height: 18px;
    border-width: 2px;
    margin: 0 auto;
  }
</style>
