<script lang="ts">
  import { onMount } from 'svelte';
  import { api, getRankingMetric, setRankingMetric, getRankChangeLookback, setRankChangeLookback, getWeekStart, setWeekStart, getRawLocale, setLocale, getLocale, getAlbumTrackDisplay, setAlbumTrackDisplay, getAlbumShowDuration, setAlbumShowDuration, getAlbumShowAccolades, setAlbumShowAccolades, getSessionRankDisplay, setSessionRankDisplay, getSessionTrackingEnabled, setSessionTrackingEnabled, getNowPlayingDisplay, setNowPlayingDisplay, getSocialVisibility, setSocialVisibility, LOCALE_OPTIONS, type HealthData, type StreaksData, type ImportResult, type RankingMetric, type RankChangeLookback, type AlbumTrackDisplay, type SessionRankDisplay, type NowPlayingDisplay, type SocialVisibility, type WeekStartOption, type LocaleSetting, type MeResponse } from '$lib/api';
  import { formatNumber } from '$lib/utils/format';
  import IconClock from '$lib/icons/IconClock.svelte';
  import IconPlayOutline from '$lib/icons/IconPlayOutline.svelte';
  import IconCheck from '$lib/icons/IconCheck.svelte';
  import IconUpload from '$lib/icons/IconUpload.svelte';
  import IconDownload from '$lib/icons/IconDownload.svelte';

  let health = $state<HealthData | null>(null);
  let streaks = $state<StreaksData | null>(null);
  let me = $state<MeResponse | null>(null);
  let mergeCount = $state(0);
  let loading = $state(true);
  let error = $state<string | null>(null);

  // preferencias
  let rankingMetric = $state<RankingMetric>('time');
  let lookbackPref = $state<RankChangeLookback>('disabled');
  let weekStartPref = $state<WeekStartOption>('monday');
  let localePref = $state<LocaleSetting>('auto');
  let albumTrackDisplayPref = $state<AlbumTrackDisplay>('fill');
  let albumShowDurationPref = $state(true);
  let albumShowAccoladesPref = $state(true);
  let sessionRankDisplayPref = $state<SessionRankDisplay>('all+ytd');
  let sessionTrackingPref = $state(true);
  let nowPlayingDisplayPref = $state<NowPlayingDisplay>('auto');
  let socialVisibilityPref = $state<SocialVisibility>('visible');

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
    lookbackPref = getRankChangeLookback();
    weekStartPref = getWeekStart();
    localePref = getRawLocale();
    albumTrackDisplayPref = getAlbumTrackDisplay();
    albumShowDurationPref = getAlbumShowDuration();
    albumShowAccoladesPref = getAlbumShowAccolades();
    sessionRankDisplayPref = getSessionRankDisplay();
    sessionTrackingPref = getSessionTrackingEnabled();
    nowPlayingDisplayPref = getNowPlayingDisplay();
    socialVisibilityPref = getSocialVisibility();
    try {
      [health, streaks, me] = await Promise.all([
        api.health(),
        api.streaks(),
        api.me(),
      ]);
      api.listMerges().then(m => { mergeCount = m.length; }).catch(() => {});
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

    <div class="prefs-subtitle">General</div>
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

    <div class="prefs-subtitle">Now playing</div>
    <div class="prefs-list">
      <div class="pref-row">
        <div class="pref-info">
          <div class="pref-label">Display</div>
          <div class="pref-desc">How the currently playing track is displayed in the sidebar</div>
        </div>
        <div class="pref-control">
          <div class="segmented">
            <button class="segmented-btn" class:segmented-active={nowPlayingDisplayPref === 'off'} onclick={() => { nowPlayingDisplayPref = 'off'; setNowPlayingDisplay('off'); }}>Off</button>
            <button class="segmented-btn" class:segmented-active={nowPlayingDisplayPref === 'compact'} onclick={() => { nowPlayingDisplayPref = 'compact'; setNowPlayingDisplay('compact'); }}>Compact</button>
            <button class="segmented-btn" class:segmented-active={nowPlayingDisplayPref === 'auto'} onclick={() => { nowPlayingDisplayPref = 'auto'; setNowPlayingDisplay('auto'); }}>Auto</button>
            <button class="segmented-btn" class:segmented-active={nowPlayingDisplayPref === 'normal'} onclick={() => { nowPlayingDisplayPref = 'normal'; setNowPlayingDisplay('normal'); }}>Normal</button>
          </div>
        </div>
      </div>
      <div class="pref-row row-border">
        <div class="pref-info">
          <div class="pref-label">Session tracking</div>
          <div class="pref-desc">Show session card in sidebar and highlight session tracks in recent plays and history</div>
        </div>
        <div class="pref-control">
          <div class="segmented">
            <button class="segmented-btn" class:segmented-active={!sessionTrackingPref} onclick={() => { sessionTrackingPref = false; setSessionTrackingEnabled(false); }}>Off</button>
            <button class="segmented-btn" class:segmented-active={sessionTrackingPref} onclick={() => { sessionTrackingPref = true; setSessionTrackingEnabled(true); }}>On</button>
          </div>
        </div>
      </div>
      <div class="pref-row row-border" class:pref-row--disabled={!sessionTrackingPref}>
        <div class="pref-info">
          <div class="pref-label">Session rankings</div>
          <div class="pref-desc">Which projected ranking changes to show during a listening session</div>
        </div>
        <div class="pref-control">
          <div class="segmented">
            <button class="segmented-btn" class:segmented-active={sessionRankDisplayPref === 'none'} onclick={() => { sessionRankDisplayPref = 'none'; setSessionRankDisplay('none'); }} disabled={!sessionTrackingPref}>Off</button>
            <button class="segmented-btn" class:segmented-active={sessionRankDisplayPref === 'all'} onclick={() => { sessionRankDisplayPref = 'all'; setSessionRankDisplay('all'); }} disabled={!sessionTrackingPref}>ALL</button>
            <button class="segmented-btn" class:segmented-active={sessionRankDisplayPref === 'all+ytd'} onclick={() => { sessionRankDisplayPref = 'all+ytd'; setSessionRankDisplay('all+ytd'); }} disabled={!sessionTrackingPref}>ALL+YTD</button>
          </div>
        </div>
      </div>
    </div>

    <div class="prefs-subtitle">Social</div>
    <div class="prefs-list">
      <div class="pref-row">
        <div class="pref-info">
          <div class="pref-label">Activity visibility</div>
          <div class="pref-desc">Show your currently playing track to other users in the sidebar</div>
        </div>
        <div class="pref-control">
          <div class="segmented">
            <button class="segmented-btn" class:segmented-active={socialVisibilityPref === 'hidden'} onclick={() => { socialVisibilityPref = 'hidden'; setSocialVisibility('hidden'); }}>Hidden</button>
            <button class="segmented-btn" class:segmented-active={socialVisibilityPref === 'visible'} onclick={() => { socialVisibilityPref = 'visible'; setSocialVisibility('visible'); }}>Visible</button>
          </div>
        </div>
      </div>
    </div>

    <div class="prefs-subtitle">Rankings & Records</div>
    <div class="prefs-list">
      <div class="pref-row">
        <div class="pref-info">
          <div class="pref-label">Ranking changes</div>
          <div class="pref-desc">Compare rankings to a previous snapshot (3M+ ranges only)</div>
        </div>
        <div class="pref-control">
          <div class="segmented">
            <button class="segmented-btn" class:segmented-active={lookbackPref === 'disabled'} onclick={() => { lookbackPref = 'disabled'; setRankChangeLookback('disabled'); }}>Off</button>
            <button class="segmented-btn" class:segmented-active={lookbackPref === '7d'} onclick={() => { lookbackPref = '7d'; setRankChangeLookback('7d'); }}>7 days</button>
            <button class="segmented-btn" class:segmented-active={lookbackPref === '30d'} onclick={() => { lookbackPref = '30d'; setRankChangeLookback('30d'); }}>30 days</button>
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

    <div class="prefs-subtitle">Album details</div>
    <div class="prefs-list">
      <div class="pref-row">
        <div class="pref-info">
          <div class="pref-label">Track share</div>
          <div class="pref-desc">Show each track's share of total album plays</div>
        </div>
        <div class="pref-control">
          <div class="segmented">
            <button class="segmented-btn" class:segmented-active={albumTrackDisplayPref === 'off'} onclick={() => { albumTrackDisplayPref = 'off'; setAlbumTrackDisplay('off'); }}>Off</button>
            <button class="segmented-btn" class:segmented-active={albumTrackDisplayPref === 'fill'} onclick={() => { albumTrackDisplayPref = 'fill'; setAlbumTrackDisplay('fill'); }}>Fill</button>
            <button class="segmented-btn" class:segmented-active={albumTrackDisplayPref === 'percent'} onclick={() => { albumTrackDisplayPref = 'percent'; setAlbumTrackDisplay('percent'); }}>%</button>
          </div>
        </div>
      </div>
      <div class="pref-row row-border">
        <div class="pref-info">
          <div class="pref-label">Track duration</div>
          <div class="pref-desc">Show individual track length in the track list</div>
        </div>
        <div class="pref-control">
          <div class="segmented">
            <button class="segmented-btn" class:segmented-active={!albumShowDurationPref} onclick={() => { albumShowDurationPref = false; setAlbumShowDuration(false); }}>Off</button>
            <button class="segmented-btn" class:segmented-active={albumShowDurationPref} onclick={() => { albumShowDurationPref = true; setAlbumShowDuration(true); }}>On</button>
          </div>
        </div>
      </div>
      <div class="pref-row row-border">
        <div class="pref-info">
          <div class="pref-label">Track accolades</div>
          <div class="pref-desc">Show record badges next to tracks</div>
        </div>
        <div class="pref-control">
          <div class="segmented">
            <button class="segmented-btn" class:segmented-active={!albumShowAccoladesPref} onclick={() => { albumShowAccoladesPref = false; setAlbumShowAccolades(false); }}>Off</button>
            <button class="segmented-btn" class:segmented-active={albumShowAccoladesPref} onclick={() => { albumShowAccoladesPref = true; setAlbumShowAccolades(true); }}>On</button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div class="card section-card">
    <h3 class="section-card-title">Data</h3>
    <div class="section-list">
      <div class="pref-row">
        <div class="pref-info">
          <div class="pref-label">Import listening history</div>
          <div class="pref-desc">Upload Spotify data export — Extended Streaming History or Account Data formats</div>
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
      <div class="pref-row row-border">
        <div class="pref-info">
          <div class="pref-label">Export listening history</div>
          <div class="pref-desc">Download your complete data ({formatNumber(health?.totalPlays ?? 0)} plays)</div>
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
      <div class="pref-row row-border">
        <div class="pref-info">
          <div class="pref-label">Merge rules</div>
          <div class="pref-desc">{mergeCount > 0 ? `${mergeCount} active rule${mergeCount !== 1 ? 's' : ''} combining duplicate entities` : 'Combine duplicate artists, albums, or tracks'}</div>
        </div>
        <div class="pref-control">
          <a href="/settings/merges" class="action-btn action-btn--secondary">Manage</a>
        </div>
      </div>
    </div>
  </div>

  {#if me?.isAdmin}
    <div class="card section-card">
      <div class="pref-row" style="padding: 0;">
        <div class="pref-info">
          <h3 class="section-card-title" style="margin-bottom: 0.15rem;">Admin</h3>
          <div class="pref-desc">User management and system status</div>
        </div>
        <div class="pref-control">
          <a href="/settings/admin" class="action-btn action-btn--secondary">Open</a>
        </div>
      </div>
    </div>
  {/if}
{/if}

<style>
  .section-card, .prefs-card {
    margin-bottom: 1.5rem;
  }

  .section-card-title, .prefs-title {
    margin-bottom: 0.75rem;
  }

  .prefs-subtitle {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
    margin-top: 1.25rem;
    margin-bottom: 0.25rem;
  }

  .prefs-subtitle:first-of-type {
    margin-top: 0;
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

  .pref-row--disabled {
    opacity: 0.4;
    pointer-events: none;
  }

  .pref-info {
    flex: 1;
    min-width: 0;
  }

  .pref-label {
    font-size: 0.85rem;
    font-weight: 500;
    letter-spacing: 0.02em;
  }

  .pref-desc {
    font-size: 0.8rem;
    color: var(--text-muted);
    margin-top: 0.15rem;
  }

  .pref-control {
    flex-shrink: 0;
  }

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
    border-radius: var(--radius);
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 0.85rem;
    transition: all 0.05s;
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

  .locale-select {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text);
    font-size: 0.85rem;
    padding: 0.4rem 0.7rem;
    outline: none;
    cursor: pointer;
    transition: border-color 0.05s;
  }

  .locale-select:focus {
    border-color: var(--accent);
  }

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
    text-decoration: none;
    transition: background 0.05s;
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
    transition: all 0.05s;
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
