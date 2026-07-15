<script lang="ts">
  import { api } from '$lib/api';
  import { nowPlayingStore } from '$lib/stores/now-playing.svelte';
  import { formatClock } from '$lib/utils/format';

  // salto con las flechas del teclado sobre la barra de progreso
  const SEEK_STEP_MS = 5_000;
  import DevicePicker from './DevicePicker.svelte';
  import IconPrev from '$lib/icons/IconPrev.svelte';
  import IconPause from '$lib/icons/IconPause.svelte';
  import IconPlay from '$lib/icons/IconPlay.svelte';
  import IconNext from '$lib/icons/IconNext.svelte';
  import IconHeartFilled from '$lib/icons/IconHeartFilled.svelte';
  import IconHeartOutline from '$lib/icons/IconHeartOutline.svelte';
  import IconVolume from '$lib/icons/IconVolume.svelte';
  import PlaylistPopover from './PlaylistPopover.svelte';

  let { compact = false, inline = false, rail = false }: { compact?: boolean; inline?: boolean; rail?: boolean } = $props();

  let acting = $state(false);
  let showDevices = $state(false);
  let trackEl = $state<HTMLElement | null>(null);
  let overflows = $state(false);
  let showVolume = $state(false);

  let data = $derived(nowPlayingStore.data);
  let vol = $derived(nowPlayingStore.volumePercent);
  let volIcon = $derived<0 | 1 | 2>(vol === null || vol === 0 ? 0 : vol < 50 ? 1 : 2);
  // usuarios solo-last.fm: sin token de spotify no hay controles (read-only)
  let controllable = $derived(data?.controllable !== false);

  // tick de 1s para animar el progreso extrapolado mientras suena
  let nowMs = $state(Date.now());
  $effect(() => {
    if (!data?.playing || !data.isPlaying) return;
    nowMs = Date.now();
    const id = setInterval(() => { nowMs = Date.now(); }, 1000);
    return () => clearInterval(id);
  });
  let progressMs = $derived(nowPlayingStore.progressMsAt(nowMs));
  let progressPct = $derived(
    progressMs != null && data?.track?.durationMs ? Math.min(100, (progressMs / data.track.durationMs) * 100) : null
  );

  // scrubbing: mientras se arrastra, la barra y el tiempo siguen al puntero;
  // al soltar se hace el seek real
  let barEl = $state<HTMLElement | null>(null);
  let scrubPct = $state<number | null>(null);
  let shownPct = $derived(scrubPct ?? progressPct);
  let shownMs = $derived(
    scrubPct != null && data?.track?.durationMs ? (scrubPct / 100) * data.track.durationMs : progressMs
  );

  function pctFromPointer(e: PointerEvent): number {
    const rect = barEl!.getBoundingClientRect();
    return Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
  }

  function scrubStart(e: PointerEvent) {
    if (!barEl || !data?.track?.durationMs) return;
    barEl.setPointerCapture(e.pointerId);
    scrubPct = pctFromPointer(e);
  }

  function scrubMove(e: PointerEvent) {
    if (scrubPct !== null) scrubPct = pctFromPointer(e);
  }

  function scrubEnd(e: PointerEvent) {
    if (scrubPct === null || !data?.track?.durationMs) return;
    nowPlayingStore.seek((pctFromPointer(e) / 100) * data.track.durationMs);
    scrubPct = null;
  }

  function scrubKey(e: KeyboardEvent) {
    if (progressMs == null) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); nowPlayingStore.seek(progressMs + SEEK_STEP_MS); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); nowPlayingStore.seek(progressMs - SEEK_STEP_MS); }
  }

  $effect(() => {
    void data?.track?.name;
    if (!trackEl) { overflows = false; return; }
    overflows = false;
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

{#snippet progressRow()}
  {#if shownPct != null && shownMs != null && data?.track?.durationMs}
    <div class="np-progress-row">
      <span class="np-time">{formatClock(shownMs)}</span>
      <div
        class="np-progress"
        class:np-progress--scrubbing={scrubPct !== null}
        bind:this={barEl}
        role="slider"
        tabindex="0"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={data.track.durationMs}
        aria-valuenow={Math.round(shownMs)}
        aria-valuetext="{formatClock(shownMs)} of {formatClock(data.track.durationMs)}"
        onpointerdown={scrubStart}
        onpointermove={scrubMove}
        onpointerup={scrubEnd}
        onpointercancel={() => scrubPct = null}
        onkeydown={scrubKey}
      >
        <div class="np-progress-track">
          <div class="np-progress-fill" style="width: {shownPct.toFixed(2)}%"></div>
        </div>
      </div>
      <span class="np-time">{formatClock(data.track.durationMs)}</span>
    </div>
  {/if}
{/snippet}

<!-- variante rail: tira fina no interactiva en el filo inferior (sin sitio
     para tiempos ni target de scrub decente en 64px) -->
{#snippet progressStrip()}
  {#if progressPct != null}
    <div class="np-progress-strip">
      <div class="np-progress-fill" style="width: {progressPct.toFixed(2)}%"></div>
    </div>
  {/if}
{/snippet}

{#if data?.playing && data.track}
  {#if rail}
    <!-- variante rail (sidebar colapsada): solo carátula + controles de
         transporte en vertical. sin info, volumen, like ni popovers (que se
         recortarían en un rail de 64px con overflow oculto). -->
    <div class="np np--rail">
      {#if data.track.album?.imageUrl}
        <a href="/album/{data.track.album.id}" class="np-art-link" title={data.track.name}>
          <img class="np-art" src={data.track.album.imageUrl} alt={data.track.album.name} />
          {#if data.isPlaying}
            <div class="np-eq"><span></span><span></span><span></span></div>
          {/if}
        </a>
      {:else}
        <div class="np-art"></div>
      {/if}
      {#if controllable}
        <div class="np-controls np-controls--vertical">
          <button class="ctrl-btn" title="Previous" disabled={acting} onclick={previous}><IconPrev /></button>
          <button class="ctrl-btn ctrl-btn--play" title={data.isPlaying ? 'Pause' : 'Play'} disabled={acting} onclick={togglePlay}>
            {#if data.isPlaying}<IconPause />{:else}<IconPlay />{/if}
          </button>
          <button class="ctrl-btn" title="Next" disabled={acting} onclick={next}><IconNext /></button>
        </div>
      {/if}
      {@render progressStrip()}
    </div>
  {:else}
  <div class="np" class:np--compact={compact} class:np--inline={inline}>
    <div class="np-row-info">
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
    </div>
    {#if controllable}
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
      {#if vol !== null}
        <div class="np-volume" class:np-volume--open={showVolume}>
          <button
            class="ctrl-btn ctrl-btn--vol"
            class:ctrl-btn--muted={vol === 0}
            title="Volume: {vol}%"
            onclick={() => showVolume = !showVolume}
          >
            <IconVolume size={14} level={volIcon} />
          </button>
          {#if showVolume}
            <input
              type="range"
              class="vol-slider"
              min="0"
              max="100"
              value={vol}
              oninput={(e) => nowPlayingStore.setVolume(Number((e.target as HTMLInputElement).value))}
            />
          {/if}
        </div>
      {/if}
      <PlaylistPopover
        trackId={data?.track?.id ?? null}
        inPlaylists={nowPlayingStore.playlists}
        onAdd={(pl) => { nowPlayingStore.playlists = [...nowPlayingStore.playlists, pl]; }}
        onRemove={(id) => { nowPlayingStore.playlists = nowPlayingStore.playlists.filter(p => p.id !== id); }}
      >
        {#snippet likeButton()}
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
        {/snippet}
      </PlaylistPopover>
    </div>
    {/if}
    {@render progressRow()}
  </div>
  {/if}
{/if}

<style>
  .np {
    position: relative;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem;
    background: linear-gradient(135deg, rgba(29, 185, 84, 0.08), rgba(29, 185, 84, 0.02));
    border: 1px solid rgba(29, 185, 84, 0.15);
    border-radius: var(--radius);
  }

  /* fila de progreso: transcurrido — barra scrubbable — duración. el ancho
     del fill se recalcula cada tick y la transición lineal lo desliza */
  .np-progress-row {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    width: 100%;
  }

  .np-time {
    font-size: 0.62rem;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }

  /* la pista visible mide 4px; el padding vertical amplía el target de
     click/touch sin engordar el diseño */
  .np-progress {
    flex: 1;
    min-width: 0;
    padding: 5px 0;
    cursor: pointer;
    touch-action: none;
  }

  .np-progress:focus-visible {
    outline: none;
  }

  .np-progress:focus-visible .np-progress-track {
    outline: 1px solid var(--accent);
    outline-offset: 2px;
  }

  .np-progress-track {
    height: 4px;
    border-radius: 2px;
    overflow: hidden;
    background: rgba(29, 185, 84, 0.15);
  }

  .np-progress-fill {
    height: 100%;
    background: var(--accent);
    transition: width 1s linear;
  }

  .np-progress--scrubbing .np-progress-fill {
    transition: none;
  }

  /* variante rail: tira fina pegada al filo inferior de la card */
  .np-progress-strip {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 3px;
    border-radius: 0 0 var(--radius) var(--radius);
    overflow: hidden;
    background: rgba(29, 185, 84, 0.15);
  }

  .np--compact {
    flex-direction: column;
    align-items: stretch;
    gap: 0.5rem;
    padding: 0.6rem;
  }

  /* variante rail: carátula a todo el ancho + controles verticales bajo ella */
  .np--rail {
    flex-direction: column;
    align-items: center;
    gap: 0.4rem;
    padding: 0.4rem;
  }

  .np--rail .np-art-link {
    width: 100%;
    display: block;
  }

  .np--rail .np-art {
    width: 100%;
    height: auto;
    aspect-ratio: 1;
    border-radius: var(--radius);
  }

  .np-controls--vertical {
    flex-direction: column;
    gap: 0.1rem;
  }

  .np--compact:not(.np--inline) .np-art {
    width: 100%;
    height: auto;
    aspect-ratio: 1;
    border-radius: var(--radius);
  }

  .np--inline {
    flex-direction: column;
    align-items: stretch;
    gap: 0.4rem;
    padding: 0.5rem;
  }

  .np--inline .np-art {
    width: 32px;
    height: 32px;
  }

  .np--inline .np-eq {
    height: 8px;
    bottom: 2px;
    left: 2px;
  }

  .np--inline .np-eq span {
    width: 2px;
  }

  .np--inline .np-track {
    font-size: 0.78rem;
  }

  .np--inline .np-artist {
    font-size: 0.68rem;
  }

  .np--inline .np-actions {
    gap: 0.15rem;
    justify-content: center;
  }

  .np--inline .ctrl-btn {
    min-width: 24px;
    min-height: 24px;
    padding: 0.2rem;
  }

  .np--inline .ctrl-btn--play {
    min-width: 28px;
    min-height: 28px;
  }

  .np-row-info {
    display: contents;
  }

  .np--inline .np-row-info {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
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
    transition: color 0.05s, background 0.05s;
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

  .ctrl-btn--muted {
    color: var(--text-muted);
    opacity: 0.6;
  }

  .np-volume {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .vol-slider {
    width: 70px;
    height: 4px;
    -webkit-appearance: none;
    appearance: none;
    background: var(--border);
    border-radius: 2px;
    outline: none;
    cursor: pointer;
  }

  .vol-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--text);
    cursor: pointer;
    transition: background 0.1s;
  }

  .vol-slider::-moz-range-thumb {
    width: 12px;
    height: 12px;
    border: none;
    border-radius: 50%;
    background: var(--text);
    cursor: pointer;
  }

  .vol-slider:hover::-webkit-slider-thumb {
    background: var(--accent);
  }

  .vol-slider:hover::-moz-range-thumb {
    background: var(--accent);
  }

  .np--inline .vol-slider {
    width: 50px;
  }

  .np--compact .np-volume {
    order: -1;
  }
</style>
