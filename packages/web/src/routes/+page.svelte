<script lang="ts">
  // dashboard: rejilla de widgets configurable (lib/widgets), más dos avisos que no
  // son widgets porque no se eligen: los reports recién cerrados (descartables) y la
  // tarjeta de una cuenta sin plays. Cada widget pide sus datos; lo que comparten
  // varios (los días, el total, la racha) vive en widgets/daily-data
  import { onMount, onDestroy } from 'svelte';
  import { invalidateCache, getWeekStart } from '$lib/api';
  import { closedChartsStore } from '$lib/stores/closed-charts.svelte';
  import { shortcutStore } from '$lib/stores/keyboard-shortcuts.svelte';
  import { GRANULARITY_LABELS, periodDateRange } from '$lib/utils/report-periods';
  import IconChart from '$lib/icons/IconChart.svelte';
  import IconChevronRight from '$lib/icons/IconChevronRight.svelte';
  import PullToRefresh from '$lib/components/PullToRefresh.svelte';
  import WidgetGrid from '$lib/widgets/WidgetGrid.svelte';
  import { dashboardStore } from '$lib/widgets/dashboard-store.svelte';
  import { dailyData } from '$lib/widgets/daily-data.svelte';

  const weekStart = getWeekStart();

  // el total de plays decide si la cuenta está vacía
  onMount(() => dailyData.ensure('health'));
  let empty = $derived(!dailyData.loading('health') && dailyData.health?.totalPlays === 0);

  // pull-to-refresh: sin purgar, cada widget se resolvería entero desde la cache SWR
  // (TTL de 10 min en los tops) y el gesto no haría nada visible. Aquí el purgado
  // ancho sí es lo que el usuario está pidiendo; reload() avisa a los widgets
  async function refresh() {
    await invalidateCache('/stats/');
    dashboardStore.reload();
  }

  // W entra y sale del modo edición (E es el atajo global de records)
  shortcutStore.registerPageShortcuts(
    [{ key: 'W', description: 'Edit widgets', category: 'page' }],
    (e) => {
      if (e.key !== 'w') return false;
      e.preventDefault();
      dashboardStore.editing = !dashboardStore.editing;
      return true;
    },
  );
  onDestroy(() => {
    shortcutStore.unregisterPageShortcuts();
    dashboardStore.editing = false;
  });
</script>

<PullToRefresh onrefresh={refresh}>
<!-- el div evita que los snippets, como hijos directos de PullToRefresh, se
     interpreten como props implícitas del componente -->
<div class="dash">
  <!-- aviso de periodos recién cerrados: enlaza a su report, que es la lectura de
       ese periodo (el chart sigue a un click desde el report). Abrir el report lo da
       por visto, igual que el "view" del banner de /charts -->
  {#if closedChartsStore.charts.length > 0 && !dashboardStore.editing}
    <div class="card new-reports-card">
      <div class="new-reports-header">
        <IconChart />
        <span>New reports</span>
        <button class="new-reports-dismiss" onclick={() => closedChartsStore.dismissAll()} title="Dismiss">&times;</button>
      </div>
      <div class="new-reports-list">
        {#each closedChartsStore.charts as closed (closed.granularity)}
          <a href="/reports/{closed.granularity}/{closed.period}" class="new-report-link">
            {GRANULARITY_LABELS[closed.granularity]} report
            <span class="new-report-range">{periodDateRange(closed.period, closed.granularity, weekStart)}</span>
            <IconChevronRight />
          </a>
        {/each}
      </div>
    </div>
  {/if}

  <!-- cuenta sin plays: los widgets se quedan vacíos y la página no decía cómo llenarla -->
  {#if empty}
    <div class="card empty-account-card">
      <h3 class="section-title">Nothing here yet</h3>
      <p>sis fills up as you listen. Import your Spotify history to start with years of data, or connect a scrobbler if you listen elsewhere.</p>
      <div class="empty-account-actions">
        <a href="/settings?tab=data" class="range-btn">Import history</a>
        <a href="/settings?tab=connections" class="range-btn">Connect a scrobbler</a>
      </div>
    </div>
  {/if}

  <WidgetGrid />
</div>
</PullToRefresh>

<style>
  .dash {
    display: flex;
    flex-direction: column;
    gap: var(--detail-gap);
  }

  .empty-account-card p {
    margin: 0 0 1rem;
    color: var(--text-muted);
    font-size: var(--fs-md);
    line-height: 1.5;
  }
  .empty-account-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .empty-account-actions .range-btn { text-decoration: none; }

  .new-reports-card {
    border-color: var(--accent-a25);
    background: var(--accent-a05);
  }
  .new-reports-header {
    font-family: var(--font-mono);
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: var(--accent);
    font-size: var(--fs-sm);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: var(--track);
    margin-bottom: 0.5rem;
  }
  .new-reports-dismiss {
    margin-left: auto;
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: var(--fs-lg);
    cursor: pointer;
    padding: 0 0.2rem;
    line-height: 1;
  }
  .new-reports-dismiss:hover {
    color: var(--text);
  }
  .new-reports-list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .new-report-link {
    font-family: var(--font-mono);
    display: flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--text);
    text-decoration: none;
    font-size: var(--fs-sm);
    padding: 0.3rem 0;
    transition: color 0.05s;
  }
  .new-report-link:hover {
    color: var(--accent);
  }
  .new-report-range {
    color: var(--text-muted);
  }
  .new-report-link :global(svg) {
    margin-left: auto;
    opacity: 0;
    transition: opacity 0.05s;
  }
  .new-report-link:hover :global(svg) {
    opacity: 1;
  }
</style>
