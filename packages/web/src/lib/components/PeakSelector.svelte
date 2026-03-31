<script lang="ts">
  import { medalColor } from '$lib/utils/medals';

  let {
    peakRank,
    peakPeriods,
    onselect,
    size = 'sm',
  }: {
    peakRank: number;
    peakPeriods: string[];
    onselect: (period: string) => void;
    size?: 'sm' | 'lg';
  } = $props();

  let open = $state(false);
  let container: HTMLElement | null = $state(null);

  function toggle(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    open = !open;
  }

  function select(period: string, e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    open = false;
    onselect(period);
  }

  // cerrar al hacer click fuera
  function handleClickOutside(e: MouseEvent) {
    if (container && !container.contains(e.target as Node)) {
      open = false;
    }
  }

  $effect(() => {
    if (open) {
      document.addEventListener('click', handleClickOutside, true);
      return () => document.removeEventListener('click', handleClickOutside, true);
    }
  });
</script>

<span class="peak-selector" class:peak-selector--lg={size === 'lg'} bind:this={container}>
  <button class="peak-trigger" onclick={toggle} title="View peak weeks">
    <span class="peak-top">
      <span class="peak-val" style:color={medalColor(peakRank) ?? 'var(--accent)'}>#{peakRank}</span>
      <span class="peak-times">×{peakPeriods.length}</span>
    </span>
    <span class="peak-label">peak</span>
  </button>
  {#if open}
    <div class="peak-dropdown">
      {#each peakPeriods as period}
        <button class="peak-option" onclick={(e) => select(period, e)}>{period}</button>
      {/each}
    </div>
  {/if}
</span>

<style>
  .peak-selector {
    position: relative;
    display: inline-flex;
    align-items: stretch;
    justify-content: center;
    width: 100%;
    height: 100%;
  }
  .peak-trigger {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.1rem;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    border-radius: 6px;
    font-family: var(--font);
    transition: background 0.15s;
    width: 100%;
  }
  .peak-trigger:hover {
    background: rgba(29, 185, 84, 0.12);
  }
  .peak-top {
    display: flex;
    align-items: center;
    gap: 0.25em;
  }
  .peak-val {
    font-size: 0.85rem;
    font-weight: 700;
    line-height: 1.1;
  }
  .peak-label {
    font-size: 0.6rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .peak-times {
    font-size: 0.7rem;
    font-weight: 500;
    color: var(--text-muted);
  }
  .peak-selector--lg .peak-val {
    font-size: 1.1rem;
  }
  .peak-selector--lg .peak-label {
    font-size: 0.65rem;
    letter-spacing: 0.05em;
  }
  .peak-selector--lg .peak-times {
    font-size: 0.75rem;
  }
  .peak-dropdown {
    position: absolute;
    top: 100%;
    right: 0;
    z-index: 50;
    margin-top: 0.25rem;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    min-width: 7rem;
  }
  .peak-option {
    display: block;
    width: 100%;
    text-align: left;
    padding: 0.4rem 0.6rem;
    border: none;
    border-radius: 5px;
    background: none;
    color: var(--text);
    font-size: 0.8rem;
    font-family: var(--font);
    cursor: pointer;
    transition: background 0.1s;
    white-space: nowrap;
  }
  .peak-option:hover {
    background: rgba(29, 185, 84, 0.15);
    color: var(--accent);
  }
</style>
