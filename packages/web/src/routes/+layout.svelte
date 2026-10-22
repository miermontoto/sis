<script lang="ts">
  // safe areas de ios como tokens (columna lateral del iPhone Duo + rail de pestañas nativo)
  import '@platform/ui/safe-area.css';
  import '../app.css';
  import { nativeTabBar } from '@platform/mobile/native-tab-bar';
  // el store del tema vive desde el arranque: es quien sigue al sistema (y a otras
  // pestañas) cuando la preferencia es 'system'
  import '$lib/stores/theme.svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import type { Snippet } from 'svelte';
  import SearchModal from '$lib/components/SearchModal.svelte';
  import NowPlaying from '$lib/components/NowPlaying.svelte';
  import ContextMenu from '$lib/components/ContextMenu.svelte';
  import PlaylistPicker from '$lib/components/PlaylistPicker.svelte';
  import EntityHoverCard from '$lib/components/EntityHoverCard.svelte';
  import MergeEntityModal from '$lib/components/MergeEntityModal.svelte';
  import CollectionModal from '$lib/components/CollectionModal.svelte';
  import RelateArtistModal from '$lib/components/RelateArtistModal.svelte';
  import CreditsModal from '$lib/components/CreditsModal.svelte';
  import KeyboardShortcutsHelp from '$lib/components/KeyboardShortcutsHelp.svelte';
  import Toast from '$lib/components/Toast.svelte';
  import Wordmark from '$lib/components/Wordmark.svelte';
  import { apiBase, api, loadSettings, getNowPlayingDisplay, onNowPlayingDisplayChange, getSessionTrackingDisplay, onSessionTrackingDisplayChange, getSidebarCollapsed, setSidebarCollapsed, onSidebarCollapsedChange, type MeResponse, type NowPlayingDisplay, type SessionTrackingDisplay } from '$lib/api';
  import { nowPlayingStore } from '$lib/stores/now-playing.svelte';
  import { projectionsStore } from '$lib/stores/projections.svelte';
  import { playUpdatesStore } from '$lib/stores/play-updates.svelte';
  import { statFlashStore } from '$lib/stores/stat-flash.svelte';
  import { closedChartsStore } from '$lib/stores/closed-charts.svelte';
  import ProjectedChanges from '$lib/components/ProjectedChanges.svelte';
  import MobilePlayer from '$lib/components/MobilePlayer.svelte';
  import IconArtist from '$lib/icons/IconArtist.svelte';
  import FriendsActivity from '$lib/components/FriendsActivity.svelte';
  import UserMenu from '$lib/components/UserMenu.svelte';
  import IconMenuDots from '$lib/icons/IconMenuDots.svelte';
  import { mergeModal } from '$lib/stores/merge-modal.svelte';
  import { collectionModal } from '$lib/stores/collection-modal.svelte';
  import { collectionsStore } from '$lib/stores/collections.svelte';
  import { relateModal } from '$lib/stores/relate-modal.svelte';
  import { shortcutStore } from '$lib/stores/keyboard-shortcuts.svelte';
  import { prewarmer, setUser, hydrateUser, bootCleanup } from '$lib/cache';
  import { hasInstance, instanceOrigin, APP_LINK_HOSTS } from '$lib/instance';

  // hidrata el namespace del cache antes de cualquier apiFetch para que
  // /me, /settings, /version hagan hit cuando vuelves al app.
  hydrateUser();
  import { onDestroy, onMount, tick, untrack } from 'svelte';
  import { chooseFit, sameFit, type FitChoice, type FitSizes } from '$lib/utils/sidebar-fit';
  import { positionPopover } from '$lib/utils/popover';
  import { pwaInfo } from 'virtual:pwa-info';

  // estado del modal global de merge (abierto desde el menú contextual).
  // Sincroniza bidireccionalmente con el store: abre al set target, cierra al
  // dismissar el modal.
  let mergeModalShow = $state(false);
  $effect(() => {
    mergeModalShow = mergeModal.target !== null;
  });
  $effect(() => {
    if (!mergeModalShow && mergeModal.target) mergeModal.close();
  });

  // ídem para el modal de colecciones, que abre el menú contextual de un álbum o un
  // tema (la entrada sólo aparece si su artista tiene alguna: ver collectionsStore)
  let collectionModalShow = $state(false);
  $effect(() => {
    collectionModalShow = collectionModal.target !== null;
  });
  $effect(() => {
    if (!collectionModalShow && collectionModal.target) collectionModal.close();
  });

  // ídem para el modal de relaciones soft entre artistas
  let relateModalShow = $state(false);
  $effect(() => {
    relateModalShow = relateModal.target !== null;
  });
  $effect(() => {
    if (!relateModalShow && relateModal.target) relateModal.close();
  });

  const CONNECT_ROUTE = '/connect';

  let { children }: { children: Snippet } = $props();
  let authChecked = $state(false);
  let authCheckDone = false;
  let showSearch = $state(false);
  let user = $state<MeResponse | null>(null);
  let appVersion = $state('');
  let showUserMenu = $state(false);
  // el menú de usuario lo abrió el hover (no un click): no hace falta que sea
  // reactivo, solo lo lee el click para no cerrar lo que el ratón acaba de abrir
  let userMenuFromHover = false;
  let expandedGroup = $state<string | null>(null);
  let userMenuRef = $state<HTMLElement | null>(null);
  let mobileUserMenuRef = $state<HTMLElement | null>(null);
  let tabbarRef = $state<HTMLElement | null>(null);
  let nowPlayingDisplay = $state<NowPlayingDisplay>('auto');
  let sessionTrackingDisplay = $state<SessionTrackingDisplay>('all');
  // rail izquierdo colapsado (solo iconos): preferencia de escritorio persistida
  let sidebarCollapsed = $state<boolean>(getSidebarCollapsed());
  let sidebarEl = $state<HTMLElement | null>(null);
  let sidebarSpacerEl = $state<HTMLElement | null>(null);
  let navEl = $state<HTMLElement | null>(null);
  let npWrapEl = $state<HTMLElement | null>(null);
  // ajuste vertical (utils/sidebar-fit): qué partes plegables van compactas.
  // Se elige con las alturas medidas de cada parte en cada modo, no con un
  // "¿desborda?" booleano, para que la decisión no se realimente
  let fitChoice = $state<FitChoice>({ navCompact: false, npInline: false });
  const fitSizes: FitSizes = { base: 0 };
  let navCompact = $derived(fitChoice.navCompact);
  let npInline = $derived(nowPlayingDisplay === 'compact' || (nowPlayingDisplay === 'auto' && fitChoice.npInline));

  const unsubNpDisplay = onNowPlayingDisplayChange((v) => { nowPlayingDisplay = v; });
  const unsubSidebarCollapsed = onSidebarCollapsedChange((v) => { sidebarCollapsed = v; });
  const unsubSessionTracking = onSessionTrackingDisplayChange(() => {
    sessionTrackingDisplay = getSessionTrackingDisplay();
    if (sessionTrackingDisplay !== 'off') projectionsStore.startPolling();
    else projectionsStore.stopPolling();
  });
  onDestroy(() => { nowPlayingStore.stopPolling(); projectionsStore.stopPolling(); unsubNpDisplay(); unsubSessionTracking(); unsubSidebarCollapsed(); });

  // alterna el rail colapsado; el setter persiste (localStorage + PUT /settings)
  function toggleSidebar() { setSidebarCollapsed(!sidebarCollapsed); }

  // badge de usuario: en el rail solo se ve la foto y el menú no cabe (64px, con
  // overflow oculto), así que al pulsarla expandimos el rail y abrimos el menú
  // ya legible; expandido, simplemente lo alterna.
  function handleUserBadgeClick() {
    if (sidebarCollapsed) {
      setSidebarCollapsed(false);
      showUserMenu = true;
      return;
    }
    // si lo abrió el hover, el click no lo cierra: sería cerrarlo justo al ir a
    // pulsarlo. El segundo click ya sí alterna, y salirse con el ratón lo cierra
    if (userMenuFromHover) {
      userMenuFromHover = false;
      return;
    }
    showUserMenu = !showUserMenu;
  }

  // ...y también al pasar el ratón, como el resto de popovers de la app
  // (HoverPopover). Solo con puntero real: en táctil el primer tap dispara
  // pointerenter + click y el menú se abriría y cerraría de una. Con el rail
  // colapsado no se abre en hover: ahí el badge es un botón que expande.
  function handleUserBadgeEnter(e: PointerEvent) {
    if (e.pointerType === 'touch' || sidebarCollapsed) return;
    userMenuFromHover = !showUserMenu;
    showUserMenu = true;
  }
  function handleUserBadgeLeave(e: PointerEvent) {
    if (e.pointerType === 'touch') return;
    userMenuFromHover = false;
    showUserMenu = false;
  }

  onMount(async () => {
    if (pwaInfo) {
      const { registerSW } = await import('virtual:pwa-register');
      registerSW({ immediate: true });
    }
  });

  // oauth móvil (apk): el deep link info.mier.sis://auth/callback?code=... llega
  // tras el login en el browser del sistema; canjear el código por la cookie de
  // sesión (CapacitorHttp → cookie jar nativo) y recargar la spa autenticada.
  // el scheme replica MOBILE_SCHEME de la api (copia mínima, sin lib compartida);
  // es de la app, no de la instancia: cualquier instancia redirige a él y el
  // canje va contra la que esté elegida.
  onMount(async () => {
    const { Capacitor } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform()) return;
    // tinta las system bars (status + navigation) con el fondo del tema (--bg)
    const { observeSystemBars } = await import('@platform/mobile/system-bars');
    observeSystemBars({ backgroundVar: '--bg' });
    const { onAppLink, onAuthDeepLink } = await import('@platform/mobile/deep-link');
    // app links https: navegar a la ruta del link (compartidos /s /u /artist...).
    // sólo los dominios propios (oficial + alias sis.mier.info): el host va en
    // el manifest y el assetlinks lleva la firma del apk, así que los links de
    // otra instancia abren en el browser
    for (const host of APP_LINK_HOSTS) await onAppLink(host, (path) => goto(path));
    await onAuthDeepLink('info.mier.sis', async (url) => {
      const code = url.searchParams.get('code');
      if (!code) return;
      const res = await fetch(`${instanceOrigin()}/auth/mobile/exchange`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      if (res.ok) window.location.href = '/';
      else console.error('[auth] canje del código móvil falló:', res.status);
    });
    // volver al apk: el resume nativo es el contrato; que el webview lo traduzca a
    // visibilitychange depende de la plataforma. Las dos vías llegan al mismo guard
    const { App } = await import('@capacitor/app');
    await App.addListener('resume', () => nowPlayingStore.refreshIfStale());
  });

  // volver a la pestaña o a la ventana (con spotify al lado, saltar de tema allí
  // y volver aquí no oculta la pestaña): el store decide si su lectura es vieja
  function refreshNowPlayingOnFocus() {
    if (document.visibilityState === 'visible') nowPlayingStore.refreshIfStale();
  }

  $effect(() => {
    if (sessionTrackingDisplay === 'off') return;
    nowPlayingStore.trackId;
    projectionsStore.onTrackChange();
  });

  // el cambio de tema lee las proyecciones antes de que el play saliente aterrice
  // (el volcado va 8-75s detrás del corte), así que se releen cuando el servidor
  // lo confirma: es esa lectura la que mueve los puestos y suelta los momentos
  let lastConfirmedSeq = 0;

  $effect(() => {
    const batch = playUpdatesStore.confirmed;
    if (!batch || batch.seq <= lastConfirmedSeq) return;
    lastConfirmedSeq = batch.seq;
    if (untrack(() => sessionTrackingDisplay) !== 'off') projectionsStore.refresh();
  });

  // alto del panel inferior móvil (mini player + pestañas web): el hueco que el
  // contenido deja al pie sale de aquí y no de una constante (7.5rem dejaba 36px
  // bajo la banda de sesión). Con la barra nativa de ios las pestañas web miden 0
  // y app.css suma --bottom-chrome, así que la barra no se cuenta dos veces
  $effect(() => {
    const el = sidebarEl;
    if (!el) return;
    const root = document.documentElement;
    const ro = new ResizeObserver(() => root.style.setProperty('--mobile-dock-h', `${el.offsetHeight}px`));
    ro.observe(el);
    return () => { ro.disconnect(); root.style.removeProperty('--mobile-dock-h'); };
  });

  // El parpadeo se dispara una sola vez, aquí, y no en cada vista que parchea:
  // el play toca al track, a su álbum y a sus artistas, y cualquiera de esos
  // ids puede estar pintado en varios sitios a la vez. Las vistas sólo
  // preguntan por id (statFlashStore.isFlashing)
  let lastFlashSeq = 0;

  $effect(() => {
    const update = playUpdatesStore.optimistic;
    if (!update || update.seq <= lastFlashSeq) return;
    lastFlashSeq = update.seq;
    statFlashStore.flash([update.trackId, update.albumId, ...update.artistIds]);
  });

  $effect(() => {
    const el = sidebarEl;
    const spacer = sidebarSpacerEl;
    const nav = navEl;
    if (!el || !spacer || !nav) return;
    // alto real del contenido: el spacer (flex: 1) absorbe el hueco libre, así
    // que restándolo sale lo que ocupa la columna aunque quepa de sobra
    const contentHeight = () => el.scrollHeight - spacer.offsetHeight;
    let applying = false;
    const check = async () => {
      if (applying) return;
      // mide cada parte en el modo en que está pintada; el otro modo conserva
      // su última medida, o sigue desconocido hasta que se pinte
      const navH = nav.offsetHeight;
      fitSizes[navCompact ? 'navCompact' : 'navFull'] = navH;
      const npH = npWrapEl?.offsetHeight ?? 0;
      if (npWrapEl?.querySelector('.np')) fitSizes[npInline ? 'npInline' : 'npFull'] = npH;
      else { fitSizes.npFull = npH; fitSizes.npInline = npH; } // sin tarjeta, los dos modos miden lo mismo
      fitSizes.base = contentHeight() - navH - npH;
      const next = chooseFit(el.clientHeight, fitSizes, { navCompact, npInline });
      if (sameFit(next, fitChoice)) return;
      applying = true;
      fitChoice = next;
      await tick();
      applying = false;
      check(); // lo recién pintado ya tiene medida: quizá cabe otra combinación
    };
    untrack(check);
    const ro = new ResizeObserver(() => check());
    ro.observe(el);
    ro.observe(spacer);
    ro.observe(nav);
    const mo = new MutationObserver(() => check());
    mo.observe(el, { childList: true, subtree: true });
    return () => { ro.disconnect(); mo.disconnect(); };
  });

  // al cambiar el ancho del rail cambian las alturas: olvida las medidas de los
  // modos que no están pintados para que se vuelvan a sondear
  $effect(() => {
    sidebarCollapsed;
    untrack(() => {
      delete fitSizes[navCompact ? 'navFull' : 'navCompact'];
      delete fitSizes[npInline ? 'npFull' : 'npInline'];
    });
  });

  function handleClickOutside(e: MouseEvent) {
    if (showUserMenu) {
      const inDesktop = userMenuRef?.contains(e.target as Node);
      const inMobile = mobileUserMenuRef?.contains(e.target as Node);
      if (!inDesktop && !inMobile) showUserMenu = false;
    }
    if (expandedGroup && !tabbarRef?.contains(e.target as Node) && !navEl?.contains(e.target as Node)) {
      expandedGroup = null;
    }
  }

  function handleEscape(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    expandedGroup = null;
    showUserMenu = false;
  }

  $effect(() => {
    if (showUserMenu || expandedGroup) {
      document.addEventListener('click', handleClickOutside, true);
      document.addEventListener('keydown', handleEscape);
      return () => {
        document.removeEventListener('click', handleClickOutside, true);
        document.removeEventListener('keydown', handleEscape);
      };
    }
  });

  // al recuperar sitio el nav vuelve a expandirse y su desplegable deja de existir
  $effect(() => {
    if (!navCompact) expandedGroup = null;
  });

  // rutas sin chrome ni auth gate: login + picker de instancia (apk) + vistas
  // públicas de share links + privacidad y soporte (deben ser accesibles sin
  // sesión: las stores exigen ambas urls)
  function isBareRoute(pathname: string): boolean {
    return pathname === '/login' || pathname === CONNECT_ROUTE || pathname === '/privacy' || pathname === '/support' || pathname.startsWith('/s/');
  }

  $effect(() => {
    // apk sin instancia elegida: nada tiene a quién preguntar, ni el login.
    // va antes que el gate de auth porque /login también es bare
    if (!hasInstance() && page.url.pathname !== CONNECT_ROUTE) {
      goto(CONNECT_ROUTE);
      return;
    }
    if (isBareRoute(page.url.pathname)) {
      authChecked = true;
      return;
    }
    if (authCheckDone) return;
    authCheckDone = true;
    fetch(`${apiBase()}/health`)
      .then((res) => {
        if (res.status === 401) goto('/login?returnTo=' + encodeURIComponent(page.url.pathname + page.url.search));
        else {
          Promise.all([loadSettings(), api.me().then(m => { user = m; }), api.version().then(v => { appVersion = v.version; }).catch(() => {})]).finally(() => {
            authChecked = true;
            nowPlayingDisplay = getNowPlayingDisplay();
            sessionTrackingDisplay = getSessionTrackingDisplay();
            sidebarCollapsed = getSidebarCollapsed();
            closedChartsStore.refresh();
            // pulsar una push en el apk lleva a su ruta (en web lo hace el service worker)
            void import('$lib/push').then(({ listenPushTaps }) => listenPushTaps((route) => goto(route)));
            // el índice de colecciones se carga una vez: es lo que deja al menú contextual
            // decidir de forma síncrona si ofrece "add to collection". Sólo tras el gate:
            // pedido en onMount corría también en /login y su 401 lo recargaba en bucle
            collectionsStore.ensure();
            nowPlayingStore.startPolling();
            if (sessionTrackingDisplay !== 'off') projectionsStore.startPolling();
            // namespacing del cache por usuario + limpieza foreign/LRU + prewarming
            setUser(user?.userId ?? user?.spotifyId ?? null);
            bootCleanup();
            prewarmer.start();
          });
        }
      })
      .catch(() => {
        authChecked = true;
      });
  });

  $effect(() => {
    function handleKeydown(e: KeyboardEvent) {
      shortcutStore.handleKeydown(e, {
        openSearch: () => { showSearch = true; },
        isSearchOpen: () => showSearch,
      });
    }
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  });

  const navGroups = [
    // en escritorio el grupo no existe: el dashboard es el logo de la cabecera
    // (la columna no cabía con todo) y History se llega desde "Recent plays" del
    // dashboard, la tarjeta de sesión, las stat cards y el atajo `h`. Ambos siguen
    // en `nav` para que la cabecera móvil titule la página
    {
      label: 'Listen',
      symbol: 'house',
      desktopHidden: true,
      items: [
        { href: '/', label: 'Dashboard', icon: '~' },
        { href: '/history', label: 'History', icon: '#', mobileHidden: true },
      ],
    },
    {
      label: 'Stats',
      symbol: 'chart.bar',
      items: [
        { href: '/top', label: 'Rankings', icon: '*' },
        { href: '/charts', label: 'Charts', icon: '%' },
      ],
    },
    {
      label: 'Highlights',
      symbol: 'star',
      items: [
        { href: '/insights', label: 'Insights', icon: '!' },
        { href: '/records', label: 'Records', icon: '^' },
        { href: '/reports', label: 'Reports', icon: '¶' },
      ],
    },
    {
      label: 'Library',
      symbol: 'square.stack',
      items: [
        { href: '/playlists', label: 'Playlists', icon: '+' },
        { href: '/concerts', label: 'Concerts', icon: '@' },
        { href: '/generators', label: 'Generators', icon: '&' },
      ],
    },
    // el feed entra por el contenedor de friends del sidebar (desktop); en móvil
    // no hay sidebar, así que conserva un tab propio
    {
      label: 'Feed',
      symbol: 'person.2',
      desktopHidden: true,
      items: [
        { href: '/feed', label: 'Feed', icon: '=' },
      ],
    },
  ];

  const nav = navGroups.flatMap(group => group.items);
  const desktopNavGroups = navGroups.filter(g => !('desktopHidden' in g));
  const mobileNavGroups = navGroups
    .map(g => ({ label: g.label, symbol: g.symbol, items: g.items.filter(i => !('mobileHidden' in i)) }))
    .filter(g => g.items.length > 0);

  // app de ios: las pestañas móviles las pinta la barra nativa con liquid glass (rail lateral en el
  // iPhone Duo, también con el layout de escritorio), una por grupo con su sf symbol (solo símbolos
  // de ios <= 15, el deployment target). id = label del grupo: el toque hace lo mismo que el de la
  // pestaña web (navegar o abrir el desplegable del grupo). la barra web queda oculta (app.css).
  // misma query que el @media del layout móvil de app.css
  const MOBILE_QUERY = '(max-width: 768px)';
  const nativeTabs = mobileNavGroups.map(g => ({ id: g.label, title: g.label, symbol: g.symbol }));
  const activeGroupLabel = $derived(mobileNavGroups.find(g => isGroupActive(g))?.label ?? null);

  function onNativeTab(label: string) {
    const group = mobileNavGroups.find(g => g.label === label);
    if (group) handleGroupTap(group);
  }

  function isNavActive(href: string) {
    return page.url.pathname === href || (href !== '/' && page.url.pathname.startsWith(href));
  }

  function isGroupActive(group: typeof mobileNavGroups[number]) {
    return group.items.some(i => isNavActive(i.href));
  }

  // icono con el que se representa un grupo compactado (pestaña móvil, renglón
  // del nav compacto): el del item activo si estás dentro, si no el del primero
  function groupIcon(group: typeof mobileNavGroups[number]) {
    return (group.items.find(i => isNavActive(i.href)) ?? group.items[0]).icon;
  }

  // desplegable del nav compacto: se abre al pasar el ratón (puntero real; en
  // táctil manda el click, si no el primer tap abre y cierra), mismo contrato
  // que HoverPopover
  function hoverGroup(e: PointerEvent, label: string | null) {
    if (e.pointerType === 'touch') return;
    expandedGroup = label;
  }

  function handleGroupTap(group: typeof mobileNavGroups[number]) {
    if (group.items.length === 1) {
      goto(group.items[0].href);
      expandedGroup = null;
    } else {
      expandedGroup = expandedGroup === group.label ? null : group.label;
    }
  }

