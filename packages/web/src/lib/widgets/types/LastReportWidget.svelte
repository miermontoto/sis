<script lang="ts">
  // el último periodo cerrado de la granularidad elegida, con su resumen y sus
  // tres nº 1 (artista, álbum, tema) como fichas: en fila en medium y xl, una
  // debajo de otra en large. El report está pre-horneado: es una lectura de cache
  import { untrack } from 'svelte';
  import { isGranularity } from '@sis/shared';
  import { api, getWeekStart, type Granularity, type ReportResponse } from '$lib/api';
  import RankChange from '$lib/components/RankChange.svelte';
  import ReportDelta from '$lib/components/reports/ReportDelta.svelte';
  import GranularityPicker from '$lib/components/GranularityPicker.svelte';
  import { formatDuration, formatHours, formatNumber } from '$lib/utils/format';
  import { GRANULARITY_NOUNS, latestClosedPeriod, periodDateRange } from '$lib/utils/report-periods';
  import { openEntityContextMenu, trackEntity, type EntityContext } from '$lib/utils/entity-context';
  import WidgetHeader from '../WidgetHeader.svelte';
  import { widgetMetric, reloadKey } from '../util';
  import type { WidgetProps } from '../components';

  let { size, settings, onsettings }: WidgetProps = $props();

  let granularity = $derived<Granularity>(isGranularity(String(settings.granularity)) ? settings.granularity as Granularity : 'week');
  let weekStart = getWeekStart();
  let metric = $derived(widgetMetric(settings));
  // null = aún no hay un periodo cerrado (historial recién empezado)
  let period = $derived(latestClosedPeriod(granularity, weekStart));
  let noun = $derived(GRANULARITY_NOUNS[granularity].toLowerCase());

  let report = $state<ReportResponse | null>(null);
  let loading = $state(true);
  let seq = 0;

  $effect(() => {
    const [g, p, m] = [granularity, period, metric];
    reloadKey();
    untrack(() => {
      const my = ++seq;
      if (!p) { report = null; loading = false; return; }
      loading = true;
      api.report(g, p, weekStart, m)
        .then(r => { if (my === seq) report = r; })
        .catch(e => console.error('report widget:', e))
        .finally(() => { if (my === seq) loading = false; });
    });
  });

  const value = (plays: number, ms: number) => metric === 'plays' ? `${formatNumber(plays)} plays` : formatDuration(ms);

  type Pick = { label: string; href: string; imageUrl: string | null; round: boolean; name: string; value: string; rankChange: number | null; isNew: boolean; isReentry: boolean; entity: EntityContext };
  let picks = $derived.by((): Pick[] => {
    if (!report) return [];
    const a = report.top.artists[0];
    const al = report.top.albums[0];
    const t = report.top.tracks[0];
    const out: Pick[] = [];
    if (a?.artist) out.push({ label: 'Top artist', href: `/artist/${a.artistId}`, imageUrl: a.artist.imageUrl ?? null, round: true, name: a.artist.name, value: value(a.playCount, a.totalMs), rankChange: a.rankChange, isNew: a.isNew, isReentry: a.isReentry ?? false, entity: { type: 'artist', id: a.artistId, name: a.artist.name, imageUrl: a.artist.imageUrl ?? null } });
    if (al?.album) out.push({ label: 'Top album', href: `/album/${al.albumId}`, imageUrl: al.album.imageUrl ?? null, round: false, name: al.album.name, value: value(al.playCount, al.totalMs), rankChange: al.rankChange, isNew: al.isNew, isReentry: al.isReentry ?? false, entity: { type: 'album', id: al.albumId, name: al.album.name, imageUrl: al.album.imageUrl ?? null, parentArtistId: al.artists?.[0]?.id } });
    if (t?.track) out.push({ label: 'Top track', href: `/track/${t.trackId}`, imageUrl: t.track.album?.imageUrl ?? null, round: false, name: t.track.name, value: value(t.playCount, t.totalMs), rankChange: t.rankChange, isNew: t.isNew, isReentry: t.isReentry ?? false, entity: trackEntity(t.track) });
    return out;
  });
