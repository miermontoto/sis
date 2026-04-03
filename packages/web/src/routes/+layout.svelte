<script lang="ts">
  import '../app.css';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import type { Snippet } from 'svelte';
  import SearchModal from '$lib/components/SearchModal.svelte';
  import NowPlaying from '$lib/components/NowPlaying.svelte';
  import { api, loadSettings, type MeResponse } from '$lib/api';
  import { nowPlayingStore } from '$lib/stores/now-playing.svelte';
  import { onDestroy } from 'svelte';

  let { children }: { children: Snippet } = $props();
  let authChecked = $state(false);
  let authCheckDone = false;
  let showSearch = $state(false);
  let user = $state<MeResponse | null>(null);
  let showUserMenu = $state(false);
  let userMenuRef = $state<HTMLElement | null>(null);

  onDestroy(() => nowPlayingStore.stopPolling());

  function handleClickOutside(e: MouseEvent) {
    if (showUserMenu && userMenuRef && !userMenuRef.contains(e.target as Node)) {
      showUserMenu = false;
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
          </button>
          {#if showUserMenu}
            <div class="user-menu">
              <a href="/settings" class="user-menu-item" onclick={() => showUserMenu = false}>Settings</a>
              <a href="/auth/logout" class="user-menu-item user-menu-item--danger">Log out</a>
            </div>
          {/if}
        </div>
      {/if}
    </aside>
    <main class="main-content">
      <div class="mobile-header">
        <span class="mobile-header-title"><span class="mobile-header-logo">SIS</span>{#if pageTitle} <span class="mobile-header-sep">|</span> {pageTitle}{/if}</span>
        <button class="mobile-search-bar" onclick={() => showSearch = true}>
          Search...
        </button>
      </div>
      {@render children()}
    </main>
  </div>
  <SearchModal bind:show={showSearch} />
{/if}
