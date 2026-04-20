<script lang="ts">
  import type { TopTrackItem, HistoryItem, RankingMetric } from '$lib/api';
  import { formatDuration, formatDate, timeAgo } from '$lib/utils/format';
  import { nowPlayingStore } from '$lib/stores/now-playing.svelte';
  import TrackItem from './TrackItem.svelte';

  interface Props {
    items: (TopTrackItem | HistoryItem)[];
    showRank?: boolean;
    showTime?: boolean;
    metric?: RankingMetric;
    compact?: boolean;
  }

  let { items, showRank = false, showTime = false, metric = 'time', compact = false }: Props = $props();

  function getTrackId(item: TopTrackItem | HistoryItem): string | null {
    if ('trackId' in item) return item.trackId;
    if ('track' in item && item.track) return item.track.id;
    return null;
  }

  function isTopTrack(item: TopTrackItem | HistoryItem): item is TopTrackItem {
    return 'playCount' in item;
  }

  function formatMetric(item: TopTrackItem): string {
    if (metric === 'plays') return `${item.playCount} plays`;
    return formatDuration(item.totalMs);
  }
</script>

<div class="track-list">
  {#each items as item, i}
    {@const track = isTopTrack(item) ? item.track : item.track}
    {#if track}
      <TrackItem
        rank={showRank ? i + 1 : undefined}
        imageUrl={track.album?.imageUrl}
        imageHref={track.album ? `/album/${track.album.id}` : undefined}
        name={track.name}
        nameHref={isTopTrack(item) ? `/track/${item.trackId}` : ('track' in item && item.track ? `/track/${item.track.id}` : undefined)}
        isLive={getTrackId(item) === nowPlayingStore.trackId}
        {compact}
      >
        {#snippet subtitle()}
          {#each track.artists as artist, ai}
            <a href="/artist/{artist.id}" class="artist-link">{artist.name}</a>{#if ai < track.artists.length - 1}{', '}{/if}
          {/each}
        {/snippet}
        {#snippet meta()}
          {#if isTopTrack(item)}
            <div class="track-plays">{formatMetric(item)}</div>
            {#if metric === 'time'}
              <div class="track-time">{item.playCount} plays</div>
            {:else}
              <div class="track-time">{formatDuration(item.totalMs)}</div>
            {/if}
          {/if}
          {#if showTime && 'playedAt' in item}
            <div class="track-time" title={formatDate(item.playedAt)}>{timeAgo(item.playedAt)}</div>
          {/if}
        {/snippet}
      </TrackItem>
    {/if}
  {/each}
</div>
