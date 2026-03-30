<script lang="ts">
  import { api, createFetchController, type Accolade } from '$lib/api';
  import { formatDuration, formatNumber } from '$lib/utils/format';

  let {
    entityType,
    entityId,
  }: {
    entityType: 'artist' | 'track' | 'album';
    entityId: string;
  } = $props();

  const chartType = entityType === 'artist' ? 'artists' : entityType === 'album' ? 'albums' : 'tracks';

  function accoladeHref(a: Accolade): string | null {
    if (a.week) return `/charts?type=${chartType}&granularity=week&period=${a.week}`;
    return null;
  }

  let accolades = $state<Accolade[]>([]);
  let metric = $state<'plays' | 'time'>('time');
  let loading = $state(true);
  const fetchCtrl = createFetchController();

  const labels: Record<string, string> = {
    peakWeek: 'Peak week',
    biggestDebut: 'Biggest debut',
    weeksAtNo1: 'Weeks at #1',
    weeksInChart: 'Weeks in charts',
    longestRun: 'Longest chart run',
    mostNo1Tracks: '#1 tracks',
    mostNo1Albums: '#1 albums',
    inPlaylists: 'In playlists',
    inMostPlaylists: 'In most playlists',
  };

  function medal(rank: number): string {
    if (rank === 1) return '\u{1F947}';
    if (rank === 2) return '\u{1F948}';
    if (rank === 3) return '\u{1F949}';
    return `#${rank}`;
  }

  function formatValue(a: Accolade): string {
    if (a.type === 'inPlaylists' || a.type === 'inMostPlaylists') return `${a.value} playlist${a.value !== 1 ? 's' : ''}`;
    if (a.type === 'weeksAtNo1' || a.type === 'weeksInChart' || a.type === 'longestRun') return `${a.value} wk${a.value !== 1 ? 's' : ''}`;
    if (a.type === 'mostNo1Tracks' || a.type === 'mostNo1Albums') return String(a.value);
    if (metric === 'plays') return `${formatNumber(a.value)} plays`;
    return formatDuration(a.value);
  }

  $effect(() => {
    void entityId;
    const signal = fetchCtrl.reset();
    loading = true;
    accolades = [];
    api.accolades(entityType, entityId, signal)
      .then(r => { if (!signal.aborted) { metric = r.metric; accolades = r.accolades; loading = false; } })
      .catch(() => { if (!signal.aborted) { accolades = []; loading = false; } });
    return () => fetchCtrl.abort();
  });
</script>

{#if !loading && accolades.length > 0}
  <div class="accolades" class:accolades--multi={accolades.length > 4}>
    {#each accolades as a}
      {@const href = accoladeHref(a)}
      {#if href}
        <a {href} class="accolade accolade--link">
          <span class="accolade-medal" class:accolade-medal--text={a.rank > 3}>{medal(a.rank)}</span>
          <span class="accolade-label">{labels[a.type] ?? a.type}</span>
          <span class="accolade-value">{formatValue(a)}</span>
        </a>
      {:else}
        <div class="accolade">
          <span class="accolade-medal" class:accolade-medal--text={a.rank > 3}>{medal(a.rank)}</span>
          <span class="accolade-label">{labels[a.type] ?? a.type}</span>
          <span class="accolade-value">{formatValue(a)}</span>
        </div>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .accolades {
    columns: 1;
    column-gap: 0.3rem;
    flex-shrink: 0;
  }
  .accolades--multi {
    columns: 2;
  }
  .accolade {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.25rem 0.6rem 0.25rem 0.35rem;
    border-radius: 8px;
    background: rgba(29, 185, 84, 0.08);
    border: 1px solid rgba(29, 185, 84, 0.15);
    white-space: nowrap;
    margin-bottom: 0.3rem;
    break-inside: avoid;
  }
  .accolade-medal {
    font-size: 0.9rem;
    line-height: 1;
    min-width: 1.2rem;
    text-align: center;
  }
  .accolade-medal--text {
    font-size: 0.7rem;
    font-weight: 700;
    color: var(--text-muted);
  }
  .accolade-label {
    font-size: 0.7rem;
    color: var(--text-muted);
  }
  .accolade-value {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text);
    margin-left: auto;
  }
  .accolade--link {
    text-decoration: none;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
  }
  .accolade--link:hover {
    border-color: rgba(29, 185, 84, 0.4);
    background: rgba(29, 185, 84, 0.15);
  }
  @media (max-width: 768px) {
    .accolades, .accolades--multi {
      columns: 1;
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 0.3rem;
    }
    .accolade {
      margin-bottom: 0;
    }
  }
</style>
