<script lang="ts">
  // /support: página pública de soporte (ruta bare, sin chrome ni gate de sesión —
  // ver isBareRoute en el layout). las stores exigen un support url accesible sin
  // login. copy compartido desde @platform/ui (hermana de /privacy); sis solo aporta
  // su FAQ y la sección de autoalojamiento.
  import Support from '@platform/ui/Support.svelte';
  import { OFFICIAL_INSTANCE } from '$lib/instance';
  import { instanceHost } from '$lib/utils/instance-url';

  const GUIDE_ROUTE = '/guide';
  const officialHost = instanceHost(OFFICIAL_INSTANCE);

  // FAQ específico de sis; el ítem de borrado usa el token {email}, que el
  // componente renderiza como enlace mailto al contacto.
  const FAQ = [
    {
      q: 'What is sis?',
      a: `sis is a self-hosted listening tracker: a sis server records what you listen to on Spotify and turns it into a history, rankings, charts and records, with shareable profiles. The web, iOS and Android apps show the data of the server you connect them to. ${officialHost} is the developer's own instance and is invite-only.`,
    },
    {
      q: 'Can I bring in my listening history from before I joined?',
      a: 'Yes. Request your data export from Spotify and upload the files in Settings → Import listening history (Extended Streaming History or Account Data). You can also connect Last.fm and backfill your scrobbles.',
    },
    {
      q: 'How do I delete my account and data?',
      a: 'Open Settings → Account → Delete account, in the app or on the web, and confirm: your account and all its data are erased right away. You can also revoke sis from your Spotify account settings to stop any further syncing. If you can no longer sign in, email us at {email}.',
    },
  ];
</script>

{#snippet selfHosting()}
  <p>
    Without an invite, you need your own sis server: a machine with Docker, a Spotify developer app and an
    https address. The <a href={GUIDE_ROUTE}>self-hosting guide</a> walks through it step by step.
  </p>
{/snippet}

<Support faq={FAQ} extra={[{ id: 'self-hosting', title: 'Running your own server', body: selfHosting }]} />
