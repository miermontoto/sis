<script lang="ts">
  import { onMount } from 'svelte';
  import { api, type PlaylistStrategy, type GeneratedPlaylist, type PlaylistPreviewResponse, type TrackInfo, type GenreItem, type MeResponse } from '$lib/api';
  import TimeRangeSelector from '$lib/components/TimeRangeSelector.svelte';
  import TrackList from '$lib/components/TrackList.svelte';
  import { formatDate } from '$lib/utils/format';

  const strategies: { key: PlaylistStrategy; label: string; desc: string; icon: string }[] = [
    { key: 'top_range', label: 'Top Tracks', desc: 'Tu ranking por rango temporal', icon: '*' },
    { key: 'top_artist', label: 'Top Artist', desc: 'Tus tracks mas escuchados de un artista', icon: '&' },
    { key: 'top_genre', label: 'Top Genre', desc: 'Tracks mas escuchados de un genero', icon: '#' },
    { key: 'deep_cuts', label: 'Deep Cuts', desc: 'Joyas ocultas con baja popularidad', icon: '.' },
    { key: 'time_vibes', label: 'Time Vibes', desc: 'Tracks segun dia y hora', icon: '!' },
    { key: 'rediscovery', label: 'Rediscovery', desc: 'Favoritos olvidados que ya no escuchas', icon: '~' },
  ];

  // state
  let selectedStrategy = $state<PlaylistStrategy | null>(null);
  let loading = $state(false);
  let creating = $state(false);
  let error = $state<string | null>(null);
  let previewTracks = $state<{ position: number; track: TrackInfo | null }[]>([]);
  let hasPlaylistScopes = $state(true);
  let playlistName = $state('');

  // parametros comunes
  let range = $state('all');
  let startDate = $state('');
  let endDate = $state('');
  let trackCount = $state(50);

  // top artist params
  let artistSearch = $state('');
  let artistId = $state<string | null>(null);
  let artistName = $state<string | null>(null);

  // top genre params
  let genreFilter = $state('');
  let genres = $state<GenreItem[]>([]);

  // deep cuts params
  let maxPopularity = $state(15);
  let minPlaysDeep = $state(2);

  // time vibes params
  let selectedDays = $state<number[]>([5, 6]);
  let hourStart = $state(20);
  let hourEnd = $state(23);

  // rediscovery params
  let minPlaysRediscovery = $state(5);
  let recencyDays = $state(60);

  // historial
  let savedPlaylists = $state<GeneratedPlaylist[]>([]);
  let expandedPlaylist = $state<number | null>(null);
  let expandedTracks = $state<{ position: number; track: TrackInfo | null }[]>([]);

  const dayLabels = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'];

  onMount(async () => {
    try {
      const [meData, genreData, plData] = await Promise.all([
        api.me() as Promise<MeResponse>,
        api.topGenres('all', 50),
        api.listPlaylists(),
      ]);
      hasPlaylistScopes = meData.scopes?.includes('playlist-modify-private') ?? false;
      genres = genreData;
      savedPlaylists = plData.items;
    } catch {}
  });

  function buildParams(): Record<string, unknown> {
    const rangeParams = { range, ...(range === 'custom' && startDate && endDate ? { startDate, endDate } : {}) };

    switch (selectedStrategy) {
      case 'top_range':
        return { ...rangeParams, limit: trackCount };
      case 'top_artist':
        return { ...rangeParams, limit: trackCount, artistId };
      case 'top_genre':
        return { ...rangeParams, limit: trackCount, genre: genreFilter };
      case 'deep_cuts':
        return { ...rangeParams, limit: trackCount, maxPopularity, minPlays: minPlaysDeep };
      case 'time_vibes': {
        const hours: number[] = [];
        for (let h = hourStart; h <= hourEnd; h++) hours.push(h);
        return { ...rangeParams, limit: trackCount, days: selectedDays, hours };
      }
      case 'rediscovery':
        return { limit: trackCount, minPlays: minPlaysRediscovery, recencyDays };
      default:
        return { limit: trackCount };
    }
  }

  function canGenerate(): boolean {
    if (!selectedStrategy) return false;
    if (selectedStrategy === 'top_artist' && !artistId) return false;
    if (selectedStrategy === 'top_genre' && !genreFilter) return false;
    return true;
  }

  async function handlePreview() {
    if (!canGenerate()) return;
    loading = true;
    error = null;
    previewTracks = [];
    try {
      const res = await api.generatePlaylist({
        strategy: selectedStrategy!,
        params: buildParams(),
        preview: true,
      }) as PlaylistPreviewResponse;
      previewTracks = res.tracks;
    } catch (err: any) {
      error = err.message || 'Error al generar preview';
    } finally {
      loading = false;
    }
  }

  async function handleCreate() {
    if (!canGenerate()) return;
    creating = true;
    error = null;
    try {
      const res = await api.generatePlaylist({
        strategy: selectedStrategy!,
        params: buildParams(),
        name: playlistName || undefined,
      }) as GeneratedPlaylist;
      const plData = await api.listPlaylists();
      savedPlaylists = plData.items;
      previewTracks = res.tracks || [];
      playlistName = '';
    } catch (err: any) {
      if (err.message === 'missing_scopes') {
        hasPlaylistScopes = false;
      } else {
        error = err.message || 'Error al crear playlist';
      }
    } finally {
      creating = false;
    }
  }

  async function handleRegenerate(id: number) {
    try {
      await api.regeneratePlaylist(id);
      const plData = await api.listPlaylists();
      savedPlaylists = plData.items;
      if (expandedPlaylist === id) expandedPlaylist = null;
    } catch (err: any) {
      error = err.message;
    }
  }

  async function handleDelete(id: number) {
    if (!confirm('Eliminar playlist?')) return;
    try {
      await api.deletePlaylist(id, true);
      const plData = await api.listPlaylists();
      savedPlaylists = plData.items;
      if (expandedPlaylist === id) expandedPlaylist = null;
    } catch (err: any) {
      error = err.message;
    }
  }

  async function toggleExpand(id: number) {
    if (expandedPlaylist === id) {
      expandedPlaylist = null;
      return;
    }
    try {
      const detail = await api.getPlaylist(id);
      expandedTracks = detail.tracks || [];
      expandedPlaylist = id;
    } catch {}
  }

  async function searchArtist() {
    if (!artistSearch.trim()) { artistId = null; artistName = null; return; }
    try {
      const results = await api.search(artistSearch, 1);
      if (results.artists.length > 0) {
        artistId = results.artists[0].id;
        artistName = results.artists[0].name;
      } else {
        artistId = null;
        artistName = null;
      }
    } catch { artistId = null; artistName = null; }
  }

  function toggleDay(day: number) {
    if (selectedDays.includes(day)) {
      selectedDays = selectedDays.filter(d => d !== day);
    } else {
      selectedDays = [...selectedDays, day];
    }
  }
