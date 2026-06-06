<script lang="ts">
  // /settings/sessions: sesiones de login activas + cerrar las demás
  import { onMount } from 'svelte';
  import SessionsPanel from '@platform/ui/SessionsPanel.svelte';
  import { listLoginSessions, logoutOtherSessions, type SessionInfo } from '$lib/api';

  let sessions = $state<SessionInfo[]>([]);
  let error = $state<string | null>(null);
  let busy = $state(false);

  async function load() {
    try {
      sessions = (await listLoginSessions()).sessions;
    } catch (err) {
      error = (err as Error).message;
    }
  }

  async function logoutOthers() {
    if (!confirm('Log out all other active sessions?')) return;
    busy = true;
    try {
      await logoutOtherSessions();
      await load();
    } catch (err) {
      error = (err as Error).message;
    } finally {
      busy = false;
    }
  }

  onMount(load);
</script>

<svelte:head><title>Sessions — SIS</title></svelte:head>

<div class="sessions-page">
  <h2>Active sessions</h2>
  {#if error}<p class="error">{error}</p>{/if}
  <SessionsPanel
    {sessions}
    {busy}
    onlogoutothers={logoutOthers}
    labels={{
      current: 'this session',
      unknownAgent: 'unknown device',
      created: 'started',
      expires: 'expires',
      logoutOthers: 'Log out other sessions',
      empty: 'No active sessions',
    }}
  />
</div>

<style>
  .sessions-page {
    max-width: 640px;
    margin: 0 auto;
    padding: 0 1rem;
  }
  .sessions-page h2 {
    font-size: 1rem;
    margin: 0 0 0.75rem;
  }
  .error {
    color: var(--danger, #c33);
    font-size: 0.8rem;
  }
</style>