</script>

{#if period}
  <WidgetHeader title="Last {noun}'s report" href="/reports/{granularity}/{period}">
    {#snippet actions()}
      <!-- el selector sólo cabe en xl: en large aplastaba el título a "L." -->
      {#if onsettings && size === 'xl'}<GranularityPicker value={granularity} onchange={(g) => onsettings({ granularity: g })} />{/if}
    {/snippet}
  </WidgetHeader>
  {#if loading && !report}
    <div class="w-ghost w-ghost--fill"></div>
  {:else if report && report.summary.plays > 0}
    {@const s = report.summary}
    <p class="lr-summary data-count">
      {#if size !== 'medium'}<span class="data-label">{periodDateRange(period, granularity, weekStart)}</span>{/if}
      {formatNumber(s.plays)} plays · {formatHours(s.totalMs)}
      <ReportDelta value={s.totalMs} previous={report.previous?.totalMs} />
      {#if size !== 'medium'} · {formatNumber(s.distinctArtists)} artists{/if}
    </p>
    <div class="w-fill lr-picks" class:lr-picks--col={size === 'large'} class:lr-picks--tiles={size === 'medium'}>
      {#each picks as pick (pick.label)}
        <a class="lr-pick" href={pick.href} oncontextmenu={openEntityContextMenu(pick.entity)} title="{pick.label}: {pick.name}">
          {#if pick.imageUrl}
            <img class="lr-img" class:lr-img--round={pick.round} src={pick.imageUrl} alt="" loading="lazy" />
          {:else}
            <div class="lr-img lr-img--empty" class:lr-img--round={pick.round}></div>
          {/if}
          <span class="lr-text">
            <span class="data-label">{pick.label}</span>
            <span class="lr-name">{pick.name}</span>
            {#if size !== 'medium'}
              <span class="lr-value">
                <span class="track-plays">{pick.value}</span>
                <RankChange rankChange={pick.rankChange} isNew={pick.isNew} isReentry={pick.isReentry} />
              </span>
            {/if}
          </span>
        </a>
      {/each}
    </div>
  {:else}
    <p class="w-empty">No plays in the last {noun}.</p>
  {/if}
{:else}
  <WidgetHeader title="Latest report" href="/reports" />
  <p class="w-empty">Your first {noun}ly report shows up when this {noun} closes.</p>
{/if}

<style>
  .lr-summary {
    margin: 0 0 0.6rem;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem;
    font-size: var(--fs-sm);
    flex-shrink: 0;
  }
  .lr-picks {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.9rem;
    align-content: start;
  }
  .lr-picks--col {
    grid-template-columns: 1fr;
    gap: 0.6rem;
  }
  .lr-pick {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    min-width: 0;
    text-decoration: none;
    color: inherit;
  }
  /* medium: tres fichas en vertical (carátula arriba, nombre debajo) */
  .lr-picks--tiles { gap: 0.5rem; }
  .lr-picks--tiles .lr-pick {
    flex-direction: column;
    align-items: stretch;
    gap: 0.3rem;
  }
  .lr-picks--tiles .lr-img {
    width: 100%;
    height: auto;
    aspect-ratio: 1;
    max-height: 3rem;
  }
  /* medium no da para la etiqueta de cada ficha: la carátula y el nombre bastan */
  .lr-picks--tiles .data-label { display: none; }
  .lr-img {
    width: 3rem;
    height: 3rem;
    flex-shrink: 0;
    border-radius: var(--radius);
    object-fit: cover;
  }
  .lr-img--round { border-radius: 50%; }
  .lr-picks--tiles .lr-img--round { border-radius: var(--radius); }
  .lr-img--empty { background: linear-gradient(135deg, var(--bg-placeholder), var(--bg-placeholder-hi)); }
  .lr-text {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    min-width: 0;
  }
  .lr-name {
    font-weight: 600;
    font-size: var(--fs-md);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .lr-picks--tiles .lr-name { font-size: var(--fs-sm); }
  .lr-pick:hover .lr-name { color: var(--accent); }
  .lr-value {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: var(--fs-sm);
  }
</style>
