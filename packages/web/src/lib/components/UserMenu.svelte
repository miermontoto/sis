<script lang="ts">
  import type { MeResponse } from '$lib/api';
  import IconArtist from '$lib/icons/IconArtist.svelte';
  import IconSettings from '$lib/icons/IconSettings.svelte';
  import IconLogout from '$lib/icons/IconLogout.svelte';
  import IconLastfm from '$lib/icons/IconLastfm.svelte';
  import IconChevronRight from '$lib/icons/IconChevronRight.svelte';

  // menú de cuenta compartido por el badge del sidebar y el de la cabecera móvil.
  // `header` sólo en móvil: en el sidebar el nombre ya está en el propio badge
  // justo debajo, y repetirlo sería la misma etiqueta dos veces seguidas.
  let {
    user,
    placement = 'up',
    header = false,
    onnavigate,
  }: {
    user: MeResponse;
    placement?: 'up' | 'down';
    header?: boolean;
    onnavigate?: () => void;
  } = $props();

  const ICON_SIZE = 15;
  const AVATAR_ICON_SIZE = 18;
  const CHEVRON_SIZE = 12;

  let profileHref = $derived(`/u/${encodeURIComponent(user.spotifyId ?? '')}`);
</script>

<div class="user-menu user-menu--{placement}" role="menu">
  {#if header}
    <div class="user-menu-header">
      <div class="user-menu-avatar">
        {#if user.imageUrl}
          <img src={user.imageUrl} alt="" />
        {:else}
          <IconArtist size={AVATAR_ICON_SIZE} />
        {/if}
      </div>
      <div class="user-menu-ident">
        <span class="user-menu-name">
          {user.displayName ?? user.spotifyId}
          {#if user.isAdmin}<span class="user-menu-admin">admin</span>{/if}
        </span>
        <span class="user-menu-id">{user.spotifyId}</span>
      </div>
    </div>
    {#if user.lastfmUsername}
      <div class="user-menu-linked">
        <IconLastfm size={CHEVRON_SIZE} />
        <span>{user.lastfmUsername}</span>
      </div>
    {/if}
  {/if}

  <a href={profileHref} class="user-menu-item" role="menuitem" onclick={onnavigate}>
    <span class="user-menu-icon"><IconArtist size={ICON_SIZE} /></span>
    Profile
    <span class="user-menu-chevron"><IconChevronRight size={CHEVRON_SIZE} /></span>
  </a>
  <a href="/settings" class="user-menu-item" role="menuitem" onclick={onnavigate}>
    <span class="user-menu-icon"><IconSettings size={ICON_SIZE} /></span>
    Settings
    <span class="user-menu-chevron"><IconChevronRight size={CHEVRON_SIZE} /></span>
  </a>
  <div class="user-menu-sep"></div>
  <a href="/auth/logout" class="user-menu-item user-menu-item--danger" role="menuitem">
    <span class="user-menu-icon"><IconLogout size={ICON_SIZE} /></span>
    Log out
  </a>
</div>

<style>
  .user-menu {
    position: absolute;
    z-index: 200;
    padding: 0.25rem;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
    animation: user-menu-pop 0.12s ease-out;
  }
  /* sidebar: crece hacia arriba y ocupa el ancho del badge */
  .user-menu--up {
    /* deja pasar el pill de admin, que sobresale del borde superior del badge */
    --user-menu-gap: 0.6rem;
    bottom: calc(100% + var(--user-menu-gap));
    left: 0;
    right: 0;
  }
  /* puente invisible sobre el hueco: el menú se abre en hover y el ratón tiene
     que poder cruzar del badge al panel sin salirse del wrap */
  .user-menu--up::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: calc(-1 * var(--user-menu-gap));
    height: var(--user-menu-gap);
  }
  /* cabecera móvil: cuelga del avatar, alineado a la derecha */
  .user-menu--down {
    top: calc(100% + 0.5rem);
    right: 0;
    min-width: 200px;
  }
  @keyframes user-menu-pop {
    from { opacity: 0; transform: translateY(var(--user-menu-pop-from, -4px)); }
    to { opacity: 1; transform: translateY(0); }
  }
  .user-menu--up {
    --user-menu-pop-from: 4px;
  }

  .user-menu-header {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0.5rem 0.55rem 0.55rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    margin-bottom: 0.25rem;
  }

  .user-menu-avatar {
    width: 34px;
    height: 34px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    overflow: hidden;
    background: var(--bg-hover);
    color: var(--text-muted);
    box-shadow: 0 0 0 1px var(--border);
  }
  .user-menu-avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .user-menu-ident {
    display: flex;
    flex-direction: column;
    min-width: 0;
    line-height: 1.3;
  }

  .user-menu-name {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .user-menu-admin {
    flex-shrink: 0;
    padding: 0 0.25rem;
    border-radius: var(--radius);
    background: rgba(29, 185, 84, 0.12);
    color: var(--accent);
    font-family: var(--font-mono);
    font-size: 0.5rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .user-menu-id {
    font-family: var(--font-mono);
    font-size: 0.65rem;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* cuenta enlazada: identidad, no acción (el enlace/desenlace vive en settings) */
  .user-menu-linked {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.1rem 0.6rem 0.4rem;
    font-size: 0.65rem;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
  }
  .user-menu-linked span {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .user-menu-item {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0.45rem 0.6rem;
    border-radius: var(--radius);
    font-size: 0.8rem;
    color: var(--text);
    text-decoration: none;
    transition: background 0.05s, color 0.05s;
  }
  .user-menu-item:hover {
    background: var(--bg-hover);
  }

  .user-menu-icon {
    display: flex;
    flex-shrink: 0;
    color: var(--text-muted);
    transition: color 0.05s;
  }
  .user-menu-item:hover .user-menu-icon {
    color: var(--accent);
  }

  .user-menu-chevron {
    display: flex;
    margin-left: auto;
    color: var(--text-muted);
    opacity: 0.35;
    transition: opacity 0.05s, transform 0.05s;
  }
  .user-menu-item:hover .user-menu-chevron {
    opacity: 1;
    transform: translateX(2px);
  }

  .user-menu-sep {
    height: 1px;
    margin: 0.25rem 0.35rem;
    background: rgba(255, 255, 255, 0.05);
  }

  .user-menu-item--danger {
    color: var(--danger);
  }
  .user-menu-item--danger:hover {
    background: rgba(231, 76, 60, 0.1);
  }
  .user-menu-item--danger:hover .user-menu-icon {
    color: var(--danger);
  }

  @media (prefers-reduced-motion: reduce) {
    .user-menu {
      animation: none;
    }
    .user-menu-item:hover .user-menu-chevron {
      transform: none;
    }
  }
</style>
