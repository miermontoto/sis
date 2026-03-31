<script lang="ts">
  import { api, type MergeSuggestionAlbum } from '$lib/api';

  let {
    show = $bindable(false),
    targetAlbum,
    artistId = '',
    existingMerges = [],
    onMerged = () => {},
  }: {
    show: boolean;
    targetAlbum: { id: string; name: string; imageUrl: string | null };
    artistId?: string;
    existingMerges?: { id: string; ruleId: number; name: string; imageUrl: string | null }[];
    onMerged?: () => void;
  } = $props();

  let suggestions = $state<MergeSuggestionAlbum[]>([]);
  let selected = $state<Set<string>>(new Set());
  let loading = $state(false);
  let merging = $state(false);
  let error = $state('');
  let searchQuery = $state('');

  let existingIds = $derived(new Set(existingMerges.map(m => m.id)));

  const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  // fuzzy filter: normalizar y buscar coincidencia parcial
  function fuzzyMatch(name: string, query: string): boolean {
    return norm(name).includes(norm(query));
  }

  // similaridad entre dos strings (0-1): porcentaje de trigramas en común
  function trigrams(s: string): Set<string> {
    const t = new Set<string>();
    for (let i = 0; i <= s.length - 3; i++) t.add(s.slice(i, i + 3));
    return t;
  }

  function similarity(triA: Set<string>, triB: Set<string>): number {
    if (triA.size === 0 || triB.size === 0) return 0;
    let common = 0;
    for (const t of triA) if (triB.has(t)) common++;
    return common / Math.max(triA.size, triB.size);
  }

  // ordenar sugerencias: similares al target primero, luego por plays
  let sortedSuggestions = $derived.by(() => {
    const targetTri = trigrams(norm(targetAlbum.name));
    const scored = suggestions.map(a => ({ a, sim: similarity(trigrams(norm(a.name)), targetTri) }));
    scored.sort((x, y) => {
      const xs = x.sim >= 0.3, ys = y.sim >= 0.3;
      if (xs !== ys) return xs ? -1 : 1;
      if (xs && ys) return y.sim - x.sim || y.a.plays - x.a.plays;
      return y.a.plays - x.a.plays;
    });
    return scored.map(s => s.a);
  });

  let filteredSuggestions = $derived(
    searchQuery.length > 0
      ? sortedSuggestions.filter(a => fuzzyMatch(a.name, searchQuery))
      : sortedSuggestions
  );

  function close() {
    show = false;
    error = '';
    selected = new Set();
    searchQuery = '';
  }

  async function loadSuggestions() {
    if (!artistId) return;
    loading = true;
    try {
      const all = await api.mergeSuggestions(artistId);
      suggestions = all.filter(a => a.id !== targetAlbum.id && !existingIds.has(a.id));
    } catch {
      suggestions = [];
    } finally {
      loading = false;
    }
  }

  function toggleSelection(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selected = next;
  }

  async function doMerge() {
    if (selected.size === 0) return;
    merging = true;
    error = '';
    try {
      for (const sourceId of selected) {
        await api.createMerge('album', sourceId, targetAlbum.id);
      }
      // callback ANTES de cerrar para que el parent refresque
      onMerged();
      close();
    } catch (e: any) {
      error = e.message || 'Error creating merge';
    } finally {
      merging = false;
    }
  }

  async function doUnmerge(ruleId: number) {
    try {
      await api.deleteMerge(ruleId);
      onMerged();
    } catch (e: any) {
      error = e.message || 'Error removing merge';
    }
  }

  $effect(() => {
    if (show && artistId) loadSuggestions();
  });
</script>

