<script lang="ts">
  import { untrack } from 'svelte';
  import { errorMessage } from '$lib/utils/errors';
  // Gestor de relaciones "soft" de un artista: declara el vínculo (Julian Casablancas
  // ←→ The Strokes) sin tocar el tracking. Para absorber un artista dentro de otro
  // ("Ye" en "Kanye West") el sitio es MergeEntityModal: eso es un merge.
  import { api, type MergeSuggestion, type RelatedArtist } from '$lib/api';
  import ModalTabs from '$lib/components/ModalTabs.svelte';
  import { RELATION_TABS } from '$lib/utils/relation-tabs';
  import { CANDIDATE_LIMIT, indexCandidates, searchCandidates } from '$lib/utils/candidate-search';

  let {
    show = $bindable(false),
    target,
    existing = [],
    onChanged = () => {},
    onMerge,
  }: {
    show: boolean;
    target: { id: string; name: string; imageUrl: string | null };
    existing?: RelatedArtist[];
    onChanged?: () => void;
    /** salta al modal de merges con el mismo target; ver onRelate en MergeEntityModal */
    onMerge?: () => void;
  } = $props();

  // raw: el pool son miles de filas que sólo se reemplazan enteras, y con $state a secas
  // cada lectura de name/plays dentro del índice, el filtro y el sort pasaba por un proxy
  let suggestions = $state.raw<MergeSuggestion[]>([]);
  let loading = $state(false);
  let busyId = $state('');
  let error = $state('');
  let search = $state('');

  let existingIds = $derived(new Set(existing.map(r => r.id)));
  let targetId = $derived(target.id);

  // mismo pool que las sugerencias de merge: artistas con escuchas que no son source de
  // ningún merge (un alias absorbido no es un destino válido — su página es un stub).
  // Normalizado una vez por carga; sin texto queda en el orden del servidor (plays)
  let index = $derived(indexCandidates(suggestions));
  let filtered = $derived(searchCandidates(
    index.filter(c => c.item.id !== targetId && !existingIds.has(c.item.id)), search,
  ).slice(0, CANDIDATE_LIMIT));

  function close() {
    show = false;
    search = '';
    error = '';
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && show) close();
  }

  async function loadSuggestions() {
    loading = true;
    error = '';
    try {
      suggestions = await api.mergeSuggestions('artist');
    } catch (e) {
      error = errorMessage(e, 'Error loading artists');
      suggestions = [];
    } finally {
      loading = false;
    }
  }

  async function relate(artistId: string) {
    busyId = artistId;
    error = '';
    try {
      await api.createArtistRelation(target.id, artistId);
      search = '';
      onChanged();
    } catch (e) {
      error = errorMessage(e, 'Error creating relation');
    } finally {
      busyId = '';
    }
  }

  // ruleIds suele tener un solo id; hay varios cuando el otro lado quedó mergeado
  // después de crear las relaciones, y entonces hay que borrar todas las filas
  async function unrelate(relation: RelatedArtist) {
    busyId = relation.id;
    error = '';
    try {
      await Promise.all(relation.ruleIds.map(id => api.deleteArtistRelation(id)));
      onChanged();
    } catch (e) {
      error = errorMessage(e, 'Error removing relation');
    } finally {
      busyId = '';
    }
  }

  // el pool es el mismo para todos los artistas (una entrada de cache), así que se pide
  // en cada apertura: sale de cache, y tras un merge recoge el pool ya sin su source
  $effect(() => {
    if (show) untrack(() => loadSuggestions());
  });
</script>

<svelte:window onkeydown={onKey} />

