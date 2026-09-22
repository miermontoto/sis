<script lang="ts">
  // Gestor de colecciones ("álbumes lógicos") de un artista. Tres cosas en una sola
  // ventana porque son el mismo gesto: crear una colección, meter un álbum o un tema
  // en una, y sacarlo.
  //
  // Una colección NO es un merge: sus miembros conservan su página y sus cifras. Lo
  // que cambia es quién rankea — en top albums y en los charts aparece la colección y
  // no sus partes —, y por eso un miembro sólo puede estar en UNA: en dos, sus plays
  // se contarían dos veces. El 409 del servidor trae el nombre de la que lo tiene.
  //
  // Con una entidad delante se listan sólo las colecciones en las que PUEDE entrar:
  // las de cualquier artista acreditado en ella (un tema a dos nombres cabe en las
  // dos). Sin entidad, el modal gestiona las del artista de la página.
  import { errorMessage } from '$lib/utils/errors';
  import { collectionsStore } from '$lib/stores/collections.svelte';
  import { api, collectionKey, COLLECTION_NAME_MAX_CHARS, type AlbumCollectionSummary, type CollectionMemberType } from '$lib/api';
  import { formatNumber } from '$lib/utils/format';
  import IconTrash from '$lib/icons/IconTrash.svelte';

  let {
    show = $bindable(false),
    artistId,
    artistName,
    entity,
    memberOfId = null,
    onChanged = () => {},
  }: {
    show: boolean;
    artistId: string;
    artistName: string;
    /** entidad que se está colocando; sin ella el modal sólo crea y gestiona */
    entity?: { type: CollectionMemberType; id: string; name: string; imageUrl: string | null } | null;
    /** colección en la que ya está, si la hay. Viene en el detalle de álbum y de tema
     *  (`collection`), así que el modal no tiene que preguntar los miembros de todas */
    memberOfId?: number | null;
    onChanged?: () => void;
  } = $props();

  let collections = $state<AlbumCollectionSummary[]>([]);
  let loading = $state(false);
  let busy = $state(false);
  let error = $state('');
  // colección que ya contiene la entidad (la respuesta 409 o la que la tiene ahora)
  let memberOf = $state<number | null>(null);
  let newName = $state('');

  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  let loadedFor = '';

  async function load(id: string) {
    loading = true;
    error = '';
    try {
      if (entity) {
        // las elegibles, no las del artista de la página: la regla la decide el
        // servidor (crédito en el álbum o en el tema) y aquí sólo se pinta
        const res = await api.eligibleCollections(entity.type, entity.id);
        collections = res.collections;
        memberOf = res.memberOf;
      } else {
        collections = await api.artistCollections(id);
        memberOf = null;
      }
    } catch (e) {
      error = errorMessage(e, 'Error loading collections');
    } finally {
      loading = false;
    }
  }

  async function addTo(collectionId: number) {
    if (!entity) return;
    busy = true;
    error = '';
    try {
      await api.addCollectionMember(collectionId, entity.type, entity.id);
      collectionsStore.invalidate();
      memberOf = collectionId;
      await load(artistId);
      onChanged();
    } catch (e) {
      // el 409 nombra la colección que ya lo tiene: es la única forma de que el
      // usuario sepa de dónde sacarlo antes de volver a intentarlo
      error = errorMessage(e, 'Error adding to the collection');
    } finally {
      busy = false;
    }
  }

  async function removeFrom(collectionId: number) {
    if (!entity) return;
    busy = true;
    error = '';
    try {
      await api.removeCollectionMember(collectionId, entity.type, entity.id);
      collectionsStore.invalidate();
      memberOf = null;
      await load(artistId);
      onChanged();
    } catch (e) {
      error = errorMessage(e, 'Error removing from the collection');
    } finally {
      busy = false;
    }
  }

  async function create() {
    const name = newName.trim();
    if (!name) return;
    busy = true;
    error = '';
    try {
      const created = await api.createCollection({ name, artistId });
      // el menú contextual decide con el índice en memoria: sin esto la colección
      // recién creada no aparecería como destino hasta recargar la app
      collectionsStore.invalidate();
      newName = '';
      collections = [...collections, created];
      // crear una colección desde la página de un álbum significa meterlo en ella:
      // el paso intermedio no aporta nada
      if (entity) await addTo(created.id);
      else onChanged();
    } catch (e) {
      error = errorMessage(e, 'Error creating the collection');
    } finally {
      busy = false;
    }
  }

  async function destroy(c: AlbumCollectionSummary) {
    if (!confirm(`Delete "${c.name}"? Its members go back to ranking on their own.`)) return;
    busy = true;
    try {
      await api.deleteCollection(c.id);
      collectionsStore.invalidate();
      collections = collections.filter(x => x.id !== c.id);
      if (memberOf === c.id) memberOf = null;
      onChanged();
    } catch (e) {
      error = errorMessage(e, 'Error deleting the collection');
    } finally {
      busy = false;
    }
  }

  function close() { show = false; }

  $effect(() => {
    if (show && loadedFor !== artistId + (entity?.id ?? '')) {
      loadedFor = artistId + (entity?.id ?? '');
      load(artistId);
    }
    if (!show) loadedFor = '';
  });
</script>

