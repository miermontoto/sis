<script lang="ts">
  // momentos de la sesión en el móvil: cuando un play aterriza y sube un puesto, un
  // bloque azul se pega encima del mini player unos segundos (quién, cuánto, a quién
  // adelanta), fundido con él como dos filas live contiguas: el mismo bloque azul +
  // verde que la sesión y la fila que suena en el escritorio. En reposo no ocupa
  // nada y la lista entera está en la hoja. Sólo salta con la app delante: lo que
  // sube sin nadie mirando lo cuenta projectionsStore (`away`) y lo dice el mini
  // player. Los lotes los calcula projectionsStore (rankMoments) contra su respuesta
  // anterior. `active` avisa al padre de que hay un bloque encima, para que la fila
  // ceda su borde de arriba
  import { untrack } from 'svelte';
  import { projectionsStore } from '$lib/stores/projections.svelte';
  import { rangeName, type RankMoment } from '$lib/utils/session-ranks';

  let { onopen, active = $bindable(false) }: { onopen: () => void; active?: boolean } = $props();

  const MOMENT_MS = 5_000; // lo que se queda cada bloque
  const QUEUE_MAX = 6; // varios plays seguidos no pueden encadenar un minuto de bloques

  let queue = $state<RankMoment[]>([]);
  let current = $derived(queue[0] ?? null);
  // un lote anterior al montaje ya pasó: no se repite al volver a montar
  let lastSeq = projectionsStore.moments?.seq ?? 0;

  $effect(() => {
    const batch = projectionsStore.moments;
    if (!batch || batch.seq <= lastSeq) return;
    lastSeq = batch.seq;
    untrack(() => { queue = [...queue, ...batch.items].slice(0, QUEUE_MAX); });
  });

  $effect(() => {
    if (!current) return;
    const id = setTimeout(() => { queue = queue.slice(1); }, MOMENT_MS);
    return () => clearTimeout(id);
  });

  $effect(() => {
    active = current !== null;
  });

  function open() {
    queue = [];
    onopen();
  }
</script>

<div class="session-moment-wrap" aria-live="polite">
  {#if current}
    {#key current.key}
      <button type="button" class="session-moment" onclick={open}>
        {#if current.imageUrl}
          <img class="session-moment-img" class:session-moment-img--round={current.entityType === 'artist'} src={current.imageUrl} alt="" />
        {/if}
        <span class="session-moment-text">
          <span class="session-moment-head">
            <span class="session-moment-name">{current.entityName}</span>
            <span class="session-moment-rank">{rangeName(current.range)} #{current.from}→#{current.to}</span>
          </span>
          {#if current.passed.length > 0}
            <span class="session-moment-sub">passed <span class="session-moment-who">{current.passed[0].name}</span>{#if current.passed.length > 1}{' '}+{current.passed.length - 1}{/if}</span>
          {/if}
        </span>
        {#if queue.length > 1}<span class="session-moment-more">+{queue.length - 1}</span>{/if}
        <span class="session-moment-timer" style:animation-duration="{MOMENT_MS}ms"></span>
      </button>
    {/key}
  {/if}
</div>

<style>
  /* sin caja propia en el flujo: se apoya en el filo de arriba de la fila del mini
     player (el padre la envuelve en una caja posicionada) y asoma sobre el contenido */
  .session-moment-wrap {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 100%;
    pointer-events: none;
  }

  /* opaco (mezclado con la tarjeta, no transparente): va encima de la página. el
     anillo azul cierra arriba y a los lados; abajo lo pone la fila, que es la que
     sigue */
  .session-moment {
    position: relative;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    width: 100%;
    padding: 0.45rem 0.5rem 0.55rem;
    overflow: hidden;
    border: none;
    border-radius: var(--radius) var(--radius) 0 0;
    background: color-mix(in srgb, var(--info) 10%, var(--bg-card));
    box-shadow:
      inset 1px 0 color-mix(in srgb, var(--info) 25%, transparent),
      inset -1px 0 color-mix(in srgb, var(--info) 25%, transparent),
      inset 0 1px color-mix(in srgb, var(--info) 25%, transparent),
      0 -10px 24px -12px color-mix(in srgb, var(--shadow-color) 55%, transparent);
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
    pointer-events: auto;
    animation: session-moment-in 0.2s ease-out;
  }

  @keyframes session-moment-in {
    from { opacity: 0; transform: translateY(6px); }
  }

  .session-moment-img {
    width: 28px;
    height: 28px;
    flex-shrink: 0;
    border-radius: var(--radius);
    object-fit: cover;
    background: var(--border);
  }

  .session-moment-img--round {
    border-radius: 50%;
  }

  .session-moment-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
    line-height: 1.3;
  }

  .session-moment-head {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    min-width: 0;
  }

  .session-moment-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--fs-md);
    font-weight: 600;
  }

  .session-moment-rank {
    flex-shrink: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-sm);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--accent);
  }

  .session-moment-sub {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
    letter-spacing: var(--track);
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .session-moment-who {
    color: var(--text);
  }

  .session-moment-more {
    flex-shrink: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
    color: var(--text-muted);
  }

  /* lo que le queda al bloque, vaciándose */
  .session-moment-timer {
    position: absolute;
    left: 0;
    bottom: 0;
    width: 100%;
    height: 2px;
    background: var(--info);
    transform-origin: left;
    animation: session-moment-drain linear forwards;
  }

  @keyframes session-moment-drain {
    to { transform: scaleX(0); }
  }

  @media (prefers-reduced-motion: reduce) {
    .session-moment {
      animation: none;
    }

    .session-moment-timer {
      display: none;
    }
  }
</style>
