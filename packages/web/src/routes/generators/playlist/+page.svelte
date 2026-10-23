<script lang="ts">
  // generador de playlists: antes era la pestaña "Generate" de /playlists, en castellano y
  // con sus propios controles. Vive aquí porque produce un artefacto a partir de tus datos,
  // como el resto de generators; /playlists queda como espejo de la biblioteca de spotify
  import { onMount } from 'svelte';
  import { errorMessage } from '$lib/utils/errors';
  import { api, type PlaylistStrategy, type RegenerateInterval, type GeneratedPlaylist, type PlaylistPreviewResponse, type TrackInfo, type GenreItem, type MeResponse } from '$lib/api';
  import TimeRangeSelector from '$lib/components/TimeRangeSelector.svelte';
  import TrackList from '$lib/components/TrackList.svelte';
  import TrackItem from '$lib/components/TrackItem.svelte';
  import SearchModal from '$lib/components/SearchModal.svelte';
  import { formatDate, getLocalizedDayNames } from '$lib/utils/format';
  import { getQueryParam, setQueryParams } from '$lib/utils/query-state';
  import { contextMenu, type ContextMenuAction } from '$lib/stores/context-menu.svelte';
  import { toastStore } from '$lib/stores/toast.svelte';
  import IconSpotify from '$lib/icons/IconSpotify.svelte';
  import IconRefresh from '$lib/icons/IconRefresh.svelte';
  import IconTrash from '$lib/icons/IconTrash.svelte';
  import IconTrack from '$lib/icons/IconTrack.svelte';
  import IconClock from '$lib/icons/IconClock.svelte';
  import IconExternalLink from '$lib/icons/IconExternalLink.svelte';

  const RETURN_TO = '/generators/playlist';

  // sólo las estrategias con parámetros propios: "top" (el ranking tal cual) ya tiene su
  // botón en /top y /charts, y "record" el suyo en /records
  const STRATEGIES: { key: PlaylistStrategy; label: string; desc: string; icon: string }[] = [
    { key: 'top_range', label: 'Top tracks', desc: 'Your ranking for a time range, with a custom length.', icon: '*' },
    { key: 'top_artist', label: 'Top artist', desc: 'Your most played tracks by one artist.', icon: '&' },
    { key: 'top_genre', label: 'Top genre', desc: 'Your most played tracks within a genre.', icon: '#' },
    { key: 'deep_cuts', label: 'Deep cuts', desc: 'Tracks you love that almost nobody else plays.', icon: '.' },
    { key: 'time_vibes', label: 'Time vibes', desc: 'What you play on given days and hours.', icon: '!' },
    { key: 'rediscovery', label: 'Rediscovery', desc: 'Old favourites you have stopped playing.', icon: '~' },
  ];
  const STRATEGY_KEYS = new Set(STRATEGIES.map(s => s.key));
  // las playlists creadas desde /top, /charts y /records llegan con sus propias estrategias
  const EXTRA_LABELS: Partial<Record<PlaylistStrategy, string>> = { top: 'Top', chart: 'Chart', record: 'Record', custom: 'Custom' };
  const STRATEGY_LABEL = new Map<PlaylistStrategy, string>([...STRATEGIES.map(s => [s.key, s.label] as const), ...Object.entries(EXTRA_LABELS) as [PlaylistStrategy, string][]]);

  // las estrategias de descubrimiento sobre-muestrean y barajan por defecto (variedad al
  // regenerar); las de ranking devuelven el top exacto en orden
  const SHUFFLE_BY_DEFAULT = new Set<PlaylistStrategy>(['deep_cuts', 'time_vibes', 'rediscovery']);
  const RANGELESS = new Set<PlaylistStrategy>(['rediscovery']);

  const TRACK_COUNTS = [25, 50, 100];
  const RECENCY_DAYS = [30, 60, 90, 180];
  const POPULARITY_MAX = 50;
  const HOURS_PER_DAY = 24;
  const SHUFFLE_POOL_FACTOR = '2.5×';

  // cadencias de auto-regeneración (ms), espejo de REGENERATE_INTERVALS_MS del backend
  const DAY_MS = 86_400_000;
  const INTERVALS: { key: RegenerateInterval; label: string; ms: number }[] = [
    { key: 'daily', label: 'Daily', ms: DAY_MS },
    { key: 'weekly', label: 'Weekly', ms: 7 * DAY_MS },
    { key: 'monthly', label: 'Monthly', ms: 30 * DAY_MS },
  ];
  const intervalFor = (ms?: number | null) => INTERVALS.find(i => i.ms === ms) ?? INTERVALS[1];

  let selectedStrategy = $state<PlaylistStrategy | null>(null);
  let loading = $state(false);
  let creating = $state(false);
  let error = $state<string | null>(null);
  let previewTracks = $state<{ position: number; track: TrackInfo | null }[]>([]);
  let hasPlaylistScopes = $state(true);
  let playlistName = $state('');
  let createdId = $state<number | null>(null);

  // parámetros comunes
  let range = $state('all');
  let startDate = $state('');
  let endDate = $state('');
  let trackCount = $state(50);
  let shuffle = $state(false);

  // top artist
  let artist = $state<{ id: string; name: string } | null>(null);
  let showArtistPicker = $state(false);

  // top genre
  let genreFilter = $state('');
  let genres = $state<GenreItem[]>([]);

  // deep cuts
  let maxPopularity = $state(15);
  let minPlaysDeep = $state(2);

  // time vibes (0 = domingo, como Date#getDay)
  let selectedDays = $state<number[]>([5, 6]);
  let hourStart = $state(20);
  let hourEnd = $state(23);
  const dayNames = getLocalizedDayNames();

  // rediscovery
  let minPlaysRediscovery = $state(5);
  let recencyDays = $state(60);

  // playlists ya generadas
  let saved = $state<GeneratedPlaylist[]>([]);
  let expandedId = $state<number | null>(null);
  let expandedTracks = $state<{ position: number; track: TrackInfo | null }[]>([]);

  let initialized = false;

  onMount(async () => {
    const urlStrategy = getQueryParam('strategy', '') as PlaylistStrategy | '';
    if (urlStrategy && STRATEGY_KEYS.has(urlStrategy)) selectStrategy(urlStrategy);
    const urlRange = getQueryParam('range', '');
    if (urlRange) range = urlRange;
    startDate = getQueryParam('startDate', '');
    endDate = getQueryParam('endDate', '');
    initialized = true;
    try {
      const [me, genreData, list] = await Promise.all([
        api.me() as Promise<MeResponse>,
        api.topGenres('all', 50),
        api.listPlaylists(),
      ]);
      hasPlaylistScopes = me.scopes?.includes('playlist-modify-private') ?? false;
      genres = genreData;
      saved = list.items;
    } catch (err) {
      error = errorMessage(err, 'Could not load the generator');
    }
  });

  // estrategia y rango en la URL, para que un enlace reabra el mismo formulario
  $effect(() => {
    const s = selectedStrategy;
    const r = range;
    const sd = startDate;
    const ed = endDate;
    if (!initialized) return;
    const ranged = !!s && !RANGELESS.has(s);
    setQueryParams({
      strategy: s ?? null,
      range: ranged ? r : null,
      startDate: ranged && r === 'custom' ? sd || null : null,
      endDate: ranged && r === 'custom' ? ed || null : null,
    });
  });

  function selectStrategy(key: PlaylistStrategy) {
    selectedStrategy = key;
    shuffle = SHUFFLE_BY_DEFAULT.has(key);
    previewTracks = [];
    createdId = null;
    error = null;
  }

  const hasRange = $derived(!!selectedStrategy && !RANGELESS.has(selectedStrategy));
  const canGenerate = $derived(
    !!selectedStrategy
    && (selectedStrategy !== 'top_artist' || !!artist)
    && (selectedStrategy !== 'top_genre' || !!genreFilter),
  );

  function buildParams(): Record<string, unknown> {
    const rangeParams = { range, ...(range === 'custom' && startDate && endDate ? { startDate, endDate } : {}) };
    const common = { limit: trackCount, shuffle };
    switch (selectedStrategy) {
      case 'top_range': return { ...rangeParams, ...common };
      case 'top_artist': return { ...rangeParams, ...common, artistId: artist?.id };
      case 'top_genre': return { ...rangeParams, ...common, genre: genreFilter };
      case 'deep_cuts': return { ...rangeParams, ...common, maxPopularity, minPlays: minPlaysDeep };
      case 'time_vibes': {
        const hours = Array.from({ length: Math.max(0, hourEnd - hourStart + 1) }, (_, i) => hourStart + i);
        return { ...rangeParams, ...common, days: selectedDays, hours };
      }
      case 'rediscovery': return { ...common, minPlays: minPlaysRediscovery, recencyDays };
      default: return common;
    }
  }

  async function reloadSaved() {
    saved = (await api.listPlaylists()).items;
  }

  async function preview() {
    if (!canGenerate) return;
    loading = true;
    error = null;
    previewTracks = [];
    try {
      const res = await api.generatePlaylist({ strategy: selectedStrategy!, params: buildParams(), preview: true }) as PlaylistPreviewResponse;
      previewTracks = res.tracks;
    } catch (err) {
      error = errorMessage(err, 'Could not build the preview');
    } finally {
      loading = false;
    }
  }

  async function create() {
    if (!canGenerate) return;
    creating = true;
    error = null;
    try {
      const res = await api.generatePlaylist({ strategy: selectedStrategy!, params: buildParams(), name: playlistName || undefined }) as GeneratedPlaylist;
      previewTracks = res.tracks ?? [];
      createdId = res.libraryPlaylistId ?? null;
      playlistName = '';
      await reloadSaved();
      toastStore.show(`Created "${res.name}" on Spotify`);
    } catch (err) {
      if (errorMessage(err) === 'missing_scopes') hasPlaylistScopes = false;
      else error = errorMessage(err, 'Could not create the playlist');
    } finally {
      creating = false;
    }
  }

  async function regenerate(pl: GeneratedPlaylist) {
    try {
      await api.regeneratePlaylist(pl.id);
      await reloadSaved();
      if (expandedId === pl.id) expandedId = null;
      toastStore.show(`Regenerated "${pl.name}"`);
    } catch (err) {
      error = errorMessage(err, 'Could not regenerate the playlist');
    }
  }

  async function remove(pl: GeneratedPlaylist) {
    if (!confirm(`Delete "${pl.name}" from Spotify too?`)) return;
    try {
      await api.deletePlaylist(pl.id, true);
      await reloadSaved();
      if (expandedId === pl.id) expandedId = null;
    } catch (err) {
      error = errorMessage(err, 'Could not delete the playlist');
    }
  }

  async function setSchedule(pl: GeneratedPlaylist, interval: RegenerateInterval | null) {
    try {
      await api.setPlaylistSchedule(pl.id, interval !== null, interval ?? undefined);
      await reloadSaved();
    } catch (err) {
      error = errorMessage(err, 'Could not update the schedule');
    }
  }

  // las que no están en la biblioteca no tienen página: su tracklist se despliega aquí
  async function toggleTracks(pl: GeneratedPlaylist) {
    if (expandedId === pl.id) { expandedId = null; return; }
    try {
      expandedTracks = (await api.getPlaylist(pl.id)).tracks ?? [];
      expandedId = pl.id;
    } catch (err) {
      error = errorMessage(err, 'Could not load the tracks');
    }
  }

  const libraryHref = (pl: GeneratedPlaylist) => (pl.libraryPlaylistId ? `/playlists/${pl.libraryPlaylistId}` : undefined);
  const spotifyUrl = (pl: GeneratedPlaylist) => pl.spotifyUrl ?? (pl.spotifyPlaylistId ? `https://open.spotify.com/playlist/${pl.spotifyPlaylistId}` : null);

  // acciones de fila en el menú contextual, como el resto de filas de la app
  function openRowMenu(pl: GeneratedPlaylist) {
    return (e: MouseEvent) => {
      e.preventDefault();
      const actions: ContextMenuAction[] = [];
      if (!libraryHref(pl)) actions.push({ label: expandedId === pl.id ? 'Hide tracks' : 'Show tracks', icon: IconTrack, onClick: () => toggleTracks(pl) });
      const url = spotifyUrl(pl);
      if (url) actions.push({ label: 'Open in Spotify', icon: IconExternalLink, onClick: () => { window.open(url, '_blank', 'noopener'); } });
      actions.push({ label: 'Regenerate now', icon: IconRefresh, onClick: () => regenerate(pl) });
      if (pl.spotifyPlaylistId) {
        const current = pl.autoRegenerate ? intervalFor(pl.regenerateIntervalMs).key : null;
        for (const i of INTERVALS) {
          actions.push({ label: `Regenerate ${i.label.toLowerCase()}`, icon: IconClock, disabled: current === i.key, onClick: () => setSchedule(pl, i.key) });
        }
        if (current) actions.push({ label: 'Stop auto-regenerating', icon: IconClock, onClick: () => setSchedule(pl, null) });
      }
      actions.push({ label: 'Delete playlist', icon: IconTrash, danger: true, onClick: () => remove(pl) });
      contextMenu.open(e, actions);
    };
  }

  const scheduleLabel = (pl: GeneratedPlaylist) => (pl.autoRegenerate ? intervalFor(pl.regenerateIntervalMs).label : null);

  const toListItems = (tracks: { position: number; track: TrackInfo | null }[]) =>
    tracks.map((pt, i) => ({ id: i + 1, playedAt: '', contextType: null, track: pt.track }));
