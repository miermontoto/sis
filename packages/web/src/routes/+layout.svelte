<script lang="ts">
  import '../app.css';
  import { page } from '$app/state';
  import type { Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();

  const nav = [
    { href: '/', label: 'Dashboard', icon: '~' },
    { href: '/history', label: 'History', icon: '#' },
    { href: '/top', label: 'Top', icon: '*' },
    { href: '/trends', label: 'Trends', icon: '^' },
    { href: '/insights', label: 'Insights', icon: '!' },
    { href: '/settings', label: 'Settings', icon: '@' },
  ];
</script>

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
