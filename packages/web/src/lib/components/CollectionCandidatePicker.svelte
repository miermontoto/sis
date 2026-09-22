<script lang="ts">
  // Picker de miembros de una colección. A diferencia de LibraryPicker (búsqueda
  // libre por toda la biblioteca) éste sólo ofrece lo que está **acreditado al
  // artista de la colección**, que es lo único que el servidor deja entrar: una
  // colección agrupa la obra de un artista, no una playlist.
  //
  // Lo que ya está en otra colección se lista igualmente, marcado con su nombre: un
  // miembro pertenece a UNA sola, y esconderlo dejaría al usuario buscando un disco
  // que no aparece sin saber por qué.
  import { api, type CollectionCandidate, type CollectionMemberType } from '$lib/api';
  import { errorMessage } from '$lib/utils/errors';
  import { formatNumber } from '$lib/utils/format';
  import { toastStore } from '$lib/stores/toast.svelte';
  import { collectionsStore } from '$lib/stores/collections.svelte';

  const SEARCH_DEBOUNCE_MS = 250;

  let { collectionId, onadded }: { collectionId: number; onadded: () => void } = $props();

  let query = $state('');
  let albums = $state<CollectionCandidate[]>([]);
  let tracks = $state<CollectionCandidate[]>([]);
  let loading = $state(false);
  let busyId = $state('');
  let timer: ReturnType<typeof setTimeout> | null = null;
  let seq = 0;

  async function load(q: string) {
    const mine = ++seq;
    loading = true;
    try {
      const res = await api.collectionCandidates(collectionId, q);
      // token de secuencia: dos búsquedas en vuelo pueden volver desordenadas y la
      // lenta pisaría a la que el usuario está mirando
      if (mine !== seq) return;
      albums = res.albums;
      tracks = res.tracks;
    } catch (e) {
      if (mine === seq) toastStore.show(errorMessage(e, 'Error loading candidates'));
    } finally {
      if (mine === seq) loading = false;
    }
  }

  function search() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => load(query), SEARCH_DEBOUNCE_MS);
  }

  async function add(entityType: CollectionMemberType, candidate: CollectionCandidate) {
    busyId = candidate.id;
    try {
      await api.addCollectionMember(collectionId, entityType, candidate.id);
      collectionsStore.invalidate();
      onadded();
      await load(query);
    } catch (e) {
      toastStore.show(errorMessage(e, 'Error adding the member'));
    } finally {
      busyId = '';
    }
  }

  load('');
  $effect(() => () => { if (timer) clearTimeout(timer); });
</script>

<div class="picker">
  <input
    class="search-input"
    type="search"
    placeholder="Filter this artist's albums and tracks…"
    bind:value={query}
    oninput={search}
  />

  {#if loading}
    <div class="hint">Loading…</div>
  {:else}
    {#each [{ label: 'Albums', type: 'album' as const, items: albums }, { label: 'Tracks', type: 'track' as const, items: tracks }] as group (group.type)}
      {#if group.items.length > 0}
        <div class="group-label">{group.label}</div>
        <div class="results">
          {#each group.items as item (item.id)}
            <div class="result" class:result--taken={!!item.takenBy}>
              {#if item.imageUrl}
                <img src={item.imageUrl} alt="" />
              {:else}
                <div class="result-ph">{item.name.charAt(0)}</div>
              {/if}
              <span class="result-name">{item.name}</span>
              <span class="result-meta">
                {#if item.takenBy}
                  in {item.takenBy.name}
                {:else}
                  {formatNumber(item.playCount)} plays
                {/if}
              </span>
              <button
                class="add-btn"
                disabled={!!item.takenBy || busyId === item.id}
                onclick={() => add(group.type, item)}
              >+</button>
            </div>
          {/each}
        </div>
      {/if}
    {/each}
    {#if albums.length === 0 && tracks.length === 0}
      <div class="hint">Nothing of this artist matches.</div>
    {/if}
  {/if}
</div>

<style>
  .picker {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .search-input {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text);
    padding: 0.4rem 0.6rem;
    font-size: 0.85rem;
  }
  .group-label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted);
    margin-top: 0.3rem;
  }
  .results {
    display: flex;
    flex-direction: column;
    max-height: 320px;
    overflow-y: auto;
  }
  .result {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.25rem;
    border-radius: var(--radius);
  }
  .result:hover {
    background: var(--bg-hover);
  }
  .result--taken {
    opacity: 0.5;
  }
  .result img,
  .result-ph {
    width: 30px;
    height: 30px;
    border-radius: 4px;
    object-fit: cover;
    flex-shrink: 0;
  }
  .result-ph {
    background: var(--bg-hover);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.75rem;
    color: var(--text-muted);
  }
  .result-name {
    flex: 1;
    min-width: 0;
    font-size: 0.85rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .result-meta {
    font-size: 0.72rem;
    color: var(--text-muted);
    white-space: nowrap;
  }
  .add-btn {
    background: none;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text-muted);
    width: 22px;
    height: 22px;
    line-height: 1;
    cursor: pointer;
    flex-shrink: 0;
  }
  .add-btn:hover:not(:disabled) {
    color: var(--accent);
    border-color: var(--accent);
  }
  .add-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .hint {
    font-size: 0.8rem;
    color: var(--text-muted);
    padding: 0.3rem 0;
  }
</style>
