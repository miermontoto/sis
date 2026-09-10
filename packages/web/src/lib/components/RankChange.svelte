<script lang="ts">
  import IconRankUp from '$lib/icons/IconRankUp.svelte';
  import IconRankDown from '$lib/icons/IconRankDown.svelte';

  interface Props {
    rankChange: number | null;
    isNew: boolean;
    isReentry?: boolean;
    // el puesto acaba de cambiar EN VIVO (reordenamiento optimista), no contra
    // el lookback: misma flecha, parpadeando, y sin NEW/RE — que hablan del
    // periodo, no de lo que acaba de pasar
    live?: boolean;
  }

  let { rankChange, isNew, isReentry = false, live = false }: Props = $props();
</script>

{#if isNew && !live}
  <span class="rank-change new">NEW</span>
{:else if isReentry && !live}
  <span class="rank-change re">RE</span>
{:else if rankChange !== null && rankChange > 0}
  <span class="rank-change up" class:rank-change--live={live} title="Subió {rankChange} {rankChange === 1 ? 'posición' : 'posiciones'}">
    <IconRankUp />
    {rankChange}
  </span>
{:else if rankChange !== null && rankChange < 0}
  <span class="rank-change down" class:rank-change--live={live} title="Bajó {Math.abs(rankChange)} {Math.abs(rankChange) === 1 ? 'posición' : 'posiciones'}">
    <IconRankDown />
    {Math.abs(rankChange)}
  </span>
{:else if rankChange === 0 && !live}
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
  .rank-change :global(svg) {
    flex-shrink: 0;
  }
  /* el movimiento en vivo parpadea al ritmo de .stat-flash, pero sobre la
     opacidad y no sobre el color: aquél tira a verde a media animación y
     teñiría de verde una flecha de bajada */
  .rank-change--live {
    animation: rank-move-blink 0.35s ease-in-out 3;
  }
  @keyframes rank-move-blink {
    50% { opacity: 0.15; }
  }
  /* un parpadeo repetido es de lo más agresivo con sensibilidad al movimiento:
     la flecha se queda, sin la animación */
  @media (prefers-reduced-motion: reduce) {
    .rank-change--live {
      animation: none;
    }
  }
</style>