{#if show}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="merge-overlay" onmousedown={(e) => { if (e.target === e.currentTarget) close(); }}>
    <div class="merge-modal">
      <div class="merge-header">
        <h3>Manage merges</h3>
        <button class="merge-close" onclick={close}>&times;</button>
      </div>

      <div class="merge-target">
        {#if targetAlbum.imageUrl}
          <img class="merge-thumb" src={targetAlbum.imageUrl} alt="" />
        {:else}
          <div class="merge-thumb merge-thumb--empty"></div>
        {/if}
        <div class="merge-target-info">
          <div class="merge-target-name">{targetAlbum.name}</div>
          <div class="merge-target-label">Canonical album</div>
        </div>
      </div>

      {#if error}
        <div class="merge-error">{error}</div>
      {/if}

      {#if existingMerges.length > 0}
        <div class="merge-section-title">Currently merged</div>
        <div class="merge-list">
          {#each existingMerges as merge}
            <div class="merge-item merge-item--existing">
              {#if merge.imageUrl}
                <img class="merge-thumb-sm" src={merge.imageUrl} alt="" />
              {:else}
                <div class="merge-thumb-sm merge-thumb--empty"></div>
              {/if}
              <div class="merge-item-info">
                <div class="merge-item-name">{merge.name}</div>
              </div>
              <button class="merge-unmerge" title="Unmerge" onclick={() => doUnmerge(merge.ruleId)}>&times;</button>
            </div>
          {/each}
        </div>
      {/if}

      {#if loading}
        <div class="merge-loading"><div class="spinner"></div></div>
      {:else if suggestions.length > 0}
        <div class="merge-section-title">Available to merge</div>
        <input
          class="merge-search"
          type="text"
          placeholder="Filter albums..."
          bind:value={searchQuery}
          autocomplete="off"
          spellcheck="false"
        />
        <div class="merge-list">
          {#each filteredSuggestions as album}
            <button
              class="merge-item"
              class:merge-item--selected={selected.has(album.id)}
              disabled={merging}
              onclick={() => toggleSelection(album.id)}
            >
              <div class="merge-check" class:merge-check--active={selected.has(album.id)}>
                {#if selected.has(album.id)}&#10003;{/if}
              </div>
              {#if album.image_url}
                <img class="merge-thumb-sm" src={album.image_url} alt="" />
              {:else}
                <div class="merge-thumb-sm merge-thumb--empty"></div>
              {/if}
              <div class="merge-item-info">
                <div class="merge-item-name">{album.name}</div>
                <div class="merge-item-plays">{album.plays} plays</div>
              </div>
            </button>
          {/each}
        </div>

        {#if selected.size > 0}
          <div class="merge-footer">
            <button class="merge-confirm" disabled={merging} onclick={doMerge}>
              {merging ? 'Merging...' : `Merge ${selected.size} album${selected.size > 1 ? 's' : ''}`}
            </button>
          </div>
        {/if}
      {:else if !loading && existingMerges.length === 0}
        <div class="merge-empty">No other albums found for this artist</div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .merge-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    z-index: 200;
    display: flex;
    justify-content: center;
    padding-top: 12vh;
    backdrop-filter: blur(4px);
  }

  .merge-modal {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 12px;
    width: 440px;
    max-width: calc(100% - 2rem);
    max-height: 75vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    align-self: flex-start;
  }

  .merge-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.25rem;
    border-bottom: 1px solid var(--border);
  }

  .merge-header h3 {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
  }

  .merge-close {
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 1.5rem;
    cursor: pointer;
    padding: 0;
    line-height: 1;
  }

  .merge-target {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 1rem 1.25rem;
    border-bottom: 1px solid var(--border);
    background: rgba(255, 255, 255, 0.02);
  }

  .merge-thumb {
    width: 48px;
    height: 48px;
    border-radius: 4px;
    object-fit: cover;
    flex-shrink: 0;
  }

  .merge-thumb-sm {
    width: 36px;
    height: 36px;
    border-radius: 4px;
    object-fit: cover;
    flex-shrink: 0;
  }

  .merge-thumb--empty {
    background: var(--border);
  }

  .merge-target-name {
    font-weight: 500;
    font-size: 0.95rem;
  }

  .merge-target-label {
    font-size: 0.75rem;
    color: var(--accent);
    margin-top: 0.1rem;
  }

  .merge-target-info {
    flex: 1;
    min-width: 0;
  }

  .merge-error {
    padding: 0.75rem 1.25rem;
    color: #ff4444;
    font-size: 0.85rem;
    background: rgba(255, 68, 68, 0.1);
  }

  .merge-section-title {
    padding: 0.5rem 1.25rem 0.25rem;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-muted);
  }

  .merge-search {
    width: calc(100% - 2.5rem);
    margin: 0.4rem 1.25rem;
    padding: 0.45rem 0.7rem;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    font-size: 0.85rem;
    font-family: var(--font);
    outline: none;
  }
  .merge-search::placeholder {
    color: var(--text-muted);
  }
  .merge-search:focus {
    border-color: var(--accent);
  }

  .merge-loading, .merge-empty {
    padding: 2rem;
    text-align: center;
    color: var(--text-muted);
    font-size: 0.9rem;
  }

  .merge-list {
    overflow-y: auto;
    flex: 1;
  }

  .merge-item {
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
    font-family: var(--font);
    transition: background 0.1s;
  }

  .merge-item:hover:not(:disabled) {
    background: var(--bg-hover);
  }

  .merge-item--selected {
    background: rgba(29, 185, 84, 0.08);
  }

  .merge-item--existing {
    cursor: default;
    opacity: 0.9;
  }

  .merge-check {
    width: 18px;
    height: 18px;
    border: 2px solid var(--border);
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.7rem;
    flex-shrink: 0;
    transition: border-color 0.15s, background 0.15s;
  }

  .merge-check--active {
    border-color: var(--accent);
    background: var(--accent);
    color: #000;
    font-weight: 700;
  }

  .merge-item-info {
    flex: 1;
    min-width: 0;
  }

  .merge-item-name {
    font-size: 0.85rem;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .merge-item-plays {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .merge-unmerge {
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 1.2rem;
    cursor: pointer;
    padding: 0.2rem 0.4rem;
    border-radius: 4px;
    line-height: 1;
    flex-shrink: 0;
  }

  .merge-unmerge:hover {
    color: #ff4444;
  }

  .merge-footer {
    padding: 0.75rem 1.25rem;
    border-top: 1px solid var(--border);
  }

  .merge-confirm {
    width: 100%;
    padding: 0.6rem;
    background: var(--accent);
    color: #000;
    border: none;
    border-radius: 8px;
    font-weight: 600;
    font-size: 0.9rem;
    cursor: pointer;
    font-family: var(--font);
    transition: opacity 0.15s;
  }

  .merge-confirm:hover:not(:disabled) {
    opacity: 0.9;
  }

  .merge-confirm:disabled {
    opacity: 0.5;
    cursor: wait;
  }
</style>
