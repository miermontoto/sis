<script lang="ts">
  import DatePicker from './DatePicker.svelte';
  import { todayKey } from '$lib/utils/calendar';

  interface Props {
    value: string;
    onchange: (range: string) => void;
    startDate?: string;
    endDate?: string;
    ondatechange?: (start: string, end: string) => void;
  }

  let { value, onchange, startDate = '', endDate = '', ondatechange }: Props = $props();

  const ranges = [
    { key: 'week', label: '7D' },
    { key: 'month', label: '30D' },
    { key: '3months', label: '3M' },
    { key: '6months', label: '6M' },
    { key: 'year', label: '1Y' },
    { key: 'thisYear', label: 'YTD' },
    { key: 'all', label: 'All' },
  ];

  const today = todayKey();

  function handleDate(which: 'start' | 'end', val: string) {
    const s = which === 'start' ? val : startDate;
    const en = which === 'end' ? val : endDate;
    if (s && en && s <= en) ondatechange?.(s, en);
  }
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
  <button
    class="range-btn"
    class:active={value === 'custom'}
    onclick={() => onchange('custom')}
  >
    Custom
  </button>
  {#if value === 'custom'}
    <div class="custom-dates">
      <DatePicker value={startDate} label="Start date" placeholder="Start" max={endDate || today} onchange={(v) => handleDate('start', v)} />
      <span class="date-sep">—</span>
      <DatePicker value={endDate} label="End date" placeholder="End" min={startDate} max={today} onchange={(v) => handleDate('end', v)} />
    </div>
  {/if}
</div>

<style>
  .custom-dates {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-left: 0.25rem;
  }

  .date-sep {
    color: #666;
    font-size: var(--fs-md);
  }
</style>
