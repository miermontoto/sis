<script lang="ts">
  import { onMount } from 'svelte';
  import { api, getRankingMetric, setRankingMetric, getWeekStart, setWeekStart, type HealthData, type StreaksData, type ImportResult, type RankingMetric, type MergeRule, type WeekStartOption, type UserRecord, type MeResponse } from '$lib/api';
  import { formatNumber, formatDate } from '$lib/utils/format';

  let health = $state<HealthData | null>(null);
  let streaks = $state<StreaksData | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);

  // preferencias
  let rankingMetric = $state<RankingMetric>('time');
  let weekStartPref = $state<WeekStartOption>('monday');

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
    if (!confirm(`Deactivate ${user.displayName || user.spotifyId}?`)) return;
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
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              Minutes
            </button>
            <button
              class="segmented-btn"
              class:segmented-active={rankingMetric === 'plays'}
              onclick={() => handleMetricChange('plays')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
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
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
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
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
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
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
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
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            JSON
          </a>
          <a href="/api/export?format=csv" class="action-btn action-btn--secondary" download>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
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
                    <button class="action-btn action-btn--secondary" style="color: #ff4444; border-color: #ff444444;" onclick={() => deactivateUser(user)}>
                      Deactivate
                    </button>
                  {:else}
                    <button class="action-btn action-btn--secondary" onclick={() => reactivateUser(user)}>
                      Reactivate
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
    {@const mergeTree = (() => {
      const term = mergeSearch.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const byArtist = new Map<string, { artistName: string; artistId: string; artistImage: string | null; targets: Map<string, { targetName: string; targetImage: string | null; targetId: string; sources: typeof merges }> }>();
      for (const m of merges) {
        if (term) {
          const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          const match = norm(m.artist_name ?? '').includes(term) || norm(m.target_name).includes(term) || norm(m.source_name).includes(term);
          if (!match) continue;
        }
        const aKey = m.artist_id ?? 'unknown';
        if (!byArtist.has(aKey)) byArtist.set(aKey, { artistName: m.artist_name ?? 'Unknown', artistId: aKey, artistImage: m.artist_image, targets: new Map() });
        const artist = byArtist.get(aKey)!;
        if (!artist.targets.has(m.target_id)) artist.targets.set(m.target_id, { targetName: m.target_name, targetImage: m.target_image, targetId: m.target_id, sources: [] });
        artist.targets.get(m.target_id)!.sources.push(m);
      }
      return [...byArtist.values()];
    })()}
    <div class="card section-card">
      <div class="merge-header">
        <h3 class="section-card-title">Album merges</h3>
        <input class="merge-search" type="text" placeholder="Filter merges..." bind:value={mergeSearch} />
      </div>
      <div class="merge-tree">
        {#each mergeTree as artist}
          <div class="merge-artist">
            <a href="/artist/{artist.artistId}" class="merge-artist-header">
              {#if artist.artistImage}
                <img class="merge-artist-img" src={artist.artistImage} alt="" />
              {:else}
                <div class="merge-artist-img merge-artist-img--empty"></div>
              {/if}
              <span class="merge-artist-name">{artist.artistName}</span>
            </a>
            {#each [...artist.targets.values()] as target}
              <div class="merge-target-group">
                <a href="/album/{target.targetId}" class="merge-target-row">
                  {#if target.targetImage}
                    <img class="merge-rule-thumb" src={target.targetImage} alt="" />
                  {:else}
                    <div class="merge-rule-thumb merge-rule-thumb--empty"></div>
                  {/if}
                  <span class="merge-rule-name">{target.targetName}</span>
                </a>
                {#each target.sources as source}
                  <div class="merge-source-row">
                    <span class="merge-tree-line">&lfloor;</span>
                    {#if source.source_image}
                      <img class="merge-rule-thumb-sm" src={source.source_image} alt="" />
                    {:else}
                      <div class="merge-rule-thumb-sm merge-rule-thumb--empty"></div>
                    {/if}
                    <span class="merge-source-name">{source.source_name}</span>
                    <button class="merge-source-unmerge" title="Unmerge" onclick={() => removeMerge(source.id)}>&times;</button>
                  </div>
                {/each}
              </div>
            {/each}
          </div>
        {/each}
      </div>
    </div>
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

  /* merge tree */
  .merge-tree {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .merge-artist {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .merge-artist-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    text-decoration: none;
    color: var(--text);
    padding: 0.25rem 0;
  }
  .merge-artist-header:hover {
    color: var(--accent);
  }
  .merge-artist-img {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
  }
  .merge-artist-img--empty {
    background: var(--border);
  }
  .merge-artist-name {
    font-size: 0.9rem;
    font-weight: 600;
  }
  .merge-target-group {
    margin-left: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .merge-target-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    text-decoration: none;
    color: var(--text);
    padding: 0.2rem 0;
  }
  .merge-target-row:hover {
    color: var(--accent);
  }
  .merge-rule-thumb {
    width: 28px;
    height: 28px;
    border-radius: 4px;
    object-fit: cover;
    flex-shrink: 0;
  }
  .merge-rule-thumb-sm {
    width: 22px;
    height: 22px;
    border-radius: 3px;
    object-fit: cover;
    flex-shrink: 0;
  }
  .merge-rule-thumb--empty {
    background: var(--border);
  }
  .merge-rule-name {
    font-size: 0.85rem;
    font-weight: 500;
  }
  .merge-source-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-left: 1rem;
    padding: 0.15rem 0;
  }
  .merge-tree-line {
    color: var(--border);
    font-size: 0.9rem;
    line-height: 1;
    flex-shrink: 0;
  }
  .merge-source-name {
    font-size: 0.8rem;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .merge-source-unmerge {
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
  .merge-source-row:hover .merge-source-unmerge {
    opacity: 1;
  }
  .merge-source-unmerge:hover {
    color: #ff4444;
  }

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
