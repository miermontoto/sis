<div class="login-page">
  <div class="login-card">
    <h1>SIS</h1>
    <p>Spotify Intelligence Suite</p>
    <a href="/auth/login" class="login-btn">Sign in with Spotify</a>
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

  .login-card {
    text-align: center;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 3rem 2.5rem;
    max-width: 360px;
    width: 100%;
  }

  h1 {
    font-size: 2.5rem;
    font-weight: 700;
    color: var(--accent);
    margin-bottom: 0.25rem;
  }

  p {
    color: var(--text-muted);
    margin-bottom: 2rem;
  }

  .login-btn {
    display: inline-block;
    background: var(--accent);
    color: #000;
    font-weight: 600;
    padding: 0.75rem 1.5rem;
    border-radius: var(--radius);
    text-decoration: none;
    transition: background 0.15s;
  }

  .login-btn:hover {
    background: var(--accent-hover);
  }
</style>