{#if show}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="col-overlay" onmousedown={(e) => { if (e.target === e.currentTarget) close(); }}>
    <div class="col-modal">
      <div class="col-header">
        <h3>{entity ? 'Add to a collection' : 'Collections'}</h3>
        <button class="col-close" onclick={close}>&times;</button>
      </div>

      {#if entity}
        <div class="col-target">
          {#if entity.imageUrl}
            <img class="col-thumb" src={entity.imageUrl} alt="" />
          {:else}
            <div class="col-thumb col-thumb--empty"></div>
          {/if}
          <div>
            <div class="col-target-name">{entity.name}</div>
            <div class="col-target-label">Its plays will rank under the collection, not on their own</div>
          </div>
        </div>
      {:else}
        <p class="col-hint">Group {artistName}'s albums and loose tracks into one entry. Members keep their own pages; the collection is what ranks, and only {artistName}'s own work can go in.</p>
      {/if}

      {#if error}<div class="col-error">{error}</div>{/if}

      {#if loading}
        <div class="loading"><div class="spinner"></div></div>
      {:else}
        <div class="col-list">
          {#each collections as c (c.id)}
            <div class="col-item" class:col-item--member={memberOf === c.id}>
              {#if c.imageUrl}
                <img class="col-thumb-sm" src={c.imageUrl} alt="" />
              {:else}
                <div class="col-thumb-sm col-thumb--empty"></div>
              {/if}
              <a class="col-item-info" href="/album/{collectionKey(c.id)}">
                <div class="col-item-name">{c.name}</div>
                <div class="col-item-meta">
                  {plural(c.albumCount, 'album')} · {plural(c.trackCount, 'loose track')} · {formatNumber(c.playCount)} plays
                </div>
              </a>
              {#if entity}
                {#if memberOf === c.id}
                  <button class="col-btn col-btn--out" disabled={busy} onclick={() => removeFrom(c.id)}>Remove</button>
                {:else}
                  <button class="col-btn" disabled={busy || memberOf !== null} onclick={() => addTo(c.id)}>Add</button>
                {/if}
              {:else}
                <button class="col-icon-btn" title="Delete collection" disabled={busy} onclick={() => destroy(c)}>
                  <IconTrash size={14} />
                </button>
              {/if}
            </div>
          {:else}
            <!-- con entidad delante la lista son las ELEGIBLES, así que vacía no
                 significa "no tienes ninguna" sino "ninguna de las suyas la admite" -->
            <div class="col-empty">
              {entity ? `No collection of its artists yet — create one below.` : `No collections for ${artistName} yet.`}
            </div>
          {/each}
        </div>

        {#if memberOf !== null && entity}
          <p class="col-hint">Already in a collection. Remove it from that one first: a member belongs to exactly one, or its plays would count twice.</p>
        {/if}

        <form class="col-new" onsubmit={(e) => { e.preventDefault(); create(); }}>
          <input
            type="text"
            placeholder="New collection name…"
            maxlength={COLLECTION_NAME_MAX_CHARS}
            bind:value={newName}
            disabled={busy}
          />
          <button class="col-btn" type="submit" disabled={busy || !newName.trim()}>Create</button>
        </form>
      {/if}
    </div>
  </div>
{/if}

<style>
  .col-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
    padding: 1rem;
  }
  .col-modal {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    width: min(480px, 100%);
    max-height: 85vh;
    overflow-y: auto;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .col-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .col-header h3 {
    margin: 0;
    font-size: 1rem;
  }
  .col-close {
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 1.4rem;
    line-height: 1;
    cursor: pointer;
  }
  .col-target {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }
  .col-thumb {
    width: 48px;
    height: 48px;
    border-radius: var(--radius);
    object-fit: cover;
  }
  .col-thumb-sm {
    width: 36px;
    height: 36px;
    border-radius: var(--radius);
    object-fit: cover;
    flex-shrink: 0;
  }
  .col-thumb--empty {
    background: var(--bg-hover);
  }
  .col-target-name {
    font-weight: 600;
  }
  .col-target-label,
  .col-hint {
    font-size: 0.78rem;
    color: var(--text-muted);
    margin: 0;
  }
  .col-error {
    font-size: 0.8rem;
    color: var(--danger, #e5484d);
  }
  .col-list {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .col-item {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.35rem;
    border-radius: var(--radius);
  }
  .col-item:hover {
    background: var(--bg-hover);
  }
  .col-item--member {
    background: var(--bg-hover);
  }
  .col-item-info {
    flex: 1;
    min-width: 0;
    color: inherit;
    text-decoration: none;
  }
  .col-item-name {
    font-size: 0.88rem;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .col-item-meta {
    font-size: 0.72rem;
    color: var(--text-muted);
  }
  .col-empty {
    font-size: 0.82rem;
    color: var(--text-muted);
    padding: 0.4rem 0;
  }
  .col-btn {
    background: var(--accent);
    border: none;
    color: #fff;
    border-radius: var(--radius);
    padding: 0.3rem 0.7rem;
    font-size: 0.78rem;
    cursor: pointer;
  }
  .col-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .col-btn--out {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-muted);
  }
  .col-icon-btn {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    padding: 0.25rem;
    display: flex;
  }
  .col-icon-btn:hover {
    color: var(--danger, #e5484d);
  }
  .col-new {
    display: flex;
    gap: 0.4rem;
  }
  .col-new input {
    flex: 1;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text);
    padding: 0.35rem 0.5rem;
    font-size: 0.85rem;
  }
</style>
