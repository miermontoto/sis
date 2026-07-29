<script lang="ts">
  import { api } from '$lib/api';

  let {
    entityType,
    entityId,
    mergedInto,
    mergedFrom,
    onUnmerge,
  }: {
    entityType: 'artist' | 'album' | 'track';
    entityId: string;
    mergedInto: { id: string; name: string; ruleId: number } | null;
    mergedFrom: { id: string; ruleId: number; name: string; imageUrl: string | null }[];
    onUnmerge: () => void;
  } = $props();

  let round = $derived(entityType === 'artist');
  let swapping = $state(false);
  let error = $state('');

  // promueve esta entidad a canónica: el grupo entero se repunta hacia ella
  async function makeCanonical() {
    swapping = true;
    error = '';
    try {
      await api.makeCanonical(entityType, entityId);
      onUnmerge();
    } catch (e: any) {
      error = e.message || 'Error swapping merge direction';
    } finally {
      swapping = false;
    }
  }
</script>

{#if mergedInto}
  <div class="merge-banner merge-banner--source">
    <span>Merged into <a href="/{entityType}/{mergedInto.id}">{mergedInto.name}</a></span>
    <span class="merge-banner-actions">
      {#if error}<span class="merge-banner-error">{error}</span>{/if}
      <button class="merge-banner-btn" disabled={swapping} onclick={makeCanonical} title="Make this the canonical {entityType} — the rest of the group will point here">
        {swapping ? 'Swapping...' : 'Make canonical'}
      </button>
      <button class="merge-banner-unmerge" onclick={async () => { await api.deleteMerge(mergedInto!.ruleId); onUnmerge(); }}>Unmerge</button>
    </span>
  </div>
{/if}

{#if mergedFrom.length > 0}
  <div class="merge-banner merge-banner--target">
    <div class="merge-banner-label">Includes plays from:</div>
    <div class="merge-banner-items">
      {#each mergedFrom as merge}
        <a href="/{entityType}/{merge.id}" class="merge-banner-item">
          {#if merge.imageUrl}
            <img class="merge-banner-thumb" class:merge-banner-thumb--round={round} src={merge.imageUrl} alt="" />
          {:else}
            <div class="merge-banner-thumb" class:merge-banner-thumb--round={round} class:merge-banner-thumb--empty={true}></div>
          {/if}
          <span class="merge-banner-name">{merge.name}</span>
        </a>
      {/each}
    </div>
  </div>
{/if}

<style>
  .merge-banner {
    padding: 0.6rem 1rem;
    border-radius: var(--radius);
    font-size: 0.85rem;
    margin-bottom: 1rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .merge-banner a { color: var(--accent); text-decoration: none; }
  .merge-banner a:hover { text-decoration: underline; }

  .merge-banner--source {
    background: rgba(255, 170, 0, 0.1);
    border: 1px solid rgba(255, 170, 0, 0.3);
    color: #ffaa00;
  }
  .merge-banner--source a { color: #ffaa00; text-decoration: underline; }

  .merge-banner--target {
    background: rgba(29, 185, 84, 0.08);
    border: 1px solid rgba(29, 185, 84, 0.25);
    flex-direction: column;
    align-items: stretch;
    gap: 0.5rem;
  }

  .merge-banner-label {
    font-size: 0.75rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .merge-banner-items {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 0.75rem;
  }

  .merge-banner-item {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--text);
    text-decoration: none;
  }
  .merge-banner-item:hover { color: var(--accent); }

  .merge-banner-thumb {
    width: 22px;
    height: 22px;
    border-radius: var(--radius);
    object-fit: cover;
    flex-shrink: 0;
  }
  .merge-banner-thumb--round { border-radius: 50%; }
  .merge-banner-thumb--empty { background: var(--border); }

  .merge-banner-name { font-size: 0.85rem; }

  .merge-banner-unmerge {
    background: transparent;
    border: 1px solid currentColor;
    color: inherit;
    padding: 0.2rem 0.6rem;
    border-radius: var(--radius);
    font-size: 0.75rem;
    cursor: pointer;
    opacity: 0.8;
  }
  .merge-banner-unmerge:hover { opacity: 1; }

  .merge-banner-actions {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-shrink: 0;
  }

  .merge-banner-btn {
    background: transparent;
    border: 1px solid currentColor;
    color: inherit;
    padding: 0.2rem 0.6rem;
    border-radius: var(--radius);
    font-size: 0.75rem;
    font-family: inherit;
    cursor: pointer;
    opacity: 0.8;
    white-space: nowrap;
  }
  .merge-banner-btn:hover:not(:disabled) { opacity: 1; }
  .merge-banner-btn:disabled { opacity: 0.4; cursor: wait; }

  .merge-banner-error {
    color: #ff4444;
    font-size: 0.75rem;
  }
</style>
