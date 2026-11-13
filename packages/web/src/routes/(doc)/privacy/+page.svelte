<script lang="ts">
  // /privacy: política de privacidad pública (ruta bare, sin chrome ni gate de
  // sesión — ver isBareRoute en el layout). copy compartido desde @platform/ui;
  // sección extra propia de sis sobre los datos de escucha de spotify.
  import PrivacyPolicy from '@platform/ui/PrivacyPolicy.svelte';
</script>

{#snippet spotify()}
  <p>
    sis exists to track and show your listening stats, so with your Spotify
    sign-in we read your listening activity (recently played tracks, current
    playback, your library and top items) and store it to build your history,
    charts and rankings. This data stays in your account and is only used to
    provide these features to you.
  </p>
  <p>
    You can revoke sis's access at any time from your Spotify account settings;
    doing so stops any further syncing. To erase your account and all of this
    data, use Settings → Account → Delete account.
  </p>
{/snippet}

<PrivacyPolicy
  authProvider="Spotify"
  updated="2026-11-03"
  extra={[{ id: 'spotify', title: 'Spotify listening data', body: spotify }]}
/>
