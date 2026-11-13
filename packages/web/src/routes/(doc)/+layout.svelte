<script lang="ts">
  // grupo de las páginas secundarias (guía, privacidad, soporte): fija lo común del armazón de
  // @platform/ui (DocPage). siguen siendo rutas bare del layout raíz (STATIC_ROUTES): sin sesión
  // y, en el apk, sin instancia, porque el picker enlaza a la guía antes de que haya servidor.
  // con afterNavigate, el enlace de la barra vuelve a la vista de la que se vino (picker, login,
  // settings); entrando directo (enlace de la store) va a la raíz, que ya decide entre login,
  // picker y dashboard.
  import { afterNavigate } from '$app/navigation';
  import { page } from '$app/state';
  import { setDocShell } from '@platform/ui/doc-shell';
  import Wordmark from '$lib/components/Wordmark.svelte';
  import { REPO_URL } from '$lib/instance';

  let { children } = $props();

  setDocShell({
    appName: 'sis',
    contactEmail: 'support@mier.info',
    lang: 'en',
    brand,
    afterNavigate,
    links: [
      { href: '/guide', label: 'Self-hosting guide' },
      { href: '/support', label: 'Support' },
      { href: '/privacy', label: 'Privacy' },
      { href: REPO_URL, label: 'Source on GitHub' },
    ],
    get path() {
      return page.url.pathname;
    },
  });
</script>

{#snippet brand()}<span class="doc-mark"><Wordmark /></span>{/snippet}

{@render children()}

<style>
  /* el wordmark mide 1em: el mismo tamaño que el logo del sidebar */
  .doc-mark {
    display: flex;
    font-size: 1.35rem;
  }
</style>
