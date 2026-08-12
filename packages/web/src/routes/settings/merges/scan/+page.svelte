<script lang="ts">
  import { errorMessage } from '$lib/utils/errors';
  import { onMount } from 'svelte';
  import { api, type BulkRemergePreview, type BulkRemergeAlbum, type AlbumMergeTrack, type RemergeConfidence, type MergeImpact } from '$lib/api';
  import { formatDuration, formatNumber } from '$lib/utils/format';
  import MergeImpactBar from '$lib/components/MergeImpactBar.svelte';

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

  // marcados: `${albumId}:${trackId}` de cada miembro que se fusiona en el canónico de su grupo
  let checked = $state<Set<string>>(new Set());
  let expanded = $state<Set<string>>(new Set());
  // canónico elegido a mano por grupo (`${albumId}:${targetOriginal}`), para invertir el par
  let canonicalOverride = $state<Map<string, string>>(new Map());
  let impact = $state<MergeImpact | null>(null);

  const memberKey = (albumId: string, trackId: string) => `${albumId}:${trackId}`;

  interface GroupMember { track: AlbumMergeTrack; confidence: RemergeConfidence; sourceAlbumName: string }
  interface ScanGroup { key: string; canonical: GroupMember; members: GroupMember[] }

  // los pares que comparten target son en realidad UN grupo: varios duplicados cayendo en el
  // mismo canónico. Se modela así para poder invertir la dirección sin encadenar merges
  // (si sólo se girase un par, sus hermanos quedarían apuntando a un source).
  function groupsFor(a: BulkRemergeAlbum): ScanGroup[] {
    const byTarget = new Map<string, { target: AlbumMergeTrack; members: GroupMember[] }>();
    for (const p of a.pairs) {
      const g = byTarget.get(p.targetTrack.id) ?? { target: p.targetTrack, members: [] };
      g.members.push({ track: p.sourceTrack, confidence: p.confidence, sourceAlbumName: p.sourceAlbumName });
      byTarget.set(p.targetTrack.id, g);
    }
    return [...byTarget.entries()].map(([targetId, g]) => {
      const key = memberKey(a.id, targetId);
      const all: GroupMember[] = [
        { track: g.target, confidence: g.members[0].confidence, sourceAlbumName: a.name },
        ...g.members,
      ];
      const canonicalId = canonicalOverride.get(key) ?? targetId;
      const canonical = all.find(m => m.track.id === canonicalId) ?? all[0];
      return { key, canonical, members: all.filter(m => m.track.id !== canonical.track.id) };
    });
  }

  let albumGroups = $derived(new Map((data?.albums ?? []).map(a => [a.id, groupsFor(a)])));

  // pares efectivos: cada miembro marcado se fusiona en el canónico ACTUAL de su grupo
  let effectivePairs = $derived.by(() => {
    const seen = new Set<string>();
    const out: { sourceId: string; targetId: string }[] = [];
    for (const a of data?.albums ?? []) {
      for (const g of albumGroups.get(a.id) ?? []) {
        for (const m of g.members) {
          if (!checked.has(memberKey(a.id, m.track.id)) || seen.has(m.track.id)) continue;
          seen.add(m.track.id);
          out.push({ sourceId: m.track.id, targetId: g.canonical.track.id });
        }
      }
    }
    return out;
  });

  let totalChecked = $derived(effectivePairs.length);
  let impactById = $derived(new Map((impact?.items ?? []).map(i => [i.id, i])));

  let byConfidence = $derived.by(() => {
    const out: Record<string, number> = { duplicate: 0, name: 0, position: 0 };
    for (const a of data?.albums ?? []) for (const p of a.pairs) out[p.confidence]++;
    return out;
  });

  const albumMembers = (a: BulkRemergeAlbum) => (albumGroups.get(a.id) ?? []).flatMap(g => g.members);
  const albumChecked = (a: BulkRemergeAlbum) =>
    albumMembers(a).filter(m => checked.has(memberKey(a.id, m.track.id))).length;

  // `keepResult` conserva la confirmación del apply: el rescan posterior la borraba en el
  // mismo tick en que se creaba, y parecía que aplicar no hacía nada
  // `fresh` salta el cache: lo piden el botón Rescan, el cambio de alcance y el rescan de
  // después de aplicar. La primera carga sí usa cache para que la página abra al instante.
  async function scan(keepResult = false, fresh = false) {
    loading = true;
    error = '';
    if (!keepResult) result = null;
    try {
      const preview = await api.bulkRemergePreview(scope, fresh ? new AbortController().signal : undefined);
      data = preview;
      checked = new Set(
        preview.albums.flatMap(a => a.pairs
          .filter(p => p.confidence === AUTO_CHECKED)
          .map(p => memberKey(a.id, p.sourceTrack.id)))
      );
      canonicalOverride = new Map();
      expanded = new Set();
    } catch (e) {
      error = errorMessage(e, 'Error scanning albums');
      data = null;
    } finally {
      loading = false;
    }
  }

  const rescan = () => scan(false, true);

  function toggleMember(albumId: string, trackId: string) {
    const k = memberKey(albumId, trackId);
    const next = new Set(checked);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    checked = next;
  }

  // invierte la dirección: el miembro pasa a ser el canónico del grupo y el canónico
  // anterior baja a miembro, heredando su estado de marcado
  function makeGroupCanonical(albumId: string, g: ScanGroup, trackId: string) {
    const next = new Map(canonicalOverride);
    next.set(g.key, trackId);
    canonicalOverride = next;

    const marks = new Set(checked);
    const wasChecked = marks.has(memberKey(albumId, trackId));
    marks.delete(memberKey(albumId, trackId));
    if (wasChecked) marks.add(memberKey(albumId, g.canonical.track.id));
    checked = marks;
  }

  function toggleAlbum(a: BulkRemergeAlbum) {
    const members = albumMembers(a);
    const all = albumChecked(a) === members.length;
    const next = new Set(checked);
    for (const m of members) {
      if (all) next.delete(memberKey(a.id, m.track.id));
      else next.add(memberKey(a.id, m.track.id));
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
    const next = new Set<string>();
    for (const a of data?.albums ?? []) {
      for (const g of albumGroups.get(a.id) ?? []) {
        for (const m of g.members) {
          if (confidence !== null && m.confidence === confidence) next.add(memberKey(a.id, m.track.id));
        }
      }
    }
    checked = next;
  }

  const trackNames = $derived(new Map(
    (data?.albums ?? []).flatMap(a => a.pairs.flatMap(p => [
      [p.sourceTrack.id, p.sourceTrack.name] as const,
      [p.targetTrack.id, p.targetTrack.name] as const,
    ]))
  ));
  const nameOf = (id: string) => trackNames.get(id) ?? null;

  function formatDelta(item: { valueBefore: number; valueAfter: number }) {
    const delta = item.valueAfter - item.valueBefore;
    if (delta <= 0) return null;
    return impact?.metric === 'plays' ? `+${formatNumber(delta)} plays` : `+${formatDuration(delta)}`;
  }

  async function apply() {
    if (totalChecked === 0) return;
    applying = true;
    error = '';
    try {
      result = await api.batchMergeTracks(effectivePairs.map(p => ({
        sourceTrackId: p.sourceId,
        targetTrackId: p.targetId,
      })));
      await scan(true, true);
    } catch (e) {
      error = errorMessage(e, 'Error applying merges');
    } finally {
      applying = false;
    }
  }

  onMount(() => { scan(); });
</script>

<div class="page-header">
  <h1>Scan for duplicates</h1>
  <a href="/settings/merges" class="back-link">← Merges</a>
</div>

<div class="card section-card">
  <div class="scan-controls">
    <select class="scan-select" bind:value={scope} onchange={rescan} disabled={loading || applying}>
      {#each SCOPES as s}
        <option value={s.value}>{s.label}</option>
      {/each}
    </select>
    <button class="scan-btn" onclick={rescan} disabled={loading || applying}>
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
              {#each albumGroups.get(a.id) ?? [] as g (g.key)}
                {#each g.members as m (m.track.id)}
                  {@const isChecked = checked.has(memberKey(a.id, m.track.id))}
                  {@const move = isChecked ? impactById.get(g.canonical.track.id) : undefined}
                  <li class="scan-pair-row">
                    <button class="scan-pair" class:scan-pair--checked={isChecked} onclick={() => toggleMember(a.id, m.track.id)}>
                      <span class="scan-check" class:scan-check--active={isChecked}>{#if isChecked}&#10003;{/if}</span>
                      <span class="scan-pair-body">
                        <span class="scan-pair-source">
                          <span class="scan-track-name">{m.track.name}</span>
                          {#if m.sourceAlbumName !== a.name}
                            <span class="scan-album-hint">{m.sourceAlbumName}</span>
                          {/if}
                        </span>
                        <span class="scan-pair-arrow">↓</span>
                        <span class="scan-pair-target">
                          <span class="scan-track-name">{g.canonical.track.name}</span>
                          <span
                            class="scan-confidence"
                            class:scan-confidence--duplicate={m.confidence === 'duplicate'}
                            class:scan-confidence--position={m.confidence === 'position'}
                            title={CONFIDENCE_BADGES[m.confidence].title}
                          >{CONFIDENCE_BADGES[m.confidence].symbol}</span>
                          {#if move && move.rankAfter !== null}
                            <span class="scan-move" title="Position in your all-time top tracks">
                              #{move.rankBefore ?? '—'} → #{move.rankAfter}
                              {#if formatDelta(move)}<span class="scan-move-delta">{formatDelta(move)}</span>{/if}
                            </span>
                          {/if}
                        </span>
                      </span>
                    </button>
                    <button
                      class="scan-swap"
                      title="Keep &quot;{m.track.name}&quot; instead and merge the other way"
                      onclick={() => makeGroupCanonical(a.id, g, m.track.id)}
                    >⇅</button>
                  </li>
                {/each}
              {/each}
            </ul>
          {/if}
        </li>
      {/each}
    </ul>

    <div class="scan-footer">
      <MergeImpactBar entityType="track" pairs={effectivePairs} {nameOf} bind:impact />
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

  .scan-pair-row {
    display: flex;
    align-items: flex-start;
    gap: 0.15rem;
  }
  .scan-pair-row .scan-pair { flex: 1; min-width: 0; }

  .scan-swap {
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 0.9rem;
    cursor: pointer;
    padding: 0.3rem 0.35rem;
    border-radius: var(--radius);
    line-height: 1;
    flex-shrink: 0;
    opacity: 0;
    transition: opacity 0.05s, color 0.05s;
  }
  .scan-pair-row:hover .scan-swap { opacity: 1; }
  .scan-swap:hover { color: var(--accent); }

  .scan-move {
    display: inline-flex;
    align-items: baseline;
    gap: 0.35rem;
    font-size: 0.7rem;
    color: #ffb02e;
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
  }
  .scan-move-delta { color: var(--text-muted); }

  .scan-footer {
    margin-top: 0.9rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
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
