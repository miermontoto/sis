<script lang="ts" module>
  // id de la sección: la cifra ★N del hero enlaza aquí
  export const REVIEW_ANCHOR = 'album-review';
</script>

<script lang="ts">
  // valoración de álbum (estrellas enteras, sin medias) + reseña opcional, como sección del
  // detalle (`review` en detail-layout). Vivía en el hero, en una fila de alto fijo con la
  // reseña en un popover: cargaba el hero en móvil y el texto sólo se leía en el tooltip.
  // El hero conserva la cifra (★N en su línea de meta) y enlaza aquí.
  // La valoración es de la página (viaja en el DTO del detalle): aquí sólo se edita y se
  // devuelve con onchange, para que la cifra del hero no se quede con la de antes
  import { api, ALBUM_RATING_MAX, ALBUM_REVIEW_MAX_CHARS, type AlbumRating } from '$lib/api';
  import IconStar from '$lib/icons/IconStar.svelte';
  import IconEdit from '$lib/icons/IconEdit.svelte';
  import { toastStore } from '$lib/stores/toast.svelte';
  import { errorMessage } from '$lib/utils/errors';

  let { albumId, rating, onchange }: {
    albumId: string;
    rating: AlbumRating | null;
    onchange: (rating: AlbumRating | null) => void;
  } = $props();

  let hover = $state<number | null>(null);
  let editing = $state(false);
  let draft = $state('');
  let saving = $state(false);

  const stars = Array.from({ length: ALBUM_RATING_MAX }, (_, i) => i + 1);

  // otro álbum: el editor abierto era del anterior
  $effect(() => {
    void albumId;
    editing = false;
    hover = null;
  });

  let shown = $derived(hover ?? rating?.rating ?? 0);

  // un fallo deja la valoración como estaba (y el editor abierto, con lo escrito)
  async function save(next: () => Promise<AlbumRating | null>) {
    if (saving) return;
    saving = true;
    try {
      onchange(await next());
      editing = false;
    } catch (e) {
      toastStore.show(errorMessage(e, 'Error saving the rating'));
    } finally {
      saving = false;
    }
  }

  const setRating = (value: number) =>
    value !== rating?.rating && save(() => api.setAlbumRating(albumId, value, rating?.review ?? null));

  // borrar la valoración se lleva la reseña (es la misma fila): con texto escrito, se pregunta
  function clearRating() {
    if (!rating || (rating.review && !confirm('Remove the rating and its review?'))) return;
    save(async () => { await api.deleteAlbumRating(albumId); return null; });
  }

  function openEditor() {
    draft = rating?.review ?? '';
    editing = true;
  }

  const saveReview = () => rating && save(() => api.setAlbumRating(albumId, rating.rating, draft.trim() || null));

  // ctrl/cmd+intro guarda y escape cancela, como cualquier editor de una línea más
  function handleKey(e: KeyboardEvent) {
    if (e.key === 'Escape') editing = false;
    else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveReview();
  }
</script>

<div class="section-header" id={REVIEW_ANCHOR}>
  <h2 class="section-title">Review</h2>
  {#if rating && !editing}
    <button class="show-all-btn" onclick={openEditor}>
      <IconEdit size={13} /> {rating.review ? 'Edit' : 'Write'}
    </button>
  {/if}
</div>

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
      <IconStar size={20} filled={value <= shown} />
    </button>
  {/each}
  {#if rating}
    <button class="rating-clear" disabled={saving} onclick={clearRating} aria-label="Remove rating" title="Remove rating">&times;</button>
  {:else}
    <span class="rating-hint">Not rated</span>
  {/if}
</div>

{#if editing && rating}
  <div class="review-editor">
    <!-- el editor solo se abre por acción explícita del usuario: el autofocus no roba foco -->
    <!-- svelte-ignore a11y_autofocus -->
    <textarea bind:value={draft} rows="4" maxlength={ALBUM_REVIEW_MAX_CHARS} placeholder="Write a review…" autofocus onkeydown={handleKey}></textarea>
    <div class="review-actions">
      <button class="review-save" disabled={saving} onclick={saveReview}>Save</button>
      <button class="review-cancel" disabled={saving} onclick={() => (editing = false)}>Cancel</button>
    </div>
  </div>
{:else if rating?.review}
  <p class="review-text">{rating.review}</p>
{/if}

<style>
  /* los botones de estrella llevan 2px de padding: el margen negativo deja la primera
     alineada con el título de la sección */
  .rating-stars {
    display: flex;
    align-items: center;
    gap: 2px;
    margin-left: -2px;
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
    font-size: var(--fs-lg);
    line-height: 1;
    padding: 2px 6px;
    margin-left: 0.25rem;
    cursor: pointer;
    transition: opacity 0.05s, color 0.05s;
  }
  /* con ratón aparece al pasar por las estrellas; en táctil no hay hover y se queda visible */
  @media (hover: hover) {
    .rating-clear { opacity: 0; }
    .rating-stars:hover .rating-clear,
    .rating-clear:focus-visible { opacity: 1; }
  }
  .rating-clear:hover {
    color: var(--text);
  }
  .rating-hint {
    margin-left: 0.5rem;
    color: var(--text-muted);
    font-size: var(--fs-sm);
  }
  .review-text {
    margin: 0.6rem 0 0;
    color: var(--text-secondary);
    line-height: 1.5;
    white-space: pre-line;
    overflow-wrap: anywhere;
  }
  .review-editor {
    margin-top: 0.6rem;
  }
  .review-editor textarea {
    width: 100%;
    resize: vertical;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text);
    font: inherit;
    font-size: var(--fs-sm);
    padding: 0.45rem 0.55rem;
  }
  /* esta regla gana al anti-zoom de base.css: en táctil, el suelo sin zoom de ios */
  @media (hover: none) {
    .review-editor textarea { font-size: var(--fs-input-touch); }
  }
  .review-editor textarea:focus {
    outline: none;
    border-color: var(--accent);
  }
  .review-actions {
    display: flex;
    gap: 0.4rem;
    margin-top: 0.35rem;
  }
  .review-actions button {
    border: 1px solid var(--border);
    background: var(--bg-card);
    color: var(--text-muted);
    border-radius: var(--radius);
    padding: 0.2rem 0.7rem;
    font: inherit;
    font-size: var(--fs-sm);
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
    color: var(--on-accent);
  }
  .review-actions .review-save:hover:not(:disabled) {
    opacity: 0.85;
  }
  .review-actions button:disabled {
    opacity: 0.6;
    cursor: default;
  }
</style>
