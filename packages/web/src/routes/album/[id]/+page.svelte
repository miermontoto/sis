<script lang="ts">
  import { isAbortError } from '$lib/utils/errors';
  import { playUpdatesStore, batchTouches } from '$lib/stores/play-updates.svelte';
  import { invalidateEntityDetail } from '$lib/utils/optimistic-play';
  import { statFlashStore } from '$lib/stores/stat-flash.svelte';
  import { page } from '$app/stores';
  import { onMount, untrack } from 'svelte';
  import { api, createFetchController, type AlbumDetail, type AlbumCover, type ChartHistoryResponse, type RankingMetric, type AlbumTrackDisplay, type TopTrackItem, getRankingMetric, getAlbumTrackDisplay, getAlbumShowDuration, getAlbumShowAccolades, getShowPlaylistBadges, getAlbumShowGlobalRanks } from '$lib/api';
  import { getDetailLayout } from '$lib/api/settings';
  import { defaultLayout, type DetailLayout } from '$lib/detail-layout';
  import { formatDuration, formatNumber, formatDate, localDateKey } from '$lib/utils/format';
  import type { ChartEvent } from '$lib/utils/chart';
  import { medalColor } from '$lib/utils/medals';
  import { extractColor, hexToRgb, rgbToHex, type Rgb } from '$lib/utils/color';
  import TrackList from '$lib/components/TrackList.svelte';
  import RecentPlaysRail from '$lib/components/RecentPlaysRail.svelte';
  import ActivityChart from '$lib/components/charts/ActivityChart.svelte';
  import EntityHistoryChart from '$lib/components/charts/EntityHistoryChart.svelte';
  import EntityRelations from '$lib/components/EntityRelations.svelte';
  import AliasBadge from '$lib/components/AliasBadge.svelte';
  import StatsGrid from '$lib/components/StatsGrid.svelte';
  import ChartStats from '$lib/components/ChartStats.svelte';
  import RankingBadges from '$lib/components/RankingBadges.svelte';
  import Accolades from '$lib/components/Accolades.svelte';
  import EntityActionsMenu from '$lib/components/EntityActionsMenu.svelte';
  import MergeEntityModal from '$lib/components/MergeEntityModal.svelte';
  import AlbumRating from '$lib/components/AlbumRating.svelte';
  import CollectionModal from '$lib/components/CollectionModal.svelte';
  import CollectionCandidatePicker from '$lib/components/CollectionCandidatePicker.svelte';
  import MetricMeta from '$lib/components/MetricMeta.svelte';
  import TrackItem from '$lib/components/TrackItem.svelte';
  import ImagePicker from '$lib/components/ImagePicker.svelte';
  import { nowPlayingStore } from '$lib/stores/now-playing.svelte';
  import { isSpotifyId } from '$lib/utils/entity-context';
  import { mergeModal } from '$lib/stores/merge-modal.svelte';
  import IconPlay from '$lib/icons/IconPlay.svelte';
  import IconExternalLink from '$lib/icons/IconExternalLink.svelte';
  import IconShare from '$lib/icons/IconShare.svelte';
  import IconImage from '$lib/icons/IconImage.svelte';
  import IconPalette from '$lib/icons/IconPalette.svelte';
  import IconMerge from '$lib/icons/IconMerge.svelte';
  import IconAlbum from '$lib/icons/IconAlbum.svelte';
  import { canShare, publicHref, shareEntity } from '$lib/utils/share';
  import { parseCollectionKey, collectionKey, type CollectionMember } from '$lib/api';
  import { contextMenu } from '$lib/stores/context-menu.svelte';
  import { collectionsStore } from '$lib/stores/collections.svelte';
  import { entityContextActions } from '$lib/utils/entity-context';
  import { toastStore } from '$lib/stores/toast.svelte';
  import { errorMessage } from '$lib/utils/errors';
  import IconPlus from '$lib/icons/IconPlus.svelte';
  import IconEdit from '$lib/icons/IconEdit.svelte';
  import IconTrash from '$lib/icons/IconTrash.svelte';
  import { goto } from '$app/navigation';


  // id de la ruta [id]: $page tipa params como opcional aunque el router garantice que existe
  const albumId = $derived($page.params.id ?? '');

  let data = $state<AlbumDetail | null>(null);

  // merges en la misma lista que las relaciones del artista (ver shared/relations.ts):
  // lo que sigue hablando de merges se deriva de ahí por `kind`
  let mergedInto = $derived(data?.relations.find(r => r.kind === 'alias') ?? null);
  let mergedFrom = $derived((data?.relations ?? [])
    .filter(r => r.kind === 'absorbed')
    .map(r => ({ id: r.id, ruleId: r.ruleIds[0], name: r.name, imageUrl: r.imageUrl })));
  let loading = $state(true);
  // color extraído de la portada activa: es el valor por defecto del tinte y el "auto"
  // del picker de color, así que se calcula aunque haya un pick manual
  let coverRgb = $state<Rgb | null>(null);
  // color en vivo mientras el input nativo está abierto: tiñe sin guardar todavía
  let colorPreview = $state<string | null>(null);
  let pickerMode = $state<'image' | 'background' | 'color'>('image');
  // el tinte del hero: la vista previa, si no el pick manual del álbum, si no la portada
  let heroColor = $derived((hexToRgb(colorPreview ?? data?.album.color) ?? coverRgb)?.join(',') ?? '');
  let highlightedMonth = $state('');
  let metric = $state<RankingMetric>('time');
  let chartHistoryData = $state<ChartHistoryResponse | null>(null);
  let showCoverPicker = $state(false);
  let showMergeModal = $state(false);
  let showCollectionModal = $state(false);
  // esta página ES la de una colección cuando el id lo es: mismo componente, mismas
  // secciones y mismos ajustes, más la sección de miembros (ver shared/collections.ts)
  const collectionId = $derived(parseCollectionKey(albumId));
  let addingMember = $state(false);
  let mergeInitialStep = $state<'select' | 'remerge' | undefined>(undefined);
  let playActing = $state(false);
  let trackSort = $state<'ranked' | 'natural'>('ranked');
  let albumTrackDisplay = $state<AlbumTrackDisplay>('fill');
  let albumShowDuration = $state(true);
  let albumShowAccolades = $state(true);
  let showPlaylistBadges = $state(true);
  let albumShowGlobalRanks = $state(true);
  let trackGlobalRanks = $state<Record<string, number> | null>(null);
  let singleGlobalRanks = $state<Record<string, number> | null>(null);
  let naturalTracks = $state<TopTrackItem[] | null>(null);
  let loadingNatural = $state(false);
  let layout = $state<DetailLayout>(defaultLayout('album'));
  const fetchCtrl = createFetchController();

  // lanzamiento del propio álbum + singles de adelanto ligados a él como eventos de las gráficas
  let releaseEvents = $derived.by<ChartEvent[]>(() => {
    if (!data) return [];
    const out: ChartEvent[] = [];
    if (data.album.releaseDate) {
      out.push({ id: data.album.id, date: data.album.releaseDate, label: data.album.name, kind: data.album.albumType === 'single' ? 'single' : 'album', imageUrl: data.album.imageUrl });
    }
    for (const s of data.relatedSingles ?? []) {
      out.push({ id: s.id, date: s.date, label: s.name, kind: 'single', imageUrl: s.imageUrl });
    }
    return out;
  });

  let displayTracks = $derived((trackSort === 'natural' && naturalTracks ? naturalTracks : data?.tracks ?? []).filter(t => t.playCount > 0));

  // duración total del álbum: suma del tracklist completo (ensureFullAlbumTracks
  // lo completa server-side, así que incluye también los tracks nunca escuchados)
  let albumLengthMs = $derived((data?.tracks ?? []).reduce((sum, t) => sum + (t.track?.durationMs ?? 0), 0));
  let trackSharePercents = $derived.by(() => {
    if (albumTrackDisplay === 'off') return undefined;
    const value = (t: TopTrackItem) => metric === 'plays' ? t.playCount : t.totalMs;
    const total = displayTracks.reduce((sum, t) => sum + value(t), 0);
    if (total === 0) return undefined;
    return displayTracks.map(t => (value(t) / total) * 100);
  });

  let hasMultipleCovers = $derived((data?.covers?.length ?? 0) > 1 || data?.album.imageUrl === null);

  function refreshCoverColor(imageUrl: string | null, signal?: AbortSignal) {
    if (!imageUrl) { coverRgb = null; return; }
    extractColor(imageUrl).then((rgb) => { if (!signal?.aborted) coverRgb = rgb; });
  }

  async function renameCollection() {
    const id = collectionId;
    if (id === null || !data) return;
    const name = prompt('Collection name', data.album.name)?.trim();
    if (!name || name === data.album.name) return;
    try {
      await api.updateCollection(id, { name });
      collectionsStore.invalidate();
      await loadData(albumId);
    } catch (e) {
      toastStore.show(errorMessage(e, 'Error renaming the collection'));
    }
  }

  async function deleteCollection() {
    const id = collectionId;
    if (id === null || !data) return;
    if (!confirm(`Delete "${data.album.name}"? Its members go back to ranking on their own.`)) return;
    try {
      const artistId = data.artists[0]?.id;
      await api.deleteCollection(id);
      collectionsStore.invalidate();
      goto(artistId ? `/artist/${artistId}` : '/');
    } catch (e) {
      toastStore.show(errorMessage(e, 'Error deleting the collection'));
    }
  }

  async function removeMember(m: CollectionMember) {
    const id = collectionId;
    if (id === null) return;
    try {
      await api.removeCollectionMember(id, m.entityType, m.entityId);
      collectionsStore.invalidate();
      await loadData(albumId);
    } catch (e) {
      toastStore.show(errorMessage(e, 'Error removing the member'));
    }
  }

  // menú contextual de un miembro: sus acciones de siempre + sacarlo de la colección,
  // que es la única que sólo existe aquí
  function memberMenu(m: CollectionMember) {
    return (e: MouseEvent) => {
      contextMenu.open(e, [
        ...entityContextActions({ type: m.entityType, id: m.entityId, name: m.name, imageUrl: m.imageUrl, parentArtistId: m.artists[0]?.id }),
        { label: 'Remove from collection', icon: IconTrash, danger: true, onClick: () => removeMember(m) },
      ]);
    };
  }

  async function selectCover(imageUrl: string) {
    if (!data) return;
    await api.setAlbumCover(albumId, imageUrl);
    data = { ...data, album: { ...data.album, imageUrl } };
    refreshCoverColor(imageUrl);
  }

  // pick manual del color: null vuelve al extraído de la portada
  async function selectColor(color: string | null) {
    if (!data) return;
    colorPreview = null;
    await api.setAlbumColor(albumId, color);
    data = { ...data, album: { ...data.album, color } };
  }

  async function handleCoverUpload(file: File) {
    if (!data) return;
    const { imageUrl } = await api.uploadAlbumCover(albumId, file);
    data = {
      ...data,
      album: { ...data.album, imageUrl },
      covers: [{ id: 0, imageUrl, source: 'upload' as const, observedAt: new Date().toISOString() }, ...(data.covers ?? [])],
    };
    refreshCoverColor(imageUrl);
  }

  async function loadNaturalTracks(id: string) {
    if (naturalTracks || loadingNatural) return;
    loadingNatural = true;
    try {
      const result = await api.albumDetail(id, 'all', 'natural');
      naturalTracks = result.tracks;
    } catch {}
    loadingNatural = false;
  }

  function toggleTrackSort(mode: 'ranked' | 'natural') {
    trackSort = mode;
    if (mode === 'natural' && !naturalTracks) {
      loadNaturalTracks(albumId);
    }
  }

  async function loadData(id: string) {
    const signal = fetchCtrl.reset();
    loading = true;
    try {
      const result = await api.albumDetail(id, 'all', metric === 'plays' ? 'plays' : 'time', signal);
      if (signal.aborted) return;
      data = result;
      // posición all-time de cada item listado: fetch aparte no bloqueante (un scan por tipo)
      if (albumShowGlobalRanks) {
        const sort = metric === 'plays' ? 'plays' : 'time';
        if (result.tracks.length > 0) {
          api.rankingsBatch('track', result.tracks.map(t => t.trackId), sort, signal)
            .then(r => { if (!signal.aborted) trackGlobalRanks = r; })
            .catch(() => {});
        }
        if ((result.relatedSingles ?? []).length > 0) {
          api.rankingsBatch('album', result.relatedSingles.map(s => s.id), sort, signal)
            .then(r => { if (!signal.aborted) singleGlobalRanks = r; })
            .catch(() => {});
        }
      }
      refreshCoverColor(result.album.imageUrl, signal);
    } catch (e) {
      if (isAbortError(e)) return;
      throw e;
    } finally {
      if (!signal.aborted) loading = false;
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
      const id = albumId;
      if (!id || !batchTouches(batch.updates, 'albums', id)) return;
      invalidateEntityDetail('album', id)
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
    albumTrackDisplay = getAlbumTrackDisplay();
    albumShowDuration = getAlbumShowDuration();
    albumShowAccolades = getAlbumShowAccolades();
    showPlaylistBadges = getShowPlaylistBadges();
    albumShowGlobalRanks = getAlbumShowGlobalRanks();
    layout = getDetailLayout('album');
    initialized = true;
  });

  $effect(() => {
    const id = albumId;
    void metric;
    void mergeModal.changeVersion;
    // alguien acaba de tocar una colección: la línea de pertenencia y los badges de
    // esta página dependen de ella
    void collectionsStore.changeVersion;
    if (!initialized || !id) return;
    // resetear al cambiar de álbum para mostrar spinner
    if (id !== prevId) {
      data = null;
      chartHistoryData = null;
      naturalTracks = null;
      trackSort = 'ranked';
      trackGlobalRanks = null;
      singleGlobalRanks = null;
      prevId = id;
    }
    loadData(id);
  });

