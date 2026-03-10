<script lang="ts">
  import type { TopTrackItem, HistoryItem } from '$lib/api';
  import { formatDuration, timeAgo } from '$lib/utils/format';

  interface Props {
    items: (TopTrackItem | HistoryItem)[];
    showRank?: boolean;
    showTime?: boolean;
  }

  let { items, showRank = false, showTime = false }: Props = $props();

  // type guard
  function isTopTrack(item: TopTrackItem | HistoryItem): item is TopTrackItem {
    return 'playCount' in item;
  }
</script>

<div class="track-list">
  {#each items as item, i}
    {@const track = isTopTrack(item) ? item.track : item.track}
    {#if track}
      <div class="track-item">
        {#if showRank}
          <span class="track-rank">{i + 1}</span>
        {/if}
        {#if track.album?.imageUrl}
          <img class="track-art" src={track.album.imageUrl} alt={track.album?.name ?? ''} />
        {:else}
          <div class="track-art"></div>
        {/if}
        <div class="track-info">
          <div class="track-name">{track.name}</div>
          <div class="track-artist">{track.artists.map(a => a.name).join(', ')}</div>
        </div>
        <div class="track-meta">
          {#if isTopTrack(item)}
            <div class="track-plays">{item.playCount} plays</div>
          {/if}
          {#if showTime && 'playedAt' in item}
            <div class="track-time">{timeAgo(item.playedAt)}</div>
          {/if}
          <div class="track-time">{formatDuration(track.durationMs)}</div>
        </div>
      </div>
    {/if}
  {/each}
</div>
