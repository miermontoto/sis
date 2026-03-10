<script lang="ts">
  interface Props {
    value: string;
    onchange: (range: string) => void;
  }

  let { value, onchange }: Props = $props();

  const ranges = [
    { key: 'week', label: '7D' },
    { key: 'month', label: '30D' },
    { key: '3months', label: '3M' },
    { key: '6months', label: '6M' },
    { key: 'year', label: '1Y' },
    { key: 'all', label: 'All' },
  ];
</script>

<div class="time-range-selector">
  {#each ranges as r}
    <button
      class="range-btn"
      class:active={value === r.key}
      onclick={() => onchange(r.key)}
    >
      {r.label}
    </button>
  {/each}
</div>
