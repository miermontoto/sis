<script lang="ts">
  import { onMount } from 'svelte';
  import { api, getRankingMetric, type TopTrackItem, type TopArtistItem, type TopAlbumItem, type RankingMetric } from '$lib/api';
  import { formatDuration } from '$lib/utils/format';
  import TrackList from '$lib/components/TrackList.svelte';
  import TimeRangeSelector from '$lib/components/TimeRangeSelector.svelte';
  import BaseChart from '$lib/components/charts/BaseChart.svelte';
  import type { EChartsOption } from 'echarts';

  let activeTab = $state<'tracks' | 'artists' | 'albums'>('tracks');
  let range = $state('month');
  let metric = $state<RankingMetric>('time');
  let topTracks = $state<TopTrackItem[]>([]);
  let topArtists = $state<TopArtistItem[]>([]);
  let topAlbums = $state<TopAlbumItem[]>([]);
  let loading = $state(true);
  let barColors = $state<[number, number, number][]>([]);

  async function loadData() {
    loading = true;
    try {
      if (activeTab === 'tracks') {
        topTracks = await api.topTracks(range, 50, metric);
      } else if (activeTab === 'artists') {
        topArtists = await api.topArtists(range, 50, metric);
      } else {
        topAlbums = await api.topAlbums(range, 50, metric);
      }
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    metric = getRankingMetric();
    loadData();
  });

  $effect(() => {
    void activeTab;
    void range;
    void metric;
    loadData();
  });

  // extraer color dominante como [r,g,b]
  // busca el pixel más saturado/vibrante de la imagen
  function extractColor(url: string): Promise<[number, number, number]> {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          const size = 32;
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(img, 0, 0, size, size);
          const data = ctx.getImageData(0, 0, size, size).data;

          // recoger todos los pixeles con su saturación
          let bestR = 0, bestG = 0, bestB = 0, bestScore = -1;
          // también acumular promedio como fallback
          let sumR = 0, sumG = 0, sumB = 0, count = 0;

          for (let i = 0; i < data.length; i += 4) {
            const pr = data[i], pg = data[i+1], pb = data[i+2];
            const max = Math.max(pr, pg, pb), min = Math.min(pr, pg, pb);
            const sat = max === 0 ? 0 : (max - min) / max;
            const brightness = max / 255;
            // score: saturación ponderada con brillo (preferir colores vivos y visibles)
            const score = sat * (0.3 + brightness * 0.7);

            if (brightness > 0.08) { // ignorar negro puro
              sumR += pr; sumG += pg; sumB += pb; count++;
            }
            if (score > bestScore) {
              bestScore = score;
              bestR = pr; bestG = pg; bestB = pb;
            }
          }

          let r: number, g: number, b: number;

          if (bestScore > 0.15) {
            // encontramos un pixel con color real
            r = bestR; g = bestG; b = bestB;
          } else if (count > 0) {
            // imagen muy gris/oscura → usar promedio
            r = Math.round(sumR / count);
            g = Math.round(sumG / count);
            b = Math.round(sumB / count);
          } else {
            resolve([29, 185, 84]);
            return;
          }

          // asegurar brillo mínimo para visibilidad sobre fondo oscuro
          const lum = 0.299 * r + 0.587 * g + 0.114 * b;
          if (lum < 90) {
            const factor = 90 / Math.max(lum, 1);
            r = Math.min(255, Math.round(r * factor));
            g = Math.min(255, Math.round(g * factor));
            b = Math.min(255, Math.round(b * factor));
          }

          resolve([r, g, b]);
        } catch {
          resolve([29, 185, 84]);
        }
      };
      img.onerror = () => resolve([29, 185, 84]);
      img.src = url;
    });
  }

  // extraer colores del top 10 cuando cambian los datos
  $effect(() => {
    let urls: (string | null)[] = [];
    if (activeTab === 'tracks') {
      urls = topTracks.slice(0, 10).map(t => t.track?.album?.imageUrl ?? null);
    } else if (activeTab === 'artists') {
      urls = topArtists.slice(0, 10).map(a => a.artist?.imageUrl ?? null);
    } else {
      urls = topAlbums.slice(0, 10).map(a => a.album?.imageUrl ?? null);
    }

    Promise.all(urls.map(u => u ? extractColor(u) : Promise.resolve<[number, number, number]>([29, 185, 84])))
      .then(colors => { barColors = colors; });
  });

  function metricValue(item: { playCount: number; totalMs: number }): number {
    return metric === 'plays' ? item.playCount : item.totalMs / 60_000;
  }

  function formatChartValue(ms: number): string {
    if (metric === 'plays') return String(ms);
    const h = Math.floor(ms / 60);
    const m = Math.round(ms % 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  let chartOption = $derived.by<EChartsOption>(() => {
    let names: string[] = [];
    let values: number[] = [];
    let images: (string | null)[] = [];

    if (activeTab === 'tracks') {
      const top10 = topTracks.slice(0, 10);
      names = top10.map(t => t.track?.name ?? 'Unknown');
      values = top10.map(t => metricValue(t));
      images = top10.map(t => t.track?.album?.imageUrl ?? null);
    } else if (activeTab === 'artists') {
      const top10 = topArtists.slice(0, 10);
      names = top10.map(a => a.artist?.name ?? 'Unknown');
      values = top10.map(a => metricValue(a));
      images = top10.map(a => a.artist?.imageUrl ?? null);
    } else {
      const top10 = topAlbums.slice(0, 10);
      names = top10.map(a => a.album?.name ?? 'Unknown');
      values = top10.map(a => metricValue(a));
      images = top10.map(a => a.album?.imageUrl ?? null);
    }

    // truncar nombres largos para que no invadan el chart
    const MAX_NAME = 18;
    names = names.map(n => n.length > MAX_NAME ? n.slice(0, MAX_NAME - 1) + '…' : n);

    // invertir para que #1 quede arriba
    names = names.slice().reverse();
    values = values.slice().reverse();
    images = images.slice().reverse();
    const defaultRgb: [number, number, number] = [29, 185, 84];
    const colors = barColors.length >= names.length
      ? barColors.slice(0, names.length).slice().reverse()
      : names.map(() => defaultRgb);

    // rich styles para imágenes en las labels del eje Y
    const rich: Record<string, any> = {
      name: { fontSize: 12, color: '#e5e5e5', width: 130, overflow: 'truncate', align: 'left' },
    };
    images.forEach((url, i) => {
      if (url) {
        rich[`img${i}`] = {
          backgroundColor: { image: url },
          width: 26,
          height: 26,
          borderRadius: activeTab === 'artists' ? 13 : 3,
          align: 'left',
        };
      } else {
        rich[`img${i}`] = {
          backgroundColor: '#2a2a2a',
          width: 26,
          height: 26,
          borderRadius: activeTab === 'artists' ? 13 : 3,
          align: 'left',
        };
      }
    });

    return {
      grid: { left: 190, right: 55, top: 10, bottom: 20 },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          const p = Array.isArray(params) ? params[0] : params;
          return `${p.name}<br/>${metric === 'plays' ? `${p.value} plays` : formatChartValue(p.value)}`;
        },
      },
      xAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: '#2a2a2a' } },
        axisLabel: {
          color: '#888',
          formatter: (v: number) => metric === 'plays' ? String(v) : formatChartValue(v),
        },
      },
      yAxis: {
        type: 'category',
        data: names,
        axisLine: { lineStyle: { color: '#2a2a2a' } },
        axisTick: { show: false },
        axisLabel: {
          rich,
          align: 'left',
          margin: 180,
          formatter: (name: string) => {
            const idx = names.indexOf(name);
            return `{img${idx}|}  {name|${name}}`;
          },
        },
      },
      series: [{
        type: 'bar',
        data: values.map((v, i) => {
          const [r, g, b] = colors[i] ?? defaultRgb;
          return {
            value: v,
            itemStyle: {
              color: {
                type: 'linear' as const,
                x: 0, y: 0, x2: 1, y2: 0,
                colorStops: [
                  { offset: 0, color: `rgba(${r},${g},${b},0.9)` },
                  { offset: 1, color: `rgba(${r},${g},${b},0.3)` },
                ],
              },
              borderRadius: [0, 4, 4, 0],
            },
          };
        }),
        barMaxWidth: 28,
        label: {
          show: true,
          position: 'right',
          color: '#888',
          fontSize: 11,
          formatter: (p: any) => metric === 'plays' ? `${p.value}` : formatChartValue(p.value),
        },
      }],
    };
  });
