<script lang="ts">
  // layout de /settings: tabs de subsección sobre el shell compartido de la
  // plataforma. el tab admin se muestra según rol (el server gatea sus rutas).
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import SettingsTabs from '@platform/ui/SettingsTabs.svelte';
  import { api } from '$lib/api';

  let { children } = $props();

  let isAdmin = $state(false);

  const TABS = $derived([
    { href: '/settings', label: 'General' },
    { href: '/settings/sessions', label: 'Sessions' },
    ...(isAdmin ? [{ href: '/settings/admin', label: 'Admin' }] : []),
  ]);

  onMount(async () => {
    try {
      const me = await api.me();
      isAdmin = me?.isAdmin ?? false;
    } catch (err) {
      console.error('[settings-layout] could not load user:', err);
    }
  });
</script>

<SettingsTabs tabs={TABS} currentPath={page.url.pathname}>
  {@render children?.()}
</SettingsTabs>
