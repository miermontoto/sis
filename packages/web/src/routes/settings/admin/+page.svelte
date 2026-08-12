<script lang="ts">
  import { errorMessage } from '$lib/utils/errors';
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api, type HealthData, type UserRecord, type MeResponse } from '$lib/api';
  import { formatNumber, formatDate } from '$lib/utils/format';

  let me = $state<MeResponse | null>(null);
  let health = $state<HealthData | null>(null);
  let users = $state<UserRecord[]>([]);
  let newSpotifyId = $state('');
  let newUserKind = $state<'spotify' | 'lastfm'>('spotify');
  let addingUser = $state(false);
  let userError = $state<string | null>(null);
  let loading = $state(true);

  async function loadUsers() {
    try { users = await api.listUsers(); } catch { users = []; }
  }

  async function handleAddUser() {
    if (!newSpotifyId.trim()) return;
    addingUser = true;
    userError = null;
    try {
      await api.addUser(newSpotifyId.trim(), newUserKind);
      newSpotifyId = '';
      await loadUsers();
    } catch (err) {
      userError = errorMessage(err, 'Failed to add user');
    } finally {
      addingUser = false;
    }
  }

  async function toggleAdmin(user: UserRecord) {
    try {
      await api.updateUser(user.id, { isAdmin: !user.isAdmin });
      await loadUsers();
    } catch (err) {
      userError = errorMessage(err);
    }
  }

  async function deactivateUser(user: UserRecord) {
    if (!confirm(`Deactivate ${user.displayName || user.spotifyId}? They won't be able to log in.`)) return;
    try {
      await api.deleteUser(user.id);
      await loadUsers();
    } catch (err) {
      userError = errorMessage(err);
    }
  }

  async function deleteUser(user: UserRecord) {
    if (!confirm(`Permanently delete ${user.displayName || user.spotifyId} and all their data? This cannot be undone.`)) return;
    try {
      await api.deleteUser(user.id);
      await loadUsers();
    } catch (err) {
      userError = errorMessage(err);
    }
  }

  async function reactivateUser(user: UserRecord) {
    try {
      await api.updateUser(user.id, { isActive: true });
      await loadUsers();
    } catch (err) {
      userError = errorMessage(err);
    }
  }

  onMount(async () => {
    try {
      [me, health] = await Promise.all([api.me(), api.health()]);
      if (!me?.isAdmin) {
        goto('/settings');
        return;
      }
      await loadUsers();
    } catch {
      goto('/settings');
      return;
    } finally {
      loading = false;
    }
  });
</script>

<div class="page-header">
  <h1>Admin</h1>
  <a href="/settings" class="back-link">← Settings</a>
</div>