</script>

<svelte:window onfocus={refreshNowPlayingOnFocus} />
<svelte:document onvisibilitychange={refreshNowPlayingOnFocus} />

{#if isBareRoute(page.url.pathname)}
  {@render children()}
{:else if authChecked}
  <div class="app-layout" class:sidebar-collapsed={sidebarCollapsed}>
    <aside class="sidebar" bind:this={sidebarEl}>
      <div class="sidebar-top">
        <div class="sidebar-head">
          <div class="sidebar-logo">
            <a href="/" class="sidebar-logo-mark" class:active={isNavActive('/')} aria-current={isNavActive('/') ? 'page' : undefined} title="Dashboard"><Wordmark /></a>
          </div>
          <button
            type="button"
            class="sidebar-collapse-toggle"
            onclick={toggleSidebar}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-pressed={sidebarCollapsed}
          >
            <span aria-hidden="true">{sidebarCollapsed ? '»' : '«'}</span>
          </button>
        </div>
        <button class="sidebar-search" onclick={() => showSearch = true} title="Search">
          <span class="sidebar-search-icon">?</span>
          <span>Search</span>
          <kbd>⌘K</kbd>
        </button>
      </div>
      <nav class="sidebar-nav sidebar-nav--desktop" class:sidebar-nav--compact={navCompact} bind:this={navEl} aria-label="Primary navigation">
        {#each desktopNavGroups as group}
          {#if navCompact}
            <!-- el control accesible es el botón; el div sólo capta el hover del ratón -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="sidebar-nav-group"
              onpointerenter={(e) => hoverGroup(e, group.label)}
              onpointerleave={(e) => hoverGroup(e, null)}
            >
              <button
                type="button"
                class="sidebar-nav-group-btn"
                class:active={isGroupActive(group)}
                aria-haspopup="true"
                aria-expanded={expandedGroup === group.label}
                title={group.label}
                onclick={() => handleGroupTap(group)}
              >
                <span class="sidebar-nav-icon" aria-hidden="true">{groupIcon(group)}</span>
                <span>{group.label}</span>
                <span class="sidebar-nav-chevron" aria-hidden="true">›</span>
              </button>
              {#if expandedGroup === group.label}
                <div class="sidebar-nav-flyout" use:positionPopover={'right'}>
                  <div class="sidebar-nav-flyout-panel">
                    <span class="sidebar-nav-heading">{group.label}</span>
                    {#each group.items as item}
                      <a href={item.href} class:active={isNavActive(item.href)} title={item.label} onclick={() => expandedGroup = null}>
                        <span class="sidebar-nav-icon" aria-hidden="true">{item.icon}</span>
                        <span>{item.label}</span>
                      </a>
                    {/each}
                  </div>
                </div>
              {/if}
            </div>
          {:else}
            <div class="sidebar-nav-section">
              <span class="sidebar-nav-heading">{group.label}</span>
              {#each group.items as item}
                <a href={item.href} class:active={isNavActive(item.href)} title={item.label}>
                  <span class="sidebar-nav-icon" aria-hidden="true">{item.icon}</span>
                  <span>{item.label}</span>
                </a>
              {/each}
            </div>
          {/if}
        {/each}
      </nav>
      <MobilePlayer sessionTracking={sessionTrackingDisplay} />
      <nav
        class="mobile-tabbar"
        bind:this={tabbarRef}
        aria-label="Primary navigation"
        use:nativeTabBar={{ tabs: nativeTabs, selected: activeGroupLabel, onSelect: onNativeTab, compactQuery: MOBILE_QUERY }}
      >
        {#each mobileNavGroups as group}
          <div class="mobile-tab-group">
            <button
              type="button"
              class="mobile-tab-btn"
              class:active={isGroupActive(group)}
              onclick={() => handleGroupTap(group)}
            >
              <span class="sidebar-nav-icon" aria-hidden="true">{groupIcon(group)}</span>
              <span>{group.label}</span>
            </button>
            {#if expandedGroup === group.label && group.items.length > 1}
              <div class="mobile-tab-popup">
                {#each group.items as item}
                  <a
                    href={item.href}
                    class:active={isNavActive(item.href)}
                    onclick={() => expandedGroup = null}
                  >
                    <span class="sidebar-nav-icon" aria-hidden="true">{item.icon}</span>
                    <span>{item.label}</span>
                  </a>
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      </nav>
      <div class="sidebar-spacer" bind:this={sidebarSpacerEl}></div>
      <div class="sidebar-friends">
        <FriendsActivity />
      </div>
      {#if sessionTrackingDisplay !== 'off' && (projectionsStore.data?.sessionTrackCount ?? 0) > 0}
        <div class="sidebar-projections">
          <ProjectedChanges />
        </div>
      {/if}
      {#if nowPlayingDisplay !== 'off'}
        <div class="sidebar-now-playing" bind:this={npWrapEl}>
          <NowPlaying compact rail={sidebarCollapsed} inline={npInline} />
        </div>
      {/if}
      {#if user?.authenticated}
        <!-- el control accesible es el botón; el div solo capta el hover del ratón -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="sidebar-user-wrap"
          bind:this={userMenuRef}
          onpointerenter={handleUserBadgeEnter}
          onpointerleave={handleUserBadgeLeave}
        >
          <!-- ancla del menú: el hueco lateral lo pone el wrap, así que el panel
               se posiciona contra esta caja (la del badge) y no contra el gutter -->
          <div class="sidebar-user-anchor">
            <button
              class="sidebar-user"
              class:sidebar-user--open={showUserMenu}
              aria-expanded={showUserMenu}
              aria-haspopup="true"
              onclick={handleUserBadgeClick}
            >
              {#if user.imageUrl}
                <img class="sidebar-user-avatar" src={user.imageUrl} alt="" />
              {:else}
                <div class="sidebar-user-avatar sidebar-user-avatar--empty"><IconArtist size={16} /></div>
              {/if}
              <div class="sidebar-user-info">
                <span class="sidebar-user-name">{user.displayName ?? user.spotifyId}</span>
                <span class="sidebar-user-id">{user.spotifyId}</span>
              </div>
              <span class="sidebar-user-dots"><IconMenuDots size={16} /></span>
              {#if user.isAdmin}<span class="sidebar-admin-badge">admin</span>{/if}
            </button>
            {#if showUserMenu}
              <UserMenu {user} onnavigate={() => showUserMenu = false} />
            {/if}
          </div>
        </div>
      {/if}
      <div class="sidebar-footer">{#if appVersion}<span class="sidebar-version">{appVersion}</span> · {/if}made by <a href="https://mier.info" target="_blank" rel="noopener">mier.info</a></div>
    </aside>
    <main class="main-content">
      <div class="mobile-header">
        <span class="mobile-header-logo"><Wordmark /></span>
        <div class="mobile-header-right">
          <button class="mobile-search-bar" onclick={() => showSearch = true}>
            Search...
          </button>
          {#if user?.authenticated}
            <div class="mobile-user-wrap" bind:this={mobileUserMenuRef}>
              <button class="mobile-user-btn" class:mobile-user-btn--open={showUserMenu} onclick={() => showUserMenu = !showUserMenu}>
                {#if user.imageUrl}
                  <img class="mobile-user-avatar" src={user.imageUrl} alt="" />
                {:else}
                  <div class="mobile-user-avatar mobile-user-avatar--empty"><IconArtist size={15} /></div>
                {/if}
              </button>
              {#if showUserMenu}
                <UserMenu {user} placement="down" header onnavigate={() => showUserMenu = false} />
              {/if}
            </div>
          {/if}
        </div>
      </div>
      {@render children()}
    </main>
  </div>
  <SearchModal bind:show={showSearch} />
  <KeyboardShortcutsHelp />
  <ContextMenu />
  <PlaylistPicker />
  <EntityHoverCard />
  <Toast />
  {#if mergeModal.target}
    <MergeEntityModal
      bind:show={mergeModalShow}
      entityType={mergeModal.target.entityType}
      target={mergeModal.target.target}
      parentId={mergeModal.target.parentId}
      existingMerges={mergeModal.target.existingMerges}
      initialStep={mergeModal.target.initialStep}
      onMerged={() => mergeModal.refresh()}
      onRelate={mergeModal.target.entityType === 'artist'
        ? () => { const t = mergeModal.target!.target; mergeModal.close(); relateModal.open({ target: t }); }
        : undefined}
    />
  {/if}
  {#if collectionModal.target}
    <CollectionModal
      bind:show={collectionModalShow}
      artistId={collectionModal.target.artistId}
      artistName={collectionModal.target.artistName}
      entity={{ type: collectionModal.target.entityType, id: collectionModal.target.entity.id, name: collectionModal.target.entity.name, imageUrl: collectionModal.target.entity.imageUrl }}
    />
  {/if}
  <!-- se pinta solo con el target del store: sin bind:show que sincronizar -->
  <CreditsModal />
  {#if relateModal.target}
    <RelateArtistModal
      bind:show={relateModalShow}
      target={relateModal.target.target}
      existing={relateModal.target.existing}
      onChanged={() => relateModal.refresh()}
      onMerge={() => { const t = relateModal.target!.target; relateModal.close(); mergeModal.open({ entityType: 'artist', target: t }); }}
    />
  {/if}
{/if}
