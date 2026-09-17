<script lang="ts">
  import type { Snippet } from 'svelte';
  import { medalColor } from '$lib/utils/medals';
  import { openEntityContextMenu, type EntityContext } from '$lib/utils/entity-context';
  import RankCell from './RankCell.svelte';
  import LiveEq from './LiveEq.svelte';

  interface Props {
    href?: string;
    rank?: number;
    rankChange?: number | null;
    globalRank?: number | null;
    isNew?: boolean;
    isReentry?: boolean;
    imageUrl?: string | null;
    imageHref?: string;
    imageRound?: boolean;
    name: string;
    nameHref?: string;
    isLive?: boolean;
    compact?: boolean;
    /** reserva la línea de subtítulo aunque no haya. Ver el comentario del markup:
     *  se apaga sólo en listas donde NINGUNA fila lleva subtítulo (la sección de
     *  relaciones), que si no el nombre queda arriba en vez de centrado con la foto. */
    reserveSubtitle?: boolean;
    focusId?: string;
    highlighted?: boolean;
    dimmed?: boolean;
    entity?: EntityContext;
    fillPercent?: number;
    subtitle?: Snippet;
    extra?: Snippet;
    meta?: Snippet;
    cover?: Snippet;
  }

  let { href, rank, rankChange, globalRank, isNew = false, isReentry = false, imageUrl, imageHref, imageRound = false, name, nameHref, isLive = false, compact = false, reserveSubtitle = true, focusId, highlighted = false, dimmed = false, fillPercent, entity, subtitle, extra, meta, cover }: Props = $props();

  let onContextMenu = $derived(entity ? openEntityContextMenu(entity) : undefined);
</script>

{#snippet art()}
  <img class="track-art" class:track-art--round={imageRound} src={imageUrl} alt="" />
  {#if isLive}<LiveEq round={imageRound} />{/if}
{/snippet}

{#snippet content()}
  {#if rank != null}
    <RankCell {rank} id={entity?.id} {rankChange} {isNew} {isReentry} />
  {/if}
  {#if imageHref && imageUrl}
    <a href={imageHref} class="track-art-link">{@render art()}</a>
  {:else if imageUrl}
    <span class="track-art-link">{@render art()}</span>
  {:else if cover}
    {@render cover()}
  {:else}
    <div class="track-art" class:track-art--round={imageRound}></div>
  {/if}
  <div class="track-info">
    <div class="track-name">
      {#if nameHref}
        <a href={nameHref} class="track-link">{name}</a>
      {:else}
        {name}
      {/if}
    </div>
    <!-- la línea de subtítulo se reserva aunque no haya (artistas): sin ella la
         fila mide unos px menos y una lista que alterna tipos de entidad salta.
         Con reserveSubtitle=false desaparece, para las listas donde NINGUNA fila
         la lleva y el hueco sólo descuadraba el nombre respecto a la carátula. -->
    {#if subtitle || reserveSubtitle}
      <div class="track-artist">
        {#if subtitle}{@render subtitle()}{:else}&nbsp;{/if}
      </div>
    {/if}
  </div>
  {#if extra}
    {@render extra()}
  {/if}
  {#if globalRank != null}
    <span class="global-rank" title="All-time rank" style:color={medalColor(globalRank)}>#{globalRank}</span>
  {/if}
  {#if meta}
    <div class="track-meta">
      {@render meta()}
    </div>
  {/if}
{/snippet}

{#if href}
  <a {href} class="track-item" class:compact class:track-item--live={isLive} class:track-item--focused={highlighted} class:track-item--dimmed={dimmed} data-focus-id={focusId} oncontextmenu={onContextMenu}>
    {#if fillPercent != null}<div class="track-fill" style="width:{fillPercent}%"></div>{/if}
    {@render content()}
  </a>
{:else}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="track-item" class:compact class:track-item--live={isLive} class:track-item--focused={highlighted} class:track-item--dimmed={dimmed} class:track-item--filled={fillPercent != null} data-focus-id={focusId} oncontextmenu={onContextMenu}>
    {#if fillPercent != null}<div class="track-fill" style="width:{fillPercent}%"></div>{/if}
    {@render content()}
  </div>
{/if}
