<script lang="ts">
  import { onMount } from 'svelte';
  import { api, getRankingMetric, setRankingMetric, type HealthData, type StreaksData, type ImportResult, type RankingMetric } from '$lib/api';
  import { formatNumber, formatDate } from '$lib/utils/format';

  let health = $state<HealthData | null>(null);
  let streaks = $state<StreaksData | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);

  // preferencia de ranking
  let rankingMetric = $state<RankingMetric>('time');

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

  <div class="card" style="margin-bottom: 1.5rem;">
    <h3 style="margin-bottom: 1rem;">Preferences</h3>
    <div style="display: flex; align-items: center; gap: 1rem;">
      <span style="color: var(--text-muted); font-size: 0.9rem;">Ranking metric</span>
      <div class="time-range-selector">
        <button class="range-btn" class:active={rankingMetric === 'time'} onclick={() => handleMetricChange('time')}>
          Minutes
        </button>
        <button class="range-btn" class:active={rankingMetric === 'plays'} onclick={() => handleMetricChange('plays')}>
          Plays
        </button>
      </div>
    </div>
  </div>

  <div class="card" style="margin-bottom: 1.5rem;">
    <h3 style="margin-bottom: 1rem;">Account</h3>
    {#if health?.authenticated}
      <p style="color: var(--accent); margin-bottom: 0.5rem;">Spotify account connected.</p>
      <p style="color: var(--text-muted); font-size: 0.85rem;">
        Polling actively tracks your listening. Currently playing is checked every 30s, recent plays every 5 minutes.
      </p>
    {:else}
      <p style="margin-bottom: 0.75rem;">No Spotify account connected. Connect to start tracking your listening history.</p>
      <a href="/auth/login" class="range-btn active" style="display: inline-block; text-decoration: none;">
        Connect Spotify
      </a>
    {/if}
  </div>

  <div class="card" style="margin-bottom: 1.5rem;">
    <h3 style="margin-bottom: 1rem;">Polling status</h3>
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; font-size: 0.9rem;">
      <div>
        <span style="color: var(--text-muted);">Currently playing interval</span>
        <div>30 seconds</div>
      </div>
      <div>
        <span style="color: var(--text-muted);">Recently played interval</span>
        <div>5 minutes</div>
      </div>
      <div>
        <span style="color: var(--text-muted);">Database</span>
        <div>{health?.database ?? 'unknown'}</div>
      </div>
      <div>
        <span style="color: var(--text-muted);">Last check</span>
        <div>{health?.timestamp ? formatDate(health.timestamp) : 'N/A'}</div>
      </div>
    </div>
  </div>

  <div class="card" style="margin-bottom: 1.5rem;">
    <h3 style="margin-bottom: 1rem;">Import history</h3>
    <p style="color: var(--text-muted); margin-bottom: 0.75rem;">
      Import your Spotify data export (Settings &gt; Privacy &gt; Download your data).
      Supports both Extended Streaming History and Account Data formats.
    </p>
    <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
      <input
        type="file"
        accept=".json"
        multiple
        onchange={(e) => {
          importFiles = (e.target as HTMLInputElement).files;
          importResult = null;
          importError = null;
        }}
        style="font-size: 0.85rem;"
      />
      <button
        class="range-btn active"
        onclick={handleImport}
        disabled={importing || !importFiles?.length}
      >
        {importing ? 'Importing...' : 'Upload'}
      </button>
    </div>
    {#if importResult}
      <div style="margin-top: 0.75rem; font-size: 0.9rem;">
        <p style="color: var(--accent);">Import complete</p>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(100px, 1fr)); gap: 0.5rem; margin-top: 0.5rem;">
          <div><span style="color: var(--text-muted);">Total</span><div>{formatNumber(importResult.total)}</div></div>
          <div><span style="color: var(--text-muted);">Imported</span><div>{formatNumber(importResult.imported)}</div></div>
          <div><span style="color: var(--text-muted);">Duplicates</span><div>{formatNumber(importResult.duplicates)}</div></div>
          <div><span style="color: var(--text-muted);">Skipped</span><div>{formatNumber(importResult.skipped)}</div></div>
        </div>
      </div>
    {/if}
    {#if importError}
      <p style="color: var(--danger); margin-top: 0.75rem;">{importError}</p>
    {/if}
  </div>

  <div class="card">
    <h3 style="margin-bottom: 1rem;">Export data</h3>
    <p style="color: var(--text-muted); margin-bottom: 0.75rem;">
      Download your complete listening history ({formatNumber(health?.totalPlays ?? 0)} plays).
    </p>
    <div style="display: flex; gap: 0.5rem;">
      <a href="/api/export?format=json" class="range-btn" download>Export JSON</a>
      <a href="/api/export?format=csv" class="range-btn" download>Export CSV</a>
    </div>
  </div>
{/if}
