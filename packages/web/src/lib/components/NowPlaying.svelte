<script lang="ts">
  import { untrack } from 'svelte';
  import { api } from '$lib/api';
  import { nowPlayingStore } from '$lib/stores/now-playing.svelte';
  import { formatClock } from '$lib/utils/format';
  import { marquee } from '$lib/utils/marquee';

  // salto con las flechas del teclado sobre la barra de progreso
  const SEEK_STEP_MS = 5_000;
  // antelación con la que asoma el siguiente tema: el tramo final del actual
  const UP_NEXT_LEAD_MS = 20_000;
  import DevicePicker from './DevicePicker.svelte';
  import IconPrev from '$lib/icons/IconPrev.svelte';
  import IconPause from '$lib/icons/IconPause.svelte';
  import IconPlay from '$lib/icons/IconPlay.svelte';
  import IconNext from '$lib/icons/IconNext.svelte';
  import IconHeartFilled from '$lib/icons/IconHeartFilled.svelte';
  import IconHeartOutline from '$lib/icons/IconHeartOutline.svelte';
  import IconVolume from '$lib/icons/IconVolume.svelte';
  import IconChevronRight from '$lib/icons/IconChevronRight.svelte';
  import PlaylistPopover from './PlaylistPopover.svelte';
import { playlistMembershipStore } from '$lib/stores/playlist-membership.svelte';
  import LiveEq from './LiveEq.svelte';

  import type { Snippet } from 'svelte';

  // qué parte de la hoja abre el mini player: el reproductor, o la sesión si se
  // pulsa su línea (un elemento con data-open="session" dentro del área)
  type SheetSection = 'player' | 'session';

  // mini: la barra del móvil sobre las pestañas; pulsarla abre la hoja (onopen).
  // sheet: el reproductor completo de esa hoja, que cierra con onclose.
  // sessionLine: tercera línea del mini player (el resumen de la sesión)
  // column: la tarjeta en la columna del iPhone Duo, donde el rail nativo lleva la
  // nav y el sidebar queda para el reproductor: el siguiente tema es una fila fija
  // (no se asoma) y en reposo enseña el último tema, en pausa, para retomarlo
  let { compact = false, inline = false, rail = false, mini = false, sheet = false, column = false, onopen, onclose, sessionLine }: {
    compact?: boolean; inline?: boolean; rail?: boolean; mini?: boolean; sheet?: boolean; column?: boolean;
    onopen?: (section: SheetSection) => void; onclose?: () => void; sessionLine?: Snippet;
  } = $props();

  function openFrom(e: MouseEvent) {
    const section = (e.target as HTMLElement).closest<HTMLElement>('[data-open]')?.dataset.open;
    onopen?.(section === 'session' ? 'session' : 'player');
  }

  let acting = $state(false);
  let showDevices = $state(false);
  let showVolume = $state(false);

  let data = $derived(nowPlayingStore.data);
  let vol = $derived(nowPlayingStore.volumePercent);
  let volIcon = $derived<0 | 1 | 2>(vol === null || vol === 0 ? 0 : vol < 50 ? 1 : 2);
  // usuarios solo-last.fm: sin token de spotify no hay controles (read-only)
  let controllable = $derived(data?.controllable !== false);

  // reposo de la columna: sólo con la primera respuesta ya leída (sin ella aún no
  // se sabe si suena algo) y en untrack, porque ensureLastTrack escribe lo que lee
  let idle = $derived(column && !!data && !data.playing);
  let lastTrack = $derived(idle ? nowPlayingStore.lastTrack : null);
  $effect(() => {
    if (idle) untrack(() => nowPlayingStore.ensureLastTrack());
  });

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

  // la cola se lee una vez por tema, y esa lectura puede haberse medido justo
  // antes del corte: entonces trae el tema que suena en cabeza y el siguiente
  // detrás. El primero que no sea el actual es el siguiente de verdad en los
  // dos casos, así que no hace falta reintentar la petición
  let upNext = $derived(nowPlayingStore.queue.find(t => t.id !== data?.track?.id) ?? null);
  // y solo se asoma cuando el tema actual está acabando: en pausa no está a
  // punto de empezar nada
  let upNextDue = $derived(
    !!data?.isPlaying && progressMs != null && !!data.track?.durationMs &&
    data.track.durationMs - progressMs <= UP_NEXT_LEAD_MS
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

<!-- siguiente tema: superpuesto al filo de la carátula o, en la columna del
     Duo, como fila fija bajo el progreso -->
{#snippet upNextLine(row: boolean)}
  {#if upNext}
    <div class="np-next" class:np-next--row={row}>
      <span class="np-next-label">next</span>
      {#if upNext.album?.imageUrl}
        {#if upNext.album.known}
          <a href="/album/{upNext.album.id}" class="np-next-art-link"><img class="np-next-art" src={upNext.album.imageUrl} alt={upNext.album.name} /></a>
        {:else}
          <img class="np-next-art" src={upNext.album.imageUrl} alt={upNext.album.name} />
        {/if}
      {/if}
      <span class="np-next-text marquee-line" use:marquee={upNext.id}>
        <span>{#if upNext.known}<a class="np-next-link" href="/track/{upNext.id}">{upNext.name}</a>{:else}{upNext.name}{/if}{#if upNext.artists.length}<span class="np-next-artists">{' · '}{#each upNext.artists as artist, i}{#if artist.known}<a class="np-next-link" href="/artist/{artist.id}">{artist.name}</a>{:else}{artist.name}{/if}{#if i < upNext.artists.length - 1}{', '}{/if}{/each}</span>{/if}</span>
      </span>
    </div>
  {/if}
{/snippet}

{#snippet likeBtn(cls: string, size = 14)}
  <button
    class={cls}
    class:ctrl-btn--liked={nowPlayingStore.isLiked}
    title={nowPlayingStore.likeLoading ? 'Loading...' : nowPlayingStore.isLiked ? 'Remove from Liked Songs' : 'Save to Liked Songs'}
    disabled={nowPlayingStore.likeLoading}
    onclick={() => nowPlayingStore.toggleLike()}
  >
    {#if nowPlayingStore.likeLoading}
      <span class="btn-spinner"></span>
    {:else if nowPlayingStore.isLiked}
      <IconHeartFilled {size} />
    {:else}
      <IconHeartOutline {size} />
    {/if}
  </button>
{/snippet}

{#snippet volumeSlider()}
  <input
    type="range"
    class="vol-slider"
    min="0"
    max="100"
    value={vol}
    aria-label="Volume"
    oninput={(e) => nowPlayingStore.setVolume(Number((e.target as HTMLInputElement).value))}
  />
{/snippet}

{#if data?.playing && data.track}
  {#if mini}
    <!-- barra del móvil: el área de carátula y texto abre la hoja; los botones
         van fuera de ella, así que no hay controles anidados en otro control -->
    <div class="np-mini">
      {@render progressStrip()}
      <button type="button" class="np-mini-open" aria-label="Open now playing" onclick={openFrom}>
        <span class="np-mini-art">
          {#if data.track.album?.imageUrl}
            <img class="np-mini-img" src={data.track.album.imageUrl} alt="" />
          {:else}
            <span class="np-mini-img"></span>
          {/if}
          {#if data.isPlaying}<LiveEq />{/if}
        </span>
        <span class="np-mini-info">
          <span class="np-mini-track">{data.track.name}</span>
          <span class="np-mini-artist">{data.track.artists.map(a => a.name).join(', ')}</span>
          {@render sessionLine?.()}
        </span>
      </button>
      {#if controllable}
        {@render likeBtn('np-mini-btn ctrl-btn--like')}
        <button class="np-mini-btn np-mini-btn--play" title={data.isPlaying ? 'Pause' : 'Play'} disabled={acting} onclick={togglePlay}>
          {#if data.isPlaying}<IconPause size={18} />{:else}<IconPlay size={18} />{/if}
        </button>
        <button class="np-mini-btn" title="Next" disabled={acting} onclick={next}><IconNext size={14} /></button>
      {/if}
    </div>
  {:else if sheet}
    <!-- reproductor completo de la hoja móvil: lo mismo que la tarjeta de
         escritorio (scrub, volumen, dispositivos, playlists, siguiente) a tamaño táctil -->
    <div class="np-sheet">
      <div class="np-sheet-top">
        <button type="button" class="ctrl-btn np-sheet-close" title="Close" aria-label="Close now playing" onclick={() => onclose?.()}>
          <IconChevronRight size={18} />
        </button>
        <span class="np-sheet-label">
          Now playing
          {#if data.track.album}<a href="/album/{data.track.album.id}" class="np-sheet-album">{data.track.album.name}</a>{/if}
        </span>
        {#if controllable}<DevicePicker bind:show={showDevices} />{:else}<span class="np-sheet-spacer"></span>{/if}
      </div>
      {#if data.track.album?.imageUrl}
        <a href="/album/{data.track.album.id}" class="np-sheet-art-link">
          <img class="np-sheet-art" src={data.track.album.imageUrl} alt={data.track.album.name} />
        </a>
      {/if}
      <div class="np-sheet-title">
        <div class="np-sheet-title-text">
          <a href="/track/{data.track.id}" class="np-sheet-track marquee-line" use:marquee={data.track.name}><span>{data.track.name}</span></a>
          <div class="np-sheet-artists marquee-line" use:marquee={data.track.id}>
            <span>{#each data.track.artists as artist, i}<a href="/artist/{artist.id}" class="np-artist-link">{artist.name}</a>{#if i < data.track.artists.length - 1}{', '}{/if}{/each}</span>
          </div>
        </div>
        {#if controllable}
          <PlaylistPopover
            trackId={data.track.id}
            inPlaylists={nowPlayingStore.playlists}
            onAdd={(pl) => { if (data?.track) playlistMembershipStore.add(data.track.id, pl); }}
            onRemove={(id) => { if (data?.track) playlistMembershipStore.remove(data.track.id, id); }}
          >
            {#snippet likeButton()}{@render likeBtn('ctrl-btn ctrl-btn--like', 18)}{/snippet}
          </PlaylistPopover>
        {/if}
      </div>
      {@render progressRow()}
      {#if controllable}
        <div class="np-sheet-controls">
          {#if vol !== null}
            <button
              class="ctrl-btn ctrl-btn--vol"
              class:ctrl-btn--muted={vol === 0}
              class:np-sheet-on={showVolume}
              title="Volume: {vol}%"
              aria-expanded={showVolume}
              onclick={() => showVolume = !showVolume}
            >
              <IconVolume size={18} level={volIcon} />
            </button>
          {:else}
            <span class="np-sheet-spacer"></span>
          {/if}
          <button class="ctrl-btn np-sheet-skip" title="Previous" disabled={acting} onclick={previous}><IconPrev size={22} /></button>
          <button class="np-sheet-play" title={data.isPlaying ? 'Pause' : 'Play'} disabled={acting} onclick={togglePlay}>
            {#if data.isPlaying}<IconPause size={24} />{:else}<IconPlay size={24} />{/if}
          </button>
          <button class="ctrl-btn np-sheet-skip" title="Next" disabled={acting} onclick={next}><IconNext size={22} /></button>
          <span class="np-sheet-spacer"></span>
        </div>
        {#if showVolume && vol !== null}
          <div class="np-sheet-volume">{@render volumeSlider()}<span class="np-time">{vol}%</span></div>
        {/if}
      {/if}
      {#if upNext}
        <div class="np-sheet-next">
          {#if upNext.album?.imageUrl}
            {#if upNext.album.known}
              <a href="/album/{upNext.album.id}"><img class="np-sheet-next-art" src={upNext.album.imageUrl} alt={upNext.album.name} /></a>
            {:else}
              <img class="np-sheet-next-art" src={upNext.album.imageUrl} alt={upNext.album.name} />
            {/if}
          {/if}
          <div class="np-sheet-next-info">
            <span class="np-next-label">Up next</span>
            <span class="np-sheet-next-name">{#if upNext.known}<a class="np-next-link" href="/track/{upNext.id}">{upNext.name}</a>{:else}{upNext.name}{/if}</span>
            {#if upNext.artists.length}
              <span class="np-next-artists">{#each upNext.artists as artist, i}{#if artist.known}<a class="np-next-link" href="/artist/{artist.id}">{artist.name}</a>{:else}{artist.name}{/if}{#if i < upNext.artists.length - 1}{', '}{/if}{/each}</span>
            {/if}
          </div>
        </div>
      {/if}
    </div>
  {:else if rail}
    <!-- variante rail (sidebar colapsada): solo carátula + controles de
         transporte en vertical. sin info, volumen, like ni popovers (que se
         recortarían en un rail de 64px con overflow oculto). -->
    <div class="np np--rail">
      {#if data.track.album?.imageUrl}
        <a href="/album/{data.track.album.id}" class="np-art-link" title={data.track.name}>
          <img class="np-art" src={data.track.album.imageUrl} alt={data.track.album.name} />
          {#if data.isPlaying}
            <LiveEq />
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
  <div class="np" class:np--compact={compact} class:np--inline={inline} class:np--column={column}>
    <div class="np-row-info">
      <div class="np-art-wrap">
        {#if data.track.album?.imageUrl}
          <a href="/album/{data.track.album.id}" class="np-art-link">
            <img class="np-art" src={data.track.album.imageUrl} alt={data.track.album.name} />
            {#if data.isPlaying}
              <LiveEq />
            {/if}
          </a>
        {:else}
          <div class="np-art"></div>
        {/if}
        <!-- siguiente tema: se superpone al filo de la carátula, nunca en el
             flujo — asomarse no puede recolocar el resto del sidebar. En la
             columna del Duo va fijo debajo, que ahí el sitio sobra -->
        {#if upNextDue && !inline && !column}{@render upNextLine(false)}{/if}
      </div>
      <div class="np-info">
        <a href="/track/{data.track.id}" class="np-track marquee-line" use:marquee={data.track.name}><span>{data.track.name}</span></a>
        <div class="np-artist marquee-line" use:marquee={data.track.id}>
          <span>
            {#each data.track.artists as artist, i}
              <a href="/artist/{artist.id}" class="np-artist-link">{artist.name}</a>{#if i < data.track.artists.length - 1}{', '}{/if}
            {/each}
          </span>
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
          {#if showVolume}{@render volumeSlider()}{/if}
        </div>
      {/if}
      <PlaylistPopover
        trackId={data?.track?.id ?? null}
        inPlaylists={nowPlayingStore.playlists}
        onAdd={(pl) => { if (data?.track) playlistMembershipStore.add(data.track.id, pl); }}
        onRemove={(id) => { if (data?.track) playlistMembershipStore.remove(data.track.id, id); }}
      >
        {#snippet likeButton()}{@render likeBtn('ctrl-btn ctrl-btn--like')}{/snippet}
      </PlaylistPopover>
    </div>
    {/if}
    {@render progressRow()}
    {#if column}{@render upNextLine(true)}{/if}
  </div>
  {/if}
{:else if lastTrack}
  <!-- columna del Duo en reposo: el último tema, en pausa. Elegir dispositivo es
       el camino para retomarlo: sin uno activo spotify no acepta un play a secas -->
  <div class="np np--compact np--idle">
    <span class="np-next-label">Last played</span>
    {#if lastTrack.album?.imageUrl}
      <a href="/album/{lastTrack.album.id}" class="np-art-link"><img class="np-art" src={lastTrack.album.imageUrl} alt={lastTrack.album.name} /></a>
    {:else}
      <div class="np-art"></div>
    {/if}
    <div class="np-info">
      <a href="/track/{lastTrack.id}" class="np-track marquee-line" use:marquee={lastTrack.name}><span>{lastTrack.name}</span></a>
      <div class="np-artist marquee-line" use:marquee={lastTrack.id}>
        <span>{#each lastTrack.artists as artist, i}<a href="/artist/{artist.id}" class="np-artist-link">{artist.name}</a>{#if i < lastTrack.artists.length - 1}{', '}{/if}{/each}</span>
      </div>
    </div>
    {#if controllable}
      <DevicePicker bind:show={showDevices} label="Play on…" ontransfer={() => nowPlayingStore.refreshAfterPlayback()} />
    {/if}
  </div>
{/if}

<style>
  .np {
    position: relative;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem;
    background: linear-gradient(135deg, var(--accent-a10), var(--accent-a05));
    border: 1px solid var(--accent-a15);
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
    font-size: var(--fs-2xs);
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
    background: var(--accent-a15);
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
    background: var(--accent-a15);
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

  /* la columna suma la fila del siguiente tema y tiene que caber entera en el
     alto del Duo abierto (669pt) junto a amigos, sesión y badge */
  .np--column {
    gap: 0.4rem;
  }

  /* reposo: sin el degradado de acento, que en la app significa "suena ahora" */
  .np--idle {
    background: none;
    border-color: var(--border);
  }

  .np--idle .np-art {
    opacity: 0.6;
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

  .np--inline :global(.live-eq) {
    height: 8px;
    bottom: 2px;
    left: 2px;
  }

  .np--inline :global(.live-eq span) {
    width: 2px;
  }

  .np--inline .np-track {
    font-size: var(--fs-sm);
  }

  .np--inline .np-artist {
    font-size: var(--fs-xs);
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

  /* ancla de la superposición del siguiente tema; en la fila inline es además
     quien no encoge */
  .np-art-wrap {
    position: relative;
    flex-shrink: 0;
  }

  .np-art-link {
    display: block;
    position: relative;
  }

  .np-art {
    width: 48px;
    height: 48px;
    border-radius: var(--radius);
    object-fit: cover;
    background: var(--border);
    display: block;
  }

  .np-info {
    flex: 1;
    min-width: 0;
  }

  .np-track {
    display: block;
    font-size: var(--fs-md);
    font-weight: 600;
    color: var(--text);
    text-decoration: none;
  }

  .np-track:hover {
    color: var(--accent);
  }

  /* siguiente en la cola: una línea sobre el filo inferior de la carátula, en
     los últimos UP_NEXT_LEAD_MS del tema. Absoluta a propósito: aparecer y
     desaparecer no puede mover ni un píxel del resto del sidebar (y el ajuste
     vertical mide la tarjeta, así que el hueco reservado le cambiaría el modo).
     La etiqueta y la miniatura se quedan quietas; solo se desplaza el texto,
     que es lo que desborda */
  .np-next {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.2rem 0.3rem;
    border-radius: 0 0 var(--radius) var(--radius);
    background: color-mix(in srgb, var(--bg) 85%, transparent);
    font-size: var(--fs-2xs);
    color: var(--text);
    animation: np-next-in 0.2s ease-out;
  }

  @keyframes np-next-in {
    from { opacity: 0; transform: translateY(100%); }
    to { opacity: 1; transform: translateY(0); }
  }

  /* en la columna del Duo: en el flujo, bajo el progreso, y sin entrada animada
     (está siempre, no se asoma) */
  .np-next--row {
    position: static;
    padding: 0.2rem 0.4rem;
    border-radius: var(--radius);
    animation: none;
  }

  .np-next-label {
    flex-shrink: 0;
    font-size: var(--fs-2xs);
    text-transform: uppercase;
    letter-spacing: var(--track);
    color: var(--text-muted);
  }

  .np-next-art-link {
    display: block;
    flex-shrink: 0;
  }

  .np-next-art {
    width: 16px;
    height: 16px;
    border-radius: 2px;
    object-fit: cover;
    flex-shrink: 0;
    display: block;
  }

  /* mismo trato que los artistas del tema actual: el enlace hereda el color y
     solo se distingue al pasar por encima */
  .np-next-link {
    color: inherit;
    text-decoration: none;
  }

  .np-next-link:hover {
    color: var(--accent);
  }

  .np-next-text {
    flex: 1;
    min-width: 0;
  }

  .np-next-artists {
    color: var(--text-muted);
  }

  /* el recorte y el marquee los pone `.marquee-line` (app.css): un
     text-overflow aquí, scoped, ganaría al `clip` del marquee */
  .np-artist {
    font-size: var(--fs-sm);
    color: var(--text-muted);
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
    background: var(--fg-a05);
    min-width: 34px;
    min-height: 34px;
  }

  .ctrl-btn--play:hover:not(:disabled) {
    color: var(--accent);
    background: var(--accent-a10);
  }

  .ctrl-btn--like:hover:not(:disabled) {
    color: var(--like);
    background: var(--like-a10);
  }

  .ctrl-btn--liked {
    color: var(--like);
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
  /* variante mini (móvil): la barra sobre las pestañas. el progreso es la tira de
     la variante rail, pegada al filo superior; la carátula y el texto son un
     solo botón que abre la hoja y los controles van fuera de él */
  .np-mini {
    position: relative;
    display: flex;
    align-items: center;
    gap: 0.1rem;
    width: 100%;
    min-height: 44px;
    padding: 0.4rem 0.6rem;
    background: var(--live-bg);
    border-bottom: 1px solid var(--accent-a15);
  }

  .np-mini .np-progress-strip {
    top: 0;
    bottom: auto;
    height: 2px;
    border-radius: 0;
  }

  .np-mini-open {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .np-mini-art {
    position: relative;
    display: block;
    flex-shrink: 0;
  }

  .np-mini-img {
    display: block;
    width: 40px;
    height: 40px;
    border-radius: var(--radius);
    object-fit: cover;
    background: var(--border);
  }

  /* tres líneas (tema, artistas y la de sesión) en el alto de la barra de siempre */
  .np-mini-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
    line-height: 1.25;
  }

  .np-mini-track,
  .np-mini-artist {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .np-mini-track {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text);
  }

  .np-mini-artist {
    font-size: var(--fs-xs);
    color: var(--text-muted);
  }

  .np-mini-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    flex-shrink: 0;
    background: none;
    border: none;
    border-radius: var(--radius);
    color: var(--text-muted);
    cursor: pointer;
    transition: color 0.05s, background 0.05s;
  }

  .np-mini-btn--play {
    width: 44px;
    height: 44px;
    background: var(--fg-a05);
    color: var(--text);
  }

  .np-mini-btn:hover:not(:disabled) {
    color: var(--accent);
    background: var(--accent-a10);
  }

  .np-mini-btn.ctrl-btn--like:hover:not(:disabled) {
    color: var(--like);
    background: var(--like-a10);
  }

  .np-mini-btn.ctrl-btn--liked {
    color: var(--like);
  }

  .np-mini-btn:disabled {
    opacity: 0.4;
  }

  /* variante sheet: el reproductor de la hoja móvil, a tamaño táctil */
  .np-sheet {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .np-sheet .ctrl-btn {
    min-width: 40px;
    min-height: 40px;
  }

  .np-sheet-top {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  /* el chevron de la librería apunta a la derecha: hacia abajo = cerrar */
  .np-sheet-close :global(svg) {
    transform: rotate(90deg);
  }

  .np-sheet-spacer {
    width: 40px;
    flex-shrink: 0;
  }

  .np-sheet-label {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
    letter-spacing: var(--track-wide);
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .np-sheet-album {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-sans);
    font-size: var(--fs-xs);
    letter-spacing: 0;
    text-transform: none;
    color: var(--text);
    text-decoration: none;
  }

  /* la carátula no puede empujar los controles fuera de la primera pantalla */
  .np-sheet-art-link {
    display: block;
    align-self: center;
    width: min(100%, 22rem, 42vh);
  }

  .np-sheet-art {
    display: block;
    width: 100%;
    height: auto;
    aspect-ratio: 1;
    object-fit: cover;
    border-radius: var(--radius);
    background: var(--border);
    box-shadow: 0 18px 40px -18px color-mix(in srgb, var(--shadow-color) 70%, transparent);
  }

  .np-sheet-title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .np-sheet-title-text {
    flex: 1;
    min-width: 0;
  }

  .np-sheet-track {
    display: block;
    font-size: var(--fs-xl);
    font-weight: 700;
    color: var(--text);
    text-decoration: none;
  }

  .np-sheet-artists {
    font-size: var(--fs-md);
    color: var(--text-muted);
  }

  .np-sheet .np-time {
    font-size: var(--fs-xs);
  }

  .np-sheet-controls {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .np-sheet-skip {
    color: var(--text);
  }

  .np-sheet-on {
    color: var(--accent);
  }

  /* mismo botón de play que el de los heroes (.play-entity-btn), a tamaño táctil */
  .np-sheet-play {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 60px;
    height: 60px;
    padding: 0;
    border: none;
    border-radius: var(--radius);
    background: var(--accent);
    color: var(--on-accent);
    cursor: pointer;
  }

  .np-sheet-play:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .np-sheet-play:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .np-sheet-volume {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .np-sheet-volume .vol-slider {
    flex: 1;
    width: auto;
  }

  .np-sheet-next {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    padding: 0.6rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-card);
  }

  .np-sheet-next-art {
    display: block;
    width: 40px;
    height: 40px;
    border-radius: var(--radius);
    object-fit: cover;
  }

  .np-sheet-next-info {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
    font-size: var(--fs-xs);
  }

  .np-sheet-next-name {
    font-size: var(--fs-sm);
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
