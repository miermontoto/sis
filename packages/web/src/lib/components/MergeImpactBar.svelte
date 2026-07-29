<script lang="ts">
  // resumen del impacto en el ranking all-time de unos merges aún no aplicados.
  // Se recalcula con debounce al cambiar los pares (en el scan el usuario marca casillas
  // de una en una) y publica el resultado por `impact` para que el padre pinte los deltas
  // por fila.
  import { api, getRankingMetric, type EntityType, type MergeImpact, type RankingMetric } from '$lib/api';

  let {
    entityType,
    pairs,
    nameOf = () => null,
    impact = $bindable(null),
  }: {
    entityType: EntityType;
    pairs: { sourceId: string; targetId: string }[];
    nameOf?: (id: string) => string | null;
    impact?: MergeImpact | null;
  } = $props();

  const DEBOUNCE_MS = 350;
  const LABELS: Record<EntityType, string> = { track: 'tracks', album: 'albums', artist: 'artists' };

  let metric = $state<RankingMetric>('time');
  let loading = $state(false);
  let failed = $state(false);

  let timer: ReturnType<typeof setTimeout> | null = null;
  let requestId = 0;

  $effect(() => {
    metric = getRankingMetric();
  });

  $effect(() => {
    // dependencias explícitas: cualquier cambio de la selección redispara el cálculo
    const key = pairs.map(p => `${p.sourceId}>${p.targetId}`).join(',');
    const currentMetric = metric;

    if (timer) clearTimeout(timer);
    if (pairs.length === 0) {
      impact = null;
      loading = false;
      failed = false;
      return;
    }

    loading = true;
    failed = false;
    const snapshot = [...pairs];
    timer = setTimeout(async () => {
      const id = ++requestId;
      try {
        const result = await api.mergeImpact(entityType, snapshot, currentMetric);
        if (id === requestId) impact = result; // descartar respuestas fuera de orden
      } catch {
        if (id === requestId) { impact = null; failed = true; }
      } finally {
        if (id === requestId) loading = false;
      }
    }, DEBOUNCE_MS);

    void key;
    return () => { if (timer) clearTimeout(timer); };
  });

  const label = (id: string) => nameOf(id) ?? 'an entry';
</script>

{#if pairs.length > 0}
  <div class="impact" class:impact--loading={loading}>
    {#if failed}
      <span class="impact-muted">Could not calculate ranking impact.</span>
    {:else if loading && !impact}
      <span class="impact-muted">Calculating ranking impact...</span>
    {:else if impact}
      <div class="impact-headline">
        Applying {pairs.length} merge{pairs.length !== 1 ? 's' : ''} moves
        <strong>{impact.movedCount}</strong>
        {impact.movedCount === 1 ? 'entry' : 'entries'} up in your all-time top {LABELS[entityType]}
        <span class="impact-muted">(by {impact.metric === 'plays' ? 'plays' : 'listening time'})</span>{#if impact.enteredTop > 0}, <strong>{impact.enteredTop}</strong> entering the top {impact.topThreshold}{/if}.
      </div>
      {#if impact.biggest.length > 0}
        <ul class="impact-movers">
          {#each impact.biggest as b}
            <li>
              <span class="impact-name">{label(b.id)}</span>
              <span class="impact-rank">#{b.rankBefore ?? '—'} → #{b.rankAfter}</span>
            </li>
          {/each}
        </ul>
      {/if}
      <div class="impact-note">
        Other entries shift up as duplicates disappear from the list.
      </div>
    {/if}
  </div>
{/if}

<style>
  .impact {
    background: rgba(255, 176, 46, 0.07);
    border: 1px solid rgba(255, 176, 46, 0.25);
    border-radius: var(--radius);
    padding: 0.55rem 0.75rem;
    font-size: 0.8rem;
    transition: opacity 0.1s;
  }
  .impact--loading { opacity: 0.6; }

  .impact-headline { line-height: 1.4; }

  .impact-muted { color: var(--text-muted); }

  .impact-movers {
    list-style: none;
    margin: 0.4rem 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .impact-movers li {
    display: flex;
    gap: 0.5rem;
    align-items: baseline;
    font-size: 0.76rem;
  }
  .impact-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-muted);
  }
  .impact-rank {
    color: #ffb02e;
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
  }

  .impact-note {
    margin-top: 0.35rem;
    font-size: 0.72rem;
    color: var(--text-muted);
  }
</style>
