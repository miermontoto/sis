<script lang="ts">
  import { onMount } from 'svelte';
  import { api, getRankingMetric, setRankingMetric, getWeekStart, setWeekStart, getRawLocale, setLocale, getLocale, LOCALE_OPTIONS, type HealthData, type StreaksData, type ImportResult, type RankingMetric, type MergeRule, type WeekStartOption, type LocaleSetting, type UserRecord, type MeResponse } from '$lib/api';
  import { formatNumber, formatDate } from '$lib/utils/format';
  import IconClock from '$lib/icons/IconClock.svelte';
  import IconPlayOutline from '$lib/icons/IconPlayOutline.svelte';
  import IconCheck from '$lib/icons/IconCheck.svelte';
  import IconUpload from '$lib/icons/IconUpload.svelte';
  import IconDownload from '$lib/icons/IconDownload.svelte';

  let health = $state<HealthData | null>(null);
  let streaks = $state<StreaksData | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);

  // preferencias
  let rankingMetric = $state<RankingMetric>('time');
  let weekStartPref = $state<WeekStartOption>('monday');
  let localePref = $state<LocaleSetting>('auto');

  // admin
  let me = $state<MeResponse | null>(null);
  let users = $state<UserRecord[]>([]);
  let newSpotifyId = $state('');
  let addingUser = $state(false);
  let userError = $state<string | null>(null);

  async function loadUsers() {
    try { users = await api.listUsers(); } catch { users = []; }
  }

  async function handleAddUser() {
    if (!newSpotifyId.trim()) return;
    addingUser = true;
    userError = null;
    try {
      await api.addUser(newSpotifyId.trim());
      newSpotifyId = '';
      await loadUsers();
    } catch (err: any) {
      userError = err.message || 'Failed to add user';
    } finally {
      addingUser = false;
    }
  }

  async function toggleAdmin(user: UserRecord) {
    try {
      await api.updateUser(user.id, { isAdmin: !user.isAdmin });
      await loadUsers();
    } catch (err: any) {
      userError = err.message;
    }
  }

  async function deactivateUser(user: UserRecord) {
    if (!confirm(`Deactivate ${user.displayName || user.spotifyId}? They won't be able to log in.`)) return;
    try {
      await api.deleteUser(user.id);
      await loadUsers();
    } catch (err: any) {
      userError = err.message;
    }
  }

  async function deleteUser(user: UserRecord) {
    if (!confirm(`Permanently delete ${user.displayName || user.spotifyId} and all their data? This cannot be undone.`)) return;
    try {
      await api.deleteUser(user.id);
      await loadUsers();
    } catch (err: any) {
      userError = err.message;
    }
  }

  async function reactivateUser(user: UserRecord) {
    try {
      await api.updateUser(user.id, { isActive: true });
      await loadUsers();
    } catch (err: any) {
      userError = err.message;
    }
  }

  // merges
  let merges = $state<MergeRule[]>([]);
  let mergeSearch = $state('');

  async function loadMerges() {
    try { merges = await api.listMerges(); } catch { merges = []; }
  }

  async function removeMerge(id: number) {
    await api.deleteMerge(id);
    await loadMerges();
  }

  // agrupa reglas por artista: para merges de album/track usa su artist_id/name/image,
  // para merges de artista usa el propio target (que ES un artista).
  const MERGE_TYPE_ORDER: Record<string, number> = { artist: 0, album: 1, track: 2 };
  type MergeGroup = { artistId: string; artistName: string; artistImage: string | null; merges: MergeRule[] };
  function groupMergesByArtist(rules: MergeRule[], term: string): MergeGroup[] {
    const normStr = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const filtered = term
      ? rules.filter(m =>
          normStr(m.target_name).includes(term) ||
          normStr(m.source_name).includes(term) ||
          normStr(m.artist_name ?? '').includes(term))
      : rules;
    const groups = new Map<string, MergeGroup>();
    for (const m of filtered) {
      const [aId, aName, aImg] = m.entity_type === 'artist'
        ? [m.target_id, m.target_name, m.target_image]
        : [m.artist_id ?? 'unknown', m.artist_name ?? 'Unknown', m.artist_image];
      if (!groups.has(aId)) groups.set(aId, { artistId: aId, artistName: aName, artistImage: aImg, merges: [] });
      groups.get(aId)!.merges.push(m);
    }
    for (const g of groups.values()) {
      g.merges.sort((a, b) => {
        const t = (MERGE_TYPE_ORDER[a.entity_type] ?? 9) - (MERGE_TYPE_ORDER[b.entity_type] ?? 9);
        if (t !== 0) return t;
        const tn = a.target_name.localeCompare(b.target_name);
        if (tn !== 0) return tn;
        return a.source_name.localeCompare(b.source_name);
      });
    }
    return [...groups.values()].sort((a, b) => a.artistName.localeCompare(b.artistName));
  }

  // artistas expandidos (colapsados por defecto). Durante una búsqueda todos se tratan como expandidos.
  let expandedArtists = $state<Set<string>>(new Set());
  function toggleArtist(id: string) {
    const next = new Set(expandedArtists);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    expandedArtists = next;
  }

  // estado del import
  let importFiles = $state<FileList | null>(null);
  let importing = $state(false);
  let importResult = $state<ImportResult | null>(null);
  let importError = $state<string | null>(null);

  async function handleImport() {
    if (!importFiles || importFiles.length === 0) return;
    importing = true;
    importResult = null;
    importError = null;
    try {
      importResult = await api.importHistory(importFiles);
      // refrescar health para actualizar total plays
      health = await api.health();
    } catch (err: any) {
      importError = err.message || 'Import failed';
    } finally {
      importing = false;
    }
  }

  function handleMetricChange(m: RankingMetric) {
    rankingMetric = m;
    setRankingMetric(m);
  }

  onMount(async () => {
    rankingMetric = getRankingMetric();
    weekStartPref = getWeekStart();
    localePref = getRawLocale();
    try {
      [health, streaks, me] = await Promise.all([
        api.health(),
        api.streaks(),
        api.me(),
      ]);
      loadMerges();
      if (me?.isAdmin) loadUsers();
    } catch (err: any) {
      error = err.message || 'Failed to load settings';
    } finally {
      loading = false;
    }
  });
