<script lang="ts">
  import { onMount } from 'svelte';
  import { api, type MergeRule } from '$lib/api';

  let merges = $state<MergeRule[]>([]);
  let mergeSearch = $state('');
  let loading = $state(true);

  async function loadMerges() {
    try { merges = await api.listMerges(); } catch { merges = []; }
  }

  async function removeMerge(id: number) {
    await api.deleteMerge(id);
    await loadMerges();
  }

  const MERGE_TYPE_ORDER: Record<string, number> = { artist: 0, album: 1, track: 2 };
  type MergeGroup = { artistId: string; artistName: string; artistImage: string | null; merges: MergeRule[] };
  function groupMergesByArtist(rules: MergeRule[], term: string): MergeGroup[] {
    const normStr = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const filtered = term
      ? rules.filter(m =>
          normStr(m.target_name).includes(term) ||
          normStr(m.source_name).includes(term) ||
          normStr(m.artist_name ?? '').includes(term))
      : rules;
    const groups = new Map<string, MergeGroup>();
    for (const m of filtered) {
      const [aId, aName, aImg] = m.entity_type === 'artist'
        ? [m.target_id, m.target_name, m.target_image]
        : [m.artist_id ?? 'unknown', m.artist_name ?? 'Unknown', m.artist_image];
      if (!groups.has(aId)) groups.set(aId, { artistId: aId, artistName: aName, artistImage: aImg, merges: [] });
      groups.get(aId)!.merges.push(m);
    }
    for (const g of groups.values()) {
      g.merges.sort((a, b) => {
        const t = (MERGE_TYPE_ORDER[a.entity_type] ?? 9) - (MERGE_TYPE_ORDER[b.entity_type] ?? 9);
        if (t !== 0) return t;
        const tn = a.target_name.localeCompare(b.target_name);
        if (tn !== 0) return tn;
        return a.source_name.localeCompare(b.source_name);
      });
    }
    return [...groups.values()].sort((a, b) => a.artistName.localeCompare(b.artistName));
  }

  let expandedArtists = $state<Set<string>>(new Set());
  function toggleArtist(id: string) {
    const next = new Set(expandedArtists);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    expandedArtists = next;
  }

  onMount(async () => {
    await loadMerges();
    loading = false;
  });
</script>

<div class="page-header">
  <h1>Merges</h1>
  <a href="/settings" class="back-link">← Settings</a>
</div>

