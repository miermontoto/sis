<script lang="ts">
  import '../app.css';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import type { Snippet } from 'svelte';
  import SearchModal from '$lib/components/SearchModal.svelte';

  let { children }: { children: Snippet } = $props();
  let authChecked = $state(false);
  let authCheckDone = false;
  let showSearch = $state(false);

  $effect(() => {
    if (page.url.pathname === '/login') {
      authChecked = true;
      return;
    }
    if (authCheckDone) return;
    authCheckDone = true;
    fetch('/api/health')
      .then((res) => {
        if (res.status === 401) goto('/login');
        else authChecked = true;
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
    { href: '/trends', label: 'Trends', icon: '^' },
    { href: '/insights', label: 'Insights', icon: '!' },
    { href: '/settings', label: 'Settings', icon: '@' },
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
