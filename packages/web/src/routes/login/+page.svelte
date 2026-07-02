<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { Capacitor } from '@capacitor/core';
  import IconSpotify from '$lib/icons/IconSpotify.svelte';
  import IconLastfm from '$lib/icons/IconLastfm.svelte';
  import IconLock from '$lib/icons/IconLock.svelte';

  let returnTo = $derived(page.url.searchParams.get('returnTo') || '/');
  let loginHref = $derived('/auth/login?returnTo=' + encodeURIComponent(returnTo));
  let lastfmHref = $derived('/auth/lastfm/login?returnTo=' + encodeURIComponent(returnTo));

  // el botón de last.fm solo aparece si el server tiene credenciales
  let lastfmEnabled = $state(false);
  onMount(async () => {
    try {
      const base = import.meta.env.VITE_API_BASE ?? '';
      const res = await fetch(`${base}/auth/lastfm/enabled`);
      lastfmEnabled = (await res.json()).enabled === true;
    } catch {}
  });

  // oauth móvil (apk): el login va al browser del sistema (custom tab) con
  // mobile=1; el callback vuelve a la app por deep link (listener en +layout).
  // preventDefault debe ser síncrono — el check nativo no puede esperar imports.
  function nativeLogin(e: MouseEvent, path = '/auth/login') {
    if (!Capacitor.isNativePlatform()) return; // web: el anchor navega normal
    e.preventDefault();
    void (async () => {
      const { openExternalLogin } = await import('@platform/mobile/deep-link');
      const base = import.meta.env.VITE_API_BASE ?? '';
      await openExternalLogin(`${base}${path}?mobile=1&returnTo=${encodeURIComponent(returnTo)}`);
    })();
  }
  let errorCode = $derived(page.url.searchParams.get('error'));
  let retryAfterSec = $derived(parseInt(page.url.searchParams.get('retryAfter') || '0', 10));

  function formatRetry(s: number): string {
    if (s <= 0) return 'shortly';
    const h = Math.floor(s / 3600);
    const m = Math.round((s % 3600) / 60);
    if (h > 0) return `~${h}h ${m}m`;
    if (m > 0) return `~${m}m`;
    return `${s}s`;
  }

  let errorMessage = $derived.by(() => {
    if (!errorCode) return null;
    if (errorCode === 'rate_limited') {
      return `Spotify is rate-limiting the app (retry in ${formatRetry(retryAfterSec)}). Recent over-polling triggered this; try again later.`;
    }
    return `Login failed: ${errorCode}`;
  });
</script>

<div class="login-page">
  <div class="login-container">
    <div class="login-card">
      <div class="logo-area">
        <div class="logo-mark">SIS</div>
      </div>

      {#if errorMessage}
        <div class="login-error">{errorMessage}</div>
      {/if}

      <a href={loginHref} onclick={nativeLogin} class="login-btn">
        <IconSpotify />
        Sign in with Spotify
      </a>

      {#if lastfmEnabled}
        <a href={lastfmHref} onclick={(e) => nativeLogin(e, '/auth/lastfm/login')} class="login-btn login-btn--lastfm">
          <IconLastfm />
          Sign in with Last.fm
        </a>
      {/if}

      <div class="access-notice">
        <IconLock />
        Invite-only access
      </div>
    </div>

    <footer class="login-footer">
      Built by <a href="https://mier.info" target="_blank" rel="noopener">mier</a>
    </footer>
  </div>
</div>

<style>
  .login-page {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    background: var(--bg);
  }

  .login-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1.5rem;
    width: 100%;
    max-width: 400px;
    padding: 1rem;
  }

  .login-card {
    text-align: center;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 2.5rem 2rem 2rem;
    width: 100%;
  }

  .logo-area {
    margin-bottom: 1.5rem;
  }

  .logo-mark {
    font-size: 2.8rem;
    font-weight: 800;
    color: var(--accent);
    letter-spacing: -0.02em;
    line-height: 1;
  }

  .login-error {
    background: rgba(255, 170, 0, 0.08);
    border: 1px solid rgba(255, 170, 0, 0.3);
    color: #ffaa00;
    padding: 0.7rem 0.9rem;
    border-radius: var(--radius);
    font-size: 0.85rem;
    line-height: 1.4;
    margin-bottom: 1rem;
    text-align: left;
  }

  .login-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.6rem;
    width: 100%;
    background: var(--accent);
    color: #000;
    font-weight: 600;
    font-size: 0.95rem;
    padding: 0.8rem 1.5rem;
    border-radius: var(--radius);
    text-decoration: none;
    transition: background 0.05s, transform 0.05s;
  }

  .login-btn:hover {
    background: var(--accent-hover);
    transform: translateY(-1px);
  }

  .login-btn:active {
    transform: translateY(0);
  }

  .login-btn--lastfm {
    margin-top: 0.6rem;
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text);
  }

  .login-btn--lastfm:hover {
    background: transparent;
    border-color: #d51007;
    color: #d51007;
  }

  .access-notice {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    margin-top: 1.25rem;
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  .login-footer {
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  .login-footer a {
    color: var(--text);
    text-decoration: none;
    font-weight: 500;
    transition: color 0.05s;
  }

  .login-footer a:hover {
    color: var(--accent);
  }
</style>
