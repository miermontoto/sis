<script lang="ts">
  import { formatDuration, formatNumber, formatShortDate, formatSmartDate, localDateKey } from '$lib/utils/format';

  let {
    stats,
  }: {
    stats: { play_count: number; total_ms: number; first_played: string | null; last_played: string | null };
  } = $props();
</script>

<div class="stats-grid">
  <div class="card stat-card">
    <div class="stat-value">{formatNumber(stats.play_count)}</div>
    <div class="stat-label">Plays</div>
  </div>
  <div class="card stat-card">
    <div class="stat-value">{formatDuration(stats.total_ms)}</div>
    <div class="stat-label">Listening time</div>
  </div>
  {#if stats.first_played}
    <a href="/history?date={localDateKey(stats.first_played)}&focus={encodeURIComponent(stats.first_played)}" class="card stat-card stat-card--link">
      <div class="stat-value">{formatShortDate(stats.first_played)}</div>
      <div class="stat-label">First played</div>
    </a>
  {/if}
  {#if stats.last_played}
    <a href="/history?date={localDateKey(stats.last_played)}&focus={encodeURIComponent(stats.last_played)}" class="card stat-card stat-card--link">
      <div class="stat-value">{formatSmartDate(stats.last_played)}</div>
      <div class="stat-label">Last played</div>
    </a>
  {/if}
</div>
