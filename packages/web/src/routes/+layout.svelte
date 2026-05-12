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
  import { api, loadSettings, getNowPlayingDisplay, onNowPlayingDisplayChange, getSessionTrackingEnabled, onSessionTrackingChange, type MeResponse, type NowPlayingDisplay } from '$lib/api';
  import { nowPlayingStore } from '$lib/stores/now-playing.svelte';
  import { projectionsStore } from '$lib/stores/projections.svelte';
  import { closedChartsStore } from '$lib/stores/closed-charts.svelte';
  import ProjectedChanges from '$lib/components/ProjectedChanges.svelte';
  import FriendsActivity from '$lib/components/FriendsActivity.svelte';
  import { mergeModal } from '$lib/stores/merge-modal.svelte';
  import { shortcutStore } from '$lib/stores/keyboard-shortcuts.svelte';
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
  let showUserMenu = $state(false);
  let expandedGroup = $state<string | null>(null);
  let userMenuRef = $state<HTMLElement | null>(null);
  let mobileUserMenuRef = $state<HTMLElement | null>(null);
  let tabbarRef = $state<HTMLElement | null>(null);
  let nowPlayingDisplay = $state<NowPlayingDisplay>('auto');
  let sessionTrackingEnabled = $state(true);
  let sidebarEl = $state<HTMLElement | null>(null);
  let sidebarOverflows = $state(false);

  const unsubNpDisplay = onNowPlayingDisplayChange((v) => { nowPlayingDisplay = v; });
  const unsubSessionTracking = onSessionTrackingChange(() => {
    sessionTrackingEnabled = getSessionTrackingEnabled();
    if (sessionTrackingEnabled) projectionsStore.startPolling();
    else projectionsStore.stopPolling();
  });
  onDestroy(() => { nowPlayingStore.stopPolling(); projectionsStore.stopPolling(); unsubNpDisplay(); unsubSessionTracking(); });

  onMount(async () => {
    if (pwaInfo) {
      const { registerSW } = await import('virtual:pwa-register');
      registerSW({ immediate: true });
    }
  });

  $effect(() => {
    if (!sessionTrackingEnabled) return;
    nowPlayingStore.trackId;
    projectionsStore.onTrackChange();
  });

  $effect(() => {
    const el = sidebarEl;
    if (!el) return;
    const check = () => { sidebarOverflows = el.scrollHeight > el.clientHeight; };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    const mo = new MutationObserver(check);
    mo.observe(el, { childList: true, subtree: true });
    return () => { ro.disconnect(); mo.disconnect(); };
  });

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

  $effect(() => {
    if (page.url.pathname === '/login') {
      authChecked = true;
      return;
    }
    if (authCheckDone) return;
    authCheckDone = true;
    fetch('/api/health')
      .then((res) => {
        if (res.status === 401) goto('/login?returnTo=' + encodeURIComponent(page.url.pathname + page.url.search));
        else {
          Promise.all([loadSettings(), api.me().then(m => { user = m; }), api.version().then(v => { appVersion = v.version; }).catch(() => {})]).finally(() => {
            authChecked = true;
            nowPlayingDisplay = getNowPlayingDisplay();
            sessionTrackingEnabled = getSessionTrackingEnabled();
            closedChartsStore.refresh();
            nowPlayingStore.startPolling();
            if (sessionTrackingEnabled) projectionsStore.startPolling();
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

</script>

{#if page.url.pathname === '/login'}
  {@render children()}
{:else if authChecked}
  <div class="app-layout">
    <aside class="sidebar" bind:this={sidebarEl}>
      <div class="sidebar-top">
        <div class="sidebar-logo">
          <span class="sidebar-logo-mark">SIS</span>
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
      <div class="sidebar-friends">
        <FriendsActivity />
      </div>
      {#if sessionTrackingEnabled && (projectionsStore.data?.sessionTrackCount ?? 0) > 0}
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
              <a href="/settings" class="user-menu-item" onclick={() => showUserMenu = false}>Settings</a>
              <a href="/auth/logout" class="user-menu-item user-menu-item--danger">Log out</a>
            </div>
          {/if}
        </div>
      {/if}
      <div class="sidebar-footer">{#if appVersion} <a href="https://github.com/miermontoto/sis" target="_blank" rel="noopener" class="sidebar-version">{appVersion}</a>{/if} · made by <a href="https://mier.info" target="_blank" rel="noopener">mier.info</a></div>
    </aside>
    <main class="main-content">
      <div class="mobile-header">
        <span class="mobile-header-title"><span class="mobile-header-logo">SIS</span>{#if pageTitle}<span class="mobile-header-sep"></span>{pageTitle}{/if}</span>
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
  {#if mergeModal.target}
    <MergeEntityModal
      bind:show={mergeModalShow}
      entityType={mergeModal.target.entityType}
      target={mergeModal.target.target}
      parentId={mergeModal.target.parentId}
      existingMerges={mergeModal.target.existingMerges}
      onMerged={() => { mergeModal.refresh(); mergeModal.notifyChange(); }}
    />
  {/if}
{/if}
