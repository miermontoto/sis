<script lang="ts">
  // Corrector de créditos de un tema o un álbum (ver shared/credits.ts): la lista de
  // artistas tal como la quiere ver el usuario, que sustituye a la de spotify sólo en
  // SUS cifras. Se edita un borrador —quitar, añadir, hacer principal— y se guarda
  // entero, porque el servidor guarda la lista y no los cambios sueltos: así "quitar al
  // principal y poner a otro" deja siempre un principal bien definido.
  //
  // Vive una sola instancia en el layout y la abre el store (creditsModal), desde el
  // menú del hero y desde el contextual de las filas.
  import { untrack } from 'svelte';
  import { api, CREDITS_MAX_ARTISTS, type CreditArtist, type EntityCredits, type SearchResults } from '$lib/api';
  import { creditsModal } from '$lib/stores/credits-modal.svelte';
  import { toastStore } from '$lib/stores/toast.svelte';
  import { errorMessage } from '$lib/utils/errors';
  import { formatNumber } from '$lib/utils/format';
  import IconRankUp from '$lib/icons/IconRankUp.svelte';

  const SEARCH_DEBOUNCE_MS = 250;
  const SEARCH_LIMIT = 8;

  let loaded = $state<EntityCredits | null>(null);
  let draft = $state<CreditArtist[]>([]);
  let busy = $state(false);
  let error = $state('');
  let query = $state('');
  let results = $state<SearchResults['artists']>([]);
  let searching = $state(false);
  let searchTimer: ReturnType<typeof setTimeout> | null = null;

  const target = $derived(creditsModal.target);
  const ids = (list: CreditArtist[]) => list.map(a => a.id).join(',');
  let dirty = $derived(loaded !== null && ids(draft) !== ids(loaded.credits));
  let draftIds = $derived(new Set(draft.map(a => a.id)));
  let candidates = $derived(results.filter(a => !draftIds.has(a.id)));

  $effect(() => () => { if (searchTimer) clearTimeout(searchTimer); });

  // `untrack`: load escribe el estado que lee el propio efecto (loaded, draft), y sin
  // él la respuesta volvería a disparar la carga
  $effect(() => {
    const t = target;
    if (!t) return;
    untrack(() => load(t.type, t.entity.id));
  });

  async function load(type: 'track' | 'album', id: string) {
    loaded = null;
    error = '';
    query = '';
    results = [];
    try {
      loaded = await api.entityCredits(type, id);
      draft = [...loaded.credits];
    } catch (e) {
      error = errorMessage(e, 'Error loading credits');
    }
  }

  function close() {
    creditsModal.close();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && target) close();
  }

  function runSearch() {
    if (searchTimer) clearTimeout(searchTimer);
    const q = query.trim();
    if (!q) { results = []; return; }
    searchTimer = setTimeout(async () => {
      searching = true;
      try {
        results = (await api.search(q, SEARCH_LIMIT)).artists;
      } catch {
        results = [];
      } finally {
        searching = false;
      }
    }, SEARCH_DEBOUNCE_MS);
  }

  const add = (a: SearchResults['artists'][number]) => {
    draft = [...draft, { id: a.id, name: a.name, imageUrl: a.imageUrl }];
    query = '';
    results = [];
  };
  const remove = (id: string) => { draft = draft.filter(a => a.id !== id); };
  const makePrimary = (id: string) => { draft = [...draft.filter(a => a.id === id), ...draft.filter(a => a.id !== id)]; };

  // guardar y deshacer comparten desenlace: avisar a las vistas (que releen con
  // changeVersion) y cerrar
  async function commit(request: Promise<EntityCredits>, message: string) {
    busy = true;
    error = '';
    try {
      await request;
      creditsModal.notifyChange();
      toastStore.show(message);
      close();
    } catch (e) {
      error = errorMessage(e, 'Error saving credits');
    } finally {
      busy = false;
    }
  }

  const save = () => target && commit(api.setEntityCredits(target.type, target.entity.id, draft.map(a => a.id)), 'Credits updated');
  const reset = () => target && commit(api.resetEntityCredits(target.type, target.entity.id), 'Credits restored');
</script>

<svelte:window onkeydown={onKey} />

