<script lang="ts">
  import { onMount } from 'svelte';
  import { api, type BulkRemergePreview, type BulkRemergeAlbum, type RemergePreviewPair, type RemergeConfidence } from '$lib/api';

  const SCOPES: { value: string; label: string }[] = [
    { value: 'top100', label: 'Top 100 albums' },
    { value: 'top200', label: 'Top 200 albums' },
    { value: 'top500', label: 'Top 500 albums' },
    { value: 'all', label: 'Every album with plays' },
  ];

  // '#' posición dentro del álbum, '~' nombres parecidos, '=' mismo tema con distintos créditos
  const CONFIDENCE_BADGES: Record<RemergeConfidence, { symbol: string; title: string }> = {
    position: { symbol: '#', title: 'Matched by track position' },
    name:     { symbol: '~', title: 'Matched by name similarity' },
    duplicate:{ symbol: '=', title: 'Same track, different credits' },
  };

  // sólo los duplicados entran marcados: son los del matcher conservador. Los de posición
  // y parecido de nombre son más ruidosos y se activan a mano.
  const AUTO_CHECKED: RemergeConfidence = 'duplicate';

  let scope = $state('top200');
  let data = $state<BulkRemergePreview | null>(null);
  let loading = $state(true);
  let applying = $state(false);
  let error = $state('');
  let result = $state<{ created: number; skipped: string[] } | null>(null);

  let checked = $state<Set<string>>(new Set());
  let expanded = $state<Set<string>>(new Set());

  const pairKey = (albumId: string, p: RemergePreviewPair) => `${albumId}:${p.sourceTrack.id}`;

  let totalChecked = $derived(checked.size);
  let byConfidence = $derived.by(() => {
    const out: Record<string, number> = { duplicate: 0, name: 0, position: 0 };
    for (const a of data?.albums ?? []) for (const p of a.pairs) out[p.confidence]++;
    return out;
  });

  const albumChecked = (a: BulkRemergeAlbum) => a.pairs.filter(p => checked.has(pairKey(a.id, p))).length;

  async function scan() {
    loading = true;
    error = '';
    result = null;
    try {
      const preview = await api.bulkRemergePreview(scope);
      data = preview;
      // marcar por defecto sólo los duplicados
      checked = new Set(
        preview.albums.flatMap(a => a.pairs.filter(p => p.confidence === AUTO_CHECKED).map(p => pairKey(a.id, p)))
      );
      expanded = new Set();
    } catch (e: any) {
      error = e.message || 'Error scanning albums';
      data = null;
    } finally {
      loading = false;
    }
  }

  function togglePair(albumId: string, p: RemergePreviewPair) {
    const k = pairKey(albumId, p);
    const next = new Set(checked);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    checked = next;
  }

  // todo-o-nada por álbum: si ya están todos marcados, desmarca; si no, marca el resto
  function toggleAlbum(a: BulkRemergeAlbum) {
    const next = new Set(checked);
    const all = albumChecked(a) === a.pairs.length;
    for (const p of a.pairs) {
      if (all) next.delete(pairKey(a.id, p));
      else next.add(pairKey(a.id, p));
    }
    checked = next;
  }

  function toggleExpanded(albumId: string) {
    const next = new Set(expanded);
    if (next.has(albumId)) next.delete(albumId);
    else next.add(albumId);
    expanded = next;
  }

  function selectConfidence(confidence: RemergeConfidence | null) {
    checked = new Set(
      (data?.albums ?? []).flatMap(a =>
        a.pairs.filter(p => confidence !== null && p.confidence === confidence).map(p => pairKey(a.id, p))
      )
    );
  }

  async function apply() {
    if (totalChecked === 0) return;
    applying = true;
    error = '';
    try {
      // dedupe por source: un mismo track no puede fusionarse dos veces, y el backend
      // rechazaría el segundo par dejándolo en `skipped` sin razón aparente
      const seen = new Set<string>();
      const trackPairs: { sourceTrackId: string; targetTrackId: string }[] = [];
      for (const a of data?.albums ?? []) {
        for (const p of a.pairs) {
          if (!checked.has(pairKey(a.id, p)) || seen.has(p.sourceTrack.id)) continue;
          seen.add(p.sourceTrack.id);
          trackPairs.push({ sourceTrackId: p.sourceTrack.id, targetTrackId: p.targetTrack.id });
        }
      }
      result = await api.batchMergeTracks(trackPairs);
      await scan();
    } catch (e: any) {
      error = e.message || 'Error applying merges';
    } finally {
      applying = false;
    }
  }

  onMount(scan);
</script>

<div class="page-header">
  <h1>Scan for duplicates</h1>
  <a href="/settings/merges" class="back-link">← Merges</a>
</div>

