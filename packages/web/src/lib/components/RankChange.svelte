<script lang="ts">
  interface Props {
    rankChange: number | null;
    isNew: boolean;
    isReentry?: boolean;
  }

  let { rankChange, isNew, isReentry = false }: Props = $props();
</script>

{#if isNew}
  <span class="rank-change new">NEW</span>
{:else if isReentry}
  <span class="rank-change re">RE</span>
{:else if rankChange !== null && rankChange > 0}
  <span class="rank-change up" title="Subió {rankChange} {rankChange === 1 ? 'posición' : 'posiciones'}">
    <svg width="10" height="10" viewBox="0 0 10 10"><path d="M5 1 L9 6 H1 Z" fill="currentColor"/></svg>
    {rankChange}
  </span>
{:else if rankChange !== null && rankChange < 0}
  <span class="rank-change down" title="Bajó {Math.abs(rankChange)} {Math.abs(rankChange) === 1 ? 'posición' : 'posiciones'}">
    <svg width="10" height="10" viewBox="0 0 10 10"><path d="M5 9 L9 4 H1 Z" fill="currentColor"/></svg>
    {Math.abs(rankChange)}
  </span>
{:else if rankChange === 0}
  <span class="rank-change same">=</span>
{/if}

<style>
  .rank-change {
    font-size: 0.7rem;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    gap: 2px;
    line-height: 1;
  }
  .rank-change.up {
    color: #1db954;
  }
  .rank-change.down {
    color: #e34234;
  }
  .rank-change.same {
    color: #666;
    font-size: 0.75rem;
  }
  .rank-change.new {
    color: #f0c040;
    font-size: 0.6rem;
    letter-spacing: 0.03em;
  }
  .rank-change.re {
    color: #4a9eff;
    font-size: 0.6rem;
    letter-spacing: 0.03em;
  }
  .rank-change svg {
    flex-shrink: 0;
  }
</style>
