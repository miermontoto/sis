<script lang="ts">
  import { api, type NowPlayingResponse } from '$lib/api';
  import { onMount } from 'svelte';

  let data = $state<NowPlayingResponse | null>(null);
  let acting = $state(false);

  async function poll() {
    try {
      data = await api.nowPlaying();
    } catch {
      data = null;
    }
  }

  async function pollLive() {
    try {
      data = await api.nowPlayingLive();
    } catch {
      // fallback a cache si live falla
      await poll();
    }
  }

  async function togglePlay() {
    if (!data || acting) return;
    acting = true;
    try {
      if (data.isPlaying) {
        await api.playbackPause();
        data.isPlaying = false;
      } else {
        await api.playbackPlay();
        data.isPlaying = true;
      }
    } catch {} finally {
      acting = false;
    }
  }

  async function next() {
    if (acting) return;
    acting = true;
    try {
      await api.playbackNext();
      // esperar a que Spotify procese y re-poll en vivo
      setTimeout(pollLive, 500);
    } catch {} finally {
      acting = false;
    }
  }

  async function previous() {
    if (acting) return;
    acting = true;
    try {
      await api.playbackPrevious();
      setTimeout(pollLive, 500);
    } catch {} finally {
      acting = false;
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
    <div class="now-playing-controls">
      <button class="ctrl-btn" title="Previous" disabled={acting} onclick={previous}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg>
      </button>
      <button class="ctrl-btn ctrl-btn--play" title={data.isPlaying ? 'Pause' : 'Play'} disabled={acting} onclick={togglePlay}>
        {#if data.isPlaying}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6zm8-14v14h4V5z"/></svg>
        {:else}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        {/if}
      </button>
      <button class="ctrl-btn" title="Next" disabled={acting} onclick={next}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6zm8.5 0h2V6h-2z"/></svg>
      </button>
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
  .now-playing-controls {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    margin-left: auto;
    flex-shrink: 0;
  }
  .ctrl-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    padding: 0.3rem;
    border-radius: 50%;
    transition: color 0.15s, background 0.15s;
  }
  .ctrl-btn:hover:not(:disabled) {
    color: var(--text);
    background: rgba(255, 255, 255, 0.08);
  }
  .ctrl-btn--play {
    color: var(--text);
    background: rgba(255, 255, 255, 0.06);
    padding: 0.4rem;
  }
  .ctrl-btn--play:hover:not(:disabled) {
    color: var(--accent);
    background: rgba(29, 185, 84, 0.15);
  }
  .ctrl-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }
</style>