{#if target}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="credits-overlay" onmousedown={(e) => { if (e.target === e.currentTarget) close(); }}>
    <div class="credits-modal">
      <div class="credits-header">
        <h3>Credits</h3>
        <button class="credits-close" onclick={close}>&times;</button>
      </div>

      <div class="credits-target">
        {#if target.entity.imageUrl}
          <img class="credits-thumb" src={target.entity.imageUrl} alt="" />
        {:else}
          <div class="credits-thumb credits-thumb--empty"></div>
        {/if}
        <div>
          <div class="credits-target-name">{target.entity.name}</div>
          <div class="credits-hint">
            {target.type === 'track'
              ? 'Its plays count for these artists, in your stats only. The first one is the primary artist.'
              : 'Decides whose page lists this album, in your stats only. Who each track counts for is set on the track.'}
          </div>
        </div>
      </div>

      {#if error}<div class="credits-error">{error}</div>{/if}

      {#if !loaded}
        {#if !error}<div class="loading"><div class="spinner"></div></div>{/if}
      {:else}
        <div class="credits-list">
          {#each draft as artist, i (artist.id)}
            <div class="credits-item">
              {#if artist.imageUrl}
                <img class="credits-thumb-sm" src={artist.imageUrl} alt="" />
              {:else}
                <div class="credits-thumb-sm credits-thumb--empty"></div>
              {/if}
              <div class="credits-item-name">{artist.name}</div>
              {#if i === 0}
                <span class="credits-primary">Primary</span>
              {:else}
                <button class="credits-icon-btn" title="Make primary" disabled={busy} onclick={() => makePrimary(artist.id)}>
                  <IconRankUp size={10} />
                </button>
              {/if}
              <button class="credits-icon-btn credits-icon-btn--remove" title="Remove" disabled={busy} onclick={() => remove(artist.id)}>&times;</button>
            </div>
          {:else}
            <div class="credits-empty">Add at least one artist.</div>
          {/each}
        </div>

        {#if draft.length < CREDITS_MAX_ARTISTS}
          <input
            class="credits-search"
            type="search"
            placeholder="Add an artist…"
            bind:value={query}
            oninput={runSearch}
            disabled={busy}
          />
          {#if searching}
            <div class="credits-empty">Searching…</div>
          {:else if query.trim() && candidates.length === 0}
            <div class="credits-empty">No artists found.</div>
          {:else}
            <div class="credits-list">
              {#each candidates as a (a.id)}
                <button class="credits-item credits-item--result" disabled={busy} onclick={() => add(a)}>
                  {#if a.imageUrl}
                    <img class="credits-thumb-sm" src={a.imageUrl} alt="" />
                  {:else}
                    <div class="credits-thumb-sm credits-thumb--empty"></div>
                  {/if}
                  <div class="credits-item-name">{a.name}</div>
                  <span class="credits-meta">{formatNumber(a.playCount)} plays</span>
                </button>
              {/each}
            </div>
          {/if}
        {/if}

        <div class="credits-actions">
          {#if loaded.overridden}
            <button class="credits-btn credits-btn--ghost" disabled={busy} onclick={reset}
              title={`Back to ${loaded.original.map(a => a.name).join(', ') || 'the catalog credits'}`}>
              Restore original
            </button>
          {/if}
          <button class="credits-btn" disabled={busy || !dirty || draft.length === 0} onclick={save}>Save</button>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .credits-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
    padding: 1rem;
  }
  .credits-modal {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    width: min(440px, 100%);
    max-height: 85vh;
    overflow-y: auto;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .credits-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .credits-header h3 {
    margin: 0;
    font-size: var(--fs-base);
  }
  .credits-close {
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: var(--fs-xl);
    line-height: 1;
    cursor: pointer;
  }
  .credits-target {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }
  .credits-thumb {
    width: 48px;
    height: 48px;
    border-radius: var(--radius);
    object-fit: cover;
    flex-shrink: 0;
  }
  .credits-thumb-sm {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
  }
  .credits-thumb--empty {
    background: var(--bg-hover);
  }
  .credits-target-name {
    font-weight: 600;
  }
  .credits-hint,
  .credits-empty,
  .credits-meta {
    font-size: var(--fs-sm);
    color: var(--text-muted);
  }
  .credits-error {
    font-size: var(--fs-sm);
    color: var(--danger);
  }
  .credits-list {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .credits-item {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.35rem;
    border-radius: var(--radius);
  }
  .credits-item--result {
    width: 100%;
    border: none;
    background: transparent;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .credits-item:hover {
    background: var(--bg-hover);
  }
  .credits-item-name {
    flex: 1;
    min-width: 0;
    font-size: var(--fs-md);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .credits-primary {
    font-size: var(--fs-xs);
    text-transform: uppercase;
    letter-spacing: var(--track-wide);
    color: var(--accent);
  }
  .credits-icon-btn {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    padding: 0.2rem 0.35rem;
    display: flex;
    align-items: center;
    font-size: var(--fs-lg);
    line-height: 1;
  }
  .credits-icon-btn:hover:not(:disabled) {
    color: var(--text);
  }
  .credits-icon-btn--remove:hover:not(:disabled) {
    color: var(--danger);
  }
  .credits-search {
    width: 100%;
    padding: 0.45rem 0.7rem;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text);
    font: inherit;
  }
  .credits-search:focus {
    outline: none;
    border-color: var(--accent);
  }
  .credits-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }
  .credits-btn {
    background: var(--accent);
    border: none;
    color: #000;
    border-radius: var(--radius);
    padding: 0.35rem 0.9rem;
    font-size: var(--fs-sm);
    cursor: pointer;
  }
  .credits-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .credits-btn--ghost {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-muted);
  }
</style>
