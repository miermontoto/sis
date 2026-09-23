<script lang="ts">
  // /support: página pública de soporte (ruta bare, sin chrome ni gate de sesión —
  // ver isBareRoute en el layout). las stores exigen un support url accesible sin
  // login. copy compartido desde @platform/ui (hermana de /privacy); sis solo aporta
  // su FAQ y el contacto.
  import Support from '@platform/ui/Support.svelte';

  // FAQ específico de sis; el ítem de borrado usa el token {email}, que el
  // componente renderiza como enlace mailto al contacto.
  const FAQ = [
    {
      q: 'What is SIS?',
      a: 'SIS records what you listen to on Spotify and turns it into a history, rankings, charts and records, with shareable profiles.',
    },
    {
      q: 'Can I bring in my listening history from before I joined?',
      a: 'Yes. Request your data export from Spotify and upload the files in Settings → Import listening history (Extended Streaming History or Account Data). You can also connect Last.fm and backfill your scrobbles.',
    },
    {
      q: 'How do I delete my account and data?',
      a: 'Email us at {email} from your account address and we will delete your account and its associated data. You can also revoke SIS from your Spotify account settings to stop any further syncing.',
    },
  ];
</script>

<svelte:head><title>Support — SIS</title></svelte:head>

<div class="support-page">
  <Support lang="en" appName="SIS" contactEmail="support@mier.info" faq={FAQ} />
</div>

<style>
  .support-page {
    max-width: 720px;
    margin: 0 auto;
    padding: 2.5rem 1rem 4rem;
  }
</style>