</script>

{#if loading && !data}
  <div class="loading"><div class="spinner"></div></div>
{:else if data}
  {@const d = data}
  {#if heroColor}
    <div class="detail-color-bg" style="background: linear-gradient(180deg, rgba({heroColor},0.18) 0%, transparent 100%);"></div>
  {/if}

  <!-- despacha cada sección configurable por su key (ver detail-layout.ts) -->
  {#snippet sec(key: string)}
    {#if key === 'stats'}
      <section class="detail-section">
        <StatsGrid stats={d.stats} flash={statFlashStore.isFlashing(albumId)} />
      </section>
    {:else if key === 'rankingBadges'}
      {#if !mergedInto && !d.collection}
        <section class="detail-section">
          <RankingBadges entityType="album" entityId={albumId} bind:highlightedMonth />
        </section>
      {/if}
    {:else if key === 'chartStats'}
      {#if !mergedInto && !d.collection}
        <section class="detail-section">
          <ChartStats entityType="album" entityId={albumId} bind:chartData={chartHistoryData} bind:highlightedMonth />
        </section>
      {/if}
    {:else if key === 'activity'}
      <!-- misma condición que la propia gráfica: sin serie no hay sección -->
      {#if d.series.length > 1}
        <section class="detail-section">
          <ActivityChart series={d.series} {metric} events={releaseEvents} />
        </section>
      {/if}
    {:else if key === 'tracks'}
      {#if d.tracks.length > 0}
        <section class="detail-section">
          <div class="section-header">
            <h2 class="section-title">Tracks</h2>
            <div class="track-sort-toggle">
              <button class:active={trackSort === 'ranked'} onclick={() => toggleTrackSort('ranked')}>Ranked</button>
              <button class:active={trackSort === 'natural'} onclick={() => toggleTrackSort('natural')}># Order</button>
            </div>
          </div>
          {#if trackSort === 'natural' && loadingNatural}
            <div class="loading"><div class="spinner"></div></div>
          {:else if trackSort === 'natural'}
            <TrackList items={displayTracks} showRank ranks={displayTracks.map(t => t.track?.trackNumber ?? undefined)} {metric} fillPercents={albumTrackDisplay === 'fill' ? trackSharePercents : undefined} percentLabels={albumTrackDisplay === 'percent' ? trackSharePercents : undefined} showDuration={albumShowDuration} showAccolades={albumShowAccolades} showLibraryBadges={showPlaylistBadges} globalRanks={trackGlobalRanks} />
          {:else}
            <TrackList items={displayTracks} showRank {metric} fillPercents={albumTrackDisplay === 'fill' ? trackSharePercents : undefined} percentLabels={albumTrackDisplay === 'percent' ? trackSharePercents : undefined} showDuration={albumShowDuration} showAccolades={albumShowAccolades} showLibraryBadges={showPlaylistBadges} globalRanks={trackGlobalRanks} />
          {/if}
        </section>
      {/if}
    {:else if key === 'members'}
      <!-- sólo en un álbum lógico: un disco de verdad no tiene miembros -->
      {#if collectionId !== null}
        <section class="detail-section">
          <div class="section-header">
            <h2 class="section-title">Members</h2>
            <button class="show-all-btn" onclick={() => { addingMember = !addingMember; }}>
              <IconPlus size={13} /> Add
            </button>
          </div>
          {#if addingMember}
            <div class="card member-picker">
              <!-- el picker sólo ofrece lo acreditado a este artista: es lo único que
                   el servidor deja entrar en una colección suya -->
              <CollectionCandidatePicker collectionId={collectionId} onadded={() => loadData(albumId)} />
            </div>
          {/if}
          <div class="track-list">
            {#each d.members ?? [] as m (m.entityType + m.entityId)}
              {#snippet memberSubtitle()}
                <span>{[m.entityType === 'album' ? 'Album' : 'Track', m.artists.map(a => a.name).join(', ')].filter(Boolean).join(' · ')}</span>
              {/snippet}
              {#snippet memberMeta()}
                <MetricMeta playCount={m.playCount} totalMs={m.totalMs} {metric} />
              {/snippet}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div oncontextmenu={memberMenu(m)}>
                <TrackItem
                  name={m.name}
                  nameHref={m.entityType === 'album' ? `/album/${m.entityId}` : `/track/${m.entityId}`}
                  imageUrl={m.imageUrl}
                  subtitle={memberSubtitle}
                  meta={memberMeta}
                />
              </div>
            {:else}
              <div class="empty-state">
                Nothing in this collection yet. Add albums or loose tracks of {d.artists[0]?.name ?? 'this artist'} and they will rank together as one.
              </div>
            {/each}
          </div>
        </section>
      {/if}
    {:else if key === 'historyByYear'}
      {#if d.series.length > 1}
        <section class="detail-section">
          <h2 class="section-title">History by year</h2>
          <EntityHistoryChart series={d.series} {metric} events={releaseEvents} />
        </section>
      {/if}
    {:else if key === 'singles'}
      {#if (d.relatedSingles ?? []).length > 0}
        <section class="detail-section">
          <h2 class="section-title">Singles</h2>
          <div class="track-list singles-list">
            {#each d.relatedSingles as s, i}
              <a href="/album/{s.id}" class="track-item">
                <span class="track-rank">{i + 1}</span>
                {#if s.imageUrl}
                  <img class="track-art" src={s.imageUrl} alt={s.name} />
                {:else}
                  <div class="track-art"></div>
                {/if}
                <div class="track-info">
                  <div class="track-name">{s.name}</div>
                  <div class="track-artist">{s.date}</div>
                </div>
                {#if singleGlobalRanks?.[s.id] != null}
                  <span class="global-rank" title="All-time rank" style:color={medalColor(singleGlobalRanks[s.id])}>#{singleGlobalRanks[s.id]}</span>
                {/if}
                <div class="track-meta">
                  <div class="track-plays">{metric === 'plays' ? `${s.playCount} plays` : formatDuration(s.totalMs)}</div>
                  <div class="track-time">{metric === 'time' ? `${s.playCount} plays` : formatDuration(s.totalMs)}</div>
                </div>
              </a>
            {/each}
          </div>
        </section>
      {/if}
    {:else if key === 'relations'}
      {#if d.relations.length > 0}
        <section class="detail-section">
          <EntityRelations
            entityType="album"
            entity={{ id: d.album.id, name: d.album.name, imageUrl: d.album.imageUrl }}
            relations={d.relations}
            {metric}
            parentArtistId={d.artists[0]?.id}
            onManageMerges={() => { mergeInitialStep = undefined; showMergeModal = true; }}
            onChanged={() => loadData(albumId)}
          />
        </section>
      {/if}
    {:else if key === 'recentPlays'}
      {#if d.recentPlays.length > 0}
        <section class="detail-section">
          <RecentPlaysRail entityType="album" entityId={albumId} initial={d.recentPlays} historyHref={`/history?album=${albumId}`} />
        </section>
      {/if}
    {/if}
  {/snippet}

  <div class="detail-body">
    <div class="detail-main">
  <div class="detail-hero-row">
    <div class="detail-hero">
      <ImagePicker
        imageUrl={data.album.imageUrl}
        images={data.covers ?? []}
        alt={data.album.name}
        noun="cover"
        bind:open={showCoverPicker}
        bind:mode={pickerMode}
        color={data.album.color}
        defaultColor={coverRgb ? rgbToHex(coverRgb) : null}
        onSelect={selectCover}
        onUpload={handleCoverUpload}
        onSetColor={selectColor}
        onPreviewColor={(c) => { colorPreview = c; }}
      />
      <div class="detail-header-info">
        {#if collectionId !== null}<div class="data-label">Collection</div>{/if}
        <h1>{data.album.name}{#if albumId === nowPlayingStore.albumId} <span class="live-badge"><span class="live-dot"></span> Live</span>{/if}{#if mergedInto}<AliasBadge entityType="album" target={mergedInto} />{/if}</h1>
        <p class="detail-subtitle">
          {#each data.artists as artist, i}
            <a href="/artist/{artist.id}">{artist.name}</a>{#if i < data.artists.length - 1}{', '}{/if}
          {/each}
        </p>
        {#if data.album.releaseDate || data.album.totalTracks || albumLengthMs > 0}
          <p class="detail-meta-line">
            {#if data.album.releaseDate}{data.album.releaseDate}{/if}
            {#if data.album.releaseDate && data.album.totalTracks} &middot; {/if}
            {#if data.album.totalTracks}{data.album.totalTracks} tracks{/if}
            {#if (data.album.releaseDate || data.album.totalTracks) && albumLengthMs > 0} &middot; {/if}
            {#if albumLengthMs > 0}{formatDuration(albumLengthMs)}{/if}
          </p>
        {/if}
        {#if data.collection}
          <!-- mientras esté en una colección es ELLA quien rankea por este álbum: la
               página lo dice en vez de enseñar unos badges que ya no existen -->
          <p class="detail-meta-line">
            Part of <a href="/album/{collectionKey(data.collection.id)}">{data.collection.name}</a>
          </p>
        {/if}
        {#if data.notes}<p class="detail-meta-line">{data.notes}</p>{/if}
        <AlbumRating {albumId} initial={data.rating ?? null} />
      </div>
    </div>
    <div class="hero-actions">
      {#if isSpotifyId(albumId)}
        <button
          class="play-entity-btn"
          title="Play on Spotify"
          disabled={playActing}
          onclick={async () => {
            playActing = true;
            await nowPlayingStore.playContext({ context_uri: `spotify:album:${albumId}` });
            playActing = false;
          }}
        >
          <IconPlay />
        </button>
      {/if}
      {#if !mergedInto && !data.collection}
        <Accolades entityType="album" entityId={albumId} />
      {/if}
      <EntityActionsMenu
        title="Actions"
        actions={[
          ...(isSpotifyId(albumId) ? [{ label: 'View in Spotify', icon: IconExternalLink, onClick: () => window.open(`https://open.spotify.com/album/${albumId}`, '_blank') }] : []),
          ...(canShare() ? [{ label: 'Share', icon: IconShare, onClick: () => shareEntity(data?.album?.name ?? 'Album', publicHref()) }] : []),
          // una entrada por modal, no por pestaña ni por paso: el picker ya trae
          // portada/color y el modal de merges su botón de auto-merge
          { label: 'Cover & color', icon: IconImage, onClick: () => { pickerMode = 'image'; showCoverPicker = true; } },
          // un álbum lógico no se mergea (no es un lanzamiento) ni se mete en otra
          // colección: anidarlas contaría sus plays dos veces
          ...(collectionId === null ? [
            { label: 'Relations', icon: IconMerge, onClick: () => { mergeInitialStep = undefined; showMergeModal = true; } },
            { label: data?.collection ? 'Collection' : 'Add to a collection', icon: IconAlbum, onClick: () => { showCollectionModal = true; } },
          ] : [
            { label: 'Rename', icon: IconEdit, onClick: renameCollection },
            { label: 'Delete collection', icon: IconTrash, danger: true, onClick: deleteCollection },
          ]),
        ]}
      />
    </div>
  </div>

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

{#if data && data.artists[0] && collectionId === null}
  <CollectionModal
    bind:show={showCollectionModal}
    artistId={data.artists[0].id}
    artistName={data.artists[0].name}
    entity={{ type: 'album', id: albumId, name: data.album.name, imageUrl: data.album.imageUrl }}
    memberOfId={data.collection?.id ?? null}
    onChanged={() => loadData(albumId)}
  />
{/if}

{#if data && collectionId === null}
  <MergeEntityModal
    bind:show={showMergeModal}
    entityType="album"
    target={{ id: data.album.id, name: data.album.name, imageUrl: data.album.imageUrl }}
    parentId={data.artists[0]?.id ?? ''}
    existingMerges={mergedFrom}
    initialStep={mergeInitialStep}
    onMerged={() => { mergeInitialStep = undefined; loadData(albumId); }}
  />
{/if}

<style>
  .member-picker {
    padding: 0.75rem;
    margin-bottom: 0.5rem;
  }
  .track-sort-toggle {
    display: flex;
    gap: 2px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 2px;
  }
  .track-sort-toggle button {
    background: none;
    border: none;
    color: var(--text-muted);
    padding: 0.2rem 0.6rem;
    border-radius: var(--radius);
    cursor: pointer;
    font-size: 0.78rem;
    font-weight: 500;
    transition: all 0.05s;
  }
  .track-sort-toggle button:hover {
    color: var(--text);
  }
  .track-sort-toggle button.active {
    background: var(--accent);
    color: #fff;
  }
</style>
