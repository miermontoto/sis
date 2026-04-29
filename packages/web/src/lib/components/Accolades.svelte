<script lang="ts">
  import { browser } from '$app/environment';
  import { api, createFetchController, type Accolade, type EntityType, type RankingMetric } from '$lib/api';
  import { formatDuration, formatNumber } from '$lib/utils/format';

  let {
    entityType,
    entityId,
  }: {
    entityType: EntityType;
    entityId: string;
  } = $props();

  let chartType = $derived(entityType === 'artist' ? 'artists' : entityType === 'album' ? 'albums' : 'tracks');

  function accoladeHref(a: Accolade): string | null {
    if (a.week) return `/charts?type=${chartType}&granularity=week&period=${a.week}`;
    return null;
  }

  let accolades = $state<Accolade[]>([]);
  let metric = $state<RankingMetric>('time');
  let loading = $state(true);
  let open = $state(false);
  let rootEl: HTMLElement | undefined = $state();
  const fetchCtrl = createFetchController();

  const labels: Record<string, string> = {
    peakWeek: 'Peak week',
    biggestDebut: 'Biggest debut',
    weeksAtNo1: 'Weeks at #1',
    weeksInChart: 'Weeks in charts',
    longestRun: 'Longest chart run',
    mostNo1Tracks: '#1 tracks',
    mostNo1Albums: '#1 albums',
    inMostPlaylists: 'In most playlists',
    longestGap: 'Longest gap',
    goldenOldies: 'Golden oldie',
    latestDiscoveries: 'Latest discovery',
    latestNew: 'Latest new',
    mostDistinctTracks: 'Distinct tracks',
    oneHitWonders: 'One-hit wonder',
    topNoAlbum: 'Top without album',
    mostAccolades: 'Most records',
  };

  function labelFor(a: Accolade): string {
    if (a.type === 'yearEnd' && a.year != null) return `${a.year} year-end`;
    return labels[a.type] ?? a.type;
  }


  function medal(rank: number): string {
    if (rank === 1) return '\u{1F947}';
    if (rank === 2) return '\u{1F948}';
    if (rank === 3) return '\u{1F949}';
    return `#${rank}`;
  }

  function formatValue(a: Accolade): string {
    if (a.type === 'inMostPlaylists') return `${a.value} playlist${a.value !== 1 ? 's' : ''}`;
    if (a.type === 'weeksAtNo1' || a.type === 'weeksInChart' || a.type === 'longestRun') return `${a.value} wk${a.value !== 1 ? 's' : ''}`;
    if (a.type === 'mostNo1Tracks' || a.type === 'mostNo1Albums' || a.type === 'mostAccolades') return String(a.value);
    if (a.type === 'longestGap') return `${formatNumber(a.value)} day${a.value !== 1 ? 's' : ''}`;
    if (a.type === 'mostDistinctTracks') return `${a.value} track${a.value !== 1 ? 's' : ''}`;
    if (a.type === 'goldenOldies' ||
        a.type === 'latestDiscoveries' || a.type === 'latestNew' ||
        a.type === 'oneHitWonders' || a.type === 'topNoAlbum') {
      return `${formatNumber(a.value)} plays`;
    }
    if (metric === 'plays') return `${formatNumber(a.value)} plays`;
    return formatDuration(a.value);
  }

  // separar year-end finishes del resto para renderizarlos en su propia sección
  let regularAccolades = $derived(accolades.filter(a => a.type !== 'yearEnd'));
  // agrupar year-end por rank y juntar los años en un array ordenado desc
  let yearEndGroups = $derived.by(() => {
    const byRank = new Map<number, number[]>();
    for (const a of accolades) {
      if (a.type !== 'yearEnd' || a.year == null) continue;
      const arr = byRank.get(a.rank) ?? [];
      arr.push(a.year);
      byRank.set(a.rank, arr);
    }
    return [...byRank.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([rank, years]) => ({ rank, years: years.sort((a, b) => b - a) }));
  });

  // resumen compacto: agrupar por rank (gold/silver/bronze/#N) y mostrar los 3 primeros grupos
  let triggerGroups = $derived.by(() => {
    const counts = new Map<number, number>();
    for (const a of accolades) counts.set(a.rank, (counts.get(a.rank) ?? 0) + 1);
    return [...counts.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([rank, count]) => ({ rank, count }));
  });
  let triggerPreview = $derived(triggerGroups.slice(0, 3));
  let triggerOverflow = $derived.by(() => {
    const shown = triggerPreview.reduce((s, g) => s + g.count, 0);
    return Math.max(0, accolades.length - shown);
  });

  $effect(() => {
    void entityId;
    const signal = fetchCtrl.reset();
    loading = true;
    accolades = [];
    open = false;
    api.accolades(entityType, entityId, signal)
      .then(r => {
        if (signal.aborted) return;
        metric = r.metric;
        accolades = [...r.accolades].sort((a, b) => a.rank - b.rank);
        loading = false;
      })
      .catch(() => { if (!signal.aborted) { accolades = []; loading = false; } });
    return () => fetchCtrl.abort();
  });

  function handleOutside(e: PointerEvent) {
    if (rootEl && !rootEl.contains(e.target as Node)) open = false;
  }

  function handleKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && open) open = false;
  }

  $effect(() => {
    if (!browser || !open) return;
    document.addEventListener('pointerdown', handleOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('pointerdown', handleOutside);
      document.removeEventListener('keydown', handleKey);
    };
  });