{#if show}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="relate-overlay" onmousedown={(e) => { if (e.target === e.currentTarget) close(); }}>
    <div class="relate-modal">
      <div class="relate-header">
        <h3>{onMerge ? 'Relations' : 'Related artists'}</h3>
        <button class="relate-close" onclick={close}>&times;</button>
      </div>
      {#if onMerge}
        <ModalTabs tabs={RELATION_TABS} active="relate" onselect={() => onMerge()} />
      {/if}

      <div class="relate-target">
        {#if target.imageUrl}
          <img class="relate-thumb" src={target.imageUrl} alt="" />
        {:else}
          <div class="relate-thumb relate-thumb--empty"></div>
        {/if}
        <div class="relate-target-info">
          <div class="relate-target-name">{target.name}</div>
          <div class="relate-target-label">Plays stay separate</div>
        </div>
      </div>

      {#if error}
        <div class="relate-error">{error}</div>
      {/if}

      {#if existing.length > 0}
        <div class="relate-section-title">Related</div>
        <div class="relate-list relate-list--existing">
          {#each existing as relation (relation.id)}
            <div class="relate-item relate-item--existing">
              {#if relation.imageUrl}
                <img class="relate-thumb-sm" src={relation.imageUrl} alt="" />
              {:else}
                <div class="relate-thumb-sm relate-thumb--empty"></div>
              {/if}
              <div class="relate-item-info">
                <div class="relate-item-name">{relation.name}</div>
              </div>
              <button
                class="relate-remove"
                title="Remove relation"
                disabled={busyId === relation.id}
                onclick={() => unrelate(relation)}
              >&times;</button>
            </div>
          {/each}
        </div>
      {/if}

      <div class="relate-section-title">Add a relation</div>
      <input class="relate-search" type="text" placeholder="Search all artists..." bind:value={search} />

      {#if loading && suggestions.length === 0}
        <div class="relate-empty">Loading...</div>
      {:else if filtered.length === 0}
        <div class="relate-empty">
          {search ? 'No artists match your search' : 'No other artists with plays available'}
        </div>
      {:else}
        <div class="relate-list">
          {#each filtered as artist (artist.id)}
            <button class="relate-item" disabled={busyId === artist.id} onclick={() => relate(artist.id)}>
              {#if artist.image_url}
                <img class="relate-thumb-sm" src={artist.image_url} alt="" loading="lazy" />
              {:else}
                <div class="relate-thumb-sm relate-thumb--empty"></div>
              {/if}
              <div class="relate-item-info">
                <div class="relate-item-name">{artist.name}</div>
                <div class="relate-item-plays">{artist.plays} plays</div>
              </div>
            </button>
          {/each}
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .relate-overlay {
    position: fixed;
    inset: 0;
    background: var(--scrim);
    z-index: 200;
    display: flex;
    justify-content: center;
    padding-top: 12vh;
    backdrop-filter: blur(4px);
  }

  .relate-modal {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    width: 440px;
    max-width: calc(100% - 2rem);
    max-height: 75vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    align-self: flex-start;
  }

  .relate-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.25rem;
    border-bottom: 1px solid var(--border);
  }
  .relate-header h3 {
    margin: 0;
    font-size: var(--fs-base);
    font-weight: 600;
  }

  .relate-close {
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: var(--fs-xl);
    cursor: pointer;
    padding: 0;
    line-height: 1;
  }

  .relate-target {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 1rem 1.25rem;
    border-bottom: 1px solid var(--border);
    background: var(--fg-a03);
  }

  .relate-thumb {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
  }

  .relate-thumb-sm {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
  }

  .relate-thumb--empty { background: var(--border); }

  .relate-target-info {
    flex: 1;
    min-width: 0;
  }
  .relate-target-name {
    font-weight: 500;
    font-size: var(--fs-md);
  }
  .relate-target-label {
    font-size: var(--fs-sm);
    color: var(--text-muted);
    margin-top: 0.1rem;
  }

  .relate-error {
    padding: 0.75rem 1.25rem;
    color: var(--danger);
    font-size: var(--fs-md);
    background: var(--danger-a10);
  }

  .relate-section-title {
    padding: 0.5rem 1.25rem 0.25rem;
    font-size: var(--fs-xs);
    text-transform: uppercase;
    letter-spacing: var(--track-wide);
    color: var(--text-muted);
  }

  .relate-search {
    width: calc(100% - 2.5rem);
    margin: 0.4rem 1.25rem;
    padding: 0.45rem 0.7rem;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text);
    font-size: var(--fs-md);
    font-family: var(--font-sans);
    outline: none;
  }
  .relate-search::placeholder { color: var(--text-muted); }
  .relate-search:focus { border-color: var(--accent); }

  .relate-empty {
    padding: 2rem;
    text-align: center;
    color: var(--text-muted);
    font-size: var(--fs-md);
  }

  .relate-list {
    overflow-y: auto;
    flex: 1;
  }
  .relate-list--existing {
    flex: none;
    max-height: 30%;
  }

  .relate-item {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    width: 100%;
    padding: 0.5rem 1.25rem;
    border: none;
    background: transparent;
    color: var(--text);
    cursor: pointer;
    text-align: left;
    font-family: var(--font-sans);
    transition: background 0.05s;
  }
  .relate-item:hover:not(:disabled) { background: var(--bg-hover); }
  .relate-item:disabled { opacity: 0.5; cursor: wait; }
  .relate-item--existing { cursor: default; opacity: 0.9; }

  .relate-item-info {
    flex: 1;
    min-width: 0;
  }
  .relate-item-name {
    font-size: var(--fs-md);
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .relate-item-plays {
    font-size: var(--fs-sm);
    color: var(--text-muted);
  }

  .relate-remove {
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: var(--fs-lg);
    cursor: pointer;
    padding: 0.2rem 0.4rem;
    border-radius: var(--radius);
    line-height: 1;
    flex-shrink: 0;
  }
  .relate-remove:hover:not(:disabled) { color: var(--danger); }
  .relate-remove:disabled { opacity: 0.4; cursor: wait; }
</style>
