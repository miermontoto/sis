<script lang="ts">
  // carcasa de los dos modales del editor de widgets (galería y ajustes):
  // velo, panel, cabecera con cierre y Escape. role="dialog" + aria-modal es lo
  // que oculta la barra nativa de ios mientras está abierto (ver CLAUDE.md)
  import type { Snippet } from 'svelte';

  let { title, wide = false, onclose, children, footer }: {
    title: string;
    wide?: boolean;
    onclose: () => void;
    children: Snippet;
    footer?: Snippet;
  } = $props();

  // Escape en window y en captura: el foco puede no estar dentro (un botón del modal
  // que se quita al pulsarlo lo deja en <body>), y el modo edición de la rejilla
  // también escucha Escape para salir; éste cierra sólo el modal y corta ahí
  $effect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      onclose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  // el foco entra en el diálogo al abrirse (teclado y lectores de pantalla)
  let panel = $state<HTMLElement | null>(null);
  $effect(() => { panel?.focus(); });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
<!-- el clic en el velo es un atajo de ratón: Escape cierra igual -->
<div class="wm-overlay" onmousedown={(e) => { if (e.button === 0 && e.target === e.currentTarget) onclose(); }}>
  <div class="wm-panel" class:wm-panel--wide={wide} role="dialog" aria-modal="true" aria-label={title} tabindex="-1" bind:this={panel}>
    <div class="wm-header">
      <h3 class="section-title">{title}</h3>
      <button type="button" class="wm-close" onclick={onclose} aria-label="Close">&times;</button>
    </div>
    <div class="wm-body">{@render children()}</div>
    {#if footer}<div class="wm-footer">{@render footer()}</div>{/if}
  </div>
</div>

<style>
  .wm-overlay {
    position: fixed;
    inset: 0;
    background: var(--scrim);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
    padding: 1rem;
  }
  .wm-panel {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    width: min(460px, 100%);
    max-height: 88vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 1rem 3rem color-mix(in srgb, var(--shadow-color) 40%, transparent);
  }
  .wm-panel:focus { outline: none; }
  .wm-panel--wide {
    width: min(980px, 100%);
    height: min(720px, 88vh);
  }
  .wm-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.9rem 1rem 0;
  }
  .wm-header .section-title {
    margin: 0;
  }
  .wm-close {
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: var(--fs-xl);
    line-height: 1;
    cursor: pointer;
    padding: 0 0.2rem;
  }
  .wm-close:hover {
    color: var(--text);
  }
  .wm-body {
    padding: 0.9rem 1rem 1rem;
    overflow-y: auto;
    min-height: 0;
    flex: 1;
  }
  .wm-footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    border-top: 1px solid var(--border);
  }

  @media (max-width: 768px) {
    .wm-overlay {
      padding: 0;
      align-items: flex-end;
    }
    .wm-panel,
    .wm-panel--wide {
      width: 100%;
      height: auto;
      max-height: 92vh;
      border-radius: var(--radius) var(--radius) 0 0;
      padding-bottom: var(--safe-bottom, 0px);
    }
  }
</style>
