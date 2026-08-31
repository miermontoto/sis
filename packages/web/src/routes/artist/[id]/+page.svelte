<script lang="ts">
  import { isAbortError } from '$lib/utils/errors';
  import { page } from '$app/stores';
  import { onMount, untrack } from 'svelte';
  import { api, createFetchController, type ArtistDetail, type ChartHistoryResponse, type RankingMetric, getRankingMetric, getArtistShowAlbumAccolades, getArtistShowTrackAccolades, getArtistShowGlobalRanks } from '$lib/api';
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
  import RelateArtistModal from '$lib/components/RelateArtistModal.svelte';
  import StatsGrid from '$lib/components/StatsGrid.svelte';
  import MergeEntityModal from '$lib/components/MergeEntityModal.svelte';
  import ImagePicker from '$lib/components/ImagePicker.svelte';
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
  let showImagePicker = $state(false);
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
      if (result.artist.imageUrl) {
        extractColor(result.artist.imageUrl).then(([r, g, b]) => {
          if (!signal.aborted) heroColor = `${r},${g},${b}`;
        });
      } else {
        heroColor = '';
      }
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

  async function selectImage(imageUrl: string) {
    if (!data) return;
    await api.setArtistImage(artistId, imageUrl);
    data = { ...data, artist: { ...data.artist, imageUrl } };
    extractColor(imageUrl).then(([r, g, b]) => { heroColor = `${r},${g},${b}`; });
  }

  async function handleImageUpload(file: File) {
    if (!data) return;
    const { imageUrl } = await api.uploadArtistImage(artistId, file);
    data = {
      ...data,
      artist: { ...data.artist, imageUrl },
      images: [{ id: 0, imageUrl, source: 'upload' as const, observedAt: new Date().toISOString() }, ...(data.images ?? [])],
    };
    extractColor(imageUrl).then(([r, g, b]) => { heroColor = `${r},${g},${b}`; });
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

  let initialized = false;
  let prevId = '';

  onMount(() => {
    metric = getRankingMetric();
    artistShowAlbumAccolades = getArtistShowAlbumAccolades();
    artistShowTrackAccolades = getArtistShowTrackAccolades();
    artistShowGlobalRanks = getArtistShowGlobalRanks();
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
  {#if heroColor}
    <div class="detail-color-bg" style="background: linear-gradient(180deg, rgba({heroColor},0.18) 0%, transparent 100%);"></div>
  {/if}

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
          onSelect={selectImage}
          onUpload={handleImageUpload}
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
        {#if !d.mergedInto}
          <Accolades entityType="artist" entityId={artistId} />
        {/if}
        <EntityActionsMenu
          title="Actions"
          actions={[
            ...(isSpotifyId(artistId) ? [{ label: 'View in Spotify', icon: IconExternalLink, onClick: () => window.open(`https://open.spotify.com/artist/${artistId}`, '_blank') }] : []),
            ...(canShare() ? [{ label: 'Share', icon: IconShare, onClick: () => shareEntity(data?.artist?.name ?? 'Artist', publicHref()) }] : []),
            { label: hasMultipleImages ? 'Change picture' : 'Upload picture', icon: IconImage, onClick: () => { showImagePicker = true; } },
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
      <StatsGrid stats={d.stats} />
    {:else if key === 'rankingBadges'}
      {#if !d.mergedInto}
        <RankingBadges entityType="artist" entityId={artistId} bind:highlightedMonth />
      {/if}
    {:else if key === 'chartStats'}
      {#if !d.mergedInto}
        <ChartStats entityType="artist" entityId={artistId} bind:chartData={chartHistoryData} bind:highlightedMonth />
      {/if}
    {:else if key === 'activity'}
      <ActivityChart series={d.series} {metric} events={releaseEvents} />
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
        <EntityHistoryChart series={d.series} {metric} events={releaseEvents} />
      {/if}
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
{/if}