</script>

<h1>Playlists</h1>

{#if !hasPlaylistScopes}
  <div class="scope-banner">
    <span>Se requieren permisos adicionales de Spotify para crear playlists.</span>
    <a href="/auth/login?returnTo=/playlists" class="action-btn small">Re-autenticar</a>
  </div>
{/if}

<div class="card">
  <h2>Generar playlist</h2>
  <div class="strategy-grid">
    {#each strategies as s}
      <button
        class="strategy-card"
        class:selected={selectedStrategy === s.key}
        onclick={() => { selectedStrategy = s.key; previewTracks = []; error = null; }}
      >
        <span class="strategy-icon">{s.icon}</span>
        <span class="strategy-label">{s.label}</span>
        <span class="strategy-desc">{s.desc}</span>
      </button>
    {/each}
  </div>

  {#if selectedStrategy}
    <div class="filters">
      <!-- Rango temporal (no para rediscovery) -->
      {#if selectedStrategy !== 'rediscovery'}
        <div class="filter-row">
          <label>Rango temporal</label>
          <TimeRangeSelector
            value={range}
            onchange={(r) => range = r}
            {startDate}
            {endDate}
            ondatechange={(s, e) => { startDate = s; endDate = e; }}
          />
        </div>
      {/if}

      <!-- Top Artist: buscar artista -->
      {#if selectedStrategy === 'top_artist'}
        <div class="filter-row">
          <label>Artista</label>
          <div class="artist-search">
            <input
              type="text"
              placeholder="Buscar artista..."
              bind:value={artistSearch}
              onkeydown={(e) => { if (e.key === 'Enter') searchArtist(); }}
            />
            <button class="action-btn small" onclick={searchArtist}>Buscar</button>
            {#if artistName}
              <span class="artist-badge">{artistName} <button onclick={() => { artistId = null; artistName = null; artistSearch = ''; }}>&times;</button></span>
            {/if}
          </div>
        </div>
      {/if}

      <!-- Top Genre: selector de genero -->
      {#if selectedStrategy === 'top_genre'}
        <div class="filter-row">
          <label>Genero</label>
          <select bind:value={genreFilter}>
            <option value="">Seleccionar genero...</option>
            {#each genres as g}
              <option value={g.genre}>{g.genre} ({g.play_count})</option>
            {/each}
          </select>
        </div>
      {/if}

      <!-- Deep Cuts -->
      {#if selectedStrategy === 'deep_cuts'}
        <div class="filter-row">
          <label>Popularidad maxima: {maxPopularity} <span class="hint">(0 = desconocido, 100 = mainstream)</span></label>
          <input type="range" min="0" max="50" bind:value={maxPopularity} />
        </div>
        <div class="filter-row">
          <label>Minimo de plays</label>
          <input type="number" min="1" max="100" bind:value={minPlaysDeep} />
        </div>
      {/if}

      <!-- Time Vibes -->
      {#if selectedStrategy === 'time_vibes'}
        <div class="filter-row">
          <label>Dias</label>
          <div class="day-selector">
            {#each dayLabels as label, i}
              <button
                class="day-btn"
                class:active={selectedDays.includes(i)}
                onclick={() => toggleDay(i)}
              >{label}</button>
            {/each}
          </div>
        </div>
        <div class="filter-row">
          <label>Horas: {hourStart}:00 — {hourEnd}:00</label>
          <div class="hour-range">
            <input type="number" min="0" max="23" bind:value={hourStart} />
            <span>—</span>
            <input type="number" min="0" max="23" bind:value={hourEnd} />
          </div>
        </div>
      {/if}

      <!-- Rediscovery -->
      {#if selectedStrategy === 'rediscovery'}
        <div class="filter-row">
          <label>Minimo de plays historicos</label>
          <input type="number" min="1" max="500" bind:value={minPlaysRediscovery} />
        </div>
        <div class="filter-row">
          <label>No escuchado en los ultimos</label>
          <div class="segmented">
            {#each [30, 60, 90, 180] as days}
              <button class:active={recencyDays === days} onclick={() => recencyDays = days}>{days}d</button>
            {/each}
          </div>
        </div>
      {/if}

      <!-- Track count -->
      <div class="filter-row">
        <label>Cantidad de tracks</label>
        <div class="segmented">
          {#each [25, 50, 100] as n}
            <button class:active={trackCount === n} onclick={() => trackCount = n}>{n}</button>
          {/each}
        </div>
      </div>

      <!-- Nombre -->
      <div class="filter-row">
        <label>Nombre (opcional)</label>
        <input type="text" placeholder="Auto-generado si vacio" bind:value={playlistName} />
      </div>

      <!-- Actions -->
      <div class="actions">
        <button class="action-btn secondary" onclick={handlePreview} disabled={loading || !canGenerate()}>
          {loading ? 'Cargando...' : 'Preview'}
        </button>
        <button class="action-btn primary" onclick={handleCreate} disabled={creating || !hasPlaylistScopes || !canGenerate()}>
          {creating ? 'Creando...' : 'Crear en Spotify'}
        </button>
      </div>
    </div>
  {/if}

  {#if error}
    <div class="error">{error}</div>
  {/if}
</div>

{#if previewTracks.length > 0}
  <div class="card">
    <h2>Preview ({previewTracks.length} tracks)</h2>
    <TrackList
      items={previewTracks.map((pt, i) => ({
        id: i + 1,
        playedAt: '',
        contextType: null,
        track: pt.track,
      }))}
      showRank
    />
  </div>
{/if}

{#if savedPlaylists.length > 0}
  <div class="card">
    <h2>Playlists generadas</h2>
    <div class="playlist-list">
      {#each savedPlaylists as pl}
        <div class="playlist-item">
          <button class="playlist-row" onclick={() => toggleExpand(pl.id)}>
            <span class="playlist-name">{pl.name}</span>
            <span class="playlist-badge">{pl.strategy.replace(/_/g, ' ')}</span>
            <span class="playlist-meta">{pl.trackCount} tracks</span>
            <span class="playlist-date">{formatDate(pl.createdAt)}</span>
          </button>
          <div class="playlist-actions">
            {#if pl.spotifyPlaylistId}
              <a
                href="https://open.spotify.com/playlist/{pl.spotifyPlaylistId}"
                target="_blank"
                rel="noopener"
                class="spotify-link"
                title="Abrir en Spotify"
              >
                <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                  <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
                </svg>
              </a>
            {/if}
            <button class="action-btn small secondary" onclick={() => handleRegenerate(pl.id)}>Regenerar</button>
            <button class="action-btn small danger" onclick={() => handleDelete(pl.id)}>Eliminar</button>
          </div>
          {#if expandedPlaylist === pl.id && pl.spotifyPlaylistId}
            <div class="playlist-embed">
              <iframe
                title="Spotify Playlist"
                src="https://open.spotify.com/embed/playlist/{pl.spotifyPlaylistId}?utm_source=generator&theme=0"
                width="100%"
                height="352"
                frameborder="0"
                allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                loading="lazy"
              ></iframe>
            </div>
          {:else if expandedPlaylist === pl.id}
            <div class="playlist-tracks">
              <TrackList
                items={expandedTracks.map((pt, i) => ({
                  id: i + 1,
                  playedAt: '',
                  contextType: null,
                  track: pt.track,
                }))}
                showRank
              />
            </div>
          {/if}
        </div>
      {/each}
    </div>
  </div>
{/if}

<style>
  h1 { margin-bottom: 1.5rem; }
  h2 { margin: 0 0 1rem; font-size: 1.1rem; }

  .card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1.5rem;
    margin-bottom: 1.5rem;
  }

  .scope-banner {
    background: rgba(231, 76, 60, 0.1);
    border: 1px solid rgba(231, 76, 60, 0.3);
    border-radius: var(--radius);
    padding: 1rem 1.5rem;
    margin-bottom: 1.5rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    color: #e74c3c;
    font-size: 0.9rem;
  }

  .strategy-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.75rem;
    margin-bottom: 1.5rem;
  }

  .strategy-card {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1rem;
    cursor: pointer;
    text-align: left;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    transition: border-color 0.15s;
    color: var(--text);
    font-family: var(--font);
  }

  .strategy-card:hover {
    border-color: var(--text-muted);
  }

  .strategy-card.selected {
    border-color: var(--accent);
  }

  .strategy-icon {
    font-size: 1.4rem;
    opacity: 0.7;
  }

  .strategy-label {
    font-weight: 600;
    font-size: 0.95rem;
  }

  .strategy-desc {
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  .filters {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .filter-row {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .filter-row label {
    font-size: 0.85rem;
    color: var(--text-muted);
  }

  .hint {
    font-size: 0.75rem;
    opacity: 0.6;
  }

  .filter-row input[type="text"],
  .filter-row input[type="number"],
  .filter-row select {
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.5rem 0.75rem;
    font-size: 0.9rem;
    font-family: var(--font);
    outline: none;
    max-width: 300px;
  }

  .filter-row input:focus,
  .filter-row select:focus {
    border-color: var(--accent);
  }

  .filter-row input[type="range"] {
    max-width: 300px;
    accent-color: var(--accent);
  }

  .segmented {
    display: flex;
    gap: 0;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
    width: fit-content;
  }

  .segmented button {
    background: transparent;
    border: none;
    padding: 0.4rem 1rem;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 0.85rem;
    font-family: var(--font);
    transition: all 0.15s;
  }

  .segmented button.active {
    background: var(--accent);
    color: #000;
  }

  .artist-search {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .artist-search input {
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.5rem 0.75rem;
    font-size: 0.9rem;
    font-family: var(--font);
    outline: none;
    width: 200px;
  }

  .artist-search input:focus {
    border-color: var(--accent);
  }

  .artist-badge {
    background: rgba(29, 185, 84, 0.15);
    color: var(--accent);
    padding: 0.3rem 0.6rem;
    border-radius: 999px;
    font-size: 0.8rem;
    display: flex;
    align-items: center;
    gap: 0.3rem;
  }

  .artist-badge button {
    background: none;
    border: none;
    color: var(--accent);
    cursor: pointer;
    font-size: 1rem;
    padding: 0;
    line-height: 1;
  }

  .day-selector {
    display: flex;
    gap: 0.25rem;
  }

  .day-btn {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.4rem 0.6rem;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 0.8rem;
    font-family: var(--font);
    transition: all 0.15s;
  }

  .day-btn.active {
    background: var(--accent);
    color: #000;
    border-color: var(--accent);
  }

  .hour-range {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .hour-range input {
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.4rem 0.6rem;
    font-size: 0.85rem;
    font-family: var(--font);
    width: 60px;
    outline: none;
  }

  .hour-range input:focus {
    border-color: var(--accent);
  }

  .hour-range span {
    color: var(--text-muted);
  }

  .actions {
    display: flex;
    gap: 0.75rem;
    margin-top: 0.5rem;
  }

  .action-btn {
    padding: 0.55rem 1.2rem;
    border-radius: var(--radius);
    font-size: 0.9rem;
    font-family: var(--font);
    cursor: pointer;
    border: none;
    transition: all 0.15s;
    text-decoration: none;
  }

  .action-btn.primary {
    background: var(--accent);
    color: #000;
  }

  .action-btn.primary:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .action-btn.primary:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .action-btn.secondary {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text);
  }

  .action-btn.secondary:hover:not(:disabled) {
    border-color: var(--text-muted);
  }

  .action-btn.secondary:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .action-btn.small {
    padding: 0.3rem 0.7rem;
    font-size: 0.8rem;
  }

  .action-btn.danger {
    background: transparent;
    border: 1px solid rgba(231, 76, 60, 0.3);
    color: #e74c3c;
  }

  .action-btn.danger:hover {
    background: rgba(231, 76, 60, 0.1);
  }

  .error {
    color: #e74c3c;
    font-size: 0.85rem;
    margin-top: 1rem;
  }

  .playlist-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .playlist-item {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
  }

  .playlist-row {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.75rem 1rem;
    background: transparent;
    border: none;
    color: var(--text);
    cursor: pointer;
    width: 100%;
    text-align: left;
    font-family: var(--font);
    font-size: 0.9rem;
    transition: background 0.15s;
  }

  .playlist-row:hover {
    background: var(--bg-hover);
  }

  .playlist-name {
    font-weight: 500;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .playlist-badge {
    background: rgba(29, 185, 84, 0.15);
    color: var(--accent);
    padding: 0.15rem 0.5rem;
    border-radius: 999px;
    font-size: 0.75rem;
    text-transform: capitalize;
    white-space: nowrap;
  }

  .playlist-meta {
    color: var(--text-muted);
    font-size: 0.8rem;
    white-space: nowrap;
  }

  .playlist-date {
    color: var(--text-muted);
    font-size: 0.8rem;
    white-space: nowrap;
  }

  .playlist-actions {
    display: flex;
    gap: 0.5rem;
    padding: 0 1rem 0.75rem;
  }

  .spotify-link {
    display: flex;
    align-items: center;
    color: #1db954;
    transition: color 0.15s;
  }

  .spotify-link:hover {
    color: #1ed760;
  }

  .playlist-embed {
    padding: 0.75rem 1rem 1rem;
    border-top: 1px solid var(--border);
  }

  .playlist-embed iframe {
    border-radius: 12px;
  }

  .playlist-tracks {
    padding: 0 1rem 1rem;
    border-top: 1px solid var(--border);
  }

  @media (max-width: 768px) {
    .strategy-grid {
      grid-template-columns: repeat(2, 1fr);
    }

    .playlist-row {
      flex-wrap: wrap;
      gap: 0.5rem;
    }

    .playlist-date {
      display: none;
    }

    .actions {
      flex-direction: column;
    }

    .artist-search {
      flex-direction: column;
      align-items: flex-start;
    }

    .artist-search input {
      width: 100%;
    }
  }
</style>
