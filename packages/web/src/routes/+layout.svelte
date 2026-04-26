<script lang="ts">
  import '../app.css';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import type { Snippet } from 'svelte';
  import SearchModal from '$lib/components/SearchModal.svelte';
  import NowPlaying from '$lib/components/NowPlaying.svelte';
  import ContextMenu from '$lib/components/ContextMenu.svelte';
  import MergeEntityModal from '$lib/components/MergeEntityModal.svelte';
  import { api, loadSettings, type MeResponse } from '$lib/api';
  import { nowPlayingStore } from '$lib/stores/now-playing.svelte';
  import { mergeModal } from '$lib/stores/merge-modal.svelte';
  import { onDestroy } from 'svelte';

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
  let showUserMenu = $state(false);
  let userMenuRef = $state<HTMLElement | null>(null);
  let mobileUserMenuRef = $state<HTMLElement | null>(null);

  onDestroy(() => nowPlayingStore.stopPolling());

  function handleClickOutside(e: MouseEvent) {
    if (showUserMenu) {
      const inDesktop = userMenuRef?.contains(e.target as Node);
      const inMobile = mobileUserMenuRef?.contains(e.target as Node);
      if (!inDesktop && !inMobile) showUserMenu = false;
    }
  }

  $effect(() => {
    if (showUserMenu) {
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
          Promise.all([loadSettings(), api.me().then(m => { user = m; })]).finally(() => {
            authChecked = true;
            nowPlayingStore.startPolling();
          });
        }
      })
      .catch(() => {
        authChecked = true;
      });
  });

  $effect(() => {
    function handleKeydown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        showSearch = true;
      }
    }
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  });

  const nav = [
    { href: '/', label: 'Dashboard', icon: '~' },
    { href: '/history', label: 'History', icon: '#' },
    { href: '/top', label: 'Top', icon: '*' },
    { href: '/charts', label: 'Charts', icon: '%' },
    { href: '/insights', label: 'Insights', icon: '!' },
    { href: '/records', label: 'Records', icon: '^' },
    { href: '/playlists', label: 'Playlists', icon: '+' },
    { href: '/generators', label: 'Generators', icon: '&' },
  ];

  let pageTitle = $derived(
    nav.find(n => n.href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(n.href))?.label ?? null
  );
</script>

{#if page.url.pathname === '/login'}
  {@render children()}
{:else if authChecked}
  <div class="app-layout">
    <aside class="sidebar">
      <div class="sidebar-logo">SIS</div>
      <button class="sidebar-search" onclick={() => showSearch = true}>
        <span>?</span>
        <span>Search</span>
        <kbd>⌘K</kbd>
      </button>
      <nav>
        {#each nav as item}
          <a
            href={item.href}
            class:active={page.url.pathname === item.href || (item.href !== '/' && page.url.pathname.startsWith(item.href))}
          >
            <span>{item.icon}</span>
            <span>{item.label}</span>
          </a>
        {/each}
      </nav>
      <div class="sidebar-now-playing">
        <NowPlaying compact />
      </div>
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
      <div class="sidebar-footer">SIS · made by <a href="https://mier.info" target="_blank" rel="noopener">mier.info</a></div>
    </aside>
    <main class="main-content">
      <div class="mobile-header">
        <span class="mobile-header-title"><span class="mobile-header-logo">SIS</span>{#if pageTitle} <span class="mobile-header-sep">|</span> {pageTitle}{/if}</span>
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
  <ContextMenu />
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
