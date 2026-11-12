<script lang="ts">
  // los últimos plays con scroll propio (RecentPlaysRail pagina el resto). La
  // semilla se mantiene viva como la del dashboard de antes: un poll cada 15s y el
  // play que acaba de terminar por delante, que el rail funde sin perder el scroll
  import { untrack } from 'svelte';
  import { api, getSessionTrackingDisplay, type HistoryItem } from '$lib/api';
  import RecentPlaysRail from '$lib/components/RecentPlaysRail.svelte';
  import { nowPlayingStore } from '$lib/stores/now-playing.svelte';
  import { projectionsStore } from '$lib/stores/projections.svelte';
  import WidgetHeader from '../WidgetHeader.svelte';
  import { reloadKey } from '../util';
  import type { WidgetProps } from '../components';

  let { size }: WidgetProps = $props();

  const RECENT_LIMIT = 10;
  const RECENT_POLL_MS = 15_000;
  // un play que ya está en la semilla con la misma marca (±1 min) no se repite
  const SAME_PLAY_MS = 60_000;

  let plays = $state<HistoryItem[]>([]);
  let loading = $state(true);

  $effect(() => {
    reloadKey();
    untrack(() => {
      loading = true;
      api.history(1, RECENT_LIMIT)
        .then(h => { plays = h.items; })
        .catch(e => console.error('recent plays widget:', e))
        .finally(() => { loading = false; });
    });
  });

  $effect(() => {
    const id = setInterval(async () => {
      try {
        const res = await api.history(1, RECENT_LIMIT);
        if (res.items.length === 0 || plays.length === 0) return;
        const latest = plays[0].id;
        const fresh = res.items.filter(i => i.id > latest);
        if (fresh.length > 0) plays = [...fresh, ...plays].slice(0, RECENT_LIMIT);
      } catch { /* el siguiente tick reintenta */ }
    }, RECENT_POLL_MS);
    return () => clearInterval(id);
  });

  $effect(() => {
    const play = nowPlayingStore.lastFinishedPlay;
    if (!play) return;
    untrack(() => {
      if (plays.length === 0) return;
      const head = plays[0];
      if (head?.track?.id === play.track?.id && Math.abs(new Date(head.playedAt).getTime() - new Date(play.playedAt).getTime()) < SAME_PLAY_MS) return;
      plays = [play, ...plays].slice(0, RECENT_LIMIT);
    });
  });
</script>

{#if loading && plays.length === 0}
  <WidgetHeader title="Recent plays" href="/history" />
  <div class="w-ghost w-ghost--fill"></div>
{:else if plays.length === 0}
  <WidgetHeader title="Recent plays" href="/history" />
  <p class="w-empty">No listening data yet.</p>
{:else}
  <div class="rp" data-size={size}>
    <RecentPlaysRail initial={plays} historyHref="/history" compact sessionStartedAt={getSessionTrackingDisplay() !== 'off' ? projectionsStore.sessionStartedAt : null} sessionTotalTracks={projectionsStore.data?.sessionTrackCount ?? 0} />
  </div>
{/if}

<style>
  .rp {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .rp :global(.section-title) {
    margin: 0 0 0.6rem;
    font-size: var(--fs-sm);
    flex-shrink: 0;
  }
  .rp :global(.recent-scroll) {
    flex: 1;
    min-height: 0;
    max-height: none;
  }
</style>
