<script lang="ts">
  import type { TopTrackItem, HistoryItem, RankingMetric } from '$lib/api';
  import { formatTrackLength, formatDate, formatHistoryStamp } from '$lib/utils/format';
  import { nowPlayingStore } from '$lib/stores/now-playing.svelte';
  import { statFlashStore } from '$lib/stores/stat-flash.svelte';
  import { playlistMembershipStore } from '$lib/stores/playlist-membership.svelte';
  import { untrack } from 'svelte';
  import TrackItem from './TrackItem.svelte';
  import MetricMeta from './MetricMeta.svelte';
  import Accolades from './Accolades.svelte';
  import PlaylistPopover from './PlaylistPopover.svelte';

  interface Props {
    items: (TopTrackItem | HistoryItem)[];
    showRank?: boolean;
    showRankChanges?: boolean;
    showTime?: boolean;
    metric?: RankingMetric;
    compact?: boolean;
    focusId?: string | null;
    itemFocusKey?: (item: TopTrackItem | HistoryItem) => string | null;
    ranks?: (number | null | undefined)[];
    globalRanks?: Record<string, number> | null;
    dimUnplayed?: boolean;
    fillPercents?: number[];
    percentLabels?: number[];
    showDuration?: boolean;
    showAccolades?: boolean;
    showPlaylists?: boolean;
    sessionStartedAt?: string | null;
    sessionTotalTracks?: number;
  }

  let { items, showRank = false, showRankChanges = false, showTime = false, metric = 'time', compact = false, focusId = null, itemFocusKey, ranks, globalRanks = null, dimUnplayed = false, fillPercents, percentLabels, showDuration = false, showAccolades = false, showPlaylists = false, sessionStartedAt = null, sessionTotalTracks = 0 }: Props = $props();

  let sessionStartMs = $derived(sessionStartedAt ? new Date(sessionStartedAt).getTime() : null);

  // pertenencia a playlists de toda la lista en una sola petición. `untrack`
  // porque ensure() lee el mismo estado que escribe: sin él, cada respuesta
  // reejecuta el efecto
  $effect(() => {
    if (!showPlaylists) return;
    const ids = items.map(getTrackId).filter((id): id is string => !!id);
    if (ids.length > 0) untrack(() => playlistMembershipStore.ensure(ids));
  });

  function resolveFocusKey(item: TopTrackItem | HistoryItem): string | null {
    return itemFocusKey ? itemFocusKey(item) : getTrackId(item);
  }

  function getTrackId(item: TopTrackItem | HistoryItem): string | null {
    if ('trackId' in item) return item.trackId;
    if ('track' in item && item.track) return item.track.id;
    return null;
  }

  function isTopTrack(item: TopTrackItem | HistoryItem): item is TopTrackItem {
    return 'playCount' in item;
  }

  function isInSession(item: TopTrackItem | HistoryItem): boolean {
    if (!sessionStartMs || !('playedAt' in item)) return false;
    return new Date(item.playedAt).getTime() >= sessionStartMs;
  }

  let sessionCount = $derived.by(() => {
    if (!sessionStartMs) return 0;
    const idx = items.findIndex(item => !isInSession(item));
    return idx === -1 ? items.length : idx;
  });

  let sessionTruncated = $derived(sessionCount > 0 && sessionCount === items.length && sessionTotalTracks > sessionCount);
</script>

{#snippet trackItem(item: TopTrackItem | HistoryItem, i: number)}
  {@const track = isTopTrack(item) ? item.track : item.track}
  {@const trackId = getTrackId(item)}
  {@const focusKey = resolveFocusKey(item)}
  {#if track}
    <TrackItem
      rank={showRank ? (ranks ? (ranks[i] ?? undefined) : i + 1) : undefined}
      globalRank={trackId ? globalRanks?.[trackId] : undefined}
      rankChange={showRankChanges && isTopTrack(item) ? item.rankChange : undefined}
      isNew={showRankChanges && isTopTrack(item) ? item.isNew : undefined}
      imageUrl={track.album?.imageUrl}
      imageHref={track.album ? `/album/${track.album.id}` : undefined}
      name={track.name}
      nameHref={isTopTrack(item) ? `/track/${item.trackId}` : ('track' in item && item.track ? `/track/${item.track.id}` : undefined)}
      isLive={trackId === nowPlayingStore.trackId}
      focusId={focusKey ?? undefined}
      highlighted={focusId != null && focusKey === focusId}
      dimmed={dimUnplayed && isTopTrack(item) && item.playCount === 0}
      fillPercent={fillPercents?.[i]}
      entity={trackId ? { type: 'track', id: trackId, name: track.name, imageUrl: track.album?.imageUrl ?? null, parentArtistId: track.artists[0]?.id } : undefined}
      {compact}
    >
      {#snippet subtitle()}
        {#each track.artists as artist, ai}
          <a href="/artist/{artist.id}" class="artist-link">{artist.name}</a>{#if ai < track.artists.length - 1}{', '}{/if}
        {/each}
        {#if showDuration && track.durationMs}
          <span class="track-duration-label"> &middot; {formatTrackLength(track.durationMs)}</span>
        {/if}
        {#if percentLabels?.[i] != null}
          <span class="track-share">{percentLabels[i].toFixed(1)}%</span>
        {/if}
      {/snippet}
      {#snippet extra()}
        {#if showAccolades && trackId}
          <Accolades entityType="track" entityId={trackId} />
        {/if}
        <!-- el badge afirma pertenencia, así que sólo existe cuando hay alguna:
             montar el popover en cada fila sería un listener de documento por
             fila para no pintar nada -->
        {#if showPlaylists && trackId && (playlistMembershipStore.get(trackId)?.length ?? 0) > 0}
          <PlaylistPopover
            inline
            {trackId}
            inPlaylists={playlistMembershipStore.get(trackId) ?? []}
            onAdd={(pl) => playlistMembershipStore.add(trackId, pl)}
            onRemove={(id) => playlistMembershipStore.remove(trackId, id)}
          />
        {/if}
      {/snippet}
      {#snippet meta()}
        {#if isTopTrack(item)}
          <MetricMeta playCount={item.playCount} totalMs={item.totalMs} {metric} flash={statFlashStore.isFlashing(trackId)} />
        {/if}
        {#if showTime && 'playedAt' in item}
          <div class="track-time" title={formatDate(item.playedAt)}>{formatHistoryStamp(item.playedAt)}</div>
        {/if}
      {/snippet}
    </TrackItem>
  {/if}
{/snippet}

<div class="track-list">
  {#if sessionCount > 0}
    <div class="session-group" class:session-group--open={sessionTruncated}>
      {#each items.slice(0, sessionCount) as item, i}
        {@render trackItem(item, i)}
      {/each}
    </div>
  {/if}
  {#each items.slice(sessionCount) as item, ri}
    {@render trackItem(item, ri + sessionCount)}
  {/each}
</div>
