<script lang="ts">
  import '../app.css';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import type { Snippet } from 'svelte';
  import SearchModal from '$lib/components/SearchModal.svelte';
  import NowPlaying from '$lib/components/NowPlaying.svelte';
  import ContextMenu from '$lib/components/ContextMenu.svelte';
  import MergeEntityModal from '$lib/components/MergeEntityModal.svelte';
  import KeyboardShortcutsHelp from '$lib/components/KeyboardShortcutsHelp.svelte';
  import Toast from '$lib/components/Toast.svelte';
  import Changelog from '@platform/ui/Changelog.svelte';
  import { API_BASE, api, loadSettings, getChangelog, markChangelogSeen, getNowPlayingDisplay, onNowPlayingDisplayChange, getSessionTrackingDisplay, onSessionTrackingDisplayChange, getSessionRankDisplay, onSessionRankDisplayChange, type MeResponse, type NowPlayingDisplay, type SessionTrackingDisplay, type SessionRankDisplay, type RankProjection, type ProjectionResult, type ChangelogStateDTO } from '$lib/api';
  import { formatDuration } from '$lib/utils/format';
  import { nowPlayingStore } from '$lib/stores/now-playing.svelte';
  import { projectionsStore } from '$lib/stores/projections.svelte';
  import { closedChartsStore } from '$lib/stores/closed-charts.svelte';
  import ProjectedChanges from '$lib/components/ProjectedChanges.svelte';
  import IconTrack from '$lib/icons/IconTrack.svelte';
  import IconArtist from '$lib/icons/IconArtist.svelte';
  import IconAlbum from '$lib/icons/IconAlbum.svelte';
  import FriendsActivity from '$lib/components/FriendsActivity.svelte';
  import RefreshingIndicator from '$lib/components/RefreshingIndicator.svelte';
  import { mergeModal } from '$lib/stores/merge-modal.svelte';
  import { shortcutStore } from '$lib/stores/keyboard-shortcuts.svelte';
  import { prewarmer, setUser, hydrateUser, bootCleanup } from '$lib/cache';

  // hidrata el namespace del cache antes de cualquier apiFetch para que
  // /me, /settings, /version hagan hit cuando vuelves al app.
  hydrateUser();
  import IconPause from '$lib/icons/IconPause.svelte';
  import IconPlay from '$lib/icons/IconPlay.svelte';
  import IconPrev from '$lib/icons/IconPrev.svelte';
  import IconNext from '$lib/icons/IconNext.svelte';
  import IconHeartFilled from '$lib/icons/IconHeartFilled.svelte';
  import IconHeartOutline from '$lib/icons/IconHeartOutline.svelte';
  import { onDestroy, onMount } from 'svelte';
  import { pwaInfo } from 'virtual:pwa-info';

  // estado del modal global de merge (abierto desde el menú contextual).
  // Sincroniza bidireccionalmente con el store: abre al set target, cierra al
  // dismissar el modal.
  let mergeModalShow = $state(false);
  $effect(() => {
    mergeModalShow = mergeModal.target !== null;
  });
  $effect(() => {
    if (!mergeModalShow && mergeModal.target) mergeModal.close();
  });

  let { children }: { children: Snippet } = $props();
  let authChecked = $state(false);
  let authCheckDone = false;
  let showSearch = $state(false);
  let user = $state<MeResponse | null>(null);
  let appVersion = $state('');
  // changelog "novedades": estado del usuario + modal (auto-abre si hay no vistas)
  let changelog = $state<ChangelogStateDTO | null>(null);
  let showChangelog = $state(false);
  let showUserMenu = $state(false);
  let expandedGroup = $state<string | null>(null);
  let userMenuRef = $state<HTMLElement | null>(null);
  let mobileUserMenuRef = $state<HTMLElement | null>(null);
  let tabbarRef = $state<HTMLElement | null>(null);
  let nowPlayingDisplay = $state<NowPlayingDisplay>('auto');
  let sessionTrackingDisplay = $state<SessionTrackingDisplay>('all');
  let sessionRankDisplay = $state<SessionRankDisplay>(getSessionRankDisplay());
  let sidebarEl = $state<HTMLElement | null>(null);
  let sidebarOverflows = $state(false);

  const unsubNpDisplay = onNowPlayingDisplayChange((v) => { nowPlayingDisplay = v; });
  const unsubSessionTracking = onSessionTrackingDisplayChange(() => {
    sessionTrackingDisplay = getSessionTrackingDisplay();
    if (sessionTrackingDisplay !== 'off') projectionsStore.startPolling();
    else projectionsStore.stopPolling();
  });
  const unsubSessionRank = onSessionRankDisplayChange(() => { sessionRankDisplay = getSessionRankDisplay(); });
  onDestroy(() => { nowPlayingStore.stopPolling(); projectionsStore.stopPolling(); unsubNpDisplay(); unsubSessionTracking(); unsubSessionRank(); });

  onMount(async () => {
    if (pwaInfo) {
      const { registerSW } = await import('virtual:pwa-register');
      registerSW({ immediate: true });
    }
  });

  // oauth móvil (apk): el deep link info.mier.sis://auth/callback?code=... llega
  // tras el login en el browser del sistema; canjear el código por la cookie de
  // sesión (CapacitorHttp → cookie jar nativo) y recargar la spa autenticada.
  // el scheme replica MOBILE_SCHEME de la api (copia mínima, sin lib compartida).
  onMount(async () => {
    const { Capacitor } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform()) return;
    // tinta las system bars (status + navigation) con el fondo del tema (--bg)
    const { observeSystemBars } = await import('@platform/mobile/system-bars');
    observeSystemBars({ backgroundVar: '--bg' });
    const { onAppLink, onAuthDeepLink } = await import('@platform/mobile/deep-link');
    // app links https: navegar a la ruta del link (compartidos /s /u /artist...)
    await onAppLink('sis.mier.info', (path) => goto(path));
    await onAuthDeepLink('info.mier.sis', async (url) => {
      const code = url.searchParams.get('code');
      if (!code) return;
      const res = await fetch(`${import.meta.env.VITE_API_BASE ?? ''}/auth/mobile/exchange`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      if (res.ok) window.location.href = '/';
      else console.error('[auth] canje del código móvil falló:', res.status);
    });
  });

  $effect(() => {
    if (sessionTrackingDisplay === 'off') return;
    nowPlayingStore.trackId;
    projectionsStore.onTrackChange();
  });

  $effect(() => {
    const el = sidebarEl;
    if (!el) return;
    // histéresis para evitar feedback loop: NP compacto reduce scrollHeight,
    // lo que haría que sidebarOverflows vuelva a false, agrandando NP de
    // nuevo. Para volver a full, exigimos margen suficiente (~150px, la
    // diferencia aproximada entre NP full y compacto).
    const NP_HEIGHT_DIFF = 150;
    const check = () => {
      if (sidebarOverflows) {
        sidebarOverflows = el.scrollHeight + NP_HEIGHT_DIFF > el.clientHeight;
      } else {
        sidebarOverflows = el.scrollHeight > el.clientHeight;
      }
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    const mo = new MutationObserver(check);
    mo.observe(el, { childList: true, subtree: true });
    return () => { ro.disconnect(); mo.disconnect(); };
  });

  // cierra el modal de novedades y marca todo como visto (avanza el corte)
  async function dismissChangelog() {
    showChangelog = false;
    if (changelog && changelog.unseen > 0) {
      changelog = { ...changelog, unseen: 0 };
      try { await markChangelogSeen(); } catch {}
    }
  }

  // reabre el modal al clicar el tag de versión en el footer
  function openChangelog() {
    showUserMenu = false;
    if (changelog) showChangelog = true;
  }

  function handleClickOutside(e: MouseEvent) {
    if (showUserMenu) {
      const inDesktop = userMenuRef?.contains(e.target as Node);
      const inMobile = mobileUserMenuRef?.contains(e.target as Node);
      if (!inDesktop && !inMobile) showUserMenu = false;
    }
    if (expandedGroup && !tabbarRef?.contains(e.target as Node)) {
      expandedGroup = null;
    }
  }

  $effect(() => {
    if (showUserMenu || expandedGroup) {
      document.addEventListener('click', handleClickOutside, true);
      return () => document.removeEventListener('click', handleClickOutside, true);
    }
  });

  // rutas sin chrome ni auth gate: login + vistas públicas de share links +
  // política de privacidad (debe ser accesible sin sesión, p.ej. revisión de stores)
  function isBareRoute(pathname: string): boolean {
    return pathname === '/login' || pathname === '/privacy' || pathname.startsWith('/s/');
  }

  $effect(() => {
    if (isBareRoute(page.url.pathname)) {
      authChecked = true;
      return;
    }
    if (authCheckDone) return;
    authCheckDone = true;
    fetch(`${API_BASE}/health`)
      .then((res) => {
        if (res.status === 401) goto('/login?returnTo=' + encodeURIComponent(page.url.pathname + page.url.search));
        else {
          Promise.all([loadSettings(), api.me().then(m => { user = m; }), api.version().then(v => { appVersion = v.version; }).catch(() => {}), getChangelog().then(c => { changelog = c; if (c.unseen > 0) showChangelog = true; }).catch(() => {})]).finally(() => {
            authChecked = true;
            nowPlayingDisplay = getNowPlayingDisplay();
            sessionTrackingDisplay = getSessionTrackingDisplay();
            sessionRankDisplay = getSessionRankDisplay();
            closedChartsStore.refresh();
            nowPlayingStore.startPolling();
            if (sessionTrackingDisplay !== 'off') projectionsStore.startPolling();
            // namespacing del cache por usuario + limpieza foreign/LRU + prewarming
            setUser(user?.userId ?? user?.spotifyId ?? null);
            bootCleanup();
            prewarmer.start();
          });
        }
      })
      .catch(() => {
        authChecked = true;
      });
  });

  $effect(() => {
    function handleKeydown(e: KeyboardEvent) {
      shortcutStore.handleKeydown(e, {
        openSearch: () => { showSearch = true; },
        isSearchOpen: () => showSearch,
      });
    }
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  });

  const navGroups = [
    {
      label: 'Listen',
      items: [
        { href: '/', label: 'Dashboard', icon: '~' },
        { href: '/history', label: 'History', icon: '#', mobileHidden: true },
      ],
    },
    {
      label: 'Stats',
      items: [
        { href: '/top', label: 'Rankings', icon: '*' },
        { href: '/charts', label: 'Charts', icon: '%' },
      ],
    },
    {
      label: 'Highlights',
      items: [
        { href: '/insights', label: 'Insights', icon: '!' },
        { href: '/records', label: 'Records', icon: '^' },
      ],
    },
    {
      label: 'Library',
      items: [
        { href: '/playlists', label: 'Playlists', icon: '+' },
        { href: '/generators', label: 'Generators', icon: '&' },
      ],
    },
    {
      label: 'Social',
      items: [
        { href: '/users', label: 'Users', icon: '@' },
        { href: '/feed', label: 'Feed', icon: '=' },
      ],
    },
  ];

  const nav = navGroups.flatMap(group => group.items);
  const mobileNavGroups = navGroups
    .map(g => ({ label: g.label, items: g.items.filter(i => !('mobileHidden' in i)) }))
    .filter(g => g.items.length > 0);

  function isNavActive(href: string) {
    return page.url.pathname === href || (href !== '/' && page.url.pathname.startsWith(href));
  }

  function isGroupActive(group: typeof mobileNavGroups[number]) {
    return group.items.some(i => isNavActive(i.href));
  }

  function handleGroupTap(group: typeof mobileNavGroups[number]) {
    if (group.items.length === 1) {
      goto(group.items[0].href);
      expandedGroup = null;
    } else {
      expandedGroup = expandedGroup === group.label ? null : group.label;
    }
  }

  let pageTitle = $derived(
    nav.find(n => isNavActive(n.href))?.label ?? null
  );

  let miniActing = $state(false);

  async function miniTogglePlay() {
    const d = nowPlayingStore.data;
    if (!d || miniActing) return;
    miniActing = true;
    try {
      if (d.isPlaying) {
        await api.playbackPause();
        nowPlayingStore.data = { ...d, isPlaying: false };
      } else {
        await api.playbackPlay();
        nowPlayingStore.data = { ...d, isPlaying: true };
      }
    } catch {} finally {
      miniActing = false;
    }
  }

  async function miniPrevious() {
    if (miniActing) return;
    miniActing = true;
    try {
      await api.playbackPrevious();
      setTimeout(() => nowPlayingStore.pollLive(), 500);
    } catch {} finally {
      miniActing = false;
    }
  }

  async function miniNext() {
    if (miniActing) return;
    miniActing = true;
    try {
      await api.playbackNext();
      setTimeout(() => nowPlayingStore.pollLive(), 500);
    } catch {} finally {
      miniActing = false;
    }
  }

  const RANGE_LABELS: Record<string, string> = { thisYear: 'YTD', all: 'ALL' };
  const ALLOWED_RANGES: Record<string, Set<string>> = {
    'all': new Set(['all']),
    'all+ytd': new Set(['all', 'thisYear']),
  };

  function marqueeBestChange(changes: RankProjection[]): RankProjection | null {
    const allowed = ALLOWED_RANGES[sessionRankDisplay];
    if (!allowed) return null;
    const filtered = changes.filter(c => allowed.has(c.range));
    if (filtered.length === 0) return null;
    return filtered.reduce((best, c) => Math.abs(c.delta) > Math.abs(best.delta) ? c : best);
  }

  // en modo solo-ALL la etiqueta de rango es redundante (no hay YTD con qué contrastar)
  function rangeLabel(range: string): string {
    return sessionRankDisplay === 'all' ? '' : `${RANGE_LABELS[range] ?? range} `;
  }

  let marqueeItems = $derived.by(() => {
    const d = projectionsStore.data;
    if (!d || d.sessionTrackCount === 0) return [];
    const items: { r: ProjectionResult; best: RankProjection }[] = [];
    for (const r of d.session) {
      const best = marqueeBestChange(r.changes);
      if (best) items.push({ r, best });
    }
    return items;
  });

</script>

{#if isBareRoute(page.url.pathname)}
  {@render children()}
{:else if authChecked}
  <div class="app-layout">
    <aside class="sidebar" bind:this={sidebarEl}>
      <div class="sidebar-top">
        <div class="sidebar-logo">
          <span class="sidebar-logo-mark">SIS<RefreshingIndicator /></span>
          <span class="sidebar-logo-subtitle">listening stats</span>
        </div>
        <button class="sidebar-search" onclick={() => showSearch = true}>
          <span class="sidebar-search-icon">?</span>
          <span>Search</span>
          <kbd>⌘K</kbd>
        </button>
      </div>
      <nav class="sidebar-nav sidebar-nav--desktop" aria-label="Primary navigation">
        {#each navGroups as group}
          <div class="sidebar-nav-section">
            <span class="sidebar-nav-heading">{group.label}</span>
            {#each group.items as item}
              <a href={item.href} class:active={isNavActive(item.href)}>
                <span class="sidebar-nav-icon" aria-hidden="true">{item.icon}</span>
                <span>{item.label}</span>
              </a>
            {/each}
          </div>
        {/each}
      </nav>
      {#if sessionTrackingDisplay === 'all' && (projectionsStore.data?.sessionTrackCount ?? 0) > 0}
        <div class="mobile-session-marquee">
          <div class="mobile-session-marquee-inner">
            <span class="mobile-session-marquee-content">
              <span class="mobile-session-label">Session · {projectionsStore.data?.sessionTrackCount} tracks · {formatDuration(projectionsStore.data?.sessionTotalMs ?? 0)}</span>
              {#each marqueeItems as { r, best }}
                <span class="mobile-session-sep"></span>
                <a href="/{r.entityType}/{r.entityId}" class="mobile-session-item">
                  {#if r.imageUrl}
                    <span class="mobile-session-thumb-wrap" class:mobile-session-thumb--round={r.entityType === 'artist'}>
                      <img class="mobile-session-thumb" src={r.imageUrl} alt="" loading="lazy" />
                      <span class="mobile-session-badge" aria-hidden="true">
                        {#if r.entityType === 'track'}<IconTrack size={7} />
                        {:else if r.entityType === 'artist'}<IconArtist size={7} />
                        {:else}<IconAlbum size={7} />
                        {/if}
                      </span>
                    </span>
                  {/if}
                  <span class="mobile-session-entity">{r.entityName}</span>
                  <span class="mobile-session-rank" class:up={best.delta > 0} class:down={best.delta < 0}>{rangeLabel(best.range)}#{best.currentRank}→#{best.projectedRank}</span>
                </a>
              {/each}
            </span>
            <span class="mobile-session-marquee-content" aria-hidden="true">
              <span class="mobile-session-label">Session · {projectionsStore.data?.sessionTrackCount} tracks · {formatDuration(projectionsStore.data?.sessionTotalMs ?? 0)}</span>
              {#each marqueeItems as { r, best }}
                <span class="mobile-session-sep"></span>
                <a href="/{r.entityType}/{r.entityId}" class="mobile-session-item" tabindex="-1">
                  {#if r.imageUrl}
                    <span class="mobile-session-thumb-wrap" class:mobile-session-thumb--round={r.entityType === 'artist'}>
                      <img class="mobile-session-thumb" src={r.imageUrl} alt="" loading="lazy" />
                      <span class="mobile-session-badge" aria-hidden="true">
                        {#if r.entityType === 'track'}<IconTrack size={7} />
                        {:else if r.entityType === 'artist'}<IconArtist size={7} />
                        {:else}<IconAlbum size={7} />
                        {/if}
                      </span>
                    </span>
                  {/if}
                  <span class="mobile-session-entity">{r.entityName}</span>
                  <span class="mobile-session-rank" class:up={best.delta > 0} class:down={best.delta < 0}>{rangeLabel(best.range)}#{best.currentRank}→#{best.projectedRank}</span>
                </a>
              {/each}
            </span>
          </div>
        </div>
      {/if}
      {#if nowPlayingStore.data?.playing && nowPlayingStore.data.track}
        {@const npData = nowPlayingStore.data}
        <a href="/track/{npData.track.id}" class="mobile-mini-player">
          {#if npData.track.album?.imageUrl}
            <img class="mini-player-art" src={npData.track.album.imageUrl} alt={npData.track.album.name} />
          {:else}
            <div class="mini-player-art"></div>
          {/if}
          <div class="mini-player-info">
            <span class="mini-player-track">{npData.track.name}</span>
            <span class="mini-player-artist">{npData.track.artists.map(a => a.name).join(', ')}</span>
          </div>
          <div class="mini-player-controls">
            <button
              class="mini-player-btn"
              title="Previous"
              disabled={miniActing}
              onclick={(e) => { e.stopPropagation(); e.preventDefault(); miniPrevious(); }}
            >
              <IconPrev size={14} />
            </button>
            <button
              class="mini-player-btn mini-player-btn--play"
              title={npData.isPlaying ? 'Pause' : 'Play'}
              disabled={miniActing}
              onclick={(e) => { e.stopPropagation(); e.preventDefault(); miniTogglePlay(); }}
            >
              {#if npData.isPlaying}
                <IconPause size={18} />
              {:else}
                <IconPlay size={18} />
              {/if}
            </button>
            <button
              class="mini-player-btn"
              title="Next"
              disabled={miniActing}
              onclick={(e) => { e.stopPropagation(); e.preventDefault(); miniNext(); }}
            >
              <IconNext size={14} />
            </button>
          </div>
          <button
            class="mini-player-btn mini-player-btn--like"
            class:mini-player-btn--liked={nowPlayingStore.isLiked}
            title={nowPlayingStore.likeLoading ? 'Loading...' : nowPlayingStore.isLiked ? 'Remove from Liked Songs' : 'Save to Liked Songs'}
            disabled={nowPlayingStore.likeLoading}
            onclick={(e) => { e.stopPropagation(); e.preventDefault(); nowPlayingStore.toggleLike(); }}
          >
            {#if nowPlayingStore.likeLoading}
              <span class="btn-spinner"></span>
            {:else if nowPlayingStore.isLiked}
              <IconHeartFilled size={14} />
            {:else}
              <IconHeartOutline size={14} />
            {/if}
          </button>
        </a>
      {/if}
      <nav class="mobile-tabbar" bind:this={tabbarRef} aria-label="Primary navigation">
        {#each mobileNavGroups as group}
          <div class="mobile-tab-group">
            <button
              type="button"
              class="mobile-tab-btn"
              class:active={isGroupActive(group)}
              onclick={() => handleGroupTap(group)}
            >
              <span class="sidebar-nav-icon" aria-hidden="true">{group.items[0].icon}</span>
              <span>{group.label}</span>
            </button>
            {#if expandedGroup === group.label && group.items.length > 1}
              <div class="mobile-tab-popup">
                {#each group.items as item}
                  <a
                    href={item.href}
                    class:active={isNavActive(item.href)}
                    onclick={() => expandedGroup = null}
                  >
                    <span class="sidebar-nav-icon" aria-hidden="true">{item.icon}</span>
                    <span>{item.label}</span>
                  </a>
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      </nav>
      <div class="sidebar-spacer"></div>
      <div class="sidebar-friends">
        <FriendsActivity />
      </div>
      {#if sessionTrackingDisplay !== 'off' && (projectionsStore.data?.sessionTrackCount ?? 0) > 0}
        <div class="sidebar-projections">
          <ProjectedChanges />
        </div>
      {/if}
      {#if nowPlayingDisplay !== 'off'}
        <div class="sidebar-now-playing">
          <NowPlaying compact inline={nowPlayingDisplay === 'compact' || (nowPlayingDisplay === 'auto' && sidebarOverflows)} />
        </div>
      {/if}
      {#if user?.authenticated}
        <div class="sidebar-user-wrap" bind:this={userMenuRef}>
          <button class="sidebar-user" onclick={() => showUserMenu = !showUserMenu}>
            {#if user.imageUrl}
              <img class="sidebar-user-avatar" src={user.imageUrl} alt="" />
            {:else}
              <div class="sidebar-user-avatar sidebar-user-avatar--empty"></div>
            {/if}
            <div class="sidebar-user-info">
              <span class="sidebar-user-name">{user.displayName ?? user.spotifyId}</span>
              <span class="sidebar-user-id">{user.spotifyId}</span>
            </div>
            <span class="sidebar-user-dots">...</span>
            {#if user.isAdmin}<span class="sidebar-admin-badge">admin</span>{/if}
          </button>
          {#if showUserMenu}
            <div class="user-menu">
              <a href="/u/{encodeURIComponent(user.spotifyId)}" class="user-menu-item" onclick={() => showUserMenu = false}>Profile</a>
              <a href="/settings" class="user-menu-item" onclick={() => showUserMenu = false}>Settings</a>
              <a href="/auth/logout" class="user-menu-item user-menu-item--danger">Log out</a>
            </div>
          {/if}
        </div>
      {/if}
      <div class="sidebar-footer">{#if appVersion} <button type="button" class="sidebar-version" onclick={openChangelog}>{appVersion}{#if (changelog?.unseen ?? 0) > 0}<span class="menu-dot"></span>{/if}</button>{/if} · made by <a href="https://mier.info" target="_blank" rel="noopener">mier.info</a></div>
    </aside>
    <main class="main-content">
      <div class="mobile-header">
        <span class="mobile-header-title"><span class="mobile-header-logo">SIS<RefreshingIndicator /></span>{#if pageTitle}<span class="mobile-header-sep"></span>{pageTitle}{/if}</span>
        <div class="mobile-header-right">
          <button class="mobile-search-bar" onclick={() => showSearch = true}>
            Search...
          </button>
          {#if user?.authenticated}
            <div class="mobile-user-wrap" bind:this={mobileUserMenuRef}>
              <button class="mobile-user-btn" onclick={() => showUserMenu = !showUserMenu}>
                {#if user.imageUrl}
                  <img class="mobile-user-avatar" src={user.imageUrl} alt="" />
                {:else}
                  <div class="mobile-user-avatar mobile-user-avatar--empty"></div>
                {/if}
              </button>
              {#if showUserMenu}
                <div class="mobile-user-menu">
                  <div class="mobile-user-menu-header">
                    <span class="mobile-user-menu-name">{user.displayName ?? user.spotifyId}</span>
                    <span class="mobile-user-menu-id">{user.spotifyId}</span>
                  </div>
                  <a href="/u/{encodeURIComponent(user.spotifyId)}" class="user-menu-item" onclick={() => showUserMenu = false}>Profile</a>
                  <a href="/settings" class="user-menu-item" onclick={() => showUserMenu = false}>Settings</a>
                  <a href="/auth/logout" class="user-menu-item user-menu-item--danger">Log out</a>
                </div>
              {/if}
            </div>
          {/if}
        </div>
      </div>
      {@render children()}
    </main>
  </div>
  <SearchModal bind:show={showSearch} />
  <KeyboardShortcutsHelp />
  <ContextMenu />
  <Toast />
  {#if showChangelog && changelog}
    <!-- mapea las vars --ui-* del componente compartido al tema de sis -->
    <div style="--ui-bg-card: var(--bg); --ui-border: var(--border); --ui-radius: var(--radius); --ui-text: var(--text); --ui-accent: var(--accent); --ui-accent-text: #fff; --ui-bg-hover: var(--bg-hover); --ui-danger: var(--danger);">
      <Changelog entries={changelog.entries} lang="en" ondismiss={dismissChangelog} />
    </div>
  {/if}
  {#if mergeModal.target}
    <MergeEntityModal
      bind:show={mergeModalShow}
      entityType={mergeModal.target.entityType}
      target={mergeModal.target.target}
      parentId={mergeModal.target.parentId}
      existingMerges={mergeModal.target.existingMerges}
      initialStep={mergeModal.target.initialStep}
      onMerged={() => { mergeModal.refresh(); mergeModal.notifyChange(); }}
    />
  {/if}
{/if}

<style>
  /* punto indicador de novedades sin ver junto al tag de versión */
  .menu-dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    margin-left: 0.4rem;
    border-radius: 50%;
    background: var(--accent, #1db954);
    vertical-align: middle;
  }
</style>
