<script lang="ts">
  // lo que suena, con sus controles (los del store, los mismos que la tarjeta del
  // sidebar). small: la carátula con el play encima; medium: carátula, texto,
  // progreso y controles; large: además lo siguiente de la cola. En reposo enseña el
  // último tema, como la columna del reproductor del Duo
  import { untrack } from 'svelte';
  import IconPlay from '$lib/icons/IconPlay.svelte';
  import IconPause from '$lib/icons/IconPause.svelte';
  import IconNext from '$lib/icons/IconNext.svelte';
  import IconPrev from '$lib/icons/IconPrev.svelte';
  import { nowPlayingStore } from '$lib/stores/now-playing.svelte';
  import { openEntityContextMenu, trackEntity } from '$lib/utils/entity-context';
  import { formatClock } from '$lib/utils/format';
  import type { WidgetProps } from '../components';

  let { size }: WidgetProps = $props();

  const TICK_MS = 1000;
  const PCT = 100;

  let data = $derived(nowPlayingStore.data);
  let playing = $derived(!!data?.playing && !!data.track);
  let idle = $derived(!!data && !playing);
  let track = $derived(playing ? data!.track! : idle ? nowPlayingStore.lastTrack : null);
  let controllable = $derived(data?.controllable !== false);
  let next = $derived(nowPlayingStore.queue.find(q => q.id !== track?.id) ?? null);

  // con la primera respuesta ya leída y nada sonando, el último tema (escribe lo que lee: untrack)
  $effect(() => {
    if (idle) untrack(() => nowPlayingStore.ensureLastTrack());
  });

  // progreso extrapolado, con un tick sólo mientras suena
  let nowMs = $state(Date.now());
  $effect(() => {
    if (!playing || !data?.isPlaying) return;
    const id = setInterval(() => { nowMs = Date.now(); }, TICK_MS);
    return () => clearInterval(id);
  });
  let progressMs = $derived(playing ? nowPlayingStore.progressMsAt(nowMs) : null);
  let pct = $derived(progressMs !== null && track?.durationMs ? Math.min(PCT, (progressMs / track.durationMs) * PCT) : 0);
</script>