</script>

{#if !hasPlaylistScopes}
  <div class="scope-banner">
    <span>Spotify needs playlist permissions to create playlists from here.</span>
    <a href="/auth/login?returnTo={RETURN_TO}" class="range-btn">Log in again</a>
  </div>
{/if}

<div class="strategy-grid">
  {#each STRATEGIES as s (s.key)}
    <button class="strategy-card" class:selected={selectedStrategy === s.key} onclick={() => selectStrategy(s.key)}>
      <span class="strategy-icon">{s.icon}</span>
      <span class="strategy-label">{s.label}</span>
      <span class="strategy-desc">{s.desc}</span>
    </button>
  {/each}
</div>

{#if selectedStrategy}
  <div class="card controls">
    {#if hasRange}
      <div class="control-group control-group--wide">
        <span class="group-label">Time range</span>
        <TimeRangeSelector value={range} onchange={(r) => range = r} {startDate} {endDate} ondatechange={(s, e) => { startDate = s; endDate = e; }} />
      </div>
    {/if}

    {#if selectedStrategy === 'top_artist'}
      <div class="control-group">
        <span class="group-label">Artist</span>
        <div class="chip-row">
          {#if artist}
            <a class="range-btn active" href="/artist/{artist.id}">{artist.name}</a>
            <button class="range-btn" onclick={() => showArtistPicker = true}>Change</button>
          {:else}
            <button class="range-btn" onclick={() => showArtistPicker = true}>Pick an artist…</button>
          {/if}
        </div>
      </div>
    {/if}

    {#if selectedStrategy === 'top_genre'}
      <div class="control-group">
        <span class="group-label">Genre</span>
        <select class="field" bind:value={genreFilter}>
          <option value="">Pick a genre…</option>
          {#each genres as g (g.genre)}
            <option value={g.genre}>{g.genre} ({g.play_count})</option>
          {/each}
        </select>
      </div>
    {/if}

    {#if selectedStrategy === 'deep_cuts'}
      <div class="control-group">
        <span class="group-label">Max popularity · {maxPopularity} <span class="hint">0 = unknown, 100 = mainstream</span></span>
        <input type="range" min="0" max={POPULARITY_MAX} bind:value={maxPopularity} />
      </div>
      <div class="control-group">
        <span class="group-label">Min plays</span>
        <input class="field field--num" type="number" min="1" max="100" bind:value={minPlaysDeep} />
      </div>
    {/if}

    {#if selectedStrategy === 'time_vibes'}
      <div class="control-group">
        <span class="group-label">Days</span>
        <div class="chip-row">
          {#each dayNames as label, i (i)}
            <button class="range-btn" class:active={selectedDays.includes(i)} onclick={() => selectedDays = selectedDays.includes(i) ? selectedDays.filter(d => d !== i) : [...selectedDays, i]}>{label}</button>
          {/each}
        </div>
      </div>
      <div class="control-group">
        <span class="group-label">Hours · {hourStart}:00 to {hourEnd}:00</span>
        <div class="chip-row">
          <input class="field field--num" type="number" min="0" max={HOURS_PER_DAY - 1} bind:value={hourStart} />
          <span class="hint">to</span>
          <input class="field field--num" type="number" min="0" max={HOURS_PER_DAY - 1} bind:value={hourEnd} />
        </div>
      </div>
    {/if}

    {#if selectedStrategy === 'rediscovery'}
      <div class="control-group">
        <span class="group-label">Min all-time plays</span>
        <input class="field field--num" type="number" min="1" max="500" bind:value={minPlaysRediscovery} />
      </div>
      <div class="control-group">
        <span class="group-label">Not played in the last</span>
        <div class="chip-row">
          {#each RECENCY_DAYS as days (days)}
            <button class="range-btn" class:active={recencyDays === days} onclick={() => recencyDays = days}>{days}d</button>
          {/each}
        </div>
      </div>
    {/if}

    <div class="control-group">
      <span class="group-label">Tracks</span>
      <div class="chip-row">
        {#each TRACK_COUNTS as n (n)}
          <button class="range-btn" class:active={trackCount === n} onclick={() => trackCount = n}>{n}</button>
        {/each}
      </div>
    </div>

    <div class="control-group">
      <span class="group-label">Selection <span class="hint">{shuffle ? `random pick from a ${SHUFFLE_POOL_FACTOR} pool, changes on regenerate` : 'exact top, in ranking order'}</span></span>
      <div class="chip-row">
        <button class="range-btn" class:active={!shuffle} onclick={() => shuffle = false}>Exact top</button>
        <button class="range-btn" class:active={shuffle} onclick={() => shuffle = true}>Shuffled</button>
      </div>
    </div>

    <div class="control-group control-group--wide">
      <span class="group-label">Name <span class="hint">optional</span></span>
      <input class="field" type="text" placeholder="Generated from the strategy if empty" bind:value={playlistName} />
    </div>

    <div class="actions">
      <button class="range-btn" onclick={preview} disabled={loading || !canGenerate}>{loading ? 'Building…' : 'Preview'}</button>
      {#if createdId}
        <a href="/playlists/{createdId}" class="primary-btn">Created · open it</a>
      {:else}
        <button class="primary-btn" onclick={create} disabled={creating || !hasPlaylistScopes || !canGenerate}>
          <IconSpotify />
          {creating ? 'Creating…' : 'Create on Spotify'}
        </button>
      {/if}
    </div>

    {#if error}<div class="error">{error}</div>{/if}
  </div>
{:else if error}
  <div class="error">{error}</div>
{/if}

{#if previewTracks.length > 0}
  <section class="detail-section">
    <h2 class="section-title">Preview · {previewTracks.length} tracks</h2>
    <div class="card">
      <TrackList items={toListItems(previewTracks)} showRank />
    </div>
  </section>
{/if}

{#if saved.length > 0}
  <section class="detail-section">
    <h2 class="section-title">Generated playlists</h2>
    <div class="track-list">
      {#each saved as pl (pl.id)}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="saved-row" oncontextmenu={openRowMenu(pl)}>
          <TrackItem name={pl.name} nameHref={libraryHref(pl)} href={libraryHref(pl)}>
            {#snippet cover()}
              <span class="track-art saved-art" aria-hidden="true">{STRATEGIES.find(s => s.key === pl.strategy)?.icon ?? '♫'}</span>
            {/snippet}
            {#snippet subtitle()}
              {STRATEGY_LABEL.get(pl.strategy) ?? pl.strategy.replace(/_/g, ' ')} · {pl.trackCount} tracks · {formatDate(pl.createdAt)}
            {/snippet}
            {#snippet meta()}
              {#if scheduleLabel(pl)}<span class="saved-schedule" title="Auto-regenerates"><IconRefresh size={12} /> {scheduleLabel(pl)}</span>{/if}
            {/snippet}
          </TrackItem>
          {#if expandedId === pl.id}
            <div class="saved-tracks">
              <TrackList items={toListItems(expandedTracks)} showRank />
            </div>
          {/if}
        </div>
      {/each}
    </div>
  </section>
{/if}

<SearchModal
  bind:show={showArtistPicker}
  pick={{
    types: ['artist'],
    placeholder: 'Whose top tracks?',
    onPick: (entity) => { artist = { id: entity.id, name: entity.name }; previewTracks = []; createdId = null; },
  }}
/>

<style>
  .scope-banner {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    margin-bottom: 1rem;
    border: 1px solid var(--accent-a40);
    border-radius: var(--radius);
    background: var(--accent-a05);
    color: var(--text);
    font-size: var(--fs-md);
  }
  .scope-banner .range-btn { text-decoration: none; }

  .strategy-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 0.75rem;
    margin-bottom: 1rem;
  }
  .strategy-card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.25rem;
    padding: 1rem;
    text-align: left;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text);
    cursor: pointer;
    transition: border-color 0.05s;
    /* es un botón, y los botones van en mono: la tarjeta es texto, como el resto de cards */
    font-family: var(--font-sans);
    letter-spacing: normal;
  }
  .strategy-card:hover { border-color: var(--text-muted); }
  .strategy-card.selected { border-color: var(--accent); }
  .strategy-icon {
    font-family: var(--font-mono);
    font-size: var(--fs-xl);
    line-height: 1;
    color: var(--accent);
  }
  .strategy-label { font-weight: 600; font-size: var(--fs-md); }
  .strategy-desc { font-size: var(--fs-sm); color: var(--text-muted); line-height: 1.4; }

  .controls {
    display: flex;
    flex-wrap: wrap;
    gap: 1.25rem 1.75rem;
    align-items: flex-end;
  }
  .control-group {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .control-group--wide { flex-basis: 100%; }
  .control-group :global(.time-range-selector) { margin-bottom: 0; }
  .group-label {
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    letter-spacing: var(--track-wide);
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .hint {
    text-transform: none;
    letter-spacing: normal;
    font-family: inherit;
    color: var(--text-muted);
    font-size: var(--fs-xs);
  }
  .chip-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem;
  }
  .chip-row a.range-btn { text-decoration: none; }

  .field {
    padding: 0.4rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--text);
    font-size: var(--fs-md);
    min-width: 0;
  }
  .field:focus { outline: none; border-color: var(--accent); }
  .field--num { width: 5rem; }
  .control-group--wide .field { width: 100%; max-width: 28rem; }
  input[type='range'] { accent-color: var(--accent); width: 14rem; max-width: 100%; }

  .actions {
    flex-basis: 100%;
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    padding-top: 0.25rem;
    border-top: 1px solid var(--border);
  }
  .primary-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.4rem 1rem;
    border-radius: var(--radius);
    border: 1px solid var(--accent);
    background: var(--accent);
    color: var(--on-accent);
    cursor: pointer;
    font-weight: 600;
    font-size: var(--fs-md);
    text-decoration: none;
    transition: all 0.05s;
  }
  .primary-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .primary-btn:hover:not(:disabled) { background: var(--accent-hover); border-color: var(--accent-hover); }

  .error {
    flex-basis: 100%;
    color: var(--danger);
    font-size: var(--fs-md);
  }

  .saved-art {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-family: var(--font-mono);
    font-size: var(--fs-lg);
    color: var(--accent);
    background: var(--fg-a05);
  }
  .saved-schedule {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    color: var(--text-muted);
    white-space: nowrap;
  }
  .saved-tracks { padding: 0 0 0.75rem 2.5rem; }
</style>
