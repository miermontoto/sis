<script lang="ts">
  // índice de generators: cada tarjeta enseña una miniatura de lo que produce, dibujada
  // con los datos del usuario. Las diez previews salen de UN conjunto compartido (top
  // albums, artists y tracks all-time), tres peticiones para toda la página, no una
  // por tarjeta; cada preview es css/svg sobre esas listas, sin echarts ni canvas
  import { onMount } from 'svelte';
  import { api, getRankingMetric, type TopAlbumItem, type TopArtistItem, type TopTrackItem } from '$lib/api';
  import { formatNumber } from '$lib/utils/format';

  const PREVIEW_RANGE = 'all';
  const ALBUM_COUNT = 9;
  const ARTIST_COUNT = 6;
  const TRACK_COUNT = 3;
  // posiciones fijas de las burbujas (porcentaje de la caja), de la mayor a la menor
  const BUBBLE_SPOTS = [[40, 50], [74, 36], [14, 30], [64, 80], [90, 74], [20, 78]];
  // porcentaje del ANCHO de la caja (2:1): 30% de ancho = 60% de alto
  const BUBBLE_MAX_PCT = 30;
  const BUBBLE_MIN_PCT = 10;
  // exponentes de las curvas de velocity: la misma cifra final con arranques distintos
  const VELOCITY_CURVES = [1.1, 1.6, 2.4];
  const VELOCITY_STEPS = 12;
  const PIE_SLICES = 5;
  const PIE_COLORS = ['var(--accent)', 'var(--info)', 'var(--warning)', 'var(--accent-a40)', 'var(--fg-a15)', 'var(--fg-a05)'];
  const TIER_S = 2;
  const RECEIPT_LINES = 3;
  const BRACKET_SEEDS = 4;

  const generators = [
    { href: '/generators/playlist', icon: '♫', name: 'Playlist', description: 'Spotify playlist from your data: top tracks of a range, artist or genre, deep cuts, what you play at a given hour, or favourites you have dropped. Can regenerate itself on a schedule.' },
    { href: '/generators/album-quilt', icon: '▦', name: 'Album Quilt', description: 'NxN mosaic of your most-listened album covers. Downloadable as an image.' },
    { href: '/generators/bubbles', icon: '◉', name: 'Bubbles', description: 'Bubble chart of your most-listened artists; bubble size represents play count.' },
    { href: '/generators/artist-velocity', icon: '∿', name: 'Artist Velocity', description: 'Cumulative play curves per artist. Compare multiple trajectories side by side.' },
    { href: '/generators/pie-chart', icon: '◔', name: 'Pie Chart', description: 'Distribution of your plays across top artists, with an Others slice for the long tail.' },
    { href: '/generators/receipt', icon: '▤', name: 'Receipt', description: 'Shopping-receipt poster of your top 10 tracks or artists, with estimated Spotify royalties.' },
    { href: '/generators/race-chart', icon: '▶', name: 'Race Chart', description: 'Animated bar chart race showing how your top artists, tracks, or albums accumulate plays over time.' },
    { href: '/generators/march-madness', icon: '⑂', name: 'March Madness', description: 'Tournament of your artists, tracks, or albums: knockout, double elimination, groups, Swiss or king of the hill. Seed the top ones, draw a random field or pick your own, then pick your way to a champion.' },
    { href: '/generators/rerank', icon: '⇅', name: 'Rerank', description: 'Drag your top artists, albums or tracks into the order you wish they had, and see the listening time, plays and playlist it would take to get there.' },
    { href: '/generators/tier-list', icon: '≡', name: 'Tier List', description: 'Drag your artists, albums or tracks into custom tiers. Pull them from your top, a random draw, a search, or a whole discography.' },
  ] as const;
  type GeneratorKey = typeof generators[number]['href'];

  let albums = $state<TopAlbumItem[]>([]);
  let artists = $state<TopArtistItem[]>([]);
  let tracks = $state<TopTrackItem[]>([]);
  let loading = $state(true);
  const metric = getRankingMetric();

  onMount(async () => {
    try {
      [albums, artists, tracks] = await Promise.all([
        api.topAlbums(PREVIEW_RANGE, ALBUM_COUNT, metric),
        api.topArtists(PREVIEW_RANGE, ARTIST_COUNT, metric),
        api.topTracks(PREVIEW_RANGE, TRACK_COUNT, metric),
      ]);
    } catch { /* sin datos la tarjeta enseña su glifo, como antes */ }
    loading = false;
  });

  const weight = (i: { playCount: number; totalMs: number }) => (metric === 'plays' ? i.playCount : i.totalMs);
  const figure = (i: { playCount: number; totalMs: number }) => (metric === 'plays' ? formatNumber(i.playCount) : `${Math.round(i.totalMs / 3_600_000)}h`);

  // pesos relativos al mayor de la lista, en [0, 1]
  const relative = (list: { playCount: number; totalMs: number }[]) => {
    const max = Math.max(1, ...list.map(weight));
    return list.map(i => weight(i) / max);
  };

  const hasData = $derived(albums.length > 0 && artists.length > 0);
  const artistRel = $derived(relative(artists));
  const albumCovers = $derived(albums.map(a => a.album?.imageUrl ?? null));
  const artistName = (a: TopArtistItem) => a.artist?.name ?? '';

  // donut: conic-gradient con las cuotas de los primeros artistas y el resto en "others"
  const pieGradient = $derived.by(() => {
    const total = artists.reduce((n, a) => n + weight(a), 0) || 1;
    const top = artists.slice(0, PIE_SLICES);
    const stops: string[] = [];
    let acc = 0;
    top.forEach((a, i) => {
      const from = acc;
      acc += (weight(a) / total) * 100;
      stops.push(`${PIE_COLORS[i]} ${from.toFixed(1)}% ${acc.toFixed(1)}%`);
    });
    stops.push(`${PIE_COLORS[PIE_SLICES]} ${acc.toFixed(1)}% 100%`);
    return `conic-gradient(${stops.join(', ')})`;
  });

  // curvas acumuladas: la altura final es la cuota real del artista, el trazado una
  // potencia distinta por línea (en el generator de verdad sale del historial)
  const velocityPaths = $derived(
    artistRel.slice(0, VELOCITY_CURVES.length).map((h, i) => {
      const k = VELOCITY_CURVES[i];
      const pts = Array.from({ length: VELOCITY_STEPS + 1 }, (_, s) => {
        const x = (s / VELOCITY_STEPS) * 100;
        const y = 100 - h * 92 * Math.pow(s / VELOCITY_STEPS, k);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      });
      return pts.join(' ');
    }),
  );

  const bubbleSize = (rel: number) => BUBBLE_MIN_PCT + Math.sqrt(rel) * (BUBBLE_MAX_PCT - BUBBLE_MIN_PCT);