{#snippet controls(iconSize: number)}
  {#if controllable && playing}
    <div class="np-controls">
      {#if size !== 'small'}
        <button type="button" class="np-btn" title="Previous" disabled={nowPlayingStore.acting} onclick={nowPlayingStore.previous}><IconPrev size={iconSize} /></button>
      {/if}
      <button type="button" class="np-btn np-btn--play" title={data?.isPlaying ? 'Pause' : 'Play'} disabled={nowPlayingStore.acting} onclick={nowPlayingStore.togglePlay}>
        {#if data?.isPlaying}<IconPause size={iconSize} />{:else}<IconPlay size={iconSize} />{/if}
      </button>
      {#if size !== 'small'}
        <button type="button" class="np-btn" title="Next" disabled={nowPlayingStore.acting} onclick={nowPlayingStore.next}><IconNext size={iconSize} /></button>
      {/if}
    </div>
  {/if}
{/snippet}

{#if !track}
  <div class="np-empty">
    <span class="w-caption">Now playing</span>
    <p class="w-empty">{data ? 'Nothing playing right now.' : ''}</p>
  </div>
{:else if size === 'small'}
  <div class="np-small">
    {#if track.album?.imageUrl}<img class="np-small-art" src={track.album.imageUrl} alt="" />{/if}
    <div class="np-small-scrim">
      <a class="np-small-name" href="/track/{track.id}" oncontextmenu={openEntityContextMenu(trackEntity(track))}>{track.name}</a>
      {@render controls(16)}
    </div>
    {#if playing}<span class="np-small-bar" style:width="{pct}%"></span>{/if}
  </div>
{:else}
  <div class="np" class:np--large={size === 'large'}>
    <a class="np-art-link" href={track.album ? `/album/${track.album.id}` : `/track/${track.id}`}>
      {#if track.album?.imageUrl}<img class="np-art" src={track.album.imageUrl} alt="" />{:else}<span class="np-art np-art--empty"></span>{/if}
    </a>
    <div class="np-info">
      <span class="w-caption">{playing ? (data?.isPlaying ? 'Now playing' : 'Paused') : 'Last played'}</span>
      <a class="np-name" href="/track/{track.id}" oncontextmenu={openEntityContextMenu(trackEntity(track))}>{track.name}</a>
      <span class="np-artists">
        {#each track.artists as a, i (a.id)}{#if i > 0}, {/if}<a href="/artist/{a.id}" class="artist-link">{a.name}</a>{/each}
      </span>
      {#if playing && track.durationMs}
        <div class="np-progress">
          <span class="np-time">{formatClock(progressMs ?? 0)}</span>
          <span class="np-bar"><span class="np-bar-fill" style:width="{pct}%"></span></span>
          <span class="np-time">{formatClock(track.durationMs)}</span>
        </div>
      {/if}
      {@render controls(size === 'large' ? 20 : 16)}
      {#if size === 'large' && next}
        <div class="np-next">
          <span class="w-caption">Up next</span>
          <span class="np-next-name">{next.name} · {next.artists.map(a => a.name).join(', ')}</span>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .np-empty {
    flex: 1;
    display: flex;
    flex-direction: column;
  }

  /* small: la carátula a sangre, nombre y play sobre un degradado */
  .np-small {
    position: relative;
    flex: 1;
    min-height: 0;
    margin: calc(var(--widget-pad) * -1);
    display: flex;
    align-items: flex-end;
    overflow: hidden;
    background: var(--bg-placeholder);
  }
  .np-small-art {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .np-small-scrim {
    position: relative;
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 2rem var(--widget-pad) calc(var(--widget-pad) + 3px);
    background: linear-gradient(to top, rgba(0, 0, 0, 0.85), rgba(0, 0, 0, 0));
  }
  .np-small-name {
    flex: 1;
    min-width: 0;
    color: #fff;
    font-weight: 600;
    font-size: var(--fs-sm);
    text-decoration: none;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .np-small .np-btn { color: #fff; border-color: rgba(255, 255, 255, 0.4); }
  .np-small-bar {
    position: absolute;
    left: 0;
    bottom: 0;
    height: 3px;
    background: var(--accent);
  }

  /* medium / large */
  .np {
    flex: 1;
    min-height: 0;
    display: flex;
    gap: 0.9rem;
    align-items: stretch;
  }
  .np--large {
    flex-direction: column;
    align-items: stretch;
  }
  .np-art-link {
    flex-shrink: 0;
    height: 100%;
    aspect-ratio: 1;
    display: block;
  }
  .np--large .np-art-link {
    height: auto;
    flex: 1;
    min-height: 0;
    aspect-ratio: auto;
    display: flex;
    justify-content: center;
  }
  .np-art {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: var(--radius);
  }
  .np--large .np-art { width: auto; aspect-ratio: 1; }
  .np-art--empty { background: var(--bg-placeholder); }
  .np-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 0.2rem;
  }
  .np--large .np-info { flex: none; }
  .np-name {
    font-weight: 600;
    font-size: var(--fs-md);
    color: inherit;
    text-decoration: none;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .np-name:hover { color: var(--accent); }
  .np-artists {
    font-size: var(--fs-sm);
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .np-progress {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-top: 0.2rem;
  }
  .np-time {
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
  .np-bar {
    flex: 1;
    height: 3px;
    border-radius: 2px;
    background: var(--fg-a08);
    overflow: hidden;
  }
  .np-bar-fill {
    display: block;
    height: 100%;
    background: var(--accent);
  }
  .np-controls {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    margin-top: 0.25rem;
  }
  .np-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.9rem;
    height: 1.9rem;
    padding: 0;
    border-radius: 50%;
    border: 1px solid var(--border);
    background: none;
    color: var(--text);
    cursor: pointer;
  }
  .np-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
  .np-btn:disabled { opacity: 0.5; cursor: default; }
  .np-btn--play {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--on-accent);
  }
  .np-btn--play:hover:not(:disabled) { color: var(--on-accent); filter: brightness(1.1); }
  .np-small .np-btn--play { color: var(--on-accent); border-color: var(--accent); }
  .np-next {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    margin-top: 0.35rem;
    padding-top: 0.4rem;
    border-top: 1px solid var(--border);
  }
  .np-next-name {
    font-size: var(--fs-xs);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
