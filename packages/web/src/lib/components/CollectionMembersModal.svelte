<script lang="ts">
  // "Relations" de una colección: lo que tiene dentro (álbumes enteros y temas sueltos) y
  // el picker para meter más, que sólo ofrece lo acreditado a su artista. Es lo mismo que
  // la sección Members de su página, en ventana, para poder abrirlo desde una fila.
  import { api, type CollectionMember } from '$lib/api';
  import { collectionMembersModal } from '$lib/stores/collection-members-modal.svelte';
  import { collectionsStore } from '$lib/stores/collections.svelte';
  import { errorMessage } from '$lib/utils/errors';
  import { formatNumber } from '$lib/utils/format';
  import CollectionCandidatePicker from './CollectionCandidatePicker.svelte';

  const target = $derived(collectionMembersModal.target);

  let members = $state<CollectionMember[]>([]);
  let loading = $state(false);
  let busy = $state(false);
  let error = $state('');
  let loadedFor = -1;

  async function load(id: number) {
    loading = true;
    error = '';
    try {
      members = await api.collectionMembers(id);
    } catch (e) {
      error = errorMessage(e, 'Error loading its singles and songs');
    } finally {
      loading = false;
    }
  }

  async function remove(m: CollectionMember) {
    if (!target) return;
    busy = true;
    error = '';
    try {
      members = await api.removeCollectionMember(target.id, m.entityType, m.entityId);
      collectionsStore.invalidate();
    } catch (e) {
      error = errorMessage(e, 'Error removing it');
    } finally {
      busy = false;
    }
  }

  function close() {
    collectionMembersModal.close();
  }

  function onKey(e: KeyboardEvent) {
    if (target && e.key === 'Escape') close();
  }

  $effect(() => {
    const id = target?.id ?? -1;
    if (id !== -1 && id !== loadedFor) {
      loadedFor = id;
      load(id);
    }
    if (id === -1) loadedFor = -1;
  });
</script>

<svelte:window onkeydown={onKey} />

{#if target}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="cm-overlay" onmousedown={(e) => { if (e.target === e.currentTarget) close(); }}>
    <div class="cm-modal" role="dialog" aria-modal="true" aria-label="Relations of {target.name}">
      <div class="cm-header">
        <h3>Relations · {target.name}</h3>
        <button class="cm-close" onclick={close} aria-label="Close">&times;</button>
      </div>
      <p class="cm-hint">What's inside ranks as this one entry. Add the artist's singles, EPs or loose songs, or take them out.</p>

      {#if error}<div class="cm-error">{error}</div>{/if}

      {#if loading}
        <div class="loading"><div class="spinner"></div></div>
      {:else}
        <div class="cm-list">
          {#each members as m (m.entityType + m.entityId)}
            <div class="cm-item">
              {#if m.imageUrl}
                <img class="cm-thumb" src={m.imageUrl} alt="" />
              {:else}
                <div class="cm-thumb cm-thumb--empty"></div>
              {/if}
              <div class="cm-info">
                <div class="cm-name">{m.name}</div>
                <div class="cm-meta">{m.entityType === 'album' ? 'Release' : 'Song'} · {formatNumber(m.playCount)} plays</div>
              </div>
              <button class="cm-btn" disabled={busy} onclick={() => remove(m)}>Remove</button>
            </div>
          {:else}
            <div class="cm-empty">Nothing inside yet.</div>
          {/each}
        </div>

        <CollectionCandidatePicker collectionId={target.id} onadded={() => target && load(target.id)} />
      {/if}
    </div>
  </div>
{/if}

<style>
  .cm-overlay {
    position: fixed;
    inset: 0;
    background: var(--scrim);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
    padding: 1rem;
  }
  .cm-modal {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    width: min(520px, 100%);
    max-height: 85vh;
    overflow-y: auto;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .cm-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .cm-header h3 {
    margin: 0;
    font-size: var(--fs-base);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cm-close {
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: var(--fs-xl);
    line-height: 1;
    cursor: pointer;
  }
  .cm-hint,
  .cm-empty {
    font-size: var(--fs-sm);
    color: var(--text-muted);
    margin: 0;
  }
  .cm-error {
    font-size: var(--fs-sm);
    color: var(--danger);
  }
  .cm-list {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .cm-item {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.35rem;
    border-radius: var(--radius);
  }
  .cm-item:hover {
    background: var(--bg-hover);
  }
  .cm-thumb {
    width: 36px;
    height: 36px;
    border-radius: var(--radius);
    object-fit: cover;
    flex-shrink: 0;
  }
  .cm-thumb--empty {
    background: var(--bg-hover);
  }
  .cm-info {
    flex: 1;
    min-width: 0;
  }
  .cm-name {
    font-size: var(--fs-md);
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cm-meta {
    font-size: var(--fs-xs);
    color: var(--text-muted);
  }
  .cm-btn {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-muted);
    border-radius: var(--radius);
    padding: 0.3rem 0.7rem;
    font-size: var(--fs-sm);
    cursor: pointer;
  }
  .cm-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
