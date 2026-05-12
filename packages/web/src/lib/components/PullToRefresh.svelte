<script lang="ts">
  let { onrefresh }: { onrefresh: () => Promise<void> } = $props();

  let pulling = $state(false);
  let pullY = $state(0);
  let refreshing = $state(false);
  let startY = 0;
  let tracking = false;

  const THRESHOLD = 80;

  function onTouchStart(e: TouchEvent) {
    if (refreshing) return;
    if (window.scrollY > 0) return;
    startY = e.touches[0].clientY;
    tracking = true;
    pulling = false;
    pullY = 0;
  }

  function onTouchMove(e: TouchEvent) {
    if (!tracking || refreshing) return;
    const dy = e.touches[0].clientY - startY;
    if (dy < 0) { tracking = false; pulling = false; pullY = 0; return; }
    pulling = true;
    pullY = Math.min(dy * 0.4, THRESHOLD * 1.5);
  }

  async function onTouchEnd() {
    if (!tracking && !pulling) return;
    tracking = false;
    if (pullY >= THRESHOLD && !refreshing) {
      refreshing = true;
      pullY = THRESHOLD * 0.6;
      try { await onrefresh(); } catch {}
      refreshing = false;
    }
    pulling = false;
    pullY = 0;
  }
</script>

<svelte:window ontouchstart={onTouchStart} ontouchmove={onTouchMove} ontouchend={onTouchEnd} />

{#if pullY > 0 || refreshing}
  <div class="ptr-indicator" style="height:{pullY}px">
    <div class="ptr-spinner" class:ptr-spinner--active={refreshing} style="opacity:{Math.min(pullY / THRESHOLD, 1)}">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="1 4 1 10 7 10" />
        <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
      </svg>
    </div>
  </div>
{/if}

<slot />

<style>
  .ptr-indicator {
    display: flex;
    align-items: flex-end;
    justify-content: center;
    overflow: hidden;
    padding-bottom: 0.5rem;
  }
  .ptr-spinner {
    color: var(--accent);
    transition: opacity 0.1s;
  }
  .ptr-spinner--active {
    animation: ptr-spin 0.8s linear infinite;
  }
  @keyframes ptr-spin {
    to { transform: rotate(360deg); }
  }
</style>
