<script lang="ts">
  import { isAbortError } from '$lib/utils/errors';
  import { playUpdatesStore, batchTouches } from '$lib/stores/play-updates.svelte';
  import { invalidateEntityDetail } from '$lib/utils/optimistic-play';
  import { statFlashStore } from '$lib/stores/stat-flash.svelte';
  import { page } from '$app/stores';
  import { onMount, untrack } from 'svelte';
  import { api, createFetchController, type ArtistDetail, type Concert, type ChartHistoryResponse, type RankingMetric, getRankingMetric, getArtistShowAlbumAccolades, getArtistShowTrackAccolades, getArtistShowGlobalRanks, getArtistBackdrop } from '$lib/api';
  import type { ArtistBackdrop } from '@sis/shared';
  import { getDetailLayout } from '$lib/api/settings';
  import { defaultLayout, type DetailLayout } from '$lib/detail-layout';
  import { formatDuration, formatNumber, formatDate, formatShortDate, localDateKey } from '$lib/utils/format';
  import type { ChartEvent } from '$lib/utils/chart';
  import { medalColor } from '$lib/utils/medals';
  import { extractColor } from '$lib/utils/color';
  import TrackList from '$lib/components/TrackList.svelte';
  import RecentPlaysRail from '$lib/components/RecentPlaysRail.svelte';
  import ActivityChart from '$lib/components/charts/ActivityChart.svelte';
  import EntityHistoryChart from '$lib/components/charts/EntityHistoryChart.svelte';
  import MergeBanners from '$lib/components/MergeBanners.svelte';
  import RelatedArtists from '$lib/components/RelatedArtists.svelte';
  import ConcertList from '$lib/components/ConcertList.svelte';
  import ConcertModal from '$lib/components/ConcertModal.svelte';
  import RelateArtistModal from '$lib/components/RelateArtistModal.svelte';
  import StatsGrid from '$lib/components/StatsGrid.svelte';
  import MergeEntityModal from '$lib/components/MergeEntityModal.svelte';
  import ImagePicker from '$lib/components/ImagePicker.svelte';
  import DetailBackdrop from '$lib/components/DetailBackdrop.svelte';
  import EntityActionsMenu from '$lib/components/EntityActionsMenu.svelte';
  import { openEntityContextMenu } from '$lib/utils/entity-context';
  import ChartStats from '$lib/components/ChartStats.svelte';
  import RankingBadges from '$lib/components/RankingBadges.svelte';
  import Accolades from '$lib/components/Accolades.svelte';
  import { nowPlayingStore } from '$lib/stores/now-playing.svelte';
  import { isSpotifyId } from '$lib/utils/entity-context';
  import { mergeModal } from '$lib/stores/merge-modal.svelte';
  import IconPlay from '$lib/icons/IconPlay.svelte';
  import IconExternalLink from '$lib/icons/IconExternalLink.svelte';
  import IconShare from '$lib/icons/IconShare.svelte';
  import IconMerge from '$lib/icons/IconMerge.svelte';
  import IconLink from '$lib/icons/IconLink.svelte';
  import IconImage from '$lib/icons/IconImage.svelte';
  import { canShare, publicHref, shareEntity } from '$lib/utils/share';

  // tamaños de las listas top: colapsadas por defecto, expandidas con "show all"
  const TOP_TRACKS_LIMIT = 10;
  const TOP_ALBUMS_LIMIT = 5;
  const SHOW_ALL_LIMIT = 200;

  // id de la ruta [id]: $page tipa params como opcional aunque el router garantice que existe
  const artistId = $derived($page.params.id ?? '');

  let data = $state<ArtistDetail | null>(null);
  let loading = $state(true);
  let heroColor = $state('');
  let highlightedMonth = $state('');
  let metric = $state<RankingMetric>('time');
  let showAllTracks = $state(false);
  let showAllAlbums = $state(false);
  let showArtistMergeModal = $state(false);
  let showRelateModal = $state(false);
  let showConcertModal = $state(false);
  let editingConcert = $state<Concert | null>(null);
  let showImagePicker = $state(false);
  let pickerMode = $state<'image' | 'background'>('image');
  let backdropMode = $state<ArtistBackdrop>('blur');
  let playActing = $state(false);
  let artistShowAlbumAccolades = $state(true);
  let artistShowTrackAccolades = $state(true);
  let artistShowGlobalRanks = $state(true);
  let trackGlobalRanks = $state<Record<string, number> | null>(null);
  let albumGlobalRanks = $state<Record<string, number> | null>(null);
  let chartHistoryData = $state<ChartHistoryResponse | null>(null);
  let layout = $state<DetailLayout>(defaultLayout('artist'));
  const fetchCtrl = createFetchController();
  // un controller por lista: expandir álbumes no debe abortar el fetch de tracks
  const listCtrl = { tracks: createFetchController(), albums: createFetchController() };

  // lanzamientos del artista como eventos de las gráficas (singles más tenues que álbumes)
  let releaseEvents = $derived<ChartEvent[]>((data?.releases ?? []).map(r => ({
    id: r.id,
    date: r.date,
    label: r.name,
    kind: r.albumType === 'single' ? 'single' as const : 'album' as const,
    imageUrl: r.imageUrl,
  })));

  // los conciertos comparten carril con los releases: ambos son "algo que pasó
  // ese día", y verlos juntos es justo lo que explica un pico de escuchas
  let concertEvents = $derived<ChartEvent[]>((data?.concerts ?? []).map(c => ({
    id: `concert-${c.id}`,
    date: c.date,
    label: [c.venue, c.city].filter(Boolean).join(' · ') || 'Concert',
    sublabel: c.tour ?? undefined,
    kind: 'concert' as const,
    href: `/concert/${c.id}`,
  })));

  let chartEvents = $derived<ChartEvent[]>([...releaseEvents, ...concertEvents]);

  function openConcertModal(concert: Concert | null) {
    editingConcert = concert;
    showConcertModal = true;
  }

  // tras mutar, se recarga sólo la lista de conciertos: rehacer el detalle
  // entero por dar de alta un bolo tiraría abajo las gráficas y los tops
  async function refreshConcerts() {
    if (!data) return;
    data = { ...data, concerts: await api.artistConcerts(artistId) };
  }

  async function loadData(id: string) {
    const signal = fetchCtrl.reset();
    loading = true;
    try {
      const sort = metric === 'plays' ? 'plays' : 'time';
      const result = await api.artistDetail(id, 'all', {
        sort,
        trackLimit: showAllTracks ? SHOW_ALL_LIMIT : TOP_TRACKS_LIMIT,
        albumLimit: showAllAlbums ? SHOW_ALL_LIMIT : TOP_ALBUMS_LIMIT,
        signal,
      });
      if (signal.aborted) return;
      data = result;
      loadGlobalRanks('track', result.topTracks.map(t => t.trackId), signal);
      loadGlobalRanks('album', result.topAlbums.map(a => a.albumId), signal);
      refreshHeroColor(signal);
    } catch (e) {
      if (isAbortError(e)) return;
      throw e;
    } finally {
      if (!signal.aborted) loading = false;
    }
  }

  // historial de fotos: elegir una la fija (image_pinned) para que el barrido periódico
  // de spotify no la revierta; el hero recalcula su color con la nueva
  let hasMultipleImages = $derived((data?.images?.length ?? 0) > 1 || data?.artist.imageUrl === null);

  // el fondo cae en la foto activa mientras no haya pick propio, así que el artista
  // luce banda sin necesidad de configurar nada
  let backdropUrl = $derived(data?.artist.backgroundUrl ?? data?.artist.imageUrl ?? null);

  // el tinte del hero sale de la imagen que se ve al fondo, no siempre de la foto:
  // con un fondo propio el color dominante de la foto redonda desentonaría
  function refreshHeroColor(signal?: AbortSignal) {
    const url = data?.artist.backgroundUrl ?? data?.artist.imageUrl ?? null;
    if (!url) {
      heroColor = '';
      return;
    }
    extractColor(url).then(([r, g, b]) => {
      if (!signal?.aborted) heroColor = `${r},${g},${b}`;
    });
  }

  async function selectImage(imageUrl: string) {
    if (!data) return;
    await api.setArtistImage(artistId, imageUrl);
    data = { ...data, artist: { ...data.artist, imageUrl } };
    refreshHeroColor();
  }

  async function handleImageUpload(file: File) {
    if (!data) return;
    const { imageUrl } = await api.uploadArtistImage(artistId, file);
    data = {
      ...data,
      artist: { ...data.artist, imageUrl },
      images: [{ id: 0, imageUrl, source: 'upload' as const, observedAt: new Date().toISOString() }, ...(data.images ?? [])],
    };
    refreshHeroColor();
  }

  // fondo: pick independiente sobre el mismo pool. null lo devuelve a la foto activa
  async function selectBackground(backgroundUrl: string | null) {
    if (!data) return;
    await api.setArtistBackground(artistId, backgroundUrl);
    data = { ...data, artist: { ...data.artist, backgroundUrl } };
    refreshHeroColor();
  }

  async function handleBackgroundUpload(file: File) {
    if (!data) return;
    const { imageUrl } = await api.uploadArtistBackground(artistId, file);
    data = {
      ...data,
      artist: { ...data.artist, backgroundUrl: imageUrl },
      images: [{ id: 0, imageUrl, source: 'upload' as const, observedAt: new Date().toISOString() }, ...(data.images ?? [])],
    };
    refreshHeroColor();
  }

  // posición all-time de cada item listado: fetch aparte no bloqueante (un scan por tipo)
  function loadGlobalRanks(type: 'track' | 'album', ids: string[], signal: AbortSignal) {
    if (!artistShowGlobalRanks || ids.length === 0) return;
    api.rankingsBatch(type, ids, metric, signal)
      .then(r => {
        if (signal.aborted) return;
        if (type === 'track') trackGlobalRanks = r; else albumGlobalRanks = r;
      })
      .catch(() => {});
  }

  // el toggle "show all" refresca solo su lista y la parchea sobre `data`: reasignar el
  // detalle entero devolvía una `series` nueva y las gráficas se repintaban desde cero
  async function toggleList(kind: 'tracks' | 'albums') {
    const isTracks = kind === 'tracks';
    if (isTracks) showAllTracks = !showAllTracks;
    else showAllAlbums = !showAllAlbums;

    const showAll = isTracks ? showAllTracks : showAllAlbums;
    const collapsed = isTracks ? TOP_TRACKS_LIMIT : TOP_ALBUMS_LIMIT;
    const opts = { sort: metric, limit: showAll ? SHOW_ALL_LIMIT : collapsed, signal: listCtrl[kind].reset() };
    try {
      if (isTracks) {
        const rows = await api.artistTopTracks(artistId, opts);
        if (opts.signal.aborted || !data) return;
        data.topTracks = rows;
        loadGlobalRanks('track', rows.map(t => t.trackId), opts.signal);
      } else {
        const rows = await api.artistTopAlbums(artistId, opts);
        if (opts.signal.aborted || !data) return;
        data.topAlbums = rows;
        loadGlobalRanks('album', rows.map(a => a.albumId), opts.signal);
      }
    } catch (e) {
      if (isAbortError(e)) return;
      throw e;
    }
  }


  // --- play confirmado: relectura de la ficha ---
  //
  // El cliente ve el corte al instante, pero el play tarda unos segundos en
  // aterrizar en listening_history (volcado en escalera de 8/25/75s). Releer
  // antes recachearía las cifras VIEJAS durante el TTL entero de la ficha (1h),
  // así que se espera a que avance la marca de agua del historial.
  let lastConfirmedSeq = 0;

  $effect(() => {
    const batch = playUpdatesStore.confirmed;
    if (!batch || batch.seq <= lastConfirmedSeq) return;
    lastConfirmedSeq = batch.seq;
    // untrack: loadData lee flags de settings que no deben volverse deps
    untrack(() => {
      const id = artistId;
      if (!id || !batchTouches(batch.updates, 'artists', id)) return;
      invalidateEntityDetail('artist', id)
        .then(() => loadData(id))
        // el parpadeo va después de la recarga: las cifras cambian ahí, no al
        // detectarse el corte (que fue hace unos segundos)
        .then(() => statFlashStore.flash([id]))
        .catch(() => {});
    });
  });

  let initialized = false;
  let prevId = '';

  onMount(() => {
    metric = getRankingMetric();
    artistShowAlbumAccolades = getArtistShowAlbumAccolades();
    artistShowTrackAccolades = getArtistShowTrackAccolades();
    artistShowGlobalRanks = getArtistShowGlobalRanks();
    backdropMode = getArtistBackdrop();
    layout = getDetailLayout('artist');
    initialized = true;
  });

  // deps explícitas: loadData va en untrack porque sus lecturas (showAll*, flags de
  // settings) son síncronas y si no se convertirían en deps del efecto, recargando el
  // detalle entero al pulsar "show all"
  $effect(() => {
    const id = artistId;
    void metric;
    void mergeModal.changeVersion;
    if (!initialized || !id) return;
    if (id !== prevId) {
      // abortar toggles en vuelo: su respuesta parchearía las listas del artista anterior
      listCtrl.tracks.abort();
      listCtrl.albums.abort();
      data = null;
      chartHistoryData = null;
      trackGlobalRanks = null;
      albumGlobalRanks = null;
      prevId = id;
    }
    untrack(() => loadData(id));
  });