{#if loading}
  <div class="loading">
    <div class="spinner"></div>
  </div>
{:else}
  <div class="card section-card">
    <h3 class="section-card-title">Polling status</h3>
    <div class="section-list">
      <div class="pref-row">
        <div class="pref-info">
          <div class="pref-label">Spotify</div>
          <div class="pref-desc">
            {#if health?.authenticated}
              Polling actively tracks listening — currently playing every 30s, recent plays every 5 minutes
            {:else}
              Not connected to Spotify
            {/if}
          </div>
        </div>
        <div class="pref-control">
          <span class="value-badge" style="color: {health?.authenticated ? 'var(--accent)' : 'var(--text-muted)'};">
            {health?.authenticated ? 'Connected' : 'Disconnected'}
          </span>
        </div>
      </div>
      <div class="pref-row row-border">
        <div class="pref-info">
          <div class="pref-label">Database</div>
          <div class="pref-desc">Storage engine and status</div>
        </div>
        <div class="pref-control">
          <span class="value-badge">{health?.database ?? 'unknown'}</span>
        </div>
      </div>
      <div class="pref-row row-border">
        <div class="pref-info">
          <div class="pref-label">Last check</div>
          <div class="pref-desc">Most recent polling timestamp</div>
        </div>
        <div class="pref-control">
          <span class="value-badge">{health?.timestamp ? formatDate(health.timestamp) : 'N/A'}</span>
        </div>
      </div>
      <div class="pref-row row-border">
        <div class="pref-info">
          <div class="pref-label">Total plays</div>
          <div class="pref-desc">Listening entries stored in the database</div>
        </div>
        <div class="pref-control">
          <span class="value-badge">{formatNumber(health?.totalPlays ?? 0)}</span>
        </div>
      </div>
    </div>
  </div>

  <div class="card section-card">
    <h3 class="section-card-title">User management</h3>
    <div class="section-list">
      <div class="pref-row">
        <div class="pref-info">
          <div class="pref-label">Add user to whitelist</div>
          <div class="pref-desc">Enter a Spotify user ID or a Last.fm username. They can log in once added.</div>
        </div>
        <div class="pref-control input-control">
          <select class="kind-select" bind:value={newUserKind}>
            <option value="spotify">Spotify</option>
            <option value="lastfm">Last.fm</option>
          </select>
          <input
            class="text-input"
            type="text"
            placeholder={newUserKind === 'lastfm' ? 'Last.fm username...' : 'Spotify user ID...'}
            bind:value={newSpotifyId}
            onkeydown={(e) => { if (e.key === 'Enter') handleAddUser(); }}
          />
          <button class="action-btn" onclick={handleAddUser} disabled={addingUser || !newSpotifyId.trim()}>
            {addingUser ? 'Adding...' : 'Add'}
          </button>
        </div>
      </div>
      {#if userError}
        <div class="user-error">{userError}</div>
      {/if}
      {#if users.length > 0}
        <div class="user-list">
          {#each users as user}
            <div class="pref-row row-border">
              <div class="pref-info">
                <div class="pref-label">
                  {user.displayName || user.spotifyId}
                  {#if user.isAdmin}<span class="admin-badge">admin</span>{/if}
                  {#if !user.isActive}<span class="inactive-badge">inactive</span>{/if}
                </div>
                <div class="pref-desc">{user.spotifyId}</div>
              </div>
              <div class="pref-control input-control">
                {#if user.isActive}
                  <button class="action-btn action-btn--secondary" onclick={() => toggleAdmin(user)}>
                    {user.isAdmin ? 'Remove admin' : 'Make admin'}
                  </button>
                  <button class="action-btn action-btn--secondary" style="color: var(--danger); border-color: rgba(231, 76, 60, 0.3);" onclick={() => deactivateUser(user)}>
                    Deactivate
                  </button>
                {:else}
                  <button class="action-btn action-btn--secondary" onclick={() => reactivateUser(user)}>
                    Reactivate
                  </button>
                  <button class="action-btn action-btn--secondary" style="color: var(--danger); border-color: rgba(231, 76, 60, 0.3);" onclick={() => deleteUser(user)}>
                    Delete
                  </button>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .page-header {
    display: flex;
    align-items: baseline;
    gap: 1rem;
    margin-bottom: 1.5rem;
  }
  .page-header h1 {
    margin: 0;
  }
  .back-link {
    font-size: 0.85rem;
    color: var(--text-muted);
    text-decoration: none;
  }
  .back-link:hover {
    color: var(--accent);
  }

  .section-card {
    margin-bottom: 1.5rem;
  }
  .section-card-title {
    margin-bottom: 0.75rem;
  }
  .section-list {
    display: flex;
    flex-direction: column;
  }

  .pref-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1.5rem;
    padding: 0.75rem 0;
  }
  .row-border {
    border-top: 1px solid var(--border);
  }
  .pref-info {
    flex: 1;
    min-width: 0;
  }
  .pref-label {
    font-size: 0.85rem;
    font-weight: 500;
    letter-spacing: 0.02em;
  }
  .pref-desc {
    font-size: 0.8rem;
    color: var(--text-muted);
    margin-top: 0.15rem;
  }
  .pref-control {
    flex-shrink: 0;
  }

  .value-badge {
    display: inline-block;
    padding: 0.3rem 0.7rem;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    font-size: 0.85rem;
    color: var(--text);
    font-family: 'SF Mono', 'Fira Code', monospace;
  }

  .action-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.4rem 0.85rem;
    border-radius: var(--radius);
    border: none;
    background: var(--accent);
    color: #000;
    cursor: pointer;
    font-size: 0.85rem;
    font-weight: 500;
    text-decoration: none;
    transition: background 0.05s;
    white-space: nowrap;
  }
  .action-btn:hover {
    background: var(--accent-hover);
    color: #000;
  }
  .action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .action-btn--secondary {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-muted);
  }
  .action-btn--secondary:hover {
    border-color: var(--text-muted);
    color: var(--text);
    background: transparent;
  }

  .input-control {
    display: flex;
    gap: 0.5rem;
  }

  .text-input {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text);
    font-size: 0.85rem;
    padding: 0.35rem 0.7rem;
    outline: none;
    width: 180px;
    transition: border-color 0.05s;
  }
  .text-input:focus {
    border-color: var(--accent);
  }
  .text-input::placeholder {
    color: var(--text-muted);
  }

  .kind-select {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text);
    font-size: 0.85rem;
    padding: 0.35rem 0.5rem;
    outline: none;
    cursor: pointer;
  }
  .kind-select:focus {
    border-color: var(--accent);
  }

  .user-error {
    color: var(--danger);
    font-size: 0.85rem;
    border-top: 1px solid var(--border);
    padding-top: 0.75rem;
    margin-top: 0.25rem;
  }

  .admin-badge, .inactive-badge {
    display: inline-block;
    padding: 0.1rem 0.45rem;
    border-radius: var(--radius);
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    margin-left: 0.4rem;
    vertical-align: middle;
  }
  .admin-badge {
    background: rgba(29, 185, 84, 0.15);
    color: var(--accent);
  }
  .inactive-badge {
    background: rgba(255, 68, 68, 0.12);
    color: #ff4444;
  }
  .user-list {
    display: flex;
    flex-direction: column;
  }

  @media (max-width: 768px) {
    .pref-row {
      flex-direction: column;
      align-items: flex-start;
      gap: 0.75rem;
    }
  }
</style>
