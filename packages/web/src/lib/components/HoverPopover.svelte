<script lang="ts">
  // Popover compartido de los badges del hero (records, directos): un trigger de
  // 32px y un panel que se abre al pasar el ratón por encima, con el click como
  // alternativa accesible y como única vía en táctil.
  //
  // Los estilos del contenido (.popover-title, .popover-row…) se declaran aquí
  // como :global porque el markup llega por snippet desde el consumidor y por
  // tanto lleva SU hash de scope, no el de este componente.
  import { browser } from '$app/environment';
  import type { Snippet } from 'svelte';

  let {
    label,
    tone = 'accent',
    idleTone = false,
    open = $bindable(false),
    trigger,
    children,
  }: {
    label: string;
    // color de foco del trigger; el panel es siempre igual
    tone?: 'accent' | 'gold';
    // pinta el trigger con el tono ya en reposo, no sólo al abrirse
    idleTone?: boolean;
    open?: boolean;
    trigger: Snippet;
    children: Snippet;
  } = $props();

  let rootEl: HTMLElement | undefined = $state();

  // hover-abrir solo con puntero real (ratón); en táctil el toggle del click manda,
  // si no, el primer tap dispara mouseenter+click y se necesitan dos taps
  function handlePointerEnter(e: PointerEvent) {
    if (e.pointerType === 'touch') return;
    open = true;
  }
  function handlePointerLeave(e: PointerEvent) {
    if (e.pointerType === 'touch') return;
    open = false;
  }

  function handleOutside(e: PointerEvent) {
    if (rootEl && !rootEl.contains(e.target as Node)) open = false;
  }

  function handleKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && open) open = false;
  }

  $effect(() => {
    if (!browser || !open) return;
    document.addEventListener('pointerdown', handleOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('pointerdown', handleOutside);
      document.removeEventListener('keydown', handleKey);
    };
  });
</script>

<!-- el control accesible es el botón; el div sólo capta el hover del ratón -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="hover-root"
  class:hover-root--gold={tone === 'gold'}
  bind:this={rootEl}
  onpointerenter={handlePointerEnter}
  onpointerleave={handlePointerLeave}
>
  <button
    type="button"
    class="hover-trigger"
    class:hover-trigger--open={open}
    class:hover-trigger--idle-tone={idleTone}
    aria-expanded={open}
    aria-haspopup="true"
    aria-label={label}
    title={label}
    onclick={() => (open = !open)}
  >
    {@render trigger()}
  </button>

  {#if open}
    <div class="hover-popover" role="region" aria-label={label}>
      {@render children()}
    </div>
  {/if}
</div>

<style>
  .hover-root {
    --hover-tone: var(--accent);
    --hover-tone-soft: rgba(29, 185, 84, 0.08);
    position: relative;
    flex-shrink: 0;
    align-self: center;
  }
  .hover-root--gold {
    --hover-tone: #f5a623;
    --hover-tone-soft: rgba(245, 166, 35, 0.08);
  }

  .hover-trigger {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    height: 32px;
    padding: 0 0.45rem;
    border-radius: var(--radius);
    background: none;
    border: 1px solid var(--border);
    color: var(--text-muted);
    font: inherit;
    cursor: pointer;
    transition: color 0.05s, border-color 0.05s, background 0.05s;
  }
  .hover-trigger--idle-tone {
    color: var(--hover-tone);
  }
  .hover-trigger:hover,
  .hover-trigger--open {
    color: var(--hover-tone);
    border-color: var(--hover-tone);
    background: var(--hover-tone-soft);
  }

  .hover-popover {
    position: absolute;
    top: calc(100% + 0.4rem);
    right: 0;
    z-index: 30;
    min-width: 260px;
    max-width: min(320px, 90vw);
    padding: 0.5rem;
    border-radius: var(--radius);
    background: var(--bg-card);
    border: 1px solid rgba(29, 185, 84, 0.25);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
    animation: hover-pop 0.14s ease-out;
  }
  /* puente invisible que evita cerrar el popover al moverse del trigger al contenido */
  .hover-popover::before {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    top: -0.4rem;
    height: 0.4rem;
  }
  @keyframes hover-pop {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  /* --- contenido: clases compartidas por todos los consumidores --- */
  .hover-popover :global(.popover-title) {
    font-family: var(--font-mono);
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
    padding: 0.2rem 0.4rem 0.4rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    margin-bottom: 0.3rem;
  }
  .hover-popover :global(.popover-title--gap) {
    margin-top: 0.6rem;
  }
  .hover-popover :global(.popover-list) {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    max-height: 60vh;
    overflow-y: auto;
  }
  .hover-popover :global(.popover-row) {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0.35rem 0.4rem;
    border-radius: var(--radius);
    color: var(--text);
    text-decoration: none;
  }
  .hover-popover :global(.popover-row--link) {
    cursor: pointer;
    transition: background 0.05s;
  }
  .hover-popover :global(.popover-row--link:hover) {
    background: rgba(29, 185, 84, 0.1);
  }
  .hover-popover :global(.popover-label) {
    font-size: 0.8rem;
    color: var(--text-muted);
    flex: 1;
    min-width: 0;
  }
  .hover-popover :global(.popover-value) {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--text);
    margin-left: auto;
    white-space: nowrap;
  }

  @media (max-width: 768px) {
    .hover-popover {
      right: 50%;
      transform: translateX(50%);
      max-width: min(320px, calc(100vw - 2rem));
      animation-name: hover-pop-mobile;
    }
  }
  @keyframes hover-pop-mobile {
    from { opacity: 0; transform: translate(50%, -4px); }
    to { opacity: 1; transform: translate(50%, 0); }
  }
</style>