</script>

{#if loading && !data}
  <div class="loading"><div class="spinner"></div></div>
{:else if data}
  {@const d = data}
  <DetailBackdrop imageUrl={backdropUrl} color={heroColor} mode={backdropMode} />

  {#snippet heroRow()}
    <div class="detail-hero-row">
      <div class="detail-hero">
        <ImagePicker
          imageUrl={d.artist.imageUrl}
          images={d.images ?? []}
          alt={d.artist.name}
          noun="picture"
          round
          bind:open={showImagePicker}
          bind:mode={pickerMode}
          backgroundUrl={d.artist.backgroundUrl}
          onSelect={selectImage}
          onUpload={handleImageUpload}
          onSetBackground={selectBackground}
          onUploadBackground={handleBackgroundUpload}
        />
        <div class="detail-header-info">
          <h1>{d.artist.name}{#if nowPlayingStore.artistIds.includes(artistId)} <span class="live-badge"><span class="live-dot"></span> Live</span>{/if}</h1>
        </div>
      </div>
      <div class="hero-actions">
        {#if isSpotifyId(artistId)}
          <button
            class="play-entity-btn"
            title="Play on Spotify"
            disabled={playActing}
            onclick={async () => {
              playActing = true;
              await nowPlayingStore.playContext({ context_uri: `spotify:artist:${artistId}` });
              playActing = false;
            }}
          >
            <IconPlay />
          </button>
        {/if}
        <Accolades
          entityType="artist"
          entityId={artistId}
          showRecords={!d.mergedInto}
          concerts={(d.concerts ?? []).map(c => ({
            id: c.id, artistId: c.artistId, artistName: c.artistName, date: c.date, venue: c.venue, city: c.city,
          }))}
        />
        <EntityActionsMenu
          title="Actions"
          actions={[
            ...(isSpotifyId(artistId) ? [{ label: 'View in Spotify', icon: IconExternalLink, onClick: () => window.open(`https://open.spotify.com/artist/${artistId}`, '_blank') }] : []),
            ...(canShare() ? [{ label: 'Share', icon: IconShare, onClick: () => shareEntity(data?.artist?.name ?? 'Artist', publicHref()) }] : []),
            { label: hasMultipleImages ? 'Change picture' : 'Upload picture', icon: IconImage, onClick: () => { pickerMode = 'image'; showImagePicker = true; } },
            { label: 'Change background', icon: IconImage, onClick: () => { pickerMode = 'background'; showImagePicker = true; } },
            { label: 'Manage merges', icon: IconMerge, onClick: () => { showArtistMergeModal = true; } },
            { label: 'Related artists', icon: IconLink, onClick: () => { showRelateModal = true; } },
          ]}
        />
      </div>
    </div>
  {/snippet}

  <!-- despacha cada sección configurable por su key (ver detail-layout.ts) -->
  {#snippet sec(key: string)}
    {#if key === 'stats'}
      <StatsGrid stats={d.stats} flash={statFlashStore.isFlashing(artistId)} />
    {:else if key === 'rankingBadges'}
      {#if !d.mergedInto}
        <RankingBadges entityType="artist" entityId={artistId} bind:highlightedMonth />
      {/if}
    {:else if key === 'chartStats'}
      {#if !d.mergedInto}
        <ChartStats entityType="artist" entityId={artistId} bind:chartData={chartHistoryData} bind:highlightedMonth />
      {/if}
    {:else if key === 'activity'}
      <ActivityChart series={d.series} {metric} events={chartEvents} />
    {:else if key === 'topTracks'}
      {#if d.topTracks.length > 0}
        <div class="section-header">
          <h2 class="section-title">Top tracks</h2>
          <button class="show-all-btn" onclick={() => toggleList('tracks')}>
            {showAllTracks ? 'Show less' : 'Show all'}
          </button>
        </div>
        <TrackList items={d.topTracks} showRank {metric} showAccolades={artistShowTrackAccolades} globalRanks={trackGlobalRanks} />
      {/if}
    {:else if key === 'topAlbums'}
      {#if d.topAlbums.length > 0}
        <div class="section-header">
          <h2 class="section-title">Top albums</h2>
          <button class="show-all-btn" onclick={() => toggleList('albums')}>
            {showAllAlbums ? 'Show less' : 'Show all'}
          </button>
        </div>
        <div class="track-list">
          {#each d.topAlbums as item, i}
            {#if item.album}
              <a
                href="/album/{item.albumId}"
                class="track-item"
                oncontextmenu={openEntityContextMenu({ type: 'album', id: item.albumId, name: item.album.name, imageUrl: item.album.imageUrl, parentArtistId: artistId })}
              >
                <span class="track-rank" style:color={medalColor(i + 1)}>{i + 1}</span>
                {#if item.album.imageUrl}
                  <img class="track-art" src={item.album.imageUrl} alt={item.album.name} />
                {:else}
                  <div class="track-art"></div>
                {/if}
                <div class="track-info">
                  <div class="track-name">{item.album.name}</div>
                  <div class="track-artist">{item.album.releaseDate ?? ''}</div>
                </div>
                {#if artistShowAlbumAccolades}
                  <Accolades entityType="album" entityId={item.albumId} />
                {/if}
                {#if albumGlobalRanks?.[item.albumId] != null}
                  <span class="global-rank" title="All-time rank" style:color={medalColor(albumGlobalRanks[item.albumId])}>#{albumGlobalRanks[item.albumId]}</span>
                {/if}
                <div class="track-meta">
                  <div class="track-plays">{metric === 'plays' ? `${item.playCount} plays` : formatDuration(item.totalMs)}</div>
                  <div class="track-time">{metric === 'time' ? `${item.playCount} plays` : formatDuration(item.totalMs)}</div>
                </div>
              </a>
            {/if}
          {/each}
        </div>
      {/if}
    {:else if key === 'historyByYear'}
      {#if d.series.length > 1}
        <h2 class="section-title">History by year</h2>
        <EntityHistoryChart series={d.series} {metric} events={chartEvents} />
      {/if}
    {:else if key === 'concerts'}
      <ConcertList
        concerts={d.concerts ?? []}
        onAdd={() => openConcertModal(null)}
        onEdit={(concert) => openConcertModal(concert)}
        onChanged={refreshConcerts}
      />
    {:else if key === 'relations'}
      {#if d.relatedArtists.length > 0}
        <RelatedArtists artists={d.relatedArtists} onManage={() => { showRelateModal = true; }} />
      {/if}
    {:else if key === 'recentPlays'}
      {#if d.recentPlays.length > 0}
        <RecentPlaysRail entityType="artist" entityId={artistId} initial={d.recentPlays} historyHref={`/history?artist=${artistId}`} />
      {/if}
    {/if}
  {/snippet}

  <div class="detail-body">
    <div class="detail-main">
      {@render heroRow()}
      <MergeBanners entityType="artist" entityId={d.artist.id} mergedInto={d.mergedInto} mergedFrom={d.mergedFrom} onUnmerge={() => loadData(artistId)} />
      {#each layout.main as key (key)}
        {@render sec(key)}
      {/each}
    </div>

    <aside class="detail-rail">
      {#each layout.rail as key (key)}
        {@render sec(key)}
      {/each}
    </aside>
  </div>
{/if}

{#if data}
  <MergeEntityModal
    bind:show={showArtistMergeModal}
    entityType="artist"
    target={{ id: data.artist.id, name: data.artist.name, imageUrl: data.artist.imageUrl }}
    existingMerges={data.mergedFrom}
    onMerged={() => loadData(artistId)}
  />
  <RelateArtistModal
    bind:show={showRelateModal}
    target={{ id: data.artist.id, name: data.artist.name, imageUrl: data.artist.imageUrl }}
    existing={data.relatedArtists}
    onChanged={() => loadData(artistId)}
  />
  <ConcertModal
    bind:show={showConcertModal}
    artist={{ id: data.artist.id, name: data.artist.name }}
    editing={editingConcert}
    onSaved={refreshConcerts}
  />
{/if}