</script>

<div class="page-header">
  <h1>Settings</h1>
</div>

{#if loading}
  <div class="loading">
    <div class="spinner"></div>
  </div>
{:else if error}
  <div class="card" style="border-color: var(--danger);">
    <p style="color: var(--danger);">Error: {error}</p>
    <p style="color: var(--text-muted); margin-top: 0.5rem;">Make sure the API server is running on port 3000.</p>
  </div>
{:else}
  <div class="stats-grid" style="margin-bottom: 1.5rem;">
    <div class="card stat-card">
      <div class="stat-value" style="color: {health?.status === 'ok' ? 'var(--accent)' : 'var(--danger)'};">
        {health?.status === 'ok' ? '✓' : '✗'}
      </div>
      <div class="stat-label">Server</div>
    </div>
    <div class="card stat-card">
      <div class="stat-value" style="color: {health?.authenticated ? 'var(--accent)' : 'var(--text-muted)'};">
        {health?.authenticated ? '✓' : '✗'}
      </div>
      <div class="stat-label">Spotify</div>
    </div>
    <div class="card stat-card">
      <div class="stat-value">{formatNumber(health?.totalPlays ?? 0)}</div>
      <div class="stat-label">Total plays</div>
    </div>
    <div class="card stat-card">
      <div class="stat-value">{streaks?.totalDays ?? 0}</div>
      <div class="stat-label">Active days</div>
    </div>
  </div>

  <div class="card prefs-card">
    <h3 class="prefs-title">Preferences</h3>
    <div class="prefs-list">
      <div class="pref-row">
        <div class="pref-info">
          <div class="pref-label">Ranking metric</div>
          <div class="pref-desc">How tracks, artists and albums are ranked across the app</div>
        </div>
        <div class="pref-control">
          <div class="segmented">
            <button
              class="segmented-btn"
              class:segmented-active={rankingMetric === 'time'}
              onclick={() => handleMetricChange('time')}
            >
              <IconClock />
              Minutes
            </button>
            <button
              class="segmented-btn"
              class:segmented-active={rankingMetric === 'plays'}
              onclick={() => handleMetricChange('plays')}
            >
              <IconPlayOutline />
              Plays
            </button>
          </div>
        </div>
      </div>
      <div class="pref-row row-border">
        <div class="pref-info">
          <div class="pref-label">Chart week start</div>
          <div class="pref-desc">Defines how weekly charts are calculated in the Records page</div>
        </div>
        <div class="pref-control">
          <div class="segmented">
            <button class="segmented-btn" class:segmented-active={weekStartPref === 'monday'} onclick={() => { weekStartPref = 'monday'; setWeekStart('monday'); }}>Mon</button>
            <button class="segmented-btn" class:segmented-active={weekStartPref === 'friday'} onclick={() => { weekStartPref = 'friday'; setWeekStart('friday'); }}>Fri</button>
            <button class="segmented-btn" class:segmented-active={weekStartPref === 'sunday'} onclick={() => { weekStartPref = 'sunday'; setWeekStart('sunday'); }}>Sun</button>
          </div>
        </div>
      </div>
      <div class="pref-row row-border">
        <div class="pref-info">
          <div class="pref-label">Locale</div>
          <div class="pref-desc">Affects date and number formatting across the app</div>
        </div>
        <div class="pref-control">
          <select
            class="locale-select"
            value={localePref}
            onchange={(e) => { const v = (e.target as HTMLSelectElement).value; localePref = v; setLocale(v); }}
          >
            {#each LOCALE_OPTIONS as opt}
              <option value={opt.value}>
                {opt.value === 'auto' ? `${opt.label} (${getLocale()})` : opt.label}
              </option>
            {/each}
          </select>
        </div>
      </div>
    </div>
  </div>

  <div class="card section-card">
    <h3 class="section-card-title">Account</h3>
    <div class="section-list">
      <div class="pref-row">
        <div class="pref-info">
          <div class="pref-label">Spotify</div>
          <div class="pref-desc">
            {#if health?.authenticated}
              Polling actively tracks your listening — currently playing every 30s, recent plays every 5 minutes
            {:else}
              Connect your Spotify account to start tracking your listening history
            {/if}
          </div>
        </div>
        <div class="pref-control">
          {#if health?.authenticated}
            <span class="status-badge status-connected">
              <IconCheck />
              Connected
            </span>
          {:else}
            <a href="/auth/login" class="action-btn">Connect Spotify</a>
          {/if}
        </div>
      </div>
    </div>
  </div>

  <div class="card section-card">
    <h3 class="section-card-title">Polling status</h3>
    <div class="section-list">
      <div class="pref-row">
        <div class="pref-info">
          <div class="pref-label">Currently playing</div>
          <div class="pref-desc">Checks what you're listening to right now</div>
        </div>
        <div class="pref-control">
          <span class="value-badge">30s</span>
        </div>
      </div>
      <div class="pref-row row-border">
        <div class="pref-info">
          <div class="pref-label">Recently played</div>
          <div class="pref-desc">Fetches your last 50 plays from Spotify</div>
        </div>
        <div class="pref-control">
          <span class="value-badge">5m</span>
        </div>
      </div>
      <div class="pref-row row-border">
        <div class="pref-info">
          <div class="pref-label">Database</div>
          <div class="pref-desc">Storage engine and status</div>
        </div>
        <div class="pref-control">
          <span class="value-badge">{health?.database ?? 'unknown'}</span>
        </div>
      </div>
      <div class="pref-row row-border">
        <div class="pref-info">
          <div class="pref-label">Last check</div>
          <div class="pref-desc">Most recent polling timestamp</div>
        </div>
        <div class="pref-control">
          <span class="value-badge">{health?.timestamp ? formatDate(health.timestamp) : 'N/A'}</span>
        </div>
      </div>
    </div>
  </div>

  <div class="card section-card">
    <h3 class="section-card-title">Import history</h3>
    <div class="section-list">
      <div class="pref-row">
        <div class="pref-info">
          <div class="pref-label">Upload Spotify data export</div>
          <div class="pref-desc">Supports Extended Streaming History and Account Data formats (Settings &gt; Privacy &gt; Download your data)</div>
        </div>
        <div class="pref-control import-control">
          <label class="file-input-btn">
            <IconUpload />
            {importFiles?.length ? `${importFiles.length} file${importFiles.length > 1 ? 's' : ''}` : 'Choose files'}
            <input
              type="file"
              accept=".json"
              multiple
              onchange={(e) => {
                importFiles = (e.target as HTMLInputElement).files;
                importResult = null;
                importError = null;
              }}
            />
          </label>
          <button
            class="action-btn"
            onclick={handleImport}
            disabled={importing || !importFiles?.length}
          >
            {importing ? 'Importing...' : 'Upload'}
          </button>
        </div>
      </div>
      {#if importResult}
        <div class="import-results">
          <div class="import-results-header">
            <IconCheck color="var(--accent)" />
            Import complete
          </div>
          <div class="import-stats">
            <div class="import-stat">
              <span class="import-stat-value">{formatNumber(importResult.total)}</span>
              <span class="import-stat-label">Total</span>
            </div>
            <div class="import-stat">
              <span class="import-stat-value">{formatNumber(importResult.imported)}</span>
              <span class="import-stat-label">Imported</span>
            </div>
            <div class="import-stat">
              <span class="import-stat-value">{formatNumber(importResult.duplicates)}</span>
              <span class="import-stat-label">Duplicates</span>
            </div>
            <div class="import-stat">
              <span class="import-stat-value">{formatNumber(importResult.skipped)}</span>
              <span class="import-stat-label">Skipped</span>
            </div>
          </div>
        </div>
      {/if}
      {#if importError}
        <div class="import-error">{importError}</div>
      {/if}
    </div>
  </div>

  <div class="card section-card">
    <h3 class="section-card-title">Export data</h3>
    <div class="section-list">
      <div class="pref-row">
        <div class="pref-info">
          <div class="pref-label">Download listening history</div>
          <div class="pref-desc">Export your complete data ({formatNumber(health?.totalPlays ?? 0)} plays)</div>
        </div>
        <div class="pref-control export-control">
          <a href="/api/export?format=json" class="action-btn action-btn--secondary" download>
            <IconDownload />
            JSON
          </a>
          <a href="/api/export?format=csv" class="action-btn action-btn--secondary" download>
            <IconDownload />
            CSV
          </a>
        </div>
      </div>
    </div>
  </div>

  {#if me?.isAdmin}
    <div class="card section-card">
      <h3 class="section-card-title">User management</h3>
      <div class="section-list">
        <div class="pref-row">
          <div class="pref-info">
            <div class="pref-label">Add user to whitelist</div>
            <div class="pref-desc">Enter a Spotify user ID. They can log in once added.</div>
          </div>
          <div class="pref-control import-control">
            <input
              class="merge-search"
              type="text"
              placeholder="Spotify user ID..."
              bind:value={newSpotifyId}
              onkeydown={(e) => { if (e.key === 'Enter') handleAddUser(); }}
            />
            <button class="action-btn" onclick={handleAddUser} disabled={addingUser || !newSpotifyId.trim()}>
              {addingUser ? 'Adding...' : 'Add'}
            </button>
          </div>
        </div>
        {#if userError}
          <div class="import-error">{userError}</div>
        {/if}
        {#if users.length > 0}
          <div class="user-list">
            {#each users as user}
              <div class="pref-row row-border">
                <div class="pref-info">
                  <div class="pref-label">
                    {user.displayName || user.spotifyId}
                    {#if user.isAdmin}<span class="admin-badge">admin</span>{/if}
                    {#if !user.isActive}<span class="inactive-badge">inactive</span>{/if}
                  </div>
                  <div class="pref-desc">{user.spotifyId}</div>
                </div>
                <div class="pref-control import-control">
                  {#if user.isActive}
                    <button class="action-btn action-btn--secondary" onclick={() => toggleAdmin(user)}>
                      {user.isAdmin ? 'Remove admin' : 'Make admin'}
                    </button>
                    <button class="action-btn action-btn--secondary" style="color: var(--danger); border-color: rgba(231, 76, 60, 0.3);" onclick={() => deactivateUser(user)}>
                      Deactivate
                    </button>
                  {:else}
                    <button class="action-btn action-btn--secondary" onclick={() => reactivateUser(user)}>
                      Reactivate
                    </button>
                    <button class="action-btn action-btn--secondary" style="color: var(--danger); border-color: rgba(231, 76, 60, 0.3);" onclick={() => deleteUser(user)}>
                      Delete
                    </button>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  {/if}

  {#if merges.length > 0}
    {@const term = mergeSearch.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')}
    {@const groups = groupMergesByArtist(merges, term)}
    {#if groups.length > 0}
      <div class="card section-card">
        <div class="merge-header">
          <h3 class="section-card-title">Merges</h3>
          <input class="merge-search" type="text" placeholder="Filter merges..." bind:value={mergeSearch} />
        </div>
        <ul class="merge-groups">
          {#each groups as g}
            {@const open = term.length > 0 || expandedArtists.has(g.artistId)}
            <li class="merge-group" class:merge-group--open={open}>
              <button class="merge-group-header" onclick={() => toggleArtist(g.artistId)} aria-expanded={open}>
                <span class="merge-chevron">{open ? '▾' : '▸'}</span>
                {#if g.artistImage}
                  <img class="merge-group-avatar" src={g.artistImage} alt="" />
                {:else}
                  <div class="merge-group-avatar merge-group-avatar--empty"></div>
                {/if}
                <span class="merge-group-name">{g.artistName}</span>
                <span class="merge-group-count">{g.merges.length}</span>
              </button>
              {#if open}
                <ul class="merge-flat">
                  {#each g.merges as m}
                    {@const round = m.entity_type === 'artist'}
                    <li class="merge-row">
                      <span class="merge-type-pill merge-type-pill--{m.entity_type}" title={m.entity_type}>{m.entity_type[0].toUpperCase()}</span>
                      <a class="merge-side" href="/{m.entity_type}/{m.source_id}" title={m.source_name}>
                        {#if m.source_image}
                          <img class="merge-flat-thumb" class:merge-flat-thumb--round={round} src={m.source_image} alt="" />
                        {:else}
                          <div class="merge-flat-thumb" class:merge-flat-thumb--round={round} class:merge-flat-thumb--empty={true}></div>
                        {/if}
                        <span class="merge-flat-name">{m.source_name}</span>
                      </a>
                      <span class="merge-arrow">→</span>
                      <a class="merge-side" href="/{m.entity_type}/{m.target_id}" title={m.target_name}>
                        {#if m.target_image}
                          <img class="merge-flat-thumb" class:merge-flat-thumb--round={round} src={m.target_image} alt="" />
                        {:else}
                          <div class="merge-flat-thumb" class:merge-flat-thumb--round={round} class:merge-flat-thumb--empty={true}></div>
                        {/if}
                        <span class="merge-flat-name">{m.target_name}</span>
                      </a>
                      <button class="merge-flat-unmerge" title="Unmerge" onclick={() => removeMerge(m.id)}>&times;</button>
                    </li>
                  {/each}
                </ul>
              {/if}
            </li>
          {/each}
        </ul>
      </div>
    {/if}
  {/if}
{/if}

<style>
  /* shared section layout */
  .section-card, .prefs-card {
    margin-bottom: 1.5rem;
  }

  .section-card-title, .prefs-title {
    margin-bottom: 0.75rem;
  }

  .section-list, .prefs-list {
    display: flex;
    flex-direction: column;
  }

  .pref-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1.5rem;
    padding: 0.75rem 0;
  }

  .row-border {
    border-top: 1px solid var(--border);
  }

  .pref-info {
    flex: 1;
    min-width: 0;
  }

  .pref-label {
    font-size: 0.95rem;
    font-weight: 500;
  }

  .pref-desc {
    font-size: 0.8rem;
    color: var(--text-muted);
    margin-top: 0.15rem;
  }

  .pref-control {
    flex-shrink: 0;
  }

  /* segmented control */
  .segmented {
    display: flex;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 3px;
    gap: 2px;
  }

  .segmented-btn {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.4rem 0.85rem;
    border-radius: 6px;
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 0.85rem;
    font-family: var(--font);
    transition: all 0.15s;
    white-space: nowrap;
  }

  .segmented-btn:hover:not(.segmented-active) {
    color: var(--text);
  }

  .segmented-active {
    background: var(--accent);
    color: #000;
    font-weight: 500;
  }

  /* locale select */
  .locale-select {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text);
    font-size: 0.85rem;
    font-family: var(--font);
    padding: 0.4rem 0.7rem;
    outline: none;
    cursor: pointer;
    transition: border-color 0.15s;
  }

  .locale-select:focus {
    border-color: var(--accent);
  }

  /* status badge */
  .status-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.35rem 0.75rem;
    border-radius: var(--radius);
    font-size: 0.85rem;
    font-weight: 500;
  }

  .status-connected {
    background: rgba(29, 185, 84, 0.12);
    color: var(--accent);
    border: 1px solid rgba(29, 185, 84, 0.25);
  }

  /* value badge (polling intervals, db info) */
  .value-badge {
    display: inline-block;
    padding: 0.3rem 0.7rem;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    font-size: 0.85rem;
    color: var(--text);
    font-family: 'SF Mono', 'Fira Code', monospace;
  }

  /* action buttons */
  .action-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.4rem 0.85rem;
    border-radius: var(--radius);
    border: none;
    background: var(--accent);
    color: #000;
    cursor: pointer;
    font-size: 0.85rem;
    font-weight: 500;
    font-family: var(--font);
    text-decoration: none;
    transition: background 0.15s;
    white-space: nowrap;
  }

  .action-btn:hover {
    background: var(--accent-hover);
    color: #000;
  }

  .action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .action-btn--secondary {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-muted);
  }

  .action-btn--secondary:hover {
    border-color: var(--text-muted);
    color: var(--text);
    background: transparent;
  }

  /* file input */
  .file-input-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.4rem 0.85rem;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 0.85rem;
    font-family: var(--font);
    transition: all 0.15s;
    white-space: nowrap;
  }

  .file-input-btn:hover {
    border-color: var(--text-muted);
    color: var(--text);
  }

  .file-input-btn input {
    display: none;
  }

  .import-control, .export-control {
    display: flex;
    gap: 0.5rem;
  }

  /* import results */
  .import-results {
    border-top: 1px solid var(--border);
    padding-top: 0.75rem;
    margin-top: 0.25rem;
  }

  .import-results-header {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--accent);
    font-size: 0.85rem;
    font-weight: 500;
    margin-bottom: 0.5rem;
  }

  .import-stats {
    display: flex;
    gap: 1.5rem;
  }

  .import-stat {
    display: flex;
    flex-direction: column;
  }

  .import-stat-value {
    font-size: 1.1rem;
    font-weight: 600;
  }

  .import-stat-label {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .import-error {
    color: var(--danger);
    font-size: 0.85rem;
    border-top: 1px solid var(--border);
    padding-top: 0.75rem;
    margin-top: 0.25rem;
  }

  /* merge header + search */
  .merge-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 0.75rem;
  }
  .merge-header .section-card-title {
    margin-bottom: 0;
  }
  .merge-search {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    font-size: 0.85rem;
    font-family: var(--font);
    padding: 0.35rem 0.7rem;
    outline: none;
    width: 180px;
    transition: border-color 0.15s;
  }
  .merge-search:focus {
    border-color: var(--accent);
  }
  .merge-search::placeholder {
    color: var(--text-muted);
  }

  /* merges grouped by artist (collapsible) */
  .merge-groups {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }
  .merge-group + .merge-group {
    border-top: 1px solid var(--border);
  }
  .merge-group-header {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    width: 100%;
    padding: 0.45rem 0;
    background: transparent;
    border: none;
    color: var(--text);
    font-family: var(--font);
    cursor: pointer;
    text-align: left;
  }
  .merge-group-header:hover { color: var(--accent); }
  .merge-chevron {
    color: var(--text-muted);
    font-size: 0.75rem;
    width: 0.9rem;
    flex-shrink: 0;
  }
  .merge-group-avatar {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
  }
  .merge-group-avatar--empty { background: var(--border); }
  .merge-group-name {
    font-size: 0.9rem;
    font-weight: 600;
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .merge-group-count {
    color: var(--text-muted);
    font-size: 0.72rem;
    padding: 0.1rem 0.5rem;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 999px;
    flex-shrink: 0;
  }

  /* flat merge list (inside a group) */
  .merge-flat {
    list-style: none;
    margin: 0 0 0.4rem 2.25rem;
    padding: 0;
    display: flex;
    flex-direction: column;
  }
  .merge-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.2rem 0;
    font-size: 0.85rem;
    min-width: 0;
  }
  .merge-type-pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: 4px;
    font-size: 0.65rem;
    font-weight: 700;
    color: var(--text);
    background: var(--bg);
    border: 1px solid var(--border);
    flex-shrink: 0;
  }
  .merge-type-pill--artist { color: #a76bff; border-color: rgba(167, 107, 255, 0.4); }
  .merge-type-pill--album  { color: var(--accent); border-color: rgba(29, 185, 84, 0.4); }
  .merge-type-pill--track  { color: #ffaa00; border-color: rgba(255, 170, 0, 0.4); }

  .merge-side {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    text-decoration: none;
    color: var(--text);
    min-width: 0;
    flex: 1 1 0;
    overflow: hidden;
  }
  .merge-side:hover { color: var(--accent); }

  .merge-flat-thumb {
    width: 20px;
    height: 20px;
    border-radius: 3px;
    object-fit: cover;
    flex-shrink: 0;
  }
  .merge-flat-thumb--round { border-radius: 50%; }
  .merge-flat-thumb--empty { background: var(--border); }

  .merge-flat-name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  .merge-arrow {
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .merge-flat-unmerge {
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 1rem;
    cursor: pointer;
    padding: 0 0.3rem;
    line-height: 1;
    flex-shrink: 0;
    opacity: 0;
    transition: opacity 0.15s, color 0.15s;
  }
  .merge-row:hover .merge-flat-unmerge { opacity: 1; }
  .merge-flat-unmerge:hover { color: #ff4444; }

  .admin-badge, .inactive-badge {
    display: inline-block;
    padding: 0.1rem 0.45rem;
    border-radius: 4px;
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    margin-left: 0.4rem;
    vertical-align: middle;
  }
  .admin-badge {
    background: rgba(29, 185, 84, 0.15);
    color: var(--accent);
  }
  .inactive-badge {
    background: rgba(255, 68, 68, 0.12);
    color: #ff4444;
  }
  .user-list {
    display: flex;
    flex-direction: column;
  }

  @media (max-width: 768px) {
    .pref-row {
      flex-direction: column;
      align-items: flex-start;
      gap: 0.75rem;
    }

    .import-stats {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.75rem;
    }
  }
</style>
