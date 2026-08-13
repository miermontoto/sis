<script lang="ts">
  import { errorMessage } from '$lib/utils/errors';
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/state';
  import IconLastfm from '$lib/icons/IconLastfm.svelte';
  import IconSpotify from '$lib/icons/IconSpotify.svelte';
  import type { LastfmStatus } from '$lib/api';
  import { api, getRankingMetric, setRankingMetric, getRankChangeLookback, setRankChangeLookback, getWeekStart, setWeekStart, getRecordsUnique, setRecordsUnique, getRawLocale, setLocale, getLocale, getAlbumTrackDisplay, setAlbumTrackDisplay, getAlbumShowDuration, setAlbumShowDuration, getAlbumShowAccolades, setAlbumShowAccolades, getArtistShowAlbumAccolades, setArtistShowAlbumAccolades, getArtistShowTrackAccolades, setArtistShowTrackAccolades, getSessionRankDisplay, setSessionRankDisplay, getSessionRankLimitYear, setSessionRankLimitYear, getSessionRankLimitAll, setSessionRankLimitAll, getSessionTrackingDisplay, setSessionTrackingDisplay, getNowPlayingDisplay, setNowPlayingDisplay, getSocialVisibility, setSocialVisibility, getNotificationsEnabled, setNotificationsEnabled, getNotifyRecords, setNotifyRecords, getNotifyNumberOne, setNotifyNumberOne, getNotifyChartClosings, setNotifyChartClosings, getNotifyBiggestDebut, setNotifyBiggestDebut, getNotifyAnniversaries, setNotifyAnniversaries, getNotifyMilestones, setNotifyMilestones, LOCALE_OPTIONS, type HealthData, type ImportResult, type RankingMetric, type RankChangeLookback, type AlbumTrackDisplay, type SessionTrackingDisplay, type SessionRankDisplay, type NowPlayingDisplay, type SocialVisibility, type WeekStartOption, type LocaleSetting, type MeResponse } from '$lib/api';
  import { formatNumber } from '$lib/utils/format';
  import IconClock from '$lib/icons/IconClock.svelte';
  import IconPlayOutline from '$lib/icons/IconPlayOutline.svelte';
  import IconCheck from '$lib/icons/IconCheck.svelte';
  import IconUpload from '$lib/icons/IconUpload.svelte';
  import IconDownload from '$lib/icons/IconDownload.svelte';
  import DetailLayoutEditor from '$lib/components/DetailLayoutEditor.svelte';

  let health = $state<HealthData | null>(null);
  let me = $state<MeResponse | null>(null);
  let mergeCount = $state(0);
  let loading = $state(true);
  let error = $state<string | null>(null);

  // preferencias
  let rankingMetric = $state<RankingMetric>('time');
  let lookbackPref = $state<RankChangeLookback>('disabled');
  let weekStartPref = $state<WeekStartOption>('monday');
  let recordsUniquePref = $state(true);
  let localePref = $state<LocaleSetting>('auto');
  let albumTrackDisplayPref = $state<AlbumTrackDisplay>('fill');
  let albumShowDurationPref = $state(true);
  let albumShowAccoladesPref = $state(true);
  let artistShowAlbumAccoladesPref = $state(true);
  let artistShowTrackAccoladesPref = $state(true);
  let sessionRankDisplayPref = $state<SessionRankDisplay>('all+ytd');
  let sessionRankLimitYearPref = $state('50');
  let sessionRankLimitAllPref = $state('200');
  let sessionTrackingDisplayPref = $state<SessionTrackingDisplay>('all');
  let nowPlayingDisplayPref = $state<NowPlayingDisplay>('auto');
  let socialVisibilityPref = $state<SocialVisibility>('visible');

  // notificaciones push: master switch + toggles por tipo
  let notifEnabledPref = $state(false);
  let notifRecordsPref = $state(true);
  let notifNumberOnePref = $state(true);
  let notifChartClosingsPref = $state(true);
  let notifBiggestDebutPref = $state(true);
  let notifAnniversariesPref = $state(true);
  let notifMilestonesPref = $state(true);
  // bloquea el master mientras se pide permiso al SO/navegador (evita doble click)
  let notifBusy = $state(false);

  // master switch: al activar pide permiso + registra el token; si se deniega o
  // no hay soporte, revierte el toggle (no persiste true). al desactivar solo
  // persiste la preferencia (el server deja de enviar; el token sigue registrado).
  async function toggleNotificationsEnabled(next: boolean) {
    if (notifBusy) return;
    if (!next) {
      notifEnabledPref = false;
      setNotificationsEnabled(false);
      return;
    }
    notifBusy = true;
    try {
      const { initPush } = await import('$lib/push');
      const granted = await initPush();
      if (!granted) {
        notifEnabledPref = false;
        return;
      }
      notifEnabledPref = true;
      setNotificationsEnabled(true);
    } catch (e) {
      console.error('[push] fallo al activar notificaciones:', e);
      notifEnabledPref = false;
    } finally {
      notifBusy = false;
    }
  }

  // last.fm: estado de la conexión + backfill
  let lastfmStatus = $state<LastfmStatus | null>(null);
  let lastfmBusy = $state(false);
  let lastfmError = $state<string | null>(
    page.url.searchParams.get('lastfm') === 'already_linked'
      ? 'That Last.fm account is already linked to another user.'
      : null
  );
  let lastfmPollTimer: ReturnType<typeof setInterval> | null = null;

  async function refreshLastfm() {
    try {
      lastfmStatus = await api.lastfmStatus();
      const running = lastfmStatus?.account?.backfill?.running;
      if (running && !lastfmPollTimer) {
        lastfmPollTimer = setInterval(refreshLastfm, 3000);
      } else if (!running && lastfmPollTimer) {
        clearInterval(lastfmPollTimer);
        lastfmPollTimer = null;
      }
    } catch {}
  }

  async function startLastfmBackfill() {
    if (lastfmBusy) return;
    lastfmBusy = true;
    lastfmError = null;
    try {
      await api.lastfmBackfill();
      await refreshLastfm();
    } catch (err) {
      lastfmError = errorMessage(err, 'Backfill failed');
    } finally {
      lastfmBusy = false;
    }
  }

  async function disconnectLastfm() {
    if (!confirm('Disconnect Last.fm? Imported plays are kept, but scrobbles will stop syncing.')) return;
    lastfmBusy = true;
    lastfmError = null;
    try {
      await api.lastfmDisconnect();
      await refreshLastfm();
    } catch (err) {
      lastfmError = errorMessage(err, 'Disconnect failed');
    } finally {
      lastfmBusy = false;
    }
  }

  onDestroy(() => {
    if (lastfmPollTimer) clearInterval(lastfmPollTimer);
  });

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
    } catch (err) {
      importError = errorMessage(err, 'Import failed');
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
    recordsUniquePref = getRecordsUnique();
    localePref = getRawLocale();
    albumTrackDisplayPref = getAlbumTrackDisplay();
    albumShowDurationPref = getAlbumShowDuration();
    albumShowAccoladesPref = getAlbumShowAccolades();
    artistShowAlbumAccoladesPref = getArtistShowAlbumAccolades();
    artistShowTrackAccoladesPref = getArtistShowTrackAccolades();
    sessionRankDisplayPref = getSessionRankDisplay();
    sessionRankLimitYearPref = getSessionRankLimitYear();
    sessionRankLimitAllPref = getSessionRankLimitAll();
    sessionTrackingDisplayPref = getSessionTrackingDisplay();
    nowPlayingDisplayPref = getNowPlayingDisplay();
    socialVisibilityPref = getSocialVisibility();
    notifEnabledPref = getNotificationsEnabled();
    notifRecordsPref = getNotifyRecords();
    notifNumberOnePref = getNotifyNumberOne();
    notifChartClosingsPref = getNotifyChartClosings();
    notifBiggestDebutPref = getNotifyBiggestDebut();
    notifAnniversariesPref = getNotifyAnniversaries();
    notifMilestonesPref = getNotifyMilestones();
    try {
      [health, me] = await Promise.all([
        api.health(),
        api.me(),
      ]);
      api.listMerges().then(m => { mergeCount = m.length; }).catch(() => {});
      refreshLastfm();
    } catch (err) {
      error = errorMessage(err, 'Failed to load settings');
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

    <div class="prefs-subtitle">Notifications</div>
    <div class="prefs-list">
      <div class="pref-row">
        <div class="pref-info">
          <div class="pref-label">Push notifications</div>
          <div class="pref-desc">Get notified about new records, chart-toppers, weekly recaps and big debuts</div>
        </div>
        <div class="pref-control">
          <div class="segmented">
            <button class="segmented-btn" class:segmented-active={!notifEnabledPref} onclick={() => toggleNotificationsEnabled(false)} disabled={notifBusy}>Off</button>
            <button class="segmented-btn" class:segmented-active={notifEnabledPref} onclick={() => toggleNotificationsEnabled(true)} disabled={notifBusy}>On</button>
          </div>
        </div>
      </div>
      <div class="pref-row row-border" class:pref-row--disabled={!notifEnabledPref}>
        <div class="pref-info">
          <div class="pref-label">Records</div>
          <div class="pref-desc">When a track, album or artist enters an all-time record top-10</div>
        </div>
        <div class="pref-control">
          <div class="segmented">
            <button class="segmented-btn" class:segmented-active={!notifRecordsPref} onclick={() => { notifRecordsPref = false; setNotifyRecords(false); }} disabled={!notifEnabledPref}>Off</button>
            <button class="segmented-btn" class:segmented-active={notifRecordsPref} onclick={() => { notifRecordsPref = true; setNotifyRecords(true); }} disabled={!notifEnabledPref}>On</button>
          </div>
        </div>
      </div>
      <div class="pref-row row-border" class:pref-row--disabled={!notifEnabledPref}>
        <div class="pref-info">
          <div class="pref-label">New #1</div>
          <div class="pref-desc">When a new track tops your weekly chart</div>
        </div>
        <div class="pref-control">
          <div class="segmented">
            <button class="segmented-btn" class:segmented-active={!notifNumberOnePref} onclick={() => { notifNumberOnePref = false; setNotifyNumberOne(false); }} disabled={!notifEnabledPref}>Off</button>
            <button class="segmented-btn" class:segmented-active={notifNumberOnePref} onclick={() => { notifNumberOnePref = true; setNotifyNumberOne(true); }} disabled={!notifEnabledPref}>On</button>
          </div>
        </div>
      </div>
      <div class="pref-row row-border" class:pref-row--disabled={!notifEnabledPref}>
        <div class="pref-info">
          <div class="pref-label">Weekly recap</div>
          <div class="pref-desc">A summary of your top tracks when the week's chart closes</div>
        </div>
        <div class="pref-control">
          <div class="segmented">
            <button class="segmented-btn" class:segmented-active={!notifChartClosingsPref} onclick={() => { notifChartClosingsPref = false; setNotifyChartClosings(false); }} disabled={!notifEnabledPref}>Off</button>
            <button class="segmented-btn" class:segmented-active={notifChartClosingsPref} onclick={() => { notifChartClosingsPref = true; setNotifyChartClosings(true); }} disabled={!notifEnabledPref}>On</button>
          </div>
        </div>
      </div>
      <div class="pref-row row-border" class:pref-row--disabled={!notifEnabledPref}>
        <div class="pref-info">
          <div class="pref-label">Biggest debut</div>
          <div class="pref-desc">The highest-charting new entry when the week's chart closes</div>
        </div>
        <div class="pref-control">
          <div class="segmented">
            <button class="segmented-btn" class:segmented-active={!notifBiggestDebutPref} onclick={() => { notifBiggestDebutPref = false; setNotifyBiggestDebut(false); }} disabled={!notifEnabledPref}>Off</button>
            <button class="segmented-btn" class:segmented-active={notifBiggestDebutPref} onclick={() => { notifBiggestDebutPref = true; setNotifyBiggestDebut(true); }} disabled={!notifEnabledPref}>On</button>
          </div>
        </div>
      </div>
      <div class="pref-row row-border" class:pref-row--disabled={!notifEnabledPref}>
        <div class="pref-info">
          <div class="pref-label">Anniversaries</div>
          <div class="pref-desc">Release anniversaries of albums you love and first-listen anniversaries of your artists</div>
        </div>
        <div class="pref-control">
          <div class="segmented">
            <button class="segmented-btn" class:segmented-active={!notifAnniversariesPref} onclick={() => { notifAnniversariesPref = false; setNotifyAnniversaries(false); }} disabled={!notifEnabledPref}>Off</button>
            <button class="segmented-btn" class:segmented-active={notifAnniversariesPref} onclick={() => { notifAnniversariesPref = true; setNotifyAnniversaries(true); }} disabled={!notifEnabledPref}>On</button>
          </div>
        </div>
      </div>
      <div class="pref-row row-border" class:pref-row--disabled={!notifEnabledPref}>
        <div class="pref-info">
          <div class="pref-label">Milestones</div>
          <div class="pref-desc">When an artist, album or track crosses a play-count milestone (100, 500, 1,000…)</div>
        </div>
        <div class="pref-control">
          <div class="segmented">
            <button class="segmented-btn" class:segmented-active={!notifMilestonesPref} onclick={() => { notifMilestonesPref = false; setNotifyMilestones(false); }} disabled={!notifEnabledPref}>Off</button>
            <button class="segmented-btn" class:segmented-active={notifMilestonesPref} onclick={() => { notifMilestonesPref = true; setNotifyMilestones(true); }} disabled={!notifEnabledPref}>On</button>
          </div>
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
    </div>

    <div class="prefs-subtitle">Session</div>
    <div class="prefs-list">
      <div class="pref-row">
        <div class="pref-info">
          <div class="pref-label">Session tracking</div>
          <div class="pref-desc">Show session card in sidebar and highlight session tracks in recent plays and history</div>
        </div>
        <div class="pref-control">
          <div class="segmented">
            <button class="segmented-btn" class:segmented-active={sessionTrackingDisplayPref === 'off'} onclick={() => { sessionTrackingDisplayPref = 'off'; setSessionTrackingDisplay('off'); }}>Off</button>
            <button class="segmented-btn" class:segmented-active={sessionTrackingDisplayPref === 'desktop'} onclick={() => { sessionTrackingDisplayPref = 'desktop'; setSessionTrackingDisplay('desktop'); }}>Desktop</button>
            <button class="segmented-btn" class:segmented-active={sessionTrackingDisplayPref === 'all'} onclick={() => { sessionTrackingDisplayPref = 'all'; setSessionTrackingDisplay('all'); }}>Mobile+Desktop</button>
          </div>
        </div>
      </div>
      <div class="pref-row row-border" class:pref-row--disabled={sessionTrackingDisplayPref === 'off'}>
        <div class="pref-info">
          <div class="pref-label">Rankings</div>
          <div class="pref-desc">Which projected ranking changes to show during a listening session</div>
        </div>
        <div class="pref-control">
          <div class="segmented">
            <button class="segmented-btn" class:segmented-active={sessionRankDisplayPref === 'none'} onclick={() => { sessionRankDisplayPref = 'none'; setSessionRankDisplay('none'); }} disabled={sessionTrackingDisplayPref === 'off'}>Off</button>
            <button class="segmented-btn" class:segmented-active={sessionRankDisplayPref === 'all'} onclick={() => { sessionRankDisplayPref = 'all'; setSessionRankDisplay('all'); }} disabled={sessionTrackingDisplayPref === 'off'}>ALL</button>
            <button class="segmented-btn" class:segmented-active={sessionRankDisplayPref === 'all+ytd'} onclick={() => { sessionRankDisplayPref = 'all+ytd'; setSessionRankDisplay('all+ytd'); }} disabled={sessionTrackingDisplayPref === 'off'}>ALL+YTD</button>
          </div>
        </div>
      </div>
      <div class="pref-row row-border" class:pref-row--disabled={sessionTrackingDisplayPref === 'off' || sessionRankDisplayPref === 'none'}>
        <div class="pref-info">
          <div class="pref-label">Rank limit (ALL)</div>
          <div class="pref-desc">Only show all-time ranking changes for entities within this rank</div>
        </div>
        <div class="pref-control">
          <div class="segmented">
            {#each ['25', '50', '100', '200'] as v}
              <button class="segmented-btn" class:segmented-active={sessionRankLimitAllPref === v} onclick={() => { sessionRankLimitAllPref = v; setSessionRankLimitAll(v); }} disabled={sessionTrackingDisplayPref === 'off' || sessionRankDisplayPref === 'none'}>#{v}</button>
            {/each}
          </div>
        </div>
      </div>
      <div class="pref-row row-border" class:pref-row--disabled={sessionTrackingDisplayPref === 'off' || sessionRankDisplayPref === 'none'}>
        <div class="pref-info">
          <div class="pref-label">Rank limit (YTD)</div>
          <div class="pref-desc">Only show year-to-date ranking changes for entities within this rank</div>
        </div>
        <div class="pref-control">
          <div class="segmented">
            {#each ['25', '50', '100', '200'] as v}
              <button class="segmented-btn" class:segmented-active={sessionRankLimitYearPref === v} onclick={() => { sessionRankLimitYearPref = v; setSessionRankLimitYear(v); }} disabled={sessionTrackingDisplayPref === 'off' || sessionRankDisplayPref === 'none'}>#{v}</button>
            {/each}
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
      <div class="pref-row row-border">
        <div class="pref-info">
          <div class="pref-label">Record entries</div>
          <div class="pref-desc">Unique keeps one entry per song, album or artist; All lets the same one appear several times (e.g. its biggest weeks in Peak week and each run in Longest chart run)</div>
        </div>
        <div class="pref-control">
          <div class="segmented">
            <button class="segmented-btn" class:segmented-active={recordsUniquePref} onclick={() => { recordsUniquePref = true; setRecordsUnique(true); }}>Unique</button>
            <button class="segmented-btn" class:segmented-active={!recordsUniquePref} onclick={() => { recordsUniquePref = false; setRecordsUnique(false); }}>All</button>
          </div>
        </div>
      </div>
    </div>

    <div class="prefs-subtitle">Artist details</div>
    <div class="prefs-list">
      <div class="pref-row">
        <div class="pref-info">
          <div class="pref-label">Album accolades</div>
          <div class="pref-desc">Show record badges next to albums</div>
        </div>
        <div class="pref-control">
          <div class="segmented">
            <button class="segmented-btn" class:segmented-active={!artistShowAlbumAccoladesPref} onclick={() => { artistShowAlbumAccoladesPref = false; setArtistShowAlbumAccolades(false); }}>Off</button>
            <button class="segmented-btn" class:segmented-active={artistShowAlbumAccoladesPref} onclick={() => { artistShowAlbumAccoladesPref = true; setArtistShowAlbumAccolades(true); }}>On</button>
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
            <button class="segmented-btn" class:segmented-active={!artistShowTrackAccoladesPref} onclick={() => { artistShowTrackAccoladesPref = false; setArtistShowTrackAccolades(false); }}>Off</button>
            <button class="segmented-btn" class:segmented-active={artistShowTrackAccoladesPref} onclick={() => { artistShowTrackAccoladesPref = true; setArtistShowTrackAccolades(true); }}>On</button>
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

    <div class="prefs-subtitle">Detail views</div>
    <div class="prefs-list">
      <div class="pref-row pref-row--stack">
        <div class="pref-info">
          <div class="pref-label">Sections layout</div>
          <div class="pref-desc">Drag to reorder or move sections between columns; the eye hides a section. Applies to every artist, album or track page.</div>
        </div>
        <DetailLayoutEditor />
      </div>
    </div>
  </div>

  <div class="card section-card">
    <h3 class="section-card-title">Connections</h3>
    <div class="section-list">
      <div class="pref-row">
        <div class="pref-info">
          <div class="pref-label lastfm-label"><IconSpotify size={16} /> Spotify</div>
          <div class="pref-desc">
            {#if me?.displayName || me?.spotifyId}
              Connected as <strong>{me.displayName ?? me.spotifyId}</strong> — your primary listening source, polled continuously
            {:else}
              Your primary listening source, polled continuously
            {/if}
          </div>
        </div>
        <div class="pref-control lastfm-control">
          {#if health && !health.authenticated}
            <a href="/auth/login?returnTo=%2Fsettings" class="action-btn">Reconnect</a>
          {/if}
        </div>
      </div>
      {#if lastfmStatus && (lastfmStatus.configured || lastfmStatus.account)}
        <div class="pref-row row-border">
          <div class="pref-info">
            <div class="pref-label lastfm-label"><IconLastfm size={16} /> Last.fm</div>
            <div class="pref-desc">
              {#if lastfmStatus.account}
                Connected as <strong>{lastfmStatus.account.username}</strong> — scrobbles sync every few minutes and fill gaps Spotify polling misses
              {:else}
                Sync your scrobbles as a second source — fills gaps Spotify polling misses
              {/if}
            </div>
          </div>
          <div class="pref-control lastfm-control">
            {#if lastfmStatus.account}
              {@const backfill = lastfmStatus.account.backfill}
              {#if backfill?.running}
                <span class="lastfm-progress">
                  {backfill.phase === 'fetching'
                    ? `Fetching scrobbles… page ${backfill.page}/${backfill.totalPages || '?'}`
                    : 'Importing…'}
                </span>
              {:else}
                <button class="action-btn action-btn--secondary" disabled={lastfmBusy} onclick={startLastfmBackfill}>
                  {lastfmStatus.account.backfillDone ? 'Re-import history' : 'Import full history'}
                </button>
              {/if}
              <button class="action-btn action-btn--danger" disabled={lastfmBusy || backfill?.running} onclick={disconnectLastfm}>Disconnect</button>
            {:else}
              <a href="/auth/lastfm/login?returnTo=%2Fsettings" class="action-btn">Connect</a>
            {/if}
          </div>
        </div>
        {#if lastfmStatus.account?.backfill?.phase === 'done'}
          <div class="lastfm-note">Backfill complete: {formatNumber(lastfmStatus.account.backfill.imported)} plays imported.</div>
        {/if}
        {#if lastfmStatus.account?.backfill?.error}
          <div class="import-error">Backfill failed: {lastfmStatus.account.backfill.error}</div>
        {/if}
        {#if lastfmError}
          <div class="import-error">{lastfmError}</div>
        {/if}
      {/if}
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
          <div class="pref-label">Merges &amp; relations</div>
          <div class="pref-desc">{mergeCount > 0 ? `${mergeCount} active rule${mergeCount !== 1 ? 's' : ''} combining duplicate entities` : 'Combine duplicate artists, albums, or tracks'} · link related artists without merging them</div>
        </div>
        <div class="pref-control">
          <a href="/settings/merges" class="action-btn action-btn--secondary">Manage</a>
        </div>
      </div>
    </div>
  </div>

  <div class="card section-card">
    <div class="pref-row" style="padding: 0;">
      <div class="pref-info">
        <h3 class="section-card-title" style="margin-bottom: 0.15rem;">Active sessions</h3>
        <div class="pref-desc">Devices signed in to your account</div>
      </div>
      <div class="pref-control">
        <a href="/settings/sessions" class="action-btn action-btn--secondary">Manage</a>
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

  /* fila que apila el control debajo del label (controles anchos, p.ej. el
     editor de disposición de vistas de detalle) */
  .pref-row--stack {
    flex-direction: column;
    align-items: stretch;
    gap: 0.6rem;
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

  .action-btn--danger {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-muted);
  }

  .action-btn--danger:hover {
    border-color: #e5484d;
    color: #e5484d;
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

  .lastfm-label {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }

  .lastfm-control {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }

  .lastfm-progress {
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  .lastfm-note {
    font-size: 0.8rem;
    color: var(--accent);
    padding-top: 0.5rem;
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
