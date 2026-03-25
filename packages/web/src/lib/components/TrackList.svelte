<script lang="ts">
  import type { TopTrackItem, HistoryItem, RankingMetric } from '$lib/api';
  import { formatDuration, timeAgo } from '$lib/utils/format';
  import RankChange from './RankChange.svelte';

  interface Props {
    items: (TopTrackItem | HistoryItem)[];
    showRank?: boolean;
    showTime?: boolean;
    metric?: RankingMetric;
    showRankChanges?: boolean;
  }

  let { items, showRank = false, showTime = false, metric = 'time', showRankChanges = false }: Props = $props();

  // type guard
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
      <div class="track-item">
        {#if showRank}
          {#if showRankChanges && isTopTrack(item)}
            <div class="rank-cell">
              <span class="track-rank">{i + 1}</span>
              <RankChange rankChange={item.rankChange} isNew={item.isNew} />
            </div>
          {:else}
            <span class="track-rank">{i + 1}</span>
          {/if}
        {/if}
        {#if track.album?.imageUrl}
          <a href="/album/{track.album.id}" class="track-art-link">
            <img class="track-art" src={track.album.imageUrl} alt={track.album?.name ?? ''} />
          </a>
        {:else}
          <div class="track-art"></div>
        {/if}
        <div class="track-info">
          <div class="track-name">
            {#if isTopTrack(item)}
              <a href="/track/{item.trackId}" class="track-link">{track.name}</a>
            {:else if 'track' in item && item.track}
              <a href="/track/{item.track.id}" class="track-link">{track.name}</a>
            {:else}
              {track.name}
            {/if}
          </div>
          <div class="track-artist">
            {#each track.artists as artist, i}
              <a href="/artist/{artist.id}" class="artist-link">{artist.name}</a>{#if i < track.artists.length - 1}, {/if}
            {/each}
          </div>
        </div>
        <div class="track-meta">
          {#if isTopTrack(item)}
            <div class="track-plays">{formatMetric(item)}</div>
            {#if metric === 'time'}
              <div class="track-time">{item.playCount} plays</div>
            {:else}
              <div class="track-time">{formatDuration(item.totalMs)}</div>
            {/if}
          {/if}
          {#if showTime && 'playedAt' in item}
            <div class="track-time">{timeAgo(item.playedAt)}</div>
          {/if}
        </div>
      </div>
    {/if}
  {/each}
</div>

<style>
  .track-link {
    color: inherit;
    text-decoration: none;
  }
  .track-link:hover {
    color: var(--accent);
  }
  .artist-link {
    color: inherit;
    text-decoration: none;
  }
  .artist-link:hover {
    color: var(--accent);
  }
</style>
