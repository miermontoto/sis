<script lang="ts">
  import { api, type MergeSuggestion, type AlbumMergePreview, type AlbumMergeMatch, type RemergePreviewPair, type RemergeConfidence } from '$lib/api';
  import MergeImpactBar from '$lib/components/MergeImpactBar.svelte';

  type EntityType = 'album' | 'artist' | 'track';

  let {
    show = $bindable(false),
    entityType,
    target,
    parentId,
    existingMerges = [],
    initialStep,
    onMerged = () => {},
  }: {
    show: boolean;
    entityType: EntityType;
    target: { id: string; name: string; imageUrl: string | null };
    parentId?: string;
    existingMerges?: { id: string; ruleId: number; name: string; imageUrl: string | null }[];
    initialStep?: 'select' | 'remerge';
    onMerged?: () => void;
  } = $props();

  const LABELS: Record<EntityType, { title: string; canonical: string; placeholder: string; verb: string; empty: string; noSuggested: string; round: boolean }> = {
    album:  { title: 'Manage album merges',  canonical: 'Canonical album',  placeholder: 'Filter albums...',  verb: 'album',  empty: 'No other albums found for this artist',  noSuggested: 'No close matches — type to search',           round: false },
    artist: { title: 'Manage artist merges', canonical: 'Canonical artist', placeholder: 'Search all artists...', verb: 'artist', empty: 'No other artists with plays available', noSuggested: 'No close matches — type to search all artists', round: true  },
    track:  { title: 'Manage track merges',  canonical: 'Canonical track',  placeholder: 'Filter tracks...',  verb: 'track',  empty: 'No other tracks found for this artist',  noSuggested: 'No close matches — type to search',           round: false },
  };

  let labels = $derived(LABELS[entityType]);

  let suggestions = $state<MergeSuggestion[]>([]);
  let selected = $state<Set<string>>(new Set());
  let loading = $state(false);
  let merging = $state(false);
  let error = $state('');
  let searchQuery = $state('');

  // track matching step (albums only)
  let step = $state<'select' | 'tracks' | 'remerge'>('select');
  let trackPreview = $state<AlbumMergePreview | null>(null);
  let trackMatches = $state<Map<string, string>>(new Map());
  let loadingPreview = $state(false);

  // remerge step (auto-merge tracks from already-merged albums)
  let remergePairs = $state<(RemergePreviewPair & { checked: boolean })[]>([]);
  let remergeLoading = $state(false);
  let remergeApplying = $state(false);

  let existingIds = $derived(new Set(existingMerges.map(m => m.id)));

  let showOnlySimilar = $derived(entityType === 'artist');
  const SIM_THRESHOLD = 0.3;

  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  function fuzzyMatch(name: string, query: string): boolean {
    const q = norm(query);
    return norm(name).includes(q) || norm(coreName(name)).includes(q);
  }

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

  function coreName(s: string): string {
    return s.split(/ - | \(/)[0].trim();
  }

  let scored = $derived.by(() => {
    const targetNorm = norm(target.name);
    const targetCoreNorm = norm(coreName(target.name));
    const targetTri = trigrams(targetNorm);
    const targetCoreTri = targetCoreNorm !== targetNorm ? trigrams(targetCoreNorm) : targetTri;
    return suggestions.map(a => {
      const nameNorm = norm(a.name);
      const nameTri = trigrams(nameNorm);
      const full = similarity(nameTri, targetTri);
      const coreNorm = norm(coreName(a.name));
      const core = coreNorm !== nameNorm
        ? Math.max(similarity(trigrams(coreNorm), targetTri), similarity(trigrams(coreNorm), targetCoreTri))
        : similarity(nameTri, targetCoreTri);
      return { a, sim: Math.max(full, core) };
    });
  });

  let defaultList = $derived.by(() => {
    const base = showOnlySimilar ? scored.filter(s => s.sim >= SIM_THRESHOLD) : scored;
    return base
      .sort((x, y) => {
        const xs = x.sim >= SIM_THRESHOLD, ys = y.sim >= SIM_THRESHOLD;
        if (xs !== ys) return xs ? -1 : 1;
        if (xs && ys) return y.sim - x.sim || y.a.plays - x.a.plays;
        return y.a.plays - x.a.plays;
      })
      .map(s => s.a);
  });

  let searchResults = $derived(
    scored
      .filter(s => fuzzyMatch(s.a.name, searchQuery))
      .sort((x, y) => y.sim - x.sim || y.a.plays - x.a.plays)
      .map(s => s.a)
  );

  let filteredSuggestions = $derived(searchQuery.length > 0 ? searchResults : defaultList);

  // para el step de tracks: número de matches activos
  let activeTrackPairs = $derived(trackMatches.size);
  let activeRemergePairs = $derived(remergePairs.filter(p => p.checked).length);

  // pares a crear en cada step, para el preview de impacto en el ranking
  let selectionPairs = $derived([...selected].map(sourceId => ({ sourceId, targetId: target.id })));
  let trackStepPairs = $derived([...trackMatches.entries()].map(([sourceId, targetId]) => ({ sourceId, targetId })));
  let remergeSelectedPairs = $derived(remergePairs.filter(p => p.checked)
    .map(p => ({ sourceId: p.sourceTrack.id, targetId: p.targetTrack.id })));

  // nombres conocidos por el modal, para el resumen de impacto
  let impactNames = $derived(new Map<string, string>([
    [target.id, target.name],
    ...suggestions.map(s => [s.id, s.name] as const),
    ...(trackPreview?.source.tracks ?? []).map(t => [t.id, t.name] as const),
    ...(trackPreview?.target.tracks ?? []).map(t => [t.id, t.name] as const),
    ...remergePairs.flatMap(p => [
      [p.sourceTrack.id, p.sourceTrack.name] as const,
      [p.targetTrack.id, p.targetTrack.name] as const,
    ]),
  ]));
  const impactNameOf = (id: string) => impactNames.get(id) ?? null;

  // helpers para el step de tracks
  function getTargetTrackForSource(sourceId: string) {
    return trackPreview?.target.tracks.find(t => t.id === trackMatches.get(sourceId));
  }

  function getMatchConfidence(sourceId: string): AlbumMergeMatch['confidence'] | null {
    const targetId = trackMatches.get(sourceId);
    if (!targetId) return null;
    return trackPreview?.matches.find(m => m.sourceTrackId === sourceId && m.targetTrackId === targetId)?.confidence ?? 'name';
  }

  // '#' posición dentro del álbum, '~' nombres parecidos, '=' mismo tema con distintos créditos
  const CONFIDENCE_BADGES: Record<RemergeConfidence, { symbol: string; title: string }> = {
    position: { symbol: '#', title: 'Matched by track position' },
    name:     { symbol: '~', title: 'Matched by name similarity' },
    duplicate:{ symbol: '=', title: 'Same track, different credits' },
  };

  function formatDuration(ms: number) {
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function close() {
    show = false;
    error = '';
    selected = new Set();
    searchQuery = '';
    step = 'select';
    trackPreview = null;
    trackMatches = new Map();
    remergePairs = [];
    remergeLoading = false;
    remergeApplying = false;
  }

  async function loadSuggestions() {
    loading = true;
    try {
      const opts: { parent?: string; exclude?: string } = { exclude: target.id };
      if (entityType !== 'artist') {
        if (!parentId) {
          console.warn('[merge] no parentId for', entityType, target.id);
          suggestions = [];
          return;
        }
        opts.parent = parentId;
      }
      const all = await api.mergeSuggestions(entityType, opts);
      console.log('[merge] got', all.length, 'suggestions for', entityType, opts);
      suggestions = all.filter(a => a.id !== target.id && !existingIds.has(a.id));
    } catch (e) {
      console.error('[merge] error loading suggestions:', e);
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

  function toggleTrackMatch(sourceId: string) {
    const next = new Map(trackMatches);
    if (next.has(sourceId)) next.delete(sourceId);
    else {
      const original = trackPreview?.matches.find(m => m.sourceTrackId === sourceId);
      if (original) next.set(sourceId, original.targetTrackId);
    }
    trackMatches = next;
  }

  async function goToTrackStep() {
    if (entityType !== 'album' || selected.size !== 1) return;
    const sourceId = [...selected][0];
    loadingPreview = true;
    error = '';
    try {
      trackPreview = await api.albumMergePreview(sourceId, target.id);
      // inicializar matches activos desde auto-matches
      const initial = new Map<string, string>();
      for (const m of trackPreview.matches) {
        initial.set(m.sourceTrackId, m.targetTrackId);
      }
      trackMatches = initial;
      step = 'tracks';
    } catch (e: any) {
      error = e.message || 'Error loading track preview';
    } finally {
      loadingPreview = false;
    }
  }

  function goBackToSelect() {
    step = 'select';
    trackPreview = null;
    trackMatches = new Map();
    error = '';
  }

  async function loadRemergePreview() {
    remergeLoading = true;
    error = '';
    try {
      const preview = await api.albumRemergePreview(target.id);
      remergePairs = preview.pairs.map(p => ({ ...p, checked: true }));
      step = 'remerge';
    } catch (e: any) {
      error = e.message || 'Error loading remerge preview';
    } finally {
      remergeLoading = false;
    }
  }

  async function applyRemerge() {
    const selected = remergePairs.filter(p => p.checked);
    if (selected.length === 0) return;
    remergeApplying = true;
    error = '';
    try {
      await api.batchMergeTracks(selected.map(p => ({
        sourceTrackId: p.sourceTrack.id,
        targetTrackId: p.targetTrack.id,
      })));
      onMerged();
      close();
    } catch (e: any) {
      error = e.message || 'Error merging tracks';
    } finally {
      remergeApplying = false;
    }
  }

  function goBackFromRemerge() {
    step = 'select';
    remergePairs = [];
    error = '';
  }

  async function doMerge() {
    if (selected.size === 0) return;
    merging = true;
    error = '';
    try {
      if (entityType === 'album' && step === 'tracks' && selected.size === 1) {
        const sourceId = [...selected][0];
        const pairs = [...trackMatches.entries()].map(([src, tgt]) => ({ sourceTrackId: src, targetTrackId: tgt }));
        await api.mergeAlbum(sourceId, target.id, pairs);
      } else {
        for (const sourceId of selected) {
          await api.createMerge(entityType, sourceId, target.id);
        }
      }
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

  // promueve un merged a canónico: invierte la dirección repuntando el grupo entero
  let swappingId = $state<string | null>(null);
  async function doSwap(sourceId: string) {
    swappingId = sourceId;
    error = '';
    try {
      await api.makeCanonical(entityType, sourceId);
      onMerged();
      close();
    } catch (e: any) {
      error = e.message || 'Error swapping merge direction';
    } finally {
      swappingId = null;
    }
  }

  // para album con 1 selección: el botón dice "Next: Match tracks"
  let showTrackStep = $derived(entityType === 'album' && selected.size === 1 && step === 'select');

  $effect(() => {
    if (show) {
      loadSuggestions();
      if (initialStep === 'remerge' && entityType === 'album') {
        loadRemergePreview();
      }
    }
  });
</script>

{#if show}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="merge-overlay" onmousedown={(e) => { if (e.target === e.currentTarget) close(); }}>
    <div class="merge-modal" class:merge-modal--wide={step === 'tracks' || step === 'remerge'}>
      <div class="merge-header">
        <h3>{step === 'tracks' ? 'Match tracks' : step === 'remerge' ? 'Auto-merge tracks' : labels.title}</h3>
        <button class="merge-close" onclick={close}>&times;</button>
      </div>

      {#if step === 'select'}
        <!-- STEP 1: seleccionar source(s) -->
        <div class="merge-target">
          {#if target.imageUrl}
            <img class="merge-thumb" class:merge-thumb--round={labels.round} src={target.imageUrl} alt="" />
          {:else}
            <div class="merge-thumb" class:merge-thumb--round={labels.round} class:merge-thumb--empty={true}></div>
          {/if}
          <div class="merge-target-info">
            <div class="merge-target-name">{target.name}</div>
            <div class="merge-target-label">{labels.canonical}</div>
          </div>
        </div>

        {#if error}
          <div class="merge-error">{error}</div>
        {/if}

        {#if existingMerges.length > 0}
          <div class="merge-section-title">Currently merged</div>
          <div class="merge-list merge-list--existing">
            {#each existingMerges as merge}
              <div class="merge-item merge-item--existing">
                {#if merge.imageUrl}
                  <img class="merge-thumb-sm" class:merge-thumb-sm--round={labels.round} src={merge.imageUrl} alt="" />
                {:else}
                  <div class="merge-thumb-sm" class:merge-thumb-sm--round={labels.round} class:merge-thumb--empty={true}></div>
                {/if}
                <div class="merge-item-info">
                  <div class="merge-item-name">{merge.name}</div>
                </div>
                <button
                  class="merge-swap"
                  title="Make this the canonical {labels.verb} instead"
                  disabled={swappingId === merge.id}
                  onclick={() => doSwap(merge.id)}
                >⇅</button>
                <button class="merge-unmerge" title="Unmerge" onclick={() => doUnmerge(merge.ruleId)}>&times;</button>
              </div>
            {/each}
          </div>
        {/if}

        <!-- el scan no depende de haber mergeado álbumes: un álbum suelto puede tener
             duplicados del mismo tema entre sus propias pistas -->
        {#if entityType === 'album'}
          <button class="merge-remerge-btn" onclick={loadRemergePreview} disabled={remergeLoading}>
            {remergeLoading ? 'Scanning...' : 'Scan for duplicate tracks'}
          </button>
        {/if}

        {#if loading}
          <div class="merge-loading"><div class="spinner"></div></div>
        {:else if suggestions.length > 0}
          <div class="merge-section-title">{searchQuery.length > 0 ? 'Search results' : (showOnlySimilar ? 'Suggested matches' : 'Available to merge')}</div>
          <input
            class="merge-search"
            type="text"
            placeholder={labels.placeholder}
            bind:value={searchQuery}
            autocomplete="off"
            spellcheck="false"
          />
          {#if filteredSuggestions.length === 0}
            <div class="merge-empty">
              {searchQuery.length > 0 ? 'No matches found' : labels.noSuggested}
            </div>
          {/if}
          <div class="merge-list">
            {#each filteredSuggestions as item}
              <button
                class="merge-item"
                class:merge-item--selected={selected.has(item.id)}
                disabled={merging}
                onclick={() => toggleSelection(item.id)}
              >
                <div class="merge-check" class:merge-check--active={selected.has(item.id)}>
                  {#if selected.has(item.id)}&#10003;{/if}
                </div>
                {#if item.image_url}
                  <img class="merge-thumb-sm" class:merge-thumb-sm--round={labels.round} src={item.image_url} alt="" />
                {:else}
                  <div class="merge-thumb-sm" class:merge-thumb-sm--round={labels.round} class:merge-thumb--empty={true}></div>
                {/if}
                <div class="merge-item-info">
                  <div class="merge-item-name">{item.name}</div>
                  <div class="merge-item-plays">{item.plays} plays</div>
                </div>
              </button>
            {/each}
          </div>

          {#if selected.size > 0}
            <div class="merge-footer">
              <MergeImpactBar {entityType} pairs={selectionPairs} nameOf={impactNameOf} />
              {#if showTrackStep}
                <button class="merge-confirm" disabled={loadingPreview} onclick={goToTrackStep}>
                  {loadingPreview ? 'Loading...' : 'Next: Match tracks'}
                </button>
              {:else}
                <button class="merge-confirm" disabled={merging} onclick={doMerge}>
                  {merging ? 'Merging...' : `Merge ${selected.size} ${labels.verb}${selected.size > 1 ? 's' : ''}`}
                </button>
              {/if}
            </div>
          {/if}
        {:else if !loading && existingMerges.length === 0}
          <div class="merge-empty">{labels.empty}</div>
        {/if}

      {:else if step === 'tracks' && trackPreview}
        <!-- STEP 2: match tracks -->
        <div class="merge-albums-header">
          <div class="merge-album-badge merge-album-badge--source">
            {#if trackPreview.source.imageUrl}
              <img class="merge-thumb-xs" src={trackPreview.source.imageUrl} alt="" />
            {/if}
            <span class="merge-album-name">{trackPreview.source.name}</span>
            <span class="merge-badge-arrow">&rarr;</span>
          </div>
          <div class="merge-album-badge merge-album-badge--target">
            {#if trackPreview.target.imageUrl}
              <img class="merge-thumb-xs" src={trackPreview.target.imageUrl} alt="" />
            {/if}
            <span class="merge-album-name">{trackPreview.target.name}</span>
          </div>
        </div>

        {#if error}
          <div class="merge-error">{error}</div>
        {/if}

        <div class="merge-section-title">Track matches ({activeTrackPairs} of {trackPreview.source.tracks.length})</div>

        <div class="merge-list">
          {#each trackPreview.source.tracks as sourceTrack}
            {@const targetTrack = getTargetTrackForSource(sourceTrack.id)}
            {@const confidence = getMatchConfidence(sourceTrack.id)}
            {@const isMatched = trackMatches.has(sourceTrack.id)}
            {@const hasAutoMatch = trackPreview.matches.some(m => m.sourceTrackId === sourceTrack.id)}
            <button
              class="track-pair"
              class:track-pair--matched={isMatched}
              class:track-pair--unmatched={!isMatched && hasAutoMatch}
              disabled={!hasAutoMatch}
              onclick={() => toggleTrackMatch(sourceTrack.id)}
            >
              <div class="merge-check" class:merge-check--active={isMatched}>
                {#if isMatched}&#10003;{/if}
              </div>
              <div class="track-pair-content">
                <div class="track-pair-source">
                  <span class="track-num">{sourceTrack.trackNumber ?? '?'}</span>
                  <span class="track-name">{sourceTrack.name}</span>
                  <span class="track-duration">{formatDuration(sourceTrack.durationMs)}</span>
                </div>
                {#if targetTrack && isMatched}
                  <div class="track-pair-arrow">&darr;</div>
                  <div class="track-pair-target">
                    <span class="track-num">{targetTrack.trackNumber ?? '?'}</span>
                    <span class="track-name">{targetTrack.name}</span>
                    <span class="track-duration">{formatDuration(targetTrack.durationMs)}</span>
                    {#if confidence}
                      <span class="track-confidence" class:track-confidence--position={confidence === 'position'}>
                        {confidence === 'position' ? '#' : '~'}
                      </span>
                    {/if}
                  </div>
                {:else if !hasAutoMatch}
                  <div class="track-pair-no-match">No match found</div>
                {/if}
              </div>
            </button>
          {/each}
        </div>

        <div class="merge-footer">
          <MergeImpactBar entityType="track" pairs={trackStepPairs} nameOf={impactNameOf} />
          <div class="merge-footer-row">
            <button class="merge-back" onclick={goBackToSelect}>&larr; Back</button>
            <button class="merge-confirm" disabled={merging} onclick={doMerge}>
              {merging ? 'Merging...' : `Merge album${activeTrackPairs > 0 ? ` + ${activeTrackPairs} tracks` : ''}`}
            </button>
          </div>
        </div>

      {:else if step === 'remerge'}
        {#if error}
          <div class="merge-error">{error}</div>
        {/if}

        {#if remergeLoading}
          <div class="merge-loading"><div class="spinner"></div></div>
        {:else if remergePairs.length === 0}
          <div class="merge-empty">No duplicate or unmerged tracks found.</div>
        {:else}
          <div class="merge-section-title">Track matches ({activeRemergePairs} of {remergePairs.length})</div>
          <div class="merge-list">
            {#each remergePairs as pair, i}
              <button
                class="track-pair"
                class:track-pair--matched={pair.checked}
                onclick={() => { remergePairs[i] = { ...pair, checked: !pair.checked }; }}
              >
                <div class="merge-check" class:merge-check--active={pair.checked}>
                  {#if pair.checked}&#10003;{/if}
                </div>
                <div class="track-pair-content">
                  <div class="track-pair-source">
                    <span class="track-name">{pair.sourceTrack.name}</span>
                    <span class="track-album-hint">{pair.sourceAlbumName}</span>
                  </div>
                  <div class="track-pair-arrow">&darr;</div>
                  <div class="track-pair-target">
                    <span class="track-name">{pair.targetTrack.name}</span>
                    <span
                      class="track-confidence"
                      class:track-confidence--position={pair.confidence === 'position'}
                      class:track-confidence--duplicate={pair.confidence === 'duplicate'}
                      title={CONFIDENCE_BADGES[pair.confidence].title}
                    >
                      {CONFIDENCE_BADGES[pair.confidence].symbol}
                    </span>
                  </div>
                </div>
              </button>
            {/each}
          </div>

          <div class="merge-footer">
            <MergeImpactBar entityType="track" pairs={remergeSelectedPairs} nameOf={impactNameOf} />
            <div class="merge-footer-row">
              <button class="merge-back" onclick={goBackFromRemerge}>&larr; Back</button>
              <button class="merge-confirm" disabled={remergeApplying || activeRemergePairs === 0} onclick={applyRemerge}>
                {remergeApplying ? 'Merging...' : `Merge ${activeRemergePairs} tracks`}
              </button>
            </div>
          </div>
        {/if}
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
    border-radius: var(--radius);
    width: 440px;
    max-width: calc(100% - 2rem);
    max-height: 75vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    align-self: flex-start;
    transition: width 0.15s ease;
  }

  .merge-modal--wide {
    width: 520px;
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
    border-radius: var(--radius);
    object-fit: cover;
    flex-shrink: 0;
  }
  .merge-thumb--round { border-radius: 50%; }

  .merge-thumb-sm {
    width: 36px;
    height: 36px;
    border-radius: var(--radius);
    object-fit: cover;
    flex-shrink: 0;
  }
  .merge-thumb-sm--round { border-radius: 50%; }

  .merge-thumb--empty {
    background: var(--border);
  }

  .merge-thumb-xs {
    width: 24px;
    height: 24px;
    border-radius: 3px;
    object-fit: cover;
    flex-shrink: 0;
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
    border-radius: var(--radius);
    color: var(--text);
    font-size: 0.85rem;
    font-family: var(--font-sans);
    outline: none;
  }
  .merge-search::placeholder { color: var(--text-muted); }
  .merge-search:focus { border-color: var(--accent); }

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

  .merge-list--existing {
    flex: none;
    max-height: 30%;
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
    font-family: var(--font-sans);
    transition: background 0.05s;
  }

  .merge-item:hover:not(:disabled) { background: var(--bg-hover); }
  .merge-item--selected { background: rgba(29, 185, 84, 0.08); }
  .merge-item--existing { cursor: default; opacity: 0.9; }

  .merge-check {
    width: 18px;
    height: 18px;
    border: 2px solid var(--border);
    border-radius: var(--radius);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.7rem;
    flex-shrink: 0;
    transition: border-color 0.05s, background 0.05s;
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
    border-radius: var(--radius);
    line-height: 1;
    flex-shrink: 0;
  }

  .merge-unmerge:hover { color: #ff4444; }

  .merge-swap {
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 0.95rem;
    cursor: pointer;
    padding: 0.2rem 0.3rem;
    border-radius: var(--radius);
    line-height: 1;
    flex-shrink: 0;
  }
  .merge-swap:hover:not(:disabled) { color: var(--accent); }
  .merge-swap:disabled { opacity: 0.4; cursor: wait; }

  .merge-footer {
    padding: 0.75rem 1.25rem;
    border-top: 1px solid var(--border);
  }

  .merge-footer-row {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }

  .merge-footer :global(.impact) {
    margin-bottom: 0.6rem;
  }

  .merge-back {
    padding: 0.6rem 1rem;
    background: transparent;
    color: var(--text-muted);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    font-size: 0.85rem;
    cursor: pointer;
    font-family: var(--font-sans);
    white-space: nowrap;
  }
  .merge-back:hover { color: var(--text); border-color: var(--text-muted); }

  .merge-confirm {
    flex: 1;
    padding: 0.6rem;
    background: var(--accent);
    color: #000;
    border: none;
    border-radius: var(--radius);
    font-weight: 600;
    font-size: 0.9rem;
    cursor: pointer;
    transition: opacity 0.05s;
  }

  .merge-confirm:hover:not(:disabled) { opacity: 0.9; }
  .merge-confirm:disabled { opacity: 0.5; cursor: wait; }

  /* --- track matching step --- */

  .merge-albums-header {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.75rem 1.25rem;
    border-bottom: 1px solid var(--border);
    background: rgba(255, 255, 255, 0.02);
  }

  .merge-album-badge {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.8rem;
    min-width: 0;
  }

  .merge-album-badge--source { color: var(--text-muted); }
  .merge-album-badge--target { color: var(--accent); }

  .merge-album-name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-weight: 500;
  }

  .merge-badge-arrow {
    flex-shrink: 0;
    color: var(--text-muted);
    font-size: 0.75rem;
  }

  .track-pair {
    display: flex;
    align-items: flex-start;
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

  .track-pair:hover:not(:disabled) { background: var(--bg-hover); }
  .track-pair:disabled { cursor: default; opacity: 0.5; }
  .track-pair--matched { background: rgba(29, 185, 84, 0.05); }
  .track-pair--unmatched { opacity: 0.7; }

  .track-pair .merge-check { margin-top: 1px; }

  .track-pair-content {
    flex: 1;
    min-width: 0;
  }

  .track-pair-source, .track-pair-target {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.82rem;
  }

  .track-pair-target {
    color: var(--accent);
    font-size: 0.78rem;
  }

  .track-pair-arrow {
    font-size: 0.65rem;
    color: var(--text-muted);
    padding-left: 1.4rem;
    line-height: 1;
  }

  .track-pair-no-match {
    font-size: 0.75rem;
    color: var(--text-muted);
    padding-left: 1.4rem;
    font-style: italic;
  }

  .track-num {
    color: var(--text-muted);
    font-size: 0.75rem;
    min-width: 1.2rem;
    text-align: right;
    flex-shrink: 0;
  }

  .track-name {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .track-duration {
    color: var(--text-muted);
    font-size: 0.75rem;
    flex-shrink: 0;
  }

  .track-confidence {
    font-size: 0.65rem;
    padding: 0.05rem 0.3rem;
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.08);
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .track-confidence--position {
    background: rgba(29, 185, 84, 0.15);
    color: var(--accent);
  }

  .track-confidence--duplicate {
    background: rgba(255, 176, 46, 0.15);
    color: #ffb02e;
  }

  .merge-remerge-btn {
    display: block;
    width: calc(100% - 2.5rem);
    margin: 0.4rem 1.25rem;
    padding: 0.4rem 0.7rem;
    background: transparent;
    border: 1px dashed var(--border);
    border-radius: var(--radius);
    color: var(--text-muted);
    font-size: 0.8rem;
    font-family: inherit;
    cursor: pointer;
    transition: border-color 0.05s, color 0.05s;
  }
  .merge-remerge-btn:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
  }
  .merge-remerge-btn:disabled {
    opacity: 0.5;
    cursor: wait;
  }

  .track-album-hint {
    font-size: 0.72rem;
    color: var(--text-muted);
    max-width: 10rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
