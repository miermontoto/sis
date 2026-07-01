<script lang="ts">
  import { tick } from 'svelte';
  import { projectionsStore } from '$lib/stores/projections.svelte';
  import { formatDuration } from '$lib/utils/format';
  import IconTrack from '$lib/icons/IconTrack.svelte';
  import IconArtist from '$lib/icons/IconArtist.svelte';
  import IconAlbum from '$lib/icons/IconAlbum.svelte';
  import { getSessionRankDisplay, onSessionRankDisplayChange } from '$lib/api';
  import type { ProjectionResult, RankProjection, SessionRankDisplay } from '$lib/api';

  const RANGE_LABELS: Record<string, string> = { thisYear: 'YTD', all: 'ALL' };
  const TAB_MAP: Record<string, string> = { track: 'tracks', artist: 'artists', album: 'albums' };

  let displayMode = $state<SessionRankDisplay>(getSessionRankDisplay());

  $effect(() => {
    return onSessionRankDisplayChange(() => { displayMode = getSessionRankDisplay(); });
  });

  const ALLOWED_RANGES: Record<string, Set<string>> = {
    'all': new Set(['all']),
    'all+ytd': new Set(['all', 'thisYear']),
  };

  function filterChanges(changes: RankProjection[]): RankProjection[] {
    const allowed = ALLOWED_RANGES[displayMode];
    if (!allowed) return [];
    return changes.filter(c => allowed.has(c.range));
  }

  // en modo solo-ALL la etiqueta de rango es redundante (no hay YTD con qué contrastar)
  function rangeLabel(range: string): string {
    return displayMode === 'all' ? '' : `${RANGE_LABELS[range] ?? range} `;
  }

  function rankingHref(r: ProjectionResult, range: string): string {
    return `/top?tab=${TAB_MAP[r.entityType] ?? 'tracks'}&range=${range === 'thisYear' ? 'thisYear' : 'all'}&focus=${r.entityId}`;
  }

  function bestChange(changes: RankProjection[]): RankProjection | null {
    if (changes.length === 0) return null;
    return changes.reduce((best, c) => Math.abs(c.delta) > Math.abs(best.delta) ? c : best);
  }

  let data = $derived(projectionsStore.data);

  let nameEls = new Map<string, HTMLElement>();
  let overflowing = $state<Set<string>>(new Set());

  function trackOverflow(el: HTMLElement, id: string) {
    nameEls.set(id, el);
    checkOverflows();
    return { destroy() { nameEls.delete(id); } };
  }

  function checkOverflows() {
    tick().then(() => {
      const next = new Set<string>();
      for (const [id, el] of nameEls) {
        if (el.scrollWidth > el.clientWidth) next.add(id);
      }
      overflowing = next;
    });
  }

  $effect(() => {
    void data;
    checkOverflows();
  });
</script>

{#if data && data.sessionTrackCount > 0}
  <div class="session-card">
    <div class="session-header">
      <span class="session-title">Session</span>
      <span class="session-count">{data.sessionTrackCount} tracks · {formatDuration(data.sessionTotalMs)}</span>
    </div>
    {#if displayMode !== 'none' && data.session.some(r => bestChange(filterChanges(r.changes)) !== null)}
      <div class="session-list">
        {#each data.session as r}
          {@const best = bestChange(filterChanges(r.changes))}
          {#if best}
            <div class="session-row">
              <span class="session-icon">
                {#if r.entityType === 'track'}<IconTrack size={12} />
                {:else if r.entityType === 'artist'}<IconArtist size={12} />
                {:else}<IconAlbum size={12} />
                {/if}
              </span>
              <a href="/{r.entityType}/{r.entityId}" class="session-name" class:session-name--marquee={overflowing.has(r.entityId)} use:trackOverflow={r.entityId}><span class="session-name-text">{r.entityName}</span></a>
              <span class="session-change-wrap">
                <a href={rankingHref(r, best.range)} class="session-change" class:up={best.delta > 0} class:down={best.delta < 0}>
                  {rangeLabel(best.range)}#{best.currentRank}→#{best.projectedRank}
                </a>
                {#if best.displaced.length > 0}
                  <div class="displaced-tooltip">
                    {#each best.displaced.slice(0, 5) as d}
                      <div class="displaced-row">
                        <span class="displaced-arrow">▲</span>
                        {#if d.imageUrl}<img class="displaced-img" src={d.imageUrl} alt="" />{/if}
                        <a href="/{r.entityType}/{d.id}" class="displaced-name">{d.name}</a>
                      </div>
                    {/each}
                    {#if best.displaced.length > 5}
                      <div class="displaced-more">+{best.displaced.length - 5} más</div>
                    {/if}
                  </div>
                {/if}
              </span>
            </div>
          {/if}
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .session-card {
    padding: 0.6rem;
    background: linear-gradient(135deg, rgba(74, 158, 255, 0.08), rgba(74, 158, 255, 0.02));
    border: 1px solid rgba(74, 158, 255, 0.15);
    border-radius: var(--radius, 8px);
    font-size: 0.7rem;
    color: var(--text-secondary, #aaa);
  }

  .session-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .session-list {
    margin-top: 0.4rem;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }

  .session-title {
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 600;
    color: var(--text-muted, #666);
  }

  .session-count {
    font-size: 0.6rem;
    color: var(--text-muted, #555);
  }

  .session-row {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.15rem 0;
    color: inherit;
    min-width: 0;
  }

  .session-icon {
    flex-shrink: 0;
    width: 1rem;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0.6;
  }

  .session-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-decoration: none;
    color: inherit;
    text-overflow: ellipsis;
  }

  .session-name:hover {
    color: var(--text-primary, #fff);
  }

  .session-name--marquee {
    text-overflow: clip;
    mask-image: linear-gradient(to right, transparent 0, #000 4%, #000 96%, transparent 100%);
  }

  .session-name--marquee .session-name-text {
    display: inline-block;
    padding-left: 100%;
    animation: session-marquee 8s linear infinite;
  }

  @keyframes session-marquee {
    0% { transform: translateX(0); }
    100% { transform: translateX(-100%); }
  }

  .session-change-wrap {
    flex-shrink: 0;
    position: relative;
  }

  .session-change {
    font-weight: 600;
    font-size: 0.6rem;
    font-variant-numeric: tabular-nums;
    text-decoration: none;
  }

  .session-change:hover {
    text-decoration: underline;
  }

  .session-change.up {
    color: #1db954;
  }

  .session-change.down {
    color: #e34234;
  }

  .displaced-tooltip {
    display: none;
    position: absolute;
    right: 0;
    top: 100%;
    z-index: 100;
    margin-top: 4px;
    padding: 0.4rem 0.5rem;
    background: var(--bg-elevated, #1e1e1e);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    white-space: nowrap;
    min-width: max-content;
  }

  .session-change-wrap:hover .displaced-tooltip {
    display: block;
  }

  .displaced-row {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.1rem 0;
    font-size: 0.6rem;
    color: var(--text-secondary, #aaa);
  }

  .displaced-arrow {
    color: #1db954;
    font-size: 0.5rem;
    flex-shrink: 0;
  }

  .displaced-img {
    width: 16px;
    height: 16px;
    border-radius: 2px;
    object-fit: cover;
    flex-shrink: 0;
  }

  .displaced-name {
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 160px;
    text-decoration: none;
    color: inherit;
  }

  .displaced-name:hover {
    color: var(--text-primary, #fff);
  }

  .displaced-more {
    font-size: 0.55rem;
    color: var(--text-muted, #666);
    padding-top: 0.1rem;
  }
</style>