<div class="card section-card">
  <div class="scan-controls">
    <select class="scan-select" bind:value={scope} onchange={scan} disabled={loading || applying}>
      {#each SCOPES as s}
        <option value={s.value}>{s.label}</option>
      {/each}
    </select>
    <button class="scan-btn" onclick={scan} disabled={loading || applying}>
      {loading ? 'Scanning...' : 'Rescan'}
    </button>
  </div>

  {#if error}
    <div class="scan-error">{error}</div>
  {/if}

  {#if result}
    <div class="scan-result">
      Applied {result.created} merge{result.created !== 1 ? 's' : ''}.
      {#if result.skipped.length > 0}<span class="scan-skipped">{result.skipped.length} skipped.</span>{/if}
    </div>
  {/if}

  {#if loading}
    <div class="loading"><div class="spinner"></div></div>
  {:else if !data || data.albums.length === 0}
    <p style="color: var(--text-muted);">No duplicate candidates found in {data?.scanned ?? 0} albums.</p>
  {:else}
    <div class="scan-summary">
      <span class="scan-count">
        <strong>{data.totalPairs}</strong> candidates in {data.albums.length} albums
        <span class="scan-muted">(scanned {data.scanned})</span>
      </span>
      <span class="scan-legend">
        <button class="scan-chip scan-chip--duplicate" onclick={() => selectConfidence('duplicate')} title="Select only these">= {byConfidence.duplicate}</button>
        <button class="scan-chip" onclick={() => selectConfidence('name')} title="Select only these">~ {byConfidence.name}</button>
        <button class="scan-chip" onclick={() => selectConfidence('position')} title="Select only these">#{byConfidence.position}</button>
        <button class="scan-chip" onclick={() => selectConfidence(null)} title="Clear selection">none</button>
      </span>
    </div>

    <ul class="scan-groups">
      {#each data.albums as a (a.id)}
        {@const open = expanded.has(a.id)}
        {@const n = albumChecked(a)}
        <li class="scan-group" class:scan-group--open={open}>
          <div class="scan-group-header">
            <button class="scan-group-toggle" onclick={() => toggleExpanded(a.id)} aria-expanded={open}>
              <span class="scan-chevron">{open ? '▾' : '▸'}</span>
              {#if a.imageUrl}
                <img class="scan-thumb" src={a.imageUrl} alt="" />
              {:else}
                <div class="scan-thumb scan-thumb--empty"></div>
              {/if}
              <span class="scan-group-name">{a.name}</span>
              <span class="scan-group-plays">{a.playCount} plays</span>
            </button>
            <button
              class="scan-group-count"
              class:scan-group-count--active={n > 0}
              onclick={() => toggleAlbum(a)}
              title={n === a.pairs.length ? 'Deselect all' : 'Select all'}
            >
              {n}/{a.pairs.length}
            </button>
          </div>

          {#if open}
            <ul class="scan-pairs">
              {#each a.pairs as p (p.sourceTrack.id)}
                {@const isChecked = checked.has(pairKey(a.id, p))}
                <li>
                  <button class="scan-pair" class:scan-pair--checked={isChecked} onclick={() => togglePair(a.id, p)}>
                    <span class="scan-check" class:scan-check--active={isChecked}>{#if isChecked}&#10003;{/if}</span>
                    <span class="scan-pair-body">
                      <span class="scan-pair-source">
                        <span class="scan-track-name">{p.sourceTrack.name}</span>
                        {#if p.sourceAlbumName !== a.name}
                          <span class="scan-album-hint">{p.sourceAlbumName}</span>
                        {/if}
                      </span>
                      <span class="scan-pair-arrow">↓</span>
                      <span class="scan-pair-target">
                        <span class="scan-track-name">{p.targetTrack.name}</span>
                        <span
                          class="scan-confidence"
                          class:scan-confidence--duplicate={p.confidence === 'duplicate'}
                          class:scan-confidence--position={p.confidence === 'position'}
                          title={CONFIDENCE_BADGES[p.confidence].title}
                        >{CONFIDENCE_BADGES[p.confidence].symbol}</span>
                      </span>
                    </span>
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </li>
      {/each}
    </ul>

    <div class="scan-footer">
      <button class="scan-apply" disabled={applying || totalChecked === 0} onclick={apply}>
        {applying ? 'Applying...' : `Apply ${totalChecked} merge${totalChecked !== 1 ? 's' : ''}`}
      </button>
    </div>
  {/if}
</div>

<style>
  .page-header {
    display: flex;
    align-items: baseline;
    gap: 1rem;
    margin-bottom: 1.5rem;
  }
  .page-header h1 { margin: 0; }
  .back-link {
    font-size: 0.85rem;
    color: var(--text-muted);
    text-decoration: none;
  }
  .back-link:hover { color: var(--accent); }

  .section-card { margin-bottom: 1.5rem; }

  .scan-controls {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    margin-bottom: 0.75rem;
  }
  .scan-select, .scan-btn {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text);
    font-size: 0.85rem;
    font-family: inherit;
    padding: 0.35rem 0.7rem;
    cursor: pointer;
  }
  .scan-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
  .scan-btn:disabled, .scan-select:disabled { opacity: 0.5; cursor: wait; }

  .scan-error {
    color: #ff4444;
    background: rgba(255, 68, 68, 0.1);
    border-radius: var(--radius);
    padding: 0.5rem 0.75rem;
    font-size: 0.85rem;
    margin-bottom: 0.75rem;
  }
  .scan-result {
    color: var(--accent);
    background: rgba(29, 185, 84, 0.08);
    border-radius: var(--radius);
    padding: 0.5rem 0.75rem;
    font-size: 0.85rem;
    margin-bottom: 0.75rem;
  }
  .scan-skipped { color: var(--text-muted); margin-left: 0.4rem; }

  .scan-summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
    padding-bottom: 0.6rem;
    margin-bottom: 0.4rem;
    border-bottom: 1px solid var(--border);
  }
  .scan-count { font-size: 0.85rem; color: var(--text); }
  .scan-muted { color: var(--text-muted); }
  .scan-legend { display: flex; gap: 0.3rem; }

  .scan-chip {
    font-size: 0.72rem;
    font-family: inherit;
    padding: 0.15rem 0.45rem;
    border-radius: 3px;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
  }
  .scan-chip:hover { border-color: var(--accent); color: var(--accent); }
  .scan-chip--duplicate { color: #ffb02e; border-color: rgba(255, 176, 46, 0.35); }

  .scan-groups, .scan-pairs {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .scan-group { border-bottom: 1px solid var(--border); }
  .scan-group:last-child { border-bottom: none; }

  .scan-group-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .scan-group-toggle {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex: 1;
    min-width: 0;
    padding: 0.45rem 0;
    background: none;
    border: none;
    color: var(--text);
    font-family: inherit;
    font-size: 0.85rem;
    text-align: left;
    cursor: pointer;
  }
  .scan-group-toggle:hover .scan-group-name { color: var(--accent); }

  .scan-chevron {
    color: var(--text-muted);
    font-size: 0.7rem;
    width: 0.8rem;
    flex-shrink: 0;
  }

  .scan-thumb {
    width: 28px;
    height: 28px;
    border-radius: var(--radius);
    object-fit: cover;
    flex-shrink: 0;
  }
  .scan-thumb--empty { background: var(--border); }

  .scan-group-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .scan-group-plays {
    font-size: 0.75rem;
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .scan-group-count {
    font-size: 0.75rem;
    font-family: inherit;
    padding: 0.15rem 0.45rem;
    border-radius: 3px;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    flex-shrink: 0;
  }
  .scan-group-count--active {
    border-color: var(--accent);
    color: var(--accent);
  }

  .scan-pairs { padding: 0 0 0.4rem 1.3rem; }

  .scan-pair {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    width: 100%;
    padding: 0.3rem 0.4rem;
    border: none;
    border-radius: var(--radius);
    background: transparent;
    color: var(--text);
    font-family: inherit;
    text-align: left;
    cursor: pointer;
  }
  .scan-pair:hover { background: var(--bg-hover); }
  .scan-pair--checked { background: rgba(29, 185, 84, 0.06); }

  .scan-check {
    width: 16px;
    height: 16px;
    margin-top: 2px;
    border: 2px solid var(--border);
    border-radius: var(--radius);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.6rem;
    flex-shrink: 0;
  }
  .scan-check--active {
    border-color: var(--accent);
    background: var(--accent);
    color: #000;
    font-weight: 700;
  }

  .scan-pair-body { flex: 1; min-width: 0; }
  .scan-pair-source, .scan-pair-target {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.8rem;
  }
  .scan-pair-target { color: var(--accent); font-size: 0.76rem; }
  .scan-pair-arrow {
    display: block;
    font-size: 0.6rem;
    color: var(--text-muted);
    line-height: 1;
  }

  .scan-track-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .scan-album-hint {
    font-size: 0.7rem;
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .scan-confidence {
    font-size: 0.62rem;
    padding: 0.05rem 0.28rem;
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.08);
    color: var(--text-muted);
    flex-shrink: 0;
  }
  .scan-confidence--position { background: rgba(29, 185, 84, 0.15); color: var(--accent); }
  .scan-confidence--duplicate { background: rgba(255, 176, 46, 0.15); color: #ffb02e; }

  .scan-footer {
    margin-top: 0.9rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--border);
  }
  .scan-apply {
    width: 100%;
    padding: 0.6rem;
    background: var(--accent);
    color: #000;
    border: none;
    border-radius: var(--radius);
    font-weight: 600;
    font-size: 0.9rem;
    font-family: inherit;
    cursor: pointer;
  }
  .scan-apply:hover:not(:disabled) { opacity: 0.9; }
  .scan-apply:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
