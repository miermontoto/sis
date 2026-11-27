<script lang="ts">
  // cuerpo de la hoja de now playing del móvil: la ficha del tema que suena, con la
  // gramática de las vistas de detalle y no la de un reproductor. Hero en fila (88px,
  // LIVE, créditos, álbum, puesto en su artista), las cifras de la tarjeta de hover
  // (con lo que la sesión le ha movido), la sesión, lo que viene y su álbum y
  // artistas. Los controles no viven aquí: van anclados al pie (NowPlaying deck).
  // Expone el hero y las secciones (bindable) para que la hoja sepa cuándo bajar la
  // fila del tema al pie y adónde saltar
  import { untrack } from 'svelte';
  import {
    api, createFetchController, getRankingMetric, getSessionRankDisplay, onSessionRankDisplayChange,
    type EntityCard, type Rankings, type SessionRankDisplay, type TrackInfo,
  } from '$lib/api';
  import { nowPlayingStore } from '$lib/stores/now-playing.svelte';
  import { projectionsStore } from '$lib/stores/projections.svelte';
  import { playUpdatesStore } from '$lib/stores/play-updates.svelte';
  import { playlistMembershipStore } from '$lib/stores/playlist-membership.svelte';
  import { filterChanges } from '$lib/utils/session-ranks';
  import { entityContextActions, trackEntity } from '$lib/utils/entity-context';
  import { formatNumber, formatTrackLength } from '$lib/utils/format';
  import ArtistRankStats from './ArtistRankStats.svelte';
  import EntityActionsMenu from './EntityActionsMenu.svelte';
  import EntityCardStats from './EntityCardStats.svelte';
  import LiveEq from './LiveEq.svelte';
  import MetricMeta from './MetricMeta.svelte';
  import PlaylistPopover from './PlaylistPopover.svelte';
  import ProjectedChanges from './ProjectedChanges.svelte';
  import TrackItem from './TrackItem.svelte';
  import IconHeartFilled from '$lib/icons/IconHeartFilled.svelte';
  import IconHeartOutline from '$lib/icons/IconHeartOutline.svelte';

  type FromRow = { type: 'album' | 'artist'; id: string; card: EntityCard };

  let {
    track,
    showSession,
    heroEl = $bindable(null),
    sessionEl = $bindable(null),
    nextEl = $bindable(null),
  }: {
    track: TrackInfo;
    showSession: boolean;
    heroEl?: HTMLElement | null;
    sessionEl?: HTMLElement | null;
    nextEl?: HTMLElement | null;
  } = $props();

  const metric = getRankingMetric();
  let rankMode = $state<SessionRankDisplay>(getSessionRankDisplay());
  $effect(() => onSessionRankDisplayChange(() => { rankMode = getSessionRankDisplay(); }));

  let card = $state<EntityCard | null>(null);
  let ranks = $state<Rankings | null>(null);
  let ranksFailed = $state(false);
  let fromRows = $state<FromRow[]>([]);
  const fetchCtrl = createFetchController();

  // ids como string: cada lectura de /now-playing trae arrays nuevos con el mismo tema
  let albumId = $derived(track.album?.id ?? null);
  let artistKey = $derived(track.artists.map(a => a.id).join(','));

  // el tema y su álbum y artistas. Las fichas valen hasta que cambia el historial y el
  // layout las tira con cada play confirmado (HISTORY_BOUND_PREFIXES), pero nadie las
  // relee: por eso la confirmación es también dependencia de esta carga. El rank es
  // un escaneo del historial: sólo el del tema, que es el que lleva la tira
  $effect(() => {
    const id = track.id;
    const from = [
      ...(albumId ? [{ type: 'album' as const, id: albumId }] : []),
      ...(artistKey ? artistKey.split(',').map(a => ({ type: 'artist' as const, id: a })) : []),
    ];
    void playUpdatesStore.confirmed?.seq;
    const signal = fetchCtrl.reset();
    untrack(() => load(id, from, signal));
    return () => fetchCtrl.abort();
  });

  async function load(id: string, from: Omit<FromRow, 'card'>[], signal: AbortSignal) {
    const [c, r] = await Promise.allSettled([api.entityCard('track', id, signal), api.rankings('track', id, metric, signal)]);
    if (signal.aborted) return;
    card = c.status === 'fulfilled' ? c.value : null;
    ranks = r.status === 'fulfilled' ? r.value : null;
    ranksFailed = r.status === 'rejected';
    const rows = await Promise.allSettled(from.map(async e => ({ ...e, card: await api.entityCard(e.type, e.id, signal) })));
    if (!signal.aborted) fromRows = rows.flatMap(row => row.status === 'fulfilled' ? [row.value] : []);
  }

  // de dónde a dónde ha movido la sesión al tema, por ventana, con los mismos filtros
  // que la tarjeta de sesión. La entrada viene con el id resuelto (canónico): se casa
  // con isLive, no con el id crudo del tema
  let projected = $derived.by(() => {
    const entry = projectionsStore.data?.session.find(r => r.entityType === 'track' && nowPlayingStore.isLive('track', r.entityId));
    return Object.fromEntries(filterChanges(entry?.changes ?? [], rankMode)
      .filter(c => c.delta > 0)
      .map(c => [c.range, { from: c.currentRank, to: c.projectedRank }]));
  });

  let controllable = $derived(nowPlayingStore.data?.controllable !== false);

  // el menú del hero del detalle de tema, sin Play (es lo que suena) ni la puerta a
  // playlists (el corazón de al lado ya abre el popover). Las acciones de la fila
  // reciben el punto donde se abrió el menú; aquí no abre nada en su sitio
  let menuActions = $derived(entityContextActions(trackEntity(track), { play: false, playlists: false })
    .map(a => ({ label: a.label, icon: a.icon, danger: a.danger, disabled: a.disabled, onClick: () => a.onClick({ x: innerWidth / 2, y: innerHeight / 2 }) })));

  let queue = $derived(nowPlayingStore.queue.filter(t => t.id !== track.id));
