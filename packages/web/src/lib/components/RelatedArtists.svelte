<script lang="ts">
  // Sección de artistas relacionados (relación "soft"): vínculos declarados a mano que
  // no alteran las escuchas. Un artista mergeado no aparece aquí sino en MergeBanners.
  import type { RelatedArtist } from '$lib/api';

  let { artists, onManage }: { artists: RelatedArtist[]; onManage: () => void } = $props();
</script>

<div class="section-header">
  <h2 class="section-title">Related artists</h2>
  <button class="show-all-btn" onclick={onManage}>Manage</button>
</div>
<div class="related-list">
  {#each artists as artist (artist.id)}
    <a class="related-chip" href="/artist/{artist.id}" title={artist.name}>
      {#if artist.imageUrl}
        <img class="related-thumb" src={artist.imageUrl} alt="" />
      {:else}
        <div class="related-thumb related-thumb--empty"></div>
      {/if}
      <span class="related-name">{artist.name}</span>
    </a>
  {/each}
</div>

<style>
  .related-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-bottom: 1.5rem;
  }

  .related-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    max-width: 100%;
    padding: 0.25rem 0.7rem 0.25rem 0.25rem;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 999px;
    color: var(--text);
    text-decoration: none;
    font-size: 0.85rem;
    transition: border-color 0.05s, color 0.05s;
  }
  .related-chip:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .related-thumb {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
  }
  .related-thumb--empty { background: var(--border); }

  .related-name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
</style>
