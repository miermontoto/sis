<script lang="ts">
  // /privacy: política de privacidad pública (ruta bare, sin chrome ni gate de
  // sesión — ver isBareRoute en el layout). copy compartido desde @platform/ui;
  // sección extra propia de sis sobre los datos de escucha de spotify.
  import PrivacyPolicy from '@platform/ui/PrivacyPolicy.svelte';
</script>

<svelte:head><title>Privacy — SIS</title></svelte:head>

<div class="privacy-page">
  <PrivacyPolicy
    lang="en"
    appName="SIS"
    authProvider="Spotify"
    contactEmail="gplay@mier.info"
    updated="2026-06-08"
  >
    <section class="privacy-extra">
      <h2>Spotify listening data</h2>
      <p>
        SIS exists to track and show your listening stats, so with your Spotify
        sign-in we read your listening activity (recently played tracks, current
        playback, your library and top items) and store it to build your history,
        charts and rankings. This data stays in your account and is only used to
        provide these features to you.
      </p>
      <p>
        You can revoke SIS's access at any time from your Spotify account settings;
        doing so stops any further syncing.
      </p>
    </section>
  </PrivacyPolicy>
</div>

<style>
  .privacy-page {
    max-width: 720px;
    margin: 0 auto;
    padding: 2.5rem 1rem 4rem;
  }
  .privacy-extra {
    margin-bottom: var(--ui-section-gap, 1.5rem);
  }
  .privacy-extra h2 {
    margin: 0 0 0.5rem;
    font-size: 0.95rem;
    letter-spacing: 0.02em;
  }
  .privacy-extra p {
    margin: 0 0 0.6rem;
    font-size: 0.9rem;
    line-height: 1.6;
    color: var(--ui-text, inherit);
  }
  .privacy-extra p:last-child {
    margin-bottom: 0;
  }
</style>
