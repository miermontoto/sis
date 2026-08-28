<script lang="ts">
  // widget de valoración de álbum: estrellas enteras (sin medias) + review opcional.
  // guarda al hacer click (optimista vía respuesta del server); el × elimina la
  // valoración entera, review incluida.
  import { api, ALBUM_RATING_MAX, ALBUM_REVIEW_MAX_CHARS, type AlbumRating } from '$lib/api';
  import IconStar from '$lib/icons/IconStar.svelte';

  let { albumId, initial }: { albumId: string; initial: AlbumRating | null } = $props();

  let current = $state<AlbumRating | null>(null);
  let hover = $state<number | null>(null);
  let editing = $state(false);
  let draft = $state('');
  let saving = $state(false);

  const stars = Array.from({ length: ALBUM_RATING_MAX }, (_, i) => i + 1);

  // resync con el server cuando cambia el álbum o llega un detail nuevo
  $effect(() => {
    albumId;
    current = initial;
    editing = false;
    hover = null;
  });

  let shown = $derived(hover ?? current?.rating ?? 0);

  async function setRating(value: number) {
    if (saving || value === current?.rating) return;
    saving = true;
    try {
      current = await api.setAlbumRating(albumId, value, current?.review ?? null);
    } finally {
      saving = false;
    }
  }

  async function clearRating() {
    if (saving || !current) return;
    saving = true;
    try {
      await api.deleteAlbumRating(albumId);
      current = null;
      editing = false;
    } finally {
      saving = false;
    }
  }

  function startEdit() {
    draft = current?.review ?? '';
    editing = true;
  }

  async function saveReview() {
    if (saving || !current) return;
    saving = true;
    try {
      current = await api.setAlbumRating(albumId, current.rating, draft.trim() || null);
      editing = false;
    } finally {
      saving = false;
    }
  }
</script>

<div class="album-rating">
  <!-- el mouseleave solo resetea el preview de hover, una mejora mouse-only:
       cada estrella ya es un botón accesible que limpia el preview en blur -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="rating-stars" onmouseleave={() => (hover = null)}>
    {#each stars as value (value)}
      <button
        class="star"
        class:star--filled={value <= shown}
        disabled={saving}
        onmouseenter={() => (hover = value)}
        onfocus={() => (hover = value)}
        onblur={() => (hover = null)}
        onclick={() => setRating(value)}
        aria-label="Rate {value} star{value === 1 ? '' : 's'}"
        title="{value} star{value === 1 ? '' : 's'}"
      >
        <IconStar size={16} filled={value <= shown} />
      </button>
    {/each}
    {#if current}
      <button class="rating-clear" disabled={saving} onclick={clearRating} aria-label="Remove rating" title="Remove rating">&times;</button>
    {/if}
  </div>

  {#if current}
    {#if editing}
      <div class="review-editor">
        <!-- el editor solo se abre por acción explícita del usuario: el autofocus no roba foco -->
        <!-- svelte-ignore a11y_autofocus -->
        <textarea bind:value={draft} rows="3" maxlength={ALBUM_REVIEW_MAX_CHARS} placeholder="Write a review…" autofocus></textarea>
        <div class="review-actions">
          <button class="review-save" disabled={saving} onclick={saveReview}>Save</button>
          <button class="review-cancel" disabled={saving} onclick={() => (editing = false)}>Cancel</button>
        </div>
      </div>
    {:else if current.review}
      <button class="review-text" onclick={startEdit} title="Edit review">{current.review}</button>
    {:else}
      <button class="review-add" onclick={startEdit}>+ Add review</button>
    {/if}
  {/if}
</div>

<style>
  .album-rating {
    margin-top: 0.4rem;
    max-width: 480px;
  }
  .rating-stars {
    display: flex;
    align-items: center;
    gap: 1px;
  }
  .star {
    background: none;
    border: none;
    padding: 2px;
    cursor: pointer;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    transition: color 0.05s, transform 0.05s;
  }
  .star:hover {
    transform: scale(1.15);
  }
  .star--filled {
    color: var(--accent);
  }
  .star:disabled {
    cursor: default;
    opacity: 0.6;
  }
  .rating-clear {
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 0.95rem;
    line-height: 1;
    padding: 2px 4px;
    margin-left: 0.15rem;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.05s, color 0.05s;
  }
  .rating-stars:hover .rating-clear,
  .rating-clear:focus-visible {
    opacity: 1;
  }
  .rating-clear:hover {
    color: var(--text);
  }
  .review-text {
    display: block;
    background: none;
    border: none;
    padding: 0;
    margin-top: 0.3rem;
    color: var(--text-muted);
    font: inherit;
    font-size: 0.82rem;
    font-style: italic;
    line-height: 1.4;
    text-align: left;
    cursor: pointer;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .review-text:hover {
    color: var(--text);
  }
  .review-add {
    background: none;
    border: none;
    padding: 0;
    margin-top: 0.2rem;
    color: var(--text-muted);
    font: inherit;
    font-size: 0.78rem;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.05s, color 0.05s;
  }
  .album-rating:hover .review-add,
  .review-add:focus-visible {
    opacity: 1;
  }
  .review-add:hover {
    color: var(--accent);
  }
  .review-editor {
    margin-top: 0.35rem;
  }
  .review-editor textarea {
    width: 100%;
    resize: vertical;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text);
    font: inherit;
    font-size: 0.82rem;
    padding: 0.45rem 0.55rem;
  }
  .review-editor textarea:focus {
    outline: none;
    border-color: var(--accent);
  }
  .review-actions {
    display: flex;
    gap: 0.4rem;
    margin-top: 0.3rem;
  }
  .review-actions button {
    border: 1px solid var(--border);
    background: var(--bg-card);
    color: var(--text-muted);
    border-radius: var(--radius);
    padding: 0.2rem 0.7rem;
    font: inherit;
    font-size: 0.78rem;
    cursor: pointer;
    transition: all 0.05s;
  }
  .review-actions button:hover:not(:disabled) {
    color: var(--text);
    border-color: var(--text-muted);
  }
  .review-actions .review-save {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
  .review-actions .review-save:hover:not(:disabled) {
    opacity: 0.85;
  }
  .review-actions button:disabled {
    opacity: 0.6;
    cursor: default;
  }
</style>
