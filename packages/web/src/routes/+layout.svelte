<script lang="ts">
  import '../app.css';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import type { Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();
  let authChecked = $state(false);
  let authCheckDone = false;

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

  const nav = [
    { href: '/', label: 'Dashboard', icon: '~' },
    { href: '/history', label: 'History', icon: '#' },
    { href: '/top', label: 'Top', icon: '*' },
    { href: '/trends', label: 'Trends', icon: '^' },
    { href: '/insights', label: 'Insights', icon: '!' },
    { href: '/settings', label: 'Settings', icon: '@' },
  ];
</script>

{#if page.url.pathname === '/login'}
  {@render children()}
{:else if authChecked}
  <div class="app-layout">
    <aside class="sidebar">
      <div class="sidebar-logo">SIS</div>
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
      {@render children()}
    </main>
  </div>
{/if}
