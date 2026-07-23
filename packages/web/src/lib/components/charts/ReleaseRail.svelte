<script lang="ts">
  import type * as echarts from 'echarts/core';
  import { groupEventsByBucket, type ChartEvent } from '$lib/utils/chart';

  // carril DOM de carátulas encima de una gráfica de categorías: cada lanzamiento se
  // ancla al pixel central de su bucket (convertToPixel sobre la instancia echarts) y
  // enlaza a la página del álbum. vive fuera del canvas para poder usar imágenes a
  // tamaño legible con solape tipo facepile, tooltip nativo y navegación.
  let {
    instance,
    events,
    periods,
  }: {
    instance: echarts.ECharts | null;
    events: ChartEvent[];
    periods: string[];
  } = $props();

  // desplazamiento horizontal entre carátulas que comparten bucket
  const FAN_OFFSET_PX = 9;
  const ALBUM_PX = 28;
  const SINGLE_PX = 20;

  let railWidth = $state(0);
  let markers = $state<{ x: number; ev: ChartEvent }[]>([]);

  function coverSize(e: ChartEvent) {
    return e.kind === 'album' ? ALBUM_PX : SINGLE_PX;
  }

  function recompute() {
    if (!instance || instance.isDisposed()) { markers = []; return; }
    const out: { x: number; ev: ChartEvent }[] = [];
    for (const [idx, evs] of groupEventsByBucket(events, periods)) {
      const x = instance.convertToPixel({ xAxisIndex: 0 }, idx);
      if (!Number.isFinite(x)) continue;
      // singles primero en el DOM para que los álbumes queden por encima al solaparse
      const sorted = [...evs].sort((a, b) => Number(a.kind === 'album') - Number(b.kind === 'album'));
      sorted.forEach((ev, j) => out.push({ x: x + j * FAN_OFFSET_PX, ev }));
    }
    markers = out.sort((a, b) => a.x - b.x);
  }

  // recalcular al cambiar eventos/periodos y tras cada render del chart (resize,
  // cambio de granularidad, drill-down): 'finished' cubre todos esos casos
  $effect(() => {
    void events; void periods; void railWidth;
    if (!instance) { markers = []; return; }
    recompute();
    instance.on('finished', recompute);
    return () => { if (instance && !instance.isDisposed()) instance.off('finished', recompute); };
  });

  // centra la carátula en la línea del evento sin que se salga del carril
  function clampedLeft(m: { x: number; ev: ChartEvent }) {
    const s = coverSize(m.ev);
    return Math.max(0, Math.min(m.x - s / 2, railWidth - s));
  }
</script>

{#if markers.length > 0}
  <div class="release-rail" bind:clientWidth={railWidth}>
    {#each markers as m (m.ev.id ?? `${m.ev.date}-${m.ev.label}`)}
      <a
        class="release-cover"
        class:single={m.ev.kind === 'single'}
        style:left="{clampedLeft(m)}px"
        href={m.ev.id ? `/album/${m.ev.id}` : undefined}
        title="{m.ev.label} · {m.ev.date}"
      >
        {#if m.ev.imageUrl}
          <img src={m.ev.imageUrl} alt={m.ev.label} loading="lazy" />
        {/if}
      </a>
    {/each}
  </div>
{/if}

<style>
  .release-rail {
    position: relative;
    height: 32px;
    margin-bottom: 2px;
  }
  .release-cover {
    position: absolute;
    bottom: 0;
    display: block;
    width: 28px;
    height: 28px;
    border-radius: 4px;
    overflow: hidden;
    border: 1px solid var(--border);
    background: #162020;
    transition: transform 0.12s ease, opacity 0.12s ease;
  }
  .release-cover.single {
    width: 20px;
    height: 20px;
    opacity: 0.75;
  }
  .release-cover:hover {
    transform: scale(1.4);
    opacity: 1;
    z-index: 10;
    border-color: var(--text-muted);
  }
  .release-cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
</style>
