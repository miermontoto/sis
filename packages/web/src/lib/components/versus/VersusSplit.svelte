<script lang="ts">
  import { listeningSplit } from '$lib/utils/artist-versus';

  // reparto del tiempo (o plays) entre los dos: lo compartido va aparte y en neutro porque
  // cuenta en las cifras de ambos, y un 60/40 a secas se pasaría del total real
  let {
    names,
    a,
    b,
    shared,
    format,
  }: {
    names: [string, string];
    a: number;
    b: number;
    shared: number;
    format: (value: number) => string;
  } = $props();

  // por debajo de esto un porcentaje redondeado diría "0%" de algo que existe
  const MIN_SHOWN_PERCENT = 1;

  let split = $derived(listeningSplit(a, b, shared));
  let segments = $derived([
    { key: 'a', label: `${names[0]} only`, value: split.a },
    { key: 'together', label: 'Together', value: split.together },
    { key: 'b', label: `${names[1]} only`, value: split.b },
  ].filter(segment => segment.value > 0));

  function percent(value: number): string {
    const share = (value / split.total) * 100;
    return share < MIN_SHOWN_PERCENT ? `<${MIN_SHOWN_PERCENT}%` : `${Math.round(share)}%`;
  }
</script>

{#if split.total > 0}
  <div class="vs-split">
    <div class="vs-split-bar" aria-hidden="true">
      {#each segments as segment (segment.key)}
        <div
          class="vs-split-segment vs-split-segment--{segment.key}"
          style:flex-grow={segment.value}
          title="{segment.label}: {format(segment.value)}"
        ></div>
      {/each}
    </div>
    <ul class="vs-split-legend">
      {#each segments as segment (segment.key)}
        <li>
          <span class="vs-split-key vs-split-segment--{segment.key}"></span>
          <span class="vs-split-label">{segment.label}</span>
          <span class="vs-split-value">{percent(segment.value)}</span>
        </li>
      {/each}
    </ul>
  </div>
{/if}

<style>
  .vs-split {
    margin-bottom: 1rem;
  }
  .vs-split-bar {
    display: flex;
    gap: 2px;
    height: 0.75rem;
  }
  .vs-split-segment {
    flex-basis: 0;
    min-width: 2px;
  }
  .vs-split-bar > :first-child {
    border-radius: 4px 0 0 4px;
  }
  .vs-split-bar > :last-child {
    border-radius: 0 4px 4px 0;
  }
  .vs-split-bar > :only-child {
    border-radius: 4px;
  }
  .vs-split-segment--a {
    background: var(--versus-a);
  }
  .vs-split-segment--b {
    background: var(--versus-b);
  }
  .vs-split-segment--together {
    background: var(--text-muted);
  }
  .vs-split-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 1rem;
    margin: 0.5rem 0 0;
    padding: 0;
    list-style: none;
    font-size: var(--fs-sm);
    color: var(--text-secondary);
  }
  .vs-split-legend li {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    min-width: 0;
  }
  .vs-split-key {
    width: 8px;
    height: 8px;
    border-radius: 2px;
    flex-shrink: 0;
  }
  .vs-split-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .vs-split-value {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    color: var(--text);
  }
</style>
