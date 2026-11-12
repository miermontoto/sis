<script lang="ts">
  // la cola de spotify: lo que viene detrás de lo que suena. Sale del store de now
  // playing, que la pide una vez por tema (nunca en el tick) y sólo con el ajuste
  // "Up next" encendido; aquí sólo se lee. Como en la tarjeta, se enlaza lo que existe
  // en la biblioteca (`known`) y el resto va como texto
  import { getNowPlayingUpNext, onNowPlayingUpNextChange } from '$lib/api';
  import { nowPlayingStore } from '$lib/stores/now-playing.svelte';
  import { fitRows } from '$lib/utils/fit-rows';
  import WidgetHeader from '../WidgetHeader.svelte';
  import type { WidgetProps } from '../components';

  let { size }: WidgetProps = $props();

  let enabled = $state(getNowPlayingUpNext());
  $effect(() => onNowPlayingUpNextChange(v => { enabled = v; }));

  let current = $derived(nowPlayingStore.data?.track?.id ?? null);
  // la cola puede venir medida justo antes del corte, con el tema actual en cabeza
  let queue = $derived(nowPlayingStore.queue.filter(q => q.id !== current));
</script>

<WidgetHeader title="Up next" />
{#if !enabled}
  <p class="w-empty">Up next is turned off in <a href="/settings?tab=display" class="section-link">Settings</a>.</p>
{:else if !nowPlayingStore.data?.playing}
  <p class="w-empty">Nothing playing, nothing queued.</p>
{:else if queue.length === 0}
  <p class="w-empty">Your queue is empty.</p>
{:else}
  <div class="w-fill un-list" use:fitRows data-size={size}>
    {#each queue as q, i (`${q.id}:${i}`)}
      <div class="un-row">
        {#if q.album?.imageUrl}<img class="un-art" src={q.album.imageUrl} alt="" loading="lazy" />{:else}<span class="un-art un-art--empty"></span>{/if}
        <span class="un-text">
          {#if q.known}<a class="un-name" href="/track/{q.id}">{q.name}</a>{:else}<span class="un-name">{q.name}</span>{/if}
          <span class="un-artists">
            {#each q.artists as a, j (a.id)}{#if j > 0}, {/if}{#if a.known}<a href="/artist/{a.id}" class="artist-link">{a.name}</a>{:else}{a.name}{/if}{/each}
          </span>
        </span>
      </div>
    {/each}
  </div>
{/if}

<style>
  .un-list {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }
  .un-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    min-width: 0;
  }
  .un-art {
    width: 2.25rem;
    height: 2.25rem;
    border-radius: var(--radius);
    object-fit: cover;
    flex-shrink: 0;
  }
  .un-art--empty { background: var(--bg-placeholder); }
  .un-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .un-name, .un-artists {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .un-name {
    font-weight: 600;
    font-size: var(--fs-sm);
    color: inherit;
    text-decoration: none;
  }
  a.un-name:hover { color: var(--accent); }
  .un-artists { font-size: var(--fs-xs); color: var(--text-muted); }
</style>
