<script lang="ts">
  // picker de instancia del apk: la app no trae ninguna fijada, así que el
  // primer arranque entra aquí y desde login/settings se puede volver para
  // cambiarla. en web no tiene sentido (la api sirve la spa) y se sale a /.
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { OFFICIAL_INSTANCE, hasInstance, instanceLabel, isNativeApp, probeInstance, switchInstance } from '$lib/instance';
  import { instanceHost, normalizeInstanceUrl } from '$lib/utils/instance-url';
  import Wordmark from '$lib/components/Wordmark.svelte';

  const LOGIN_ROUTE = '/login';
  const officialHost = instanceHost(OFFICIAL_INSTANCE);

  let input = $state('');
  let busy = $state(false);
  let error = $state<string | null>(null);
  let current = $state('');

  onMount(() => {
    if (!isNativeApp()) {
      void goto('/');
      return;
    }
    if (hasInstance()) current = instanceLabel();
  });

  async function connect(origin: string | null) {
    if (busy) return;
    if (!origin) {
      error = 'Enter the address of a SIS instance. Only https:// is supported.';
      return;
    }
    busy = true;
    error = null;
    try {
      await probeInstance(origin);
    } catch {
      error = `Could not reach a SIS instance at ${instanceHost(origin)}.`;
      busy = false;
      return;
    }
    await switchInstance(origin);
    // recarga completa: vacía el L1 en memoria y el espejo de ajustes
    window.location.href = LOGIN_ROUTE;
  }

  function submit(e: SubmitEvent) {
    e.preventDefault();
    void connect(normalizeInstanceUrl(input));
  }
</script>

<div class="connect-page">
  <div class="connect-container">
    <div class="connect-card">
      <div class="logo-mark"><Wordmark /></div>
      <h1 class="connect-title">Connect to an instance</h1>
      <p class="connect-desc">SIS is self-hosted. Enter the address of the server you want this app to use.</p>

      <form onsubmit={submit}>
        <input
          class="connect-input"
          type="url"
          inputmode="url"
          autocapitalize="off"
          autocorrect="off"
          spellcheck="false"
          placeholder="https://sis.example.org"
          bind:value={input}
          disabled={busy}
        />
        {#if error}
          <div class="connect-error">{error}</div>
        {/if}
        <button type="submit" class="connect-btn" disabled={busy}>{busy ? 'Connecting…' : 'Connect'}</button>
      </form>

      <button type="button" class="connect-btn connect-btn--secondary" onclick={() => connect(OFFICIAL_INSTANCE)} disabled={busy}>
        Use {officialHost}
      </button>

      {#if current}
        <div class="connect-current">
          Currently connected to {current} · <a href={LOGIN_ROUTE}>Keep it</a>
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .connect-page {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    background: var(--bg);
  }

  .connect-container {
    width: 100%;
    max-width: 400px;
    padding: 1rem;
  }

  .connect-card {
    text-align: center;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 2.5rem 2rem 2rem;
  }

  .logo-mark {
    display: flex;
    justify-content: center;
    font-size: 2.8rem;
    color: var(--text);
    margin-bottom: 1.5rem;
  }

  .connect-title {
    font-size: 1.1rem;
    font-weight: 600;
    margin: 0 0 0.4rem;
  }

  .connect-desc {
    font-size: 0.85rem;
    color: var(--text-muted);
    margin: 0 0 1.25rem;
    line-height: 1.4;
  }

  .connect-input {
    width: 100%;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text);
    font-size: 0.95rem;
    padding: 0.7rem 0.9rem;
    margin-bottom: 0.6rem;
  }

  .connect-input:focus {
    outline: none;
    border-color: var(--accent);
  }

  .connect-error {
    background: rgba(255, 170, 0, 0.08);
    border: 1px solid rgba(255, 170, 0, 0.3);
    color: #ffaa00;
    padding: 0.7rem 0.9rem;
    border-radius: var(--radius);
    font-size: 0.85rem;
    line-height: 1.4;
    margin-bottom: 0.6rem;
    text-align: left;
  }

  .connect-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    background: var(--accent);
    color: #000;
    font-weight: 600;
    font-size: 0.95rem;
    padding: 0.8rem 1.5rem;
    border: none;
    border-radius: var(--radius);
    cursor: pointer;
  }

  .connect-btn:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .connect-btn--secondary {
    margin-top: 0.6rem;
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text);
  }

  .connect-current {
    margin-top: 1.25rem;
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .connect-current a {
    color: var(--text);
    text-decoration: none;
  }
</style>