</script>

{#snippet cover(url: string | null, round = false)}
  {#if url}
    <img class="pv-img" class:pv-img--round={round} src={url} alt="" loading="lazy" />
  {:else}
    <span class="pv-img pv-img--empty" class:pv-img--round={round}></span>
  {/if}
{/snippet}

{#snippet preview(key: GeneratorKey)}
  {#if key === '/generators/playlist'}
    <div class="pv-list">
      {#each tracks as t, i (t.trackId)}
        <div class="pv-row">
          <span class="pv-rank">{i + 1}</span>
          {@render cover(t.track?.album?.imageUrl ?? null)}
          <span class="pv-text">{t.track?.name ?? ''}</span>
        </div>
      {/each}
    </div>
  {:else if key === '/generators/album-quilt'}
    <div class="pv-quilt">
      {#each albumCovers.slice(0, ALBUM_COUNT) as url, i (i)}
        {@render cover(url)}
      {/each}
    </div>
  {:else if key === '/generators/bubbles'}
    <div class="pv-bubbles">
      {#each artists as a, i (a.artistId)}
        {@const size = bubbleSize(artistRel[i])}
        <span class="pv-bubble" style:width="{size}%" style:left="{BUBBLE_SPOTS[i]?.[0] ?? 50}%" style:top="{BUBBLE_SPOTS[i]?.[1] ?? 50}%">
          {@render cover(a.artist?.imageUrl ?? null, true)}
        </span>
      {/each}
    </div>
  {:else if key === '/generators/artist-velocity'}
    <svg class="pv-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      {#each velocityPaths as d, i (i)}
        <polyline points={d} fill="none" stroke={PIE_COLORS[i]} stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round" />
      {/each}
    </svg>
  {:else if key === '/generators/pie-chart'}
    <div class="pv-pie-wrap">
      <span class="pv-pie" style:background={pieGradient}></span>
      <div class="pv-legend">
        {#each artists.slice(0, 3) as a, i (a.artistId)}
          <span class="pv-legend-row"><i style:background={PIE_COLORS[i]}></i>{artistName(a)}</span>
        {/each}
      </div>
    </div>
  {:else if key === '/generators/receipt'}
    <div class="pv-receipt">
      <span class="pv-receipt-head">sis receipt</span>
      {#each artists.slice(0, RECEIPT_LINES) as a (a.artistId)}
        <span class="pv-receipt-line"><span class="pv-text">{artistName(a).toUpperCase()}</span><span>{figure(a)}</span></span>
      {/each}
      <span class="pv-receipt-line pv-receipt-total"><span>TOTAL</span><span>{figure({ playCount: artists.reduce((n, a) => n + a.playCount, 0), totalMs: artists.reduce((n, a) => n + a.totalMs, 0) })}</span></span>
    </div>
  {:else if key === '/generators/race-chart'}
    <div class="pv-bars">
      {#each artists.slice(0, 4) as a, i (a.artistId)}
        <div class="pv-bar-row">
          <span class="pv-bar" style:width="{Math.max(8, artistRel[i] * 100)}%" style:opacity={1 - i * 0.12}></span>
          <span class="pv-text pv-bar-label">{artistName(a)}</span>
        </div>
      {/each}
    </div>
  {:else if key === '/generators/march-madness'}
    <div class="pv-bracket">
      <div class="pv-bracket-col">
        {#each artists.slice(0, BRACKET_SEEDS) as a (a.artistId)}
          {@render cover(a.artist?.imageUrl ?? null, true)}
        {/each}
      </div>
      <svg class="pv-bracket-lines" viewBox="0 0 40 100" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0 12 H14 V37 H0 M0 62 H14 V87 H0 M14 25 H28 V75 H14 M28 50 H40" fill="none" stroke="var(--border)" stroke-width="1.5" vector-effect="non-scaling-stroke" />
      </svg>
      <div class="pv-bracket-champ">
        {@render cover(artists[0]?.artist?.imageUrl ?? null, true)}
      </div>
    </div>
  {:else if key === '/generators/rerank'}
    <div class="pv-list">
      {#each albums.slice(0, 3) as a, i (a.albumId)}
        <div class="pv-row" class:pv-row--lifted={i === 1}>
          <span class="pv-rank">{i + 1}</span>
          {@render cover(a.album?.imageUrl ?? null)}
          <span class="pv-text">{a.album?.name ?? ''}</span>
          <span class="pv-handle">⇅</span>
        </div>
      {/each}
    </div>
  {:else if key === '/generators/tier-list'}
    <div class="pv-tiers">
      <div class="pv-tier"><span class="pv-tier-label pv-tier-label--s">S</span>{#each albumCovers.slice(0, TIER_S) as url, i (i)}{@render cover(url)}{/each}</div>
      <div class="pv-tier"><span class="pv-tier-label">A</span>{#each albumCovers.slice(TIER_S, TIER_S + 4) as url, i (i)}{@render cover(url)}{/each}</div>
    </div>
  {/if}
{/snippet}

<div class="generator-grid">
  {#each generators as g (g.href)}
    <a href={g.href} class="generator-card">
      <div class="generator-preview" class:generator-preview--ghost={loading}>
        {#if loading}
          <!-- esqueleto -->
        {:else if hasData}
          {@render preview(g.href)}
        {:else}
          <span class="generator-icon">{g.icon}</span>
        {/if}
      </div>
      <div class="generator-name"><span class="generator-glyph" aria-hidden="true">{g.icon}</span>{g.name}</div>
      <div class="generator-desc">{g.description}</div>
    </a>
  {/each}
</div>

<style>
  .generator-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 1rem;
    margin-top: 1rem;
  }
  .generator-card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.75rem 0.75rem 1rem;
    text-decoration: none;
    color: inherit;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    transition: border-color 0.05s, transform 0.05s;
  }
  .generator-card:hover {
    border-color: var(--accent);
    transform: translateY(-2px);
  }
  .generator-preview {
    position: relative;
    aspect-ratio: 2 / 1;
    border-radius: calc(var(--radius) - 2px);
    background: var(--bg);
    border: 1px solid var(--fg-a05);
    overflow: hidden;
    padding: 0.6rem;
    display: flex;
    align-items: center;
    justify-content: center;
    container-type: inline-size;
  }
  .generator-preview--ghost {
    background: var(--shimmer);
    background-size: 200% 100%;
    animation: generator-shimmer 1.5s ease-in-out infinite;
  }
  @keyframes generator-shimmer {
    from { background-position: 200% 0; }
    to { background-position: -200% 0; }
  }
  .generator-icon {
    font-size: var(--fs-2xl);
    line-height: 1;
    color: var(--accent);
  }
  .generator-name {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: var(--fs-lg);
    font-weight: 600;
    color: var(--text);
    padding: 0 0.25rem;
  }
  .generator-glyph {
    font-family: var(--font-mono);
    color: var(--accent);
    font-size: var(--fs-md);
  }
  .generator-desc {
    font-size: var(--fs-sm);
    color: var(--text-muted);
    line-height: 1.4;
    padding: 0 0.25rem;
  }

  /* piezas de las previews (pv-*): tamaños en cqw para que escalen con la tarjeta */
  .pv-img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 2px;
    background: var(--bg-hover);
  }
  .pv-img--round { border-radius: 50%; }
  .pv-img--empty { background: var(--fg-a05); }
  .pv-text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: 3.6cqw;
    color: var(--text);
  }

  .pv-list {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 2cqw;
  }
  .pv-row {
    display: flex;
    align-items: center;
    gap: 2.5cqw;
    padding: 1cqw 1.5cqw;
    border-radius: 2px;
  }
  .pv-row :global(.pv-img) { width: 9cqw; height: 9cqw; flex-shrink: 0; }
  .pv-row--lifted {
    background: var(--bg-card);
    box-shadow: 0 2px 6px color-mix(in srgb, var(--shadow-color) 40%, transparent);
    transform: translateX(2cqw);
  }
  .pv-rank {
    width: 4cqw;
    font-family: var(--font-mono);
    font-size: 3.2cqw;
    color: var(--text-muted);
    text-align: right;
  }
  .pv-handle {
    font-family: var(--font-mono);
    font-size: 3.6cqw;
    color: var(--text-muted);
  }

  .pv-quilt {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1cqw;
    height: 100%;
    aspect-ratio: 1;
  }

  .pv-bubbles { position: absolute; inset: 0; }
  .pv-bubble {
    position: absolute;
    aspect-ratio: 1;
    transform: translate(-50%, -50%);
    border: 1px solid var(--accent-a40);
    border-radius: 50%;
    padding: 1px;
  }

  .pv-svg { width: 100%; height: 100%; display: block; }

  .pv-pie-wrap {
    display: flex;
    align-items: center;
    gap: 4cqw;
    width: 100%;
    height: 100%;
  }
  .pv-pie {
    height: 100%;
    aspect-ratio: 1;
    border-radius: 50%;
    flex-shrink: 0;
    /* donut: agujero recortado con máscara radial */
    -webkit-mask: radial-gradient(circle, transparent 42%, #000 43%);
    mask: radial-gradient(circle, transparent 42%, #000 43%);
  }
  .pv-legend { display: flex; flex-direction: column; gap: 1.5cqw; min-width: 0; }
  .pv-legend-row {
    display: flex;
    align-items: center;
    gap: 1.5cqw;
    font-size: 3.4cqw;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .pv-legend-row i { width: 2.5cqw; height: 2.5cqw; border-radius: 1px; flex-shrink: 0; }

  .pv-receipt {
    width: 62%;
    background: #f4f1e8;
    color: #1a1a1a;
    font-family: var(--font-mono);
    font-size: 3.2cqw;
    padding: 2cqw 3cqw;
    display: flex;
    flex-direction: column;
    gap: 1cqw;
    box-shadow: 0 2px 8px color-mix(in srgb, #000 35%, transparent);
    transform: rotate(-2deg);
  }
  .pv-receipt-head {
    text-align: center;
    font-weight: 700;
    letter-spacing: var(--track-wide);
    text-transform: uppercase;
    border-bottom: 1px dashed #999;
    padding-bottom: 1cqw;
  }
  .pv-receipt-line { display: flex; justify-content: space-between; gap: 2cqw; }
  .pv-receipt-line .pv-text { color: inherit; font-size: inherit; }
  .pv-receipt-total { border-top: 1px dashed #999; padding-top: 1cqw; font-weight: 700; }

  .pv-bars { width: 100%; display: flex; flex-direction: column; gap: 2cqw; }
  .pv-bar-row { position: relative; height: 7.5cqw; display: flex; align-items: center; }
  .pv-bar { position: absolute; left: 0; top: 0; height: 100%; background: var(--accent); border-radius: 2px; }
  /* el texto va dentro de la barra, en el color que contrasta con el acento */
  .pv-bar-label { position: relative; padding-left: 2cqw; color: var(--on-accent); font-weight: 600; }

  .pv-bracket { display: flex; align-items: center; width: 100%; height: 100%; gap: 0; }
  .pv-bracket-col { display: flex; flex-direction: column; justify-content: space-between; height: 100%; }
  .pv-bracket-col :global(.pv-img) { width: 9cqw; height: 9cqw; }
  .pv-bracket-lines { height: 100%; width: 22cqw; }
  .pv-bracket-champ :global(.pv-img) { width: 15cqw; height: 15cqw; border: 2px solid var(--accent); }

  .pv-tiers { width: 100%; display: flex; flex-direction: column; gap: 1.5cqw; }
  .pv-tier { display: flex; align-items: center; gap: 1.5cqw; }
  .pv-tier :global(.pv-img) { width: 11cqw; height: 11cqw; }
  .pv-tier-label {
    width: 11cqw;
    height: 11cqw;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-family: var(--font-mono);
    font-weight: 700;
    font-size: 5cqw;
    border-radius: 2px;
    background: var(--info);
    color: #fff;
    flex-shrink: 0;
  }
  .pv-tier-label--s { background: var(--accent); color: var(--on-accent); }
</style>
