<script lang="ts">
  import type { Rankings, EntityType } from '$lib/api';
  import type { EntityRanks } from '$lib/stores/entity-ranks.svelte';
  import { medalColor } from '$lib/utils/medals';
  import { periodLabel } from '$lib/utils/periods';

  // las posiciones las pide EntityRanks (lo comparten chart stats y la timeline); la
  // línea de ranking que vivía debajo de los badges es ahora el panel de arriba de la
  // timeline, con el mismo eje que las escuchas
  let {
    entityType,
    entityId,
    ranks,
    highlightedMonth = $bindable(''),
  }: {
    entityType: EntityType;
    entityId: string;
    ranks: EntityRanks;
    highlightedMonth?: string;
  } = $props();

  const rankLabels = { week: '7D', month: '30D', thisYear: 'YTD', all: 'All' } as const;
  let chartType = $derived(entityType === 'artist' ? 'artists' : entityType === 'album' ? 'albums' : 'tracks');
  let rankings = $derived(ranks.rankings);
  let rankingsLoading = $derived(ranks.rankingsLoading);

  // pico histórico: mejor posición all-time alcanzada nunca. el historial ya es el ranking
  // acumulado mes a mes, así que el pico sale de ahí sin query ni endpoint extra.
  let allTimePeak = $derived.by(() => {
    if (ranks.history.length === 0) return null;
    let best = ranks.history[0];
    for (const p of ranks.history) if (p.rank < best.rank) best = p;
    return best;
  });

  let allTimePeakTitle = $derived(
    allTimePeak ? `All-time peak: #${allTimePeak.rank} (${periodLabel(allTimePeak.period, 'month')})` : undefined
  );
</script>

<div class="rankings-row">
  {#each Object.entries(rankLabels) as [key, label]}
    {@const rank = rankings?.[key as keyof Rankings] ?? null}
    {@const color = rank ? medalColor(rank) : undefined}
    <!-- el pico all-time vive dentro del badge "All": misma métrica, mejor posición alcanzada.
         solo se muestra si mejora la actual (si coincide, la entidad está en su pico ahora) -->
    {@const peak = key === 'all' && rank != null && allTimePeak != null && allTimePeak.rank < rank ? allTimePeak : null}
    {#if rank != null}
      <a
        class="ranking-badge ranking-badge--active ranking-badge--link"
        class:ranking-badge--top3={rank <= 3}
        style:border-color={color}
        style:--medal-color={color}
        href="/top?tab={chartType}&range={key}&focus={entityId}"
        title={key === 'all' ? allTimePeakTitle : undefined}
        onmouseenter={() => { if (peak) highlightedMonth = peak.period; }}
        onmouseleave={() => { if (peak) highlightedMonth = ''; }}
      >
        <span class="ranking-label">{label}</span>
        <span class="ranking-value" style:color={color}>#{rank}</span>
        {#if peak}<span class="ranking-peak" style:color={medalColor(peak.rank)}><span class="ranking-peak-tag">MAX</span>#{peak.rank}</span>{/if}
      </a>
    {:else}
      <div class="ranking-badge" class:ranking-badge--loading={rankingsLoading}>
        <span class="ranking-label">{label}</span>
        <span class="ranking-value">{rankingsLoading ? '' : '—'}</span>
      </div>
    {/if}
  {/each}
</div>

<style>
  .rankings-row {
    /* medidas de las tres líneas del badge en un solo sitio: el min-height se calcula
       a partir de ellas, así la fila mide igual con y sin línea de pico */
    --rb-label: 0.65rem;
    --rb-value: 1.1rem;
    --rb-peak: 0.7rem;
    --rb-gap: 0.15rem;
    --rb-value-gap: 0.35rem;
    --rb-pad-y: 0.4rem;
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .ranking-badge {
    display: flex;
    flex-direction: column;
    align-items: center;
    /* el badge "All" lleva una línea extra (el pico), así que la fila estira al resto:
       centrar en vertical para que todos queden alineados por el centro */
    justify-content: center;
    /* reparto del blanco: con line-height 1 el hueco lo ponen gap y padding a mano.
       el pico va pegado a su número (gap base) y la etiqueta respira con margin-top
       en el valor */
    gap: var(--rb-gap);
    flex: 1;
    min-width: 60px;
    padding: var(--rb-pad-y) 0.75rem;
    /* alto de las tres líneas + huecos + padding + bordes: los badges sin pico
       (o las páginas donde nadie lo tiene) conservan el alto de siempre */
    min-height: calc(
      var(--rb-label) + var(--rb-value) + var(--rb-peak)
      + var(--rb-gap) * 2 + var(--rb-value-gap) + var(--rb-pad-y) * 2 + 2px
    );
    border-radius: var(--radius);
    background: var(--bg-card);
    border: 1px solid var(--border);
    text-decoration: none;
    color: inherit;
    transition: background 0.05s, border-color 0.05s, transform 0.05s;
  }
  .ranking-badge--active {
    border-color: var(--accent);
  }
  .ranking-badge--link {
    cursor: pointer;
  }
  .ranking-badge--link:hover {
    background: var(--accent-a05);
  }
  .ranking-badge--top3:hover {
    background: color-mix(in srgb, var(--medal-color, #1db954) 10%, var(--bg-card));
  }
  .ranking-badge--link:active {
    transform: translateY(1px);
  }
  .ranking-badge--loading .ranking-value {
    width: 28px;
    height: var(--rb-value);
    border-radius: var(--radius);
    background: var(--shimmer);
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite;
    display: inline-block;
  }
  /* line-height 1 en las tres líneas: el interlineado heredado del body (1.6) sobra de
     largo para meter la línea del pico sin que la fila crezca de alto */
  .ranking-label {
    font-family: var(--font-mono);
    font-size: var(--rb-label);
    line-height: 1;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: var(--track);
  }
  .ranking-value {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: var(--rb-value);
    line-height: 1;
    margin-top: var(--rb-value-gap);
    font-weight: 700;
    color: var(--accent);
  }
  .ranking-badge--active .ranking-value {
    color: var(--accent);
  }
  .ranking-peak {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: var(--rb-peak);
    font-weight: 600;
    line-height: 1;
    color: var(--text-muted);
  }
  /* etiqueta "MAX" delante del pico histórico, en lugar del antiguo triángulo */
  .ranking-peak-tag {
    font-size: 0.85em;
    letter-spacing: var(--track);
    opacity: 0.75;
    margin-right: 0.2em;
  }
</style>
