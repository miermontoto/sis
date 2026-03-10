<script lang="ts">
  import { api, type NowPlayingResponse } from '$lib/api';
  import { onMount } from 'svelte';

  let data = $state<NowPlayingResponse | null>(null);

  async function poll() {
    try {
      data = await api.nowPlaying();
    } catch {
      data = null;
    }
  }

  onMount(() => {
    poll();
    const interval = setInterval(poll, 10_000);
    return () => clearInterval(interval);
  });
</script>

{#if data?.playing && data.track}
  <div class="now-playing">
    {#if data.track.album?.imageUrl}
      <img class="now-playing-art" src={data.track.album.imageUrl} alt={data.track.album.name} />
    {:else}
      <div class="now-playing-art"></div>
    {/if}
    <div class="now-playing-info">
      <div class="now-playing-label">Now Playing</div>
      <div class="now-playing-track">{data.track.name}</div>
      <div class="now-playing-artist">{data.track.artists.map(a => a.name).join(', ')}</div>
    </div>
  </div>
{/if}