</script>

<div class="page-header">
  <h1>Top</h1>
</div>

<div class="tabs">
  <button class="tab" class:active={activeTab === 'tracks'} onclick={() => activeTab = 'tracks'}>
    Tracks
  </button>
  <button class="tab" class:active={activeTab === 'artists'} onclick={() => activeTab = 'artists'}>
    Artists
  </button>
  <button class="tab" class:active={activeTab === 'albums'} onclick={() => activeTab = 'albums'}>
    Albums
  </button>
</div>

<TimeRangeSelector value={range} onchange={(r) => range = r} />

{#if loading}
  <div class="loading">
    <div class="spinner"></div>
  </div>
{:else}
  {#if (activeTab === 'tracks' && topTracks.length > 0) || (activeTab === 'artists' && topArtists.length > 0) || (activeTab === 'albums' && topAlbums.length > 0)}
    <div class="card" style="margin-bottom: 1.5rem;">
      <BaseChart option={chartOption} height="380px" />
    </div>
  {/if}

  {#if activeTab === 'tracks'}
    <TrackList items={topTracks} showRank {metric} />
  {:else if activeTab === 'artists'}
    <div class="track-list">
      {#each topArtists as item, i}
        {#if item.artist}
          <a href="/artist/{item.artistId}" class="track-item">
            <span class="track-rank">{i + 1}</span>
            {#if item.artist.imageUrl}
              <img class="track-art" src={item.artist.imageUrl} alt={item.artist.name} style="border-radius: 50%;" />
            {:else}
              <div class="track-art" style="border-radius: 50%;"></div>
            {/if}
            <div class="track-info">
              <div class="track-name">{item.artist.name}</div>
            </div>
            <div class="track-meta">
              <div class="track-plays">{metric === 'plays' ? `${item.playCount} plays` : formatDuration(item.totalMs)}</div>
              <div class="track-time">{metric === 'time' ? `${item.playCount} plays` : formatDuration(item.totalMs)}</div>
            </div>
          </a>
        {/if}
      {/each}
    </div>
  {:else}
    <div class="track-list">
      {#each topAlbums as item, i}
        {#if item.album}
          <a href="/album/{item.albumId}" class="track-item">
            <span class="track-rank">{i + 1}</span>
            {#if item.album.imageUrl}
              <img class="track-art" src={item.album.imageUrl} alt={item.album.name} />
            {:else}
              <div class="track-art"></div>
            {/if}
            <div class="track-info">
              <div class="track-name">{item.album.name}</div>
              <div class="track-artist">{item.album.releaseDate ?? ''}</div>
            </div>
            <div class="track-meta">
              <div class="track-plays">{metric === 'plays' ? `${item.playCount} plays` : formatDuration(item.totalMs)}</div>
              <div class="track-time">{metric === 'time' ? `${item.playCount} plays` : formatDuration(item.totalMs)}</div>
            </div>
          </a>
        {/if}
      {/each}
    </div>
  {/if}
{/if}
