<script lang="ts">
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

  const today = new Date().toISOString().split('T')[0];

  function handleDateInput(which: 'start' | 'end', e: Event) {
    const val = (e.target as HTMLInputElement).value;
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
</div>
{#if value === 'custom'}
  <div class="custom-dates">
    <input
      type="date"
      class="date-input"
      value={startDate}
      max={endDate || today}
      oninput={(e) => handleDateInput('start', e)}
    />
    <span class="date-sep">—</span>
    <input
      type="date"
      class="date-input"
      value={endDate}
      min={startDate}
      max={today}
      oninput={(e) => handleDateInput('end', e)}
    />
  </div>
{/if}

<style>
  .custom-dates {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 1.5rem;
  }

  .date-input {
    background: #1a1a1a;
    color: #e5e5e5;
    border: 1px solid #2a2a2a;
    border-radius: 8px;
    padding: 0.4rem 0.6rem;
    font-size: 0.85rem;
    font-family: var(--font);
    outline: none;
    transition: border-color 0.15s;
  }

  .date-input:focus {
    border-color: #1db954;
  }

  .date-input::-webkit-calendar-picker-indicator {
    filter: invert(0.7);
    cursor: pointer;
  }

  .date-sep {
    color: #666;
    font-size: 0.85rem;
  }
</style>
