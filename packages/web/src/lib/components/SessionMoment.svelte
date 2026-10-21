<script lang="ts">
  // momentos de la sesión en el móvil: cuando un play aterriza y sube un puesto, una
  // tarjeta asoma sobre el mini player unos segundos (quién, cuánto, a quién adelanta).
  // No hay banda fija: en reposo no ocupa nada, y la lista entera está en la hoja.
  // Los lotes los calcula projectionsStore (rankMoments) contra su respuesta anterior
  import { untrack } from 'svelte';
  import { projectionsStore } from '$lib/stores/projections.svelte';
  import { type RankMoment } from '$lib/utils/session-ranks';
  import RankChange from './RankChange.svelte';

  let { onopen }: { onopen: () => void } = $props();

  const MOMENT_MS = 5_000; // lo que se queda cada tarjeta
  const QUEUE_MAX = 6; // varios plays seguidos no pueden encadenar un minuto de tarjetas
  const RANGE_LONG: Record<string, string> = { all: 'All-time', thisYear: 'This year' };

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
            <RankChange rankChange={current.from - current.to} isNew={false} live />
            <span class="session-moment-rank">#{current.from}→#{current.to}</span>
          </span>
          <span class="session-moment-sub">
            {RANGE_LONG[current.range] ?? current.range}{#if current.passed.length > 0}{' · passed '}<span class="session-moment-who">{current.passed[0].name}</span>{#if current.passed.length > 1}{' '}+{current.passed.length - 1}{/if}{/if}
          </span>
        </span>
        {#if queue.length > 1}<span class="session-moment-more">+{queue.length - 1}</span>{/if}
        <span class="session-moment-timer" style:animation-duration="{MOMENT_MS}ms"></span>
      </button>
    {/key}
  {/if}
</div>

<style>
  /* sin caja propia en el flujo: se ancla al panel inferior fijo (.sidebar en
     móvil) y asoma por encima de él, sobre el contenido */
  .session-moment-wrap {
    position: absolute;
    left: max(0.5rem, var(--safe-left));
    right: max(0.5rem, var(--safe-right));
    bottom: calc(100% + 0.5rem);
    pointer-events: none;
  }

  .session-moment {
    position: relative;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    width: 100%;
    padding: 0.55rem 0.65rem 0.65rem;
    overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--info) 25%, transparent);
    border-radius: var(--radius);
    background: color-mix(in srgb, var(--info) 10%, var(--bg-card));
    box-shadow: 0 10px 26px -6px color-mix(in srgb, var(--shadow-color) 55%, transparent);
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
    pointer-events: auto;
    animation: session-moment-in 0.2s ease-out;
  }

  @keyframes session-moment-in {
    from { opacity: 0; transform: translateY(10px); }
  }

  .session-moment-img {
    width: 36px;
    height: 36px;
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
    gap: 3px;
  }

  .session-moment-head {
    display: flex;
    align-items: center;
    gap: 0.4rem;
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
    font-size: var(--fs-xs);
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

  /* lo que le queda a la tarjeta, vaciándose */
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
