<script lang="ts">
  import { onMount } from 'svelte';
  import { api, getRankingMetric, setRankingMetric, getShowRankChanges, setShowRankChanges, type HealthData, type StreaksData, type ImportResult, type RankingMetric } from '$lib/api';
  import { formatNumber, formatDate } from '$lib/utils/format';

  let health = $state<HealthData | null>(null);
  let streaks = $state<StreaksData | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);

  // preferencias
  let rankingMetric = $state<RankingMetric>('time');
  let showRankChanges = $state(true);

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

  function handleRankChangesToggle() {
    showRankChanges = !showRankChanges;
    setShowRankChanges(showRankChanges);
  }

  onMount(async () => {
    rankingMetric = getRankingMetric();
    showRankChanges = getShowRankChanges();
    try {
      [health, streaks] = await Promise.all([
        api.health(),
        api.streaks(),
      ]);
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
          <div class="pref-label">Position changes</div>
          <div class="pref-desc">Show rank movement indicators in top lists (compared to previous period)</div>
        </div>
        <div class="pref-control">
          <button class="toggle" class:toggle-on={showRankChanges} onclick={handleRankChangesToggle}>
            <span class="toggle-knob"></span>
          </button>
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

  /* toggle switch */
  .toggle {
    position: relative;
    width: 44px;
    height: 24px;
    border-radius: 12px;
    border: none;
    background: var(--border);
    cursor: pointer;
    padding: 0;
    transition: background 0.2s;
  }

  .toggle-on {
    background: var(--accent);
  }

  .toggle-knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: #fff;
    transition: transform 0.2s;
  }

  .toggle-on .toggle-knob {
    transform: translateX(20px);
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
