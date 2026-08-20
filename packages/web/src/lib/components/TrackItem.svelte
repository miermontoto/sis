<script lang="ts">
  import type { Snippet } from 'svelte';
  import { medalColor } from '$lib/utils/medals';
  import { openEntityContextMenu, type EntityContext } from '$lib/utils/entity-context';
  import RankChange from './RankChange.svelte';

  interface Props {
    href?: string;
    rank?: number;
    rankChange?: number | null;
    globalRank?: number | null;
    isNew?: boolean;
    imageUrl?: string | null;
    imageHref?: string;
    imageRound?: boolean;
    name: string;
    nameHref?: string;
    isLive?: boolean;
    compact?: boolean;
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

  let { href, rank, rankChange, globalRank, isNew = false, imageUrl, imageHref, imageRound = false, name, nameHref, isLive = false, compact = false, focusId, highlighted = false, dimmed = false, fillPercent, entity, subtitle, extra, meta, cover }: Props = $props();

  let onContextMenu = $derived(entity ? openEntityContextMenu(entity) : undefined);
</script>

{#snippet content()}
  {#if rank != null}
    {#if rankChange !== undefined}
      <div class="rank-col">
        <span class="track-rank" style:color={medalColor(rank)}>{rank}</span>
        <RankChange rankChange={rankChange} {isNew} />
      </div>
    {:else}
      <span class="track-rank" style:color={medalColor(rank)}>{rank}</span>
    {/if}
  {/if}
  {#if imageHref && imageUrl}
    <a href={imageHref} class="track-art-link">
      <img class="track-art" class:track-art--round={imageRound} src={imageUrl} alt="" />
    </a>
  {:else if imageUrl}
    <img class="track-art" class:track-art--round={imageRound} src={imageUrl} alt="" />
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
      {#if isLive}<span class="live-dot"></span>{/if}
    </div>
    {#if subtitle}
      <div class="track-artist">
        {@render subtitle()}
      </div>
    {/if}
  </div>
  {#if extra}
    {@render extra()}
  {/if}
  {#if globalRank != null}
    <span class="global-rank" title="All-time rank" style:color={medalColor(globalRank)}><span class="global-rank-label">all</span>#{globalRank}</span>
  {/if}
  {#if meta}
    <div class="track-meta">
      {@render meta()}
    </div>
  {/if}
{/snippet}

{#if href}
  <a {href} class="track-item" class:compact class:track-item--focused={highlighted} class:track-item--dimmed={dimmed} data-focus-id={focusId} oncontextmenu={onContextMenu}>
    {#if fillPercent != null}<div class="track-fill" style="width:{fillPercent}%"></div>{/if}
    {@render content()}
  </a>
{:else}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="track-item" class:compact class:track-item--focused={highlighted} class:track-item--dimmed={dimmed} class:track-item--filled={fillPercent != null} data-focus-id={focusId} oncontextmenu={onContextMenu}>
    {#if fillPercent != null}<div class="track-fill" style="width:{fillPercent}%"></div>{/if}
    {@render content()}
  </div>
{/if}
