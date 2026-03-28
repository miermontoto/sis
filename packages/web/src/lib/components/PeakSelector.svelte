<script lang="ts">
  import { medalColor } from '$lib/utils/medals';

  let {
    peakRank,
    peakPeriods,
    onselect,
  }: {
    peakRank: number;
    peakPeriods: string[];
    onselect: (period: string) => void;
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

<span class="peak-selector" bind:this={container}>
  <button class="peak-trigger" onclick={toggle} title="View peak weeks">
    <span class="peak-val" style:color={medalColor(peakRank) ?? 'var(--accent)'}>#{peakRank}</span>
    <span class="peak-times">×{peakPeriods.length}</span>
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
    align-items: center;
    justify-content: center;
  }
  .peak-trigger {
    display: inline-flex;
    align-items: center;
    gap: 0.25em;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    border-radius: 6px;
    font-family: var(--font);
    transition: background 0.15s;
  }
  .peak-trigger:hover {
    background: rgba(29, 185, 84, 0.12);
  }
  .peak-val {
    font-size: 1.1rem;
    font-weight: 700;
    line-height: 1;
  }
  .peak-times {
    font-size: 0.7rem;
    font-weight: 500;
    color: var(--text-muted);
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