</script>

{#if !loading && accolades.length > 0}
  <div
    class="accolades-root"
    bind:this={rootEl}
    onmouseenter={() => open = true}
    onmouseleave={() => open = false}
  >
    <button
      type="button"
      class="accolades-trigger"
      class:accolades-trigger--open={open}
      aria-expanded={open}
      aria-haspopup="true"
      aria-label="{accolades.length} records"
      title="{accolades.length} records"
      onclick={() => open = !open}
    >
      {#each triggerPreview as g}
        <span class="trigger-medal" class:trigger-medal--text={g.rank > 3}>
          {medal(g.rank)}{#if g.count > 1}<span class="trigger-times">×{g.count}</span>{/if}
        </span>
      {/each}
      {#if triggerOverflow > 0}<span class="trigger-more">+{triggerOverflow}</span>{/if}
    </button>

    {#if open}
      <div class="accolades-popover" role="region" aria-label="Records">
        {#if regularAccolades.length > 0}
          <div class="popover-title">Records</div>
          <ul class="popover-list">
            {#each regularAccolades as a}
              {@const href = accoladeHref(a)}
              <li>
                {#if href}
                  <a {href} class="popover-row popover-row--link">
                    <span class="popover-medal" class:popover-medal--text={a.rank > 3}>{medal(a.rank)}</span>
                    <span class="popover-label">{labelFor(a)}</span>
                    <span class="popover-value">{formatValue(a)}</span>
                  </a>
                {:else}
                  <div class="popover-row">
                    <span class="popover-medal" class:popover-medal--text={a.rank > 3}>{medal(a.rank)}</span>
                    <span class="popover-label">{labelFor(a)}</span>
                    <span class="popover-value">{formatValue(a)}</span>
                  </div>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}

        {#if yearEndGroups.length > 0}
          <div class="popover-title" class:popover-title--gap={regularAccolades.length > 0}>Year-end finishes</div>
          <div class="popover-pills">
            {#each yearEndGroups as g}
              <span class="popover-pill" class:popover-pill--text={g.rank > 3}>
                <span class="pill-medal">{medal(g.rank)}</span>
                {#if g.years.length > 1}<span class="pill-count">×{g.years.length}</span>{/if}
                <span class="pill-years">{#each g.years as year, yi}{#if yi > 0},{' '}{/if}<a href="/top?tab={chartType}&range=custom&startDate={year}-01-01&endDate={year}-12-31&focus={entityId}" class="pill-year-link">{year}</a>{/each}</span>
              </span>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .accolades-root {
    position: relative;
    flex-shrink: 0;
    align-self: center;
  }
  .accolades-trigger {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    height: 32px;
    padding: 0 0.45rem;
    border-radius: var(--radius);
    background: none;
    border: 1px solid var(--border);
    color: var(--text-muted);
    font: inherit;
    cursor: pointer;
    transition: color 0.15s, border-color 0.15s, background 0.15s;
  }
  .accolades-trigger:hover,
  .accolades-trigger--open {
    color: #f5a623;
    border-color: #f5a623;
    background: rgba(245, 166, 35, 0.08);
  }
  .trigger-medal {
    font-size: 0.9rem;
    line-height: 1;
    display: inline-flex;
    align-items: center;
  }
  .trigger-medal--text {
    font-family: var(--font-mono);
    font-size: 0.65rem;
    font-weight: 700;
  }
  .trigger-times {
    font-family: var(--font-mono);
    font-size: 0.55rem;
    font-weight: 700;
    opacity: 0.7;
    margin-left: 0.05rem;
  }
  .trigger-more {
    font-size: 0.6rem;
    font-weight: 700;
    opacity: 0.7;
    margin-left: 0.1rem;
  }

  .accolades-popover {
    position: absolute;
    top: calc(100% + 0.4rem);
    right: 0;
    z-index: 20;
    min-width: 260px;
    max-width: min(320px, 90vw);
    padding: 0.5rem;
    border-radius: var(--radius);
    background: var(--bg-card);
    border: 1px solid rgba(29, 185, 84, 0.25);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
    animation: accolades-pop 0.14s ease-out;
  }
  /* puente invisible que evita cerrar el popover al moverse del trigger al contenido */
  .accolades-popover::before {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    top: -0.4rem;
    height: 0.4rem;
  }
  @keyframes accolades-pop {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .popover-title {
    font-family: var(--font-mono);
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
    padding: 0.2rem 0.4rem 0.4rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    margin-bottom: 0.3rem;
  }
  .popover-title--gap {
    margin-top: 0.6rem;
  }

  .popover-pills {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    padding: 0.1rem 0.2rem 0.2rem;
  }
  .popover-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.2rem 0.55rem 0.2rem 0.4rem;
    border-radius: 999px;
    background: rgba(29, 185, 84, 0.08);
    border: 1px solid rgba(29, 185, 84, 0.2);
    font-size: 0.75rem;
    color: var(--text);
    line-height: 1.2;
    white-space: nowrap;
  }
  .popover-pill--text .pill-medal {
    font-size: 0.7rem;
    font-weight: 700;
    color: var(--text-muted);
  }
  .pill-medal {
    font-size: 0.9rem;
    line-height: 1;
  }
  .pill-count {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: 0.65rem;
    font-weight: 700;
    color: var(--text);
    background: var(--border);
    border-radius: 999px;
    padding: 0 0.35rem;
    min-width: 1rem;
    text-align: center;
  }
  .pill-years {
    color: var(--text-muted);
    font-size: 0.7rem;
  }
  .pill-year-link {
    color: var(--text-muted);
    text-decoration: none;
    transition: color 0.1s;
  }
  .pill-year-link:hover {
    color: var(--text);
    text-decoration: underline;
  }
  .popover-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    max-height: 60vh;
    overflow-y: auto;
  }
  .popover-row {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0.35rem 0.4rem;
    border-radius: var(--radius);
    color: var(--text);
    text-decoration: none;
  }
  .popover-row--link {
    cursor: pointer;
    transition: background 0.15s;
  }
  .popover-row--link:hover {
    background: rgba(29, 185, 84, 0.1);
  }
  .popover-medal {
    font-size: 1rem;
    line-height: 1;
    min-width: 1.4rem;
    text-align: center;
  }
  .popover-medal--text {
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--text-muted);
  }
  .popover-label {
    font-size: 0.8rem;
    color: var(--text-muted);
    flex: 1;
    min-width: 0;
  }
  .popover-value {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--text);
    margin-left: auto;
    white-space: nowrap;
  }

  @media (max-width: 768px) {
    .accolades-popover {
      right: 50%;
      transform: translateX(50%);
      max-width: min(320px, calc(100vw - 2rem));
      animation-name: accolades-pop-mobile;
    }
  }
  @keyframes accolades-pop-mobile {
    from { opacity: 0; transform: translate(50%, -4px); }
    to { opacity: 1; transform: translate(50%, 0); }
  }
</style>
