<script lang="ts">
  // la sesión en curso: cuántos temas y cuánto tiempo, y a qué puestos de los rankings
  // all-time / del año sube lo que llevas escuchado (las mismas proyecciones que la
  // session card del sidebar, con sus filtros de Settings), en filas de TrackItem
  import { getSessionRankDisplay, onSessionRankDisplayChange, getSessionTrackingDisplay } from '$lib/api';
  import TrackItem from '$lib/components/TrackItem.svelte';
  import { projectionsStore } from '$lib/stores/projections.svelte';
  import { nowPlayingStore } from '$lib/stores/now-playing.svelte';
  import { bestChange, rangeLabel, rankingHref, visibleSession } from '$lib/utils/session-ranks';
  import { formatDuration } from '$lib/utils/format';
  import { fitRows } from '$lib/utils/fit-rows';
  import WidgetHeader from '../WidgetHeader.svelte';
  import type { WidgetProps } from '../components';

  let { size }: WidgetProps = $props();

  let mode = $state(getSessionRankDisplay());
  $effect(() => onSessionRankDisplayChange(() => { mode = getSessionRankDisplay(); }));
  const tracking = getSessionTrackingDisplay() !== 'off';

  let data = $derived(projectionsStore.data);
  let rows = $derived(data ? visibleSession(data.session, mode) : []);
</script>

<WidgetHeader title="This session" href="/history">
  {#snippet actions()}
    {#if data && data.sessionTrackCount > 0}
      <span class="data-label">{data.sessionTrackCount} tracks · {formatDuration(data.sessionTotalMs)}</span>
    {/if}
  {/snippet}
</WidgetHeader>

{#if !tracking}
  <p class="w-empty">Session tracking is off in <a href="/settings?tab=display" class="section-link">Settings</a>.</p>
{:else if !data || data.sessionTrackCount === 0}
  <p class="w-empty">Start listening and your session's ranking moves show up here.</p>
{:else if rows.length === 0}
  <p class="w-empty">No ranking moves yet this session.</p>
{:else}
  <div class="w-fill" use:fitRows={'.track-list'} data-size={size}>
    <div class="track-list">
      {#each rows as { result: r, changes } (r.entityType + r.entityId)}
        {@const best = bestChange(changes)}
        {#snippet passedLine()}passes {best?.displaced[0].name}{#if (best?.displaced.length ?? 0) > 1}{' '}+{(best?.displaced.length ?? 0) - 1}{/if}{/snippet}
        {#snippet cells()}
          {#each changes as c (c.range)}
            <a href={rankingHref(r, c.range)} class="sw-change" class:up={c.delta > 0}>{rangeLabel(c.range, mode)}#{c.currentRank}→#{c.projectedRank}</a>
          {/each}
        {/snippet}
        <TrackItem
          compact
          name={r.entityName}
          nameHref="/{r.entityType}/{r.entityId}"
          imageUrl={r.imageUrl}
          imageHref="/{r.entityType}/{r.entityId}"
          imageRound={r.entityType === 'artist'}
          isLive={nowPlayingStore.isLive(r.entityType, r.entityId)}
          entity={{ type: r.entityType, id: r.entityId, name: r.entityName, imageUrl: r.imageUrl }}
          subtitle={best && best.displaced.length > 0 ? passedLine : undefined}
          meta={cells}
        />
      {/each}
    </div>
  </div>
{/if}

<style>
  .sw-change {
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    color: var(--text-muted);
    text-decoration: none;
    white-space: nowrap;
  }
  .sw-change.up { color: var(--accent); }
  .sw-change + .sw-change { margin-left: 0.4rem; }
</style>