{#if loading}
  <div class="loading">
    <div class="spinner"></div>
  </div>
{:else if merges.length === 0}
  <div class="card">
    <p style="color: var(--text-muted);">No merge rules configured.</p>
  </div>
{:else}
  {@const term = mergeSearch.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')}
  {@const groups = groupMergesByArtist(merges, term)}
  <div class="card section-card">
    <div class="merge-header">
      <span class="merge-count">{merges.length} rule{merges.length !== 1 ? 's' : ''}</span>
      <input class="merge-search" type="text" placeholder="Filter merges..." bind:value={mergeSearch} />
    </div>
    {#if groups.length > 0}
      <ul class="merge-groups">
        {#each groups as g}
          {@const open = term.length > 0 || expandedArtists.has(g.artistId)}
          <li class="merge-group" class:merge-group--open={open}>
            <button class="merge-group-header" onclick={() => toggleArtist(g.artistId)} aria-expanded={open}>
              <span class="merge-chevron">{open ? '▾' : '▸'}</span>
              {#if g.artistImage}
                <img class="merge-group-avatar" src={g.artistImage} alt="" />
              {:else}
                <div class="merge-group-avatar merge-group-avatar--empty"></div>
              {/if}
              <span class="merge-group-name">{g.artistName}</span>
              <span class="merge-group-count">{g.merges.length}</span>
            </button>
            {#if open}
              <ul class="merge-flat">
                {#each g.merges as m}
                  {@const round = m.entity_type === 'artist'}
                  <li class="merge-row">
                    <span class="merge-type-pill merge-type-pill--{m.entity_type}" title={m.entity_type}>{m.entity_type[0].toUpperCase()}</span>
                    <a class="merge-side" href="/{m.entity_type}/{m.source_id}" title={m.source_name}>
                      {#if m.source_image}
                        <img class="merge-flat-thumb" class:merge-flat-thumb--round={round} src={m.source_image} alt="" />
                      {:else}
                        <div class="merge-flat-thumb" class:merge-flat-thumb--round={round} class:merge-flat-thumb--empty={true}></div>
                      {/if}
                      <span class="merge-flat-name">{m.source_name}</span>
                    </a>
                    <span class="merge-arrow">→</span>
                    <a class="merge-side" href="/{m.entity_type}/{m.target_id}" title={m.target_name}>
                      {#if m.target_image}
                        <img class="merge-flat-thumb" class:merge-flat-thumb--round={round} src={m.target_image} alt="" />
                      {:else}
                        <div class="merge-flat-thumb" class:merge-flat-thumb--round={round} class:merge-flat-thumb--empty={true}></div>
                      {/if}
                      <span class="merge-flat-name">{m.target_name}</span>
                    </a>
                    <button class="merge-flat-unmerge" title="Unmerge" onclick={() => removeMerge(m.id)}>&times;</button>
                  </li>
                {/each}
              </ul>
            {/if}
          </li>
        {/each}
      </ul>
    {:else}
      <p style="color: var(--text-muted); padding: 0.5rem 0;">No merges match your filter.</p>
    {/if}
  </div>
{/if}

<style>
  .page-header {
    display: flex;
    align-items: baseline;
    gap: 1rem;
    margin-bottom: 1.5rem;
  }
  .page-header h1 {
    margin: 0;
  }
  .back-link {
    font-size: 0.85rem;
    color: var(--text-muted);
    text-decoration: none;
  }
  .back-link:hover {
    color: var(--accent);
  }

  .section-card {
    margin-bottom: 1.5rem;
  }

  .merge-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 0.75rem;
  }
  .merge-count {
    font-size: 0.85rem;
    color: var(--text-muted);
  }
  .merge-search {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text);
    font-size: 0.85rem;
    padding: 0.35rem 0.7rem;
    outline: none;
    width: 180px;
    transition: border-color 0.05s;
  }
  .merge-search:focus {
    border-color: var(--accent);
  }
  .merge-search::placeholder {
    color: var(--text-muted);
  }

  .merge-groups {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }
  .merge-group + .merge-group {
    border-top: 1px solid var(--border);
  }
  .merge-group-header {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    width: 100%;
    padding: 0.45rem 0;
    background: transparent;
    border: none;
    color: var(--text);
    cursor: pointer;
    text-align: left;
  }
  .merge-group-header:hover { color: var(--accent); }
  .merge-chevron {
    color: var(--text-muted);
    font-size: 0.75rem;
    width: 0.9rem;
    flex-shrink: 0;
  }
  .merge-group-avatar {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
  }
  .merge-group-avatar--empty { background: var(--border); }
  .merge-group-name {
    font-size: 0.9rem;
    font-weight: 600;
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .merge-group-count {
    color: var(--text-muted);
    font-size: 0.72rem;
    padding: 0.1rem 0.5rem;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 999px;
    flex-shrink: 0;
  }

  .merge-flat {
    list-style: none;
    margin: 0 0 0.4rem 2.25rem;
    padding: 0;
    display: flex;
    flex-direction: column;
  }
  .merge-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.2rem 0;
    font-size: 0.85rem;
    min-width: 0;
  }
  .merge-type-pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: var(--radius);
    font-size: 0.65rem;
    font-weight: 700;
    color: var(--text);
    background: var(--bg);
    border: 1px solid var(--border);
    flex-shrink: 0;
  }
  .merge-type-pill--artist { color: #a76bff; border-color: rgba(167, 107, 255, 0.4); }
  .merge-type-pill--album  { color: var(--accent); border-color: rgba(29, 185, 84, 0.4); }
  .merge-type-pill--track  { color: #ffaa00; border-color: rgba(255, 170, 0, 0.4); }

  .merge-side {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    text-decoration: none;
    color: var(--text);
    min-width: 0;
    flex: 1 1 0;
    overflow: hidden;
  }
  .merge-side:hover { color: var(--accent); }

  .merge-flat-thumb {
    width: 20px;
    height: 20px;
    border-radius: var(--radius);
    object-fit: cover;
    flex-shrink: 0;
  }
  .merge-flat-thumb--round { border-radius: 50%; }
  .merge-flat-thumb--empty { background: var(--border); }

  .merge-flat-name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  .merge-arrow {
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .merge-flat-unmerge {
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 1rem;
    cursor: pointer;
    padding: 0 0.3rem;
    line-height: 1;
    flex-shrink: 0;
    opacity: 0;
    transition: opacity 0.05s, color 0.05s;
  }
  .merge-row:hover .merge-flat-unmerge { opacity: 1; }
  .merge-flat-unmerge:hover { color: #ff4444; }
</style>
