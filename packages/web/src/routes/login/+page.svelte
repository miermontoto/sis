<script lang="ts">
  import { page } from '$app/state';

  let returnTo = $derived(page.url.searchParams.get('returnTo') || '/');
  let loginHref = $derived('/auth/login?returnTo=' + encodeURIComponent(returnTo));
</script>

<div class="login-page">
  <div class="login-container">
    <div class="login-card">
      <div class="logo-area">
        <div class="logo-mark">SIS</div>
      </div>

      <a href={loginHref} class="login-btn">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
          <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
        </svg>
        Sign in with Spotify
      </a>

      <div class="access-notice">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
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
    border-radius: 12px;
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
    transition: background 0.15s, transform 0.1s;
  }

  .login-btn:hover {
    background: var(--accent-hover);
    transform: translateY(-1px);
  }

  .login-btn:active {
    transform: translateY(0);
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
    transition: color 0.15s;
  }

  .login-footer a:hover {
    color: var(--accent);
  }
</style>
