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
      <a href="/album/{data.track.album.id}">
        <img class="now-playing-art" src={data.track.album.imageUrl} alt={data.track.album.name} />
      </a>
    {:else}
      <div class="now-playing-art"></div>
    {/if}
    <div class="now-playing-info">
      <div class="now-playing-label">Now Playing</div>
      <a href="/track/{data.track.id}" class="now-playing-track">{data.track.name}</a>
      <div class="now-playing-artist">
        {#each data.track.artists as artist, i}
          <a href="/artist/{artist.id}" class="now-playing-artist-link">{artist.name}</a>{#if i < data.track.artists.length - 1}, {/if}
        {/each}
      </div>
    </div>
  </div>
{/if}

<style>
  .now-playing-track {
    color: inherit;
    text-decoration: none;
  }
  .now-playing-track:hover {
    color: var(--accent);
  }
  .now-playing-artist-link {
    color: inherit;
    text-decoration: none;
  }
  .now-playing-artist-link:hover {
    color: var(--accent);
  }
</style>
