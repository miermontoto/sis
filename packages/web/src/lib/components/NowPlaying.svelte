<script lang="ts">
  import { api } from '$lib/api';
  import { nowPlayingStore } from '$lib/stores/now-playing.svelte';
  import DevicePicker from './DevicePicker.svelte';
  import IconPrev from '$lib/icons/IconPrev.svelte';
  import IconPause from '$lib/icons/IconPause.svelte';
  import IconPlay from '$lib/icons/IconPlay.svelte';
  import IconNext from '$lib/icons/IconNext.svelte';
  import IconHeartFilled from '$lib/icons/IconHeartFilled.svelte';
  import IconHeartOutline from '$lib/icons/IconHeartOutline.svelte';

  let { compact = false }: { compact?: boolean } = $props();

  let acting = $state(false);
  let showDevices = $state(false);
  let trackEl = $state<HTMLElement | null>(null);
  let overflows = $state(false);

  let data = $derived(nowPlayingStore.data);

  $effect(() => {
    void data?.track?.name;
    if (!trackEl) { overflows = false; return; }
    requestAnimationFrame(() => {
      if (trackEl) overflows = trackEl.scrollWidth > trackEl.clientWidth;
    });
  });

  async function togglePlay() {
    if (!data || acting) return;
    acting = true;
    try {
      if (data.isPlaying) {
        await api.playbackPause();
        nowPlayingStore.data = { ...data, isPlaying: false };
      } else {
        await api.playbackPlay();
        nowPlayingStore.data = { ...data, isPlaying: true };
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
      setTimeout(() => nowPlayingStore.pollLive(), 500);
    } catch {} finally {
      acting = false;
    }
  }

  async function previous() {
    if (acting) return;
    acting = true;
    try {
      await api.playbackPrevious();
      setTimeout(() => nowPlayingStore.pollLive(), 500);
    } catch {} finally {
      acting = false;
    }
  }
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
      <a href="/track/{data.track.id}" class="np-track" bind:this={trackEl} class:np-track--marquee={overflows}><span class="np-track-text">{data.track.name}</span></a>
      <div class="np-artist">
        {#each data.track.artists as artist, i}
          <a href="/artist/{artist.id}" class="np-artist-link">{artist.name}</a>{#if i < data.track.artists.length - 1}{', '}{/if}
        {/each}
      </div>
    </div>
    <div class="np-actions">
      <DevicePicker bind:show={showDevices} />
      <div class="np-controls">
        <button class="ctrl-btn" title="Previous" disabled={acting} onclick={previous}>
          <IconPrev />
        </button>
        <button class="ctrl-btn ctrl-btn--play" title={data.isPlaying ? 'Pause' : 'Play'} disabled={acting} onclick={togglePlay}>
          {#if data.isPlaying}
            <IconPause />
          {:else}
            <IconPlay />
          {/if}
        </button>
        <button class="ctrl-btn" title="Next" disabled={acting} onclick={next}>
          <IconNext />
        </button>
      </div>
      <button
        class="ctrl-btn ctrl-btn--like"
        class:ctrl-btn--liked={nowPlayingStore.isLiked}
        title={nowPlayingStore.likeLoading ? 'Loading...' : nowPlayingStore.isLiked ? 'Remove from Liked Songs' : 'Save to Liked Songs'}
        disabled={nowPlayingStore.likeLoading}
        onclick={() => nowPlayingStore.toggleLike()}
      >
        {#if nowPlayingStore.likeLoading}
          <span class="btn-spinner"></span>
        {:else if nowPlayingStore.isLiked}
          <IconHeartFilled size={14} />
        {:else}
          <IconHeartOutline size={14} />
        {/if}
      </button>
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
    border-radius: var(--radius);
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
    border-radius: var(--radius);
  }

  .np-art-link {
    position: relative;
    flex-shrink: 0;
  }

  .np-art {
    width: 48px;
    height: 48px;
    border-radius: var(--radius);
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
    width: 2.5px;
    background: var(--accent);
    border-radius: 1px;
    transform-origin: bottom;
  }

  .np-eq span:nth-child(1) { animation: eq1 1.2s ease-in-out infinite; }
  .np-eq span:nth-child(2) { animation: eq2 1.0s ease-in-out infinite; }
  .np-eq span:nth-child(3) { animation: eq3 1.4s ease-in-out infinite; }

  @keyframes eq1 {
    0%, 100% { height: 25%; }
    30% { height: 90%; }
    60% { height: 40%; }
  }

  @keyframes eq2 {
    0%, 100% { height: 50%; }
    20% { height: 35%; }
    50% { height: 100%; }
    80% { height: 45%; }
  }

  @keyframes eq3 {
    0%, 100% { height: 35%; }
    25% { height: 75%; }
    55% { height: 25%; }
    75% { height: 85%; }
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

  .np-track--marquee {
    text-overflow: clip;
    mask-image: linear-gradient(to right, transparent 0, #000 4%, #000 96%, transparent 100%);
  }

  .np-track--marquee .np-track-text {
    display: inline-block;
    padding-left: 100%;
    animation: marquee 10s linear infinite;
  }

  @keyframes marquee {
    0% { transform: translateX(0); }
    100% { transform: translateX(-100%); }
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
    gap: 0.3rem;
    flex-shrink: 0;
  }

  .np--compact .np-actions {
    justify-content: center;
  }

  .np-controls {
    display: flex;
    align-items: center;
    gap: 0.15rem;
  }

  .ctrl-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    padding: 0.35rem;
    border-radius: var(--radius);
    transition: color 0.15s, background 0.15s;
    min-width: 30px;
    min-height: 30px;
  }

  .ctrl-btn:hover:not(:disabled) {
    color: var(--text);
    background: var(--bg-hover);
  }

  .ctrl-btn--play {
    color: var(--text);
    background: rgba(255, 255, 255, 0.06);
    min-width: 34px;
    min-height: 34px;
  }

  .ctrl-btn--play:hover:not(:disabled) {
    color: var(--accent);
    background: rgba(29, 185, 84, 0.12);
  }

  .ctrl-btn--like:hover:not(:disabled) {
    color: #ff4b7a;
    background: rgba(255, 75, 122, 0.1);
  }

  .ctrl-btn--liked {
    color: #ff4b7a;
  }

  .ctrl-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }
</style>