</script>

<section class="detail-hero-row nps-hero" bind:this={heroEl}>
  <div class="detail-hero">
    {#if track.album}
      <a class="nps-cover" href="/album/{track.album.id}" aria-label="View album {track.album.name}">
        {#if track.album.imageUrl}
          <img class="detail-image" src={track.album.imageUrl} alt={track.album.name} />
        {:else}
          <div class="detail-image"></div>
        {/if}
        {#if nowPlayingStore.isPlaying}<LiveEq />{/if}
      </a>
    {/if}
    <div class="detail-header-info">
      <h1><a class="nps-title" href="/track/{track.id}">{track.name}</a> <span class="live-badge"><span class="live-dot"></span> Live</span></h1>
      <p class="detail-subtitle">
        {#each track.artists as artist, i (artist.id)}
          <a href="/artist/{artist.id}">{artist.name}</a>{#if i < track.artists.length - 1}{', '}{/if}
        {/each}
      </p>
      {#if track.album}
        <p class="detail-album">
          <a class="meta-stat" href="/album/{track.album.id}">{track.album.name}</a>
          {#if track.durationMs > 0}<span class="detail-meta meta-stat">{formatTrackLength(track.durationMs)}</span>{/if}
          <ArtistRankStats entityType="track" entityId={track.id} artists={track.artists} {metric} />
        </p>
      {/if}
    </div>
  </div>
  <div class="hero-actions">
    {#if controllable}
      <PlaylistPopover
        trackId={track.id}
        inPlaylists={nowPlayingStore.playlists}
        onAdd={(pl) => playlistMembershipStore.add(track.id, pl)}
        onRemove={(id) => playlistMembershipStore.remove(track.id, id)}
      >
        {#snippet likeButton()}
          <button
            class="like-btn"
            class:like-btn--liked={nowPlayingStore.isLiked}
            title={nowPlayingStore.likeLoading ? 'Loading...' : nowPlayingStore.isLiked ? 'Remove from Liked Songs' : 'Save to Liked Songs'}
            disabled={nowPlayingStore.likeLoading}
            onclick={() => nowPlayingStore.toggleLike()}
          >
            {#if nowPlayingStore.likeLoading}
              <span class="btn-spinner"></span>
            {:else if nowPlayingStore.isLiked}
              <IconHeartFilled />
            {:else}
              <IconHeartOutline />
            {/if}
          </button>
        {/snippet}
      </PlaylistPopover>
    {/if}
    <div class="hero-actions-end">
      <EntityActionsMenu title="Actions" actions={menuActions} />
    </div>
  </div>
</section>

{#if card}
  <section class="detail-section card">
    <EntityCardStats {card} {ranks} {ranksFailed} {metric} {projected} />
  </section>
{/if}

{#if showSession}
  <section class="detail-section" bind:this={sessionEl}>
    <ProjectedChanges variant="sheet" />
  </section>
{/if}

{#if queue.length > 0}
  <section class="detail-section" bind:this={nextEl}>
    <div class="section-header">
      <h2 class="section-title">Up next</h2>
    </div>
    <div class="track-list">
      {#each queue as q (q.id)}
        {#snippet queueArtists()}
          {#each q.artists as artist, i (artist.id)}{#if artist.known}<a href="/artist/{artist.id}" class="artist-link">{artist.name}</a>{:else}{artist.name}{/if}{#if i < q.artists.length - 1}{', '}{/if}{/each}
        {/snippet}
        <!-- cuántas veces lo has escuchado, como la cifra de cualquier fila; sin
             ninguna, la marca de estreno -->
        {#snippet queuePlays()}
          {#if q.plays}
            <div class="track-plays">{formatNumber(q.plays)}</div>
            <div class="track-time">plays</div>
          {:else if q.plays === 0}
            <span class="nps-first">First listen</span>
          {/if}
        {/snippet}
        <TrackItem
          name={q.name}
          nameHref={q.known ? `/track/${q.id}` : undefined}
          imageUrl={q.album?.imageUrl ?? undefined}
          imageHref={q.album?.known ? `/album/${q.album.id}` : undefined}
          entity={q.known ? trackEntity({ id: q.id, name: q.name, album: q.album, artists: q.artists }) : undefined}
          subtitle={q.artists.length > 0 ? queueArtists : undefined}
          meta={q.plays !== undefined ? queuePlays : undefined}
        />
      {/each}
    </div>
  </section>
{/if}

{#if fromRows.length > 0}
  <section class="detail-section">
    <div class="section-header">
      <h2 class="section-title">{fromRows.some(r => r.type === 'album') ? 'Album & ' : ''}{fromRows.filter(r => r.type === 'artist').length > 1 ? 'artists' : 'artist'}</h2>
    </div>
    <div class="track-list">
      {#each fromRows as row (`${row.type}:${row.id}`)}
        {#snippet rowArtists()}{row.card.artists.join(', ')}{/snippet}
        {#snippet rowFigures()}<MetricMeta playCount={row.card.playCount} totalMs={row.card.totalMs} {metric} />{/snippet}
        <TrackItem
          name={row.card.name}
          nameHref="/{row.type}/{row.id}"
          imageUrl={row.card.imageUrl ?? undefined}
          imageHref="/{row.type}/{row.id}"
          imageRound={row.type === 'artist'}
          entity={{ type: row.type, id: row.id, name: row.card.name, imageUrl: row.card.imageUrl }}
          subtitle={row.type === 'album' && row.card.artists.length > 0 ? rowArtists : undefined}
          meta={rowFigures}
        />
      {/each}
    </div>
  </section>
{/if}

<style>
  /* el hero de la ficha encima del fondo de la hoja (DetailBackdrop) */
  .nps-hero {
    padding-top: 0.25rem;
  }

  /* line-height 0: la carátula es un img en línea y el hueco de los descendentes
     dejaba el ecualizador por debajo de ella */
  .nps-cover {
    position: relative;
    display: block;
    flex-shrink: 0;
    line-height: 0;
  }

  .nps-title {
    color: inherit;
    text-decoration: none;
  }

  /* estreno: la marca verde de lo nuevo (los NEW de las charts), no una cifra */
  .nps-first {
    padding: 0.1rem 0.4rem;
    border: 1px solid var(--accent-a25);
    border-radius: var(--radius);
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
    font-weight: 700;
    letter-spacing: var(--track);
    text-transform: uppercase;
    color: var(--accent);
    white-space: nowrap;
  }
</style>
