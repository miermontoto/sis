<script lang="ts">
  // quién ha subido en los rankings all-time y del año en los últimos 7 días. Con
  // los cambios de ranking apagados en Settings el componente no pinta nada: aquí
  // se dice por qué en vez de dejar la card vacía
  import { getSessionRankDisplay, onSessionRankDisplayChange } from '$lib/api';
  import RecentRankChanges from '$lib/components/RecentRankChanges.svelte';
  import { entityOf, reloadKey, roomForActions } from '../util';
  import type { WidgetProps } from '../components';

  let { size, settings, onsettings }: WidgetProps = $props();

  let display = $state(getSessionRankDisplay());
  $effect(() => onSessionRankDisplayChange(() => { display = getSessionRankDisplay(); }));
</script>

{#if display === 'none'}
  <p class="w-empty">Ranking changes are turned off in <a href="/settings?tab=display" class="section-link">Settings</a>.</p>
{:else}
  {#key reloadKey()}
    <RecentRankChanges bare entity={entityOf(settings, 'artist')} onentity={onsettings && roomForActions(size) ? (e) => onsettings({ entity: e }) : undefined} />
  {/key}
{/if}
