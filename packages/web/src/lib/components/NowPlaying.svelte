<script lang="ts">
  import { api, type NowPlayingResponse } from '$lib/api';
  import { onMount } from 'svelte';

  let { compact = false }: { compact?: boolean } = $props();

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

  let spotifyUrl = $derived(data?.track ? `https://open.spotify.com/track/${data.track.id}` : null);

  onMount(() => {
    poll();
    const interval = setInterval(poll, 10_000);
    return () => clearInterval(interval);
  });
</script>

{#if data?.playing && data.track}
  <div class="np" class:np--compact={compact}>
    {#if data.track.album?.imageUrl}
      <a href="/album/{data.track.album.id}" class="np-art-link">
        <img class="np-art" src={data.track.album.imageUrl} alt={data.track.album.name} />
        {#if data.isPlaying}
          <div class="np-eq">
            <span></span><span></span><span></span>
          </div>
        {/if}
      </a>
    {:else}
      <div class="np-art"></div>
    {/if}
    <div class="np-info">
      <a href="/track/{data.track.id}" class="np-track">{data.track.name}</a>
      <div class="np-artist">
        {#each data.track.artists as artist, i}
          <a href="/artist/{artist.id}" class="np-artist-link">{artist.name}</a>{#if i < data.track.artists.length - 1}{', '}{/if}
        {/each}
      </div>
    </div>
    <div class="np-actions">
      <div class="np-controls">
        <button class="ctrl-btn" title="Previous" disabled={acting} onclick={previous}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg>
        </button>
        <button class="ctrl-btn ctrl-btn--play" title={data.isPlaying ? 'Pause' : 'Play'} disabled={acting} onclick={togglePlay}>
          {#if data.isPlaying}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6zm8-14v14h4V5z"/></svg>
          {:else}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          {/if}
        </button>
        <button class="ctrl-btn" title="Next" disabled={acting} onclick={next}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6zm8.5 0h2V6h-2z"/></svg>
        </button>
      </div>
      {#if spotifyUrl}
        <a href={spotifyUrl} target="_blank" rel="noopener" class="np-spotify" title="Open in Spotify">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>
        </a>
      {/if}
    </div>
  </div>
{/if}

<style>
  .np {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem;
    background: linear-gradient(135deg, rgba(29, 185, 84, 0.08), rgba(29, 185, 84, 0.02));
    border: 1px solid rgba(29, 185, 84, 0.15);
    border-radius: 10px;
  }

  .np--compact {
    flex-direction: column;
    align-items: stretch;
    gap: 0.5rem;
    padding: 0.6rem;
  }

  .np--compact .np-art {
    width: 100%;
    height: auto;
    aspect-ratio: 1;
    border-radius: 6px;
  }

  .np-art-link {
    position: relative;
    flex-shrink: 0;
  }

  .np-art {
    width: 48px;
    height: 48px;
    border-radius: 4px;
    object-fit: cover;
    background: var(--border);
    display: block;
  }

  .np-eq {
    position: absolute;
    bottom: 3px;
    left: 3px;
    display: flex;
    align-items: flex-end;
    gap: 2px;
    height: 12px;
  }

  .np-eq span {
    width: 3px;
    background: var(--accent);
    border-radius: 1px;
    animation: eq-bounce 0.8s ease-in-out infinite alternate;
  }

  .np-eq span:nth-child(1) { height: 40%; animation-delay: 0s; }
  .np-eq span:nth-child(2) { height: 70%; animation-delay: 0.2s; }
  .np-eq span:nth-child(3) { height: 50%; animation-delay: 0.4s; }

  @keyframes eq-bounce {
    0% { transform: scaleY(0.3); }
    100% { transform: scaleY(1); }
  }

  .np-info {
    flex: 1;
    min-width: 0;
  }

  .np-track {
    display: block;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text);
    text-decoration: none;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .np-track:hover {
    color: var(--accent);
  }

  .np-artist {
    font-size: 0.75rem;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .np-artist-link {
    color: inherit;
    text-decoration: none;
  }

  .np-artist-link:hover {
    color: var(--accent);
  }

  .np-actions {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    flex-shrink: 0;
  }

  .np--compact .np-actions {
    justify-content: center;
  }

  .np-controls {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .ctrl-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    padding: 0.5rem;
    border-radius: 50%;
    transition: color 0.15s, background 0.15s;
    min-width: 36px;
    min-height: 36px;
  }

  .ctrl-btn:hover:not(:disabled) {
    color: var(--text);
    background: rgba(255, 255, 255, 0.08);
  }

  .ctrl-btn--play {
    color: var(--text);
    background: rgba(255, 255, 255, 0.06);
    padding: 0.5rem;
    min-width: 40px;
    min-height: 40px;
  }

  .ctrl-btn--play:hover:not(:disabled) {
    color: var(--accent);
    background: rgba(29, 185, 84, 0.15);
  }

  .ctrl-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .np-spotify {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    padding: 0.5rem;
    border-radius: 50%;
    transition: color 0.15s;
    min-width: 36px;
    min-height: 36px;
  }

  .np-spotify:hover {
    color: #1db954;
  }
</style>
