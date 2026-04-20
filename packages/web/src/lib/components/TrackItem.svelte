<script lang="ts">
  import type { Snippet } from 'svelte';
  import { medalColor } from '$lib/utils/medals';

  interface Props {
    href?: string;
    rank?: number;
    imageUrl?: string | null;
    imageHref?: string;
    imageRound?: boolean;
    name: string;
    nameHref?: string;
    isLive?: boolean;
    compact?: boolean;
    subtitle?: Snippet;
    meta?: Snippet;
  }

  let { href, rank, imageUrl, imageHref, imageRound = false, name, nameHref, isLive = false, compact = false, subtitle, meta }: Props = $props();
</script>

{#snippet content()}
  {#if rank != null}
    <span class="track-rank" style:color={medalColor(rank)}>{rank}</span>
  {/if}
  {#if imageHref && imageUrl}
    <a href={imageHref} class="track-art-link">
      <img class="track-art" class:track-art--round={imageRound} src={imageUrl} alt="" />
    </a>
  {:else if imageUrl}
    <img class="track-art" class:track-art--round={imageRound} src={imageUrl} alt="" />
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
  {#if meta}
    <div class="track-meta">
      {@render meta()}
    </div>
  {/if}
{/snippet}

{#if href}
  <a {href} class="track-item" class:compact>
    {@render content()}
  </a>
{:else}
  <div class="track-item" class:compact>
    {@render content()}
  </div>
{/if}
