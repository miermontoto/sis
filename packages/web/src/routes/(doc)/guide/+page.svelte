<script lang="ts">
  // /guide: guía pública de autoalojamiento (ruta bare como /privacy y /support: sin
  // sesión y, en el apk, sin instancia, porque el picker enlaza aquí antes de que haya
  // servidor). sis es autoalojado y las apps son clientes de un servidor, así que ésta
  // es la página que explica cómo montar uno; también es la marketing url de las stores.
  // el armazón (barra, índice, pie y el atrás) es el DocPage de @platform/ui, fijado en (doc)/+layout.
  import DocPage from '@platform/ui/DocPage.svelte';
  import DocSection from '@platform/ui/DocSection.svelte';
  import { EXAMPLE_INSTANCE, OFFICIAL_INSTANCE, REPO_URL } from '$lib/instance';
  import { instanceHost } from '$lib/utils/instance-url';

  const LINKS = {
    spotifyDashboard: 'https://developer.spotify.com/dashboard',
    spotifyData: 'https://www.spotify.com/account/privacy/',
    lastfmApi: 'https://www.last.fm/api/account/create',
    setlistfmApi: 'https://www.setlist.fm/settings/api',
    pushDoc: `${REPO_URL}/blob/main/docs/PUSH_NOTIFICATIONS_SETUP.md`,
  };
  // usuarios de una app de spotify en development mode (límite vigente desde feb 2026)
  const SPOTIFY_DEV_MODE_USERS = 5;
  // escuchas que spotify devuelve en recently-played: lo único recuperable tras un corte
  const SPOTIFY_RECENT_PLAYS = 50;
  // puerto del host que publica docker-compose.yml
  const HOST_PORT = 3004;
  const officialHost = instanceHost(OFFICIAL_INSTANCE);
  const exampleHost = instanceHost(EXAMPLE_INSTANCE);
  const callbackUrl = `${EXAMPLE_INSTANCE}/auth/callback`;

  // índice y títulos salen de la misma tabla: un ancla del índice no puede quedar huérfana
  const SECTIONS = {
    why: 'Why self-hosted',
    needs: 'What you need',
    setup: 'Set up your server',
    apps: 'Connect the apps',
    extras: 'Optional integrations',
    first: 'First steps',
    upkeep: 'Updates and backups',
  } as const;
  const toc = Object.entries(SECTIONS).map(([id, title]) => ({ id, title }));

  const START = 'docker compose up --build -d';
  const CLONE = [`git clone --recurse-submodules ${REPO_URL}.git`, 'cd sis', 'cp .env.example .env'].join('\n');
  const ENV = ['SPOTIFY_CLIENT_ID=<client id>', 'SPOTIFY_CLIENT_SECRET=<client secret>', `SPOTIFY_REDIRECT_URI=${callbackUrl}`].join('\n');
  const UPDATE = ['cd sis', 'git pull --recurse-submodules', START].join('\n');
</script>

{#snippet code(text: string)}
  <pre><code>{text}</code></pre>
{/snippet}

<DocPage title="Self-hosting guide" kicker="Guide" {toc}>
  {#snippet intro()}
    <p>
      sis is self-hosted. A sis server signs in to Spotify for you, records every play in a database on
      your own machine and serves the dashboard. The web app and the iOS and Android apps are clients:
      they show the server you point them at.
    </p>
    <p>
      {officialHost} is the developer's own instance and it is invite-only, so using sis means running a
      server or being invited to one. This guide covers the first.
    </p>
  {/snippet}

  <DocSection id="why" title={SECTIONS.why}>
    <p>
      Spotify caps an app in development mode at {SPOTIFY_DEV_MODE_USERS} users, and the account that owns
      it needs Premium. Access beyond that is reserved for large registered companies, so no single sis can
      take everyone: each instance brings its own Spotify app and its own {SPOTIFY_DEV_MODE_USERS} seats.
    </p>
    <p>
      It also means your listening history lives on hardware you control. sis has no third-party analytics:
      the only outside calls are the ones that fetch your plays and their metadata (Spotify, MusicBrainz) and
      the integrations you turn on.
    </p>
  </DocSection>

  <DocSection id="needs" title={SECTIONS.needs}>
    <ul>
      <li>
        <strong>A machine that stays on</strong>, with Docker and git: a home server, a NAS or a small VPS.
        sis polls Spotify around the clock, and after an outage it can only recover the last
        {SPOTIFY_RECENT_PLAYS} plays Spotify still reports.
      </li>
      <li>
        <strong>A public https address</strong> for it: a reverse proxy (nginx, Caddy, Traefik), Cloudflare
        Tunnel or Tailscale Funnel. Spotify only accepts plain http redirects on loopback addresses, and the
        apps only connect to https servers.
      </li>
      <li><strong>Spotify Premium</strong> on the account that owns the Spotify app.</li>
    </ul>
  </DocSection>

  <DocSection id="setup" title={SECTIONS.setup}>
    <ol class="guide-steps">
      <li>
        <h3>Create a Spotify app</h3>
        <p>
          In the <a href={LINKS.spotifyDashboard} target="_blank" rel="noopener">Spotify developer dashboard</a>,
          create an app that uses the Web API and add <code>{callbackUrl}</code> as its redirect URI, with
          your address instead of {exampleHost}. Keep its client ID and client secret at hand. Then, under
          User Management, add the name and Spotify email of each person who will sign in with Spotify.
        </p>
      </li>
      <li>
        <h3>Get sis and configure it</h3>
        {@render code(CLONE)}
        <p>Fill in these three lines of <code>.env</code>; every other setting in it is optional.</p>
        {@render code(ENV)}
      </li>
      <li>
        <h3>Start it</h3>
        {@render code(START)}
        <p>
          The first build compiles everything and takes a few minutes. sis answers on port {HOST_PORT} of the
          host (change the mapping in <code>docker-compose.yml</code> if it is taken) and keeps its database in
          the <code>sis-data</code> Docker volume.
        </p>
      </li>
      <li>
        <h3>Publish it over https</h3>
        <p>
          Point your reverse proxy or tunnel for {exampleHost} at <code>http://localhost:{HOST_PORT}</code>.
        </p>
      </li>
      <li>
        <h3>Sign in</h3>
        <p>
          Open your address and sign in with Spotify. The first account to sign in becomes the admin, and from
          then on the instance is invite-only.
        </p>
      </li>
      <li>
        <h3>Invite people</h3>
        <p>
          In <a href="/settings?tab=account">Settings → Account</a> → User management, add each person by
          Spotify user ID (the username on their Spotify account page) or Last.fm username. People who sign
          in with Spotify also need to be in your Spotify app's User Management.
        </p>
      </li>
    </ol>
  </DocSection>

  <DocSection id="apps" title={SECTIONS.apps}>
    <ul>
      <li>
        <strong>iOS and Android</strong>: on first launch the app asks for a server; enter your address. To
        switch later, go to Settings → Connections → Instance.
      </li>
      <li><strong>Web</strong>: open your address in any browser, which can also install it as an app.</li>
    </ul>
    <p class="guide-note">
      Two things in the store apps depend on {officialHost} and are off on other servers: push notifications
      (the apps' push tokens belong to its Firebase project; web push works on any instance) and Sign in with
      mier.info. Links to your instance open in the browser rather than in the app.
    </p>
  </DocSection>

  <DocSection id="extras" title={SECTIONS.extras}>
    <p>
      Each one stays off until its keys are in <code>.env</code>; apply them with
      <code>docker compose up -d</code>.
    </p>
    <ul>
      <li>
        <strong>Last.fm</strong> — <code>LASTFM_API_KEY</code>, <code>LASTFM_API_SECRET</code>
        (<a href={LINKS.lastfmApi} target="_blank" rel="noopener">get a key</a>): sign in with Last.fm and
        scrobble sync. Last.fm accounts don't take Spotify seats, so it is also how an instance grows past
        {SPOTIFY_DEV_MODE_USERS} people: their plays come from their scrobbles instead of Spotify.
      </li>
      <li>
        <strong>setlist.fm</strong> — <code>SETLISTFM_API_KEY</code>
        (<a href={LINKS.setlistfmApi} target="_blank" rel="noopener">free key</a>): setlist search and import
        in the concert log.
      </li>
      <li>
        <strong>Push notifications</strong> — Firebase and VAPID keys: see the
        <a href={LINKS.pushDoc} target="_blank" rel="noopener">push setup notes</a>.
      </li>
    </ul>
  </DocSection>

  <DocSection id="first" title={SECTIONS.first}>
    <ul>
      <li>
        <strong>Bring your history.</strong> Spotify only hands out your last {SPOTIFY_RECENT_PLAYS} plays, so
        sis starts counting the day you sign in. Request your data on
        <a href={LINKS.spotifyData} target="_blank" rel="noopener">Spotify's privacy page</a> (the Extended
        streaming history goes back to the start of your account) and upload the files in
        <a href="/settings?tab=data">Settings → Data</a> → Import listening history.
      </li>
      <li>
        <strong>Connect Last.fm</strong> in <a href="/settings?tab=connections">Settings → Connections</a> to
        backfill your scrobbles and keep them in sync.
      </li>
      <li>
        <strong>Add other players.</strong> Anything that speaks the ListenBrainz API (Navidrome, Pano
        Scrobbler, Web Scrobbler…) can send plays with your token: Settings → Connections → Scrobblers shows
        the URL each one needs.
      </li>
    </ul>
  </DocSection>

  <DocSection id="upkeep" title={SECTIONS.upkeep}>
    {@render code(UPDATE)}
    <p>
      The database updates itself on boot; there is nothing to migrate by hand. Your whole history is one
      SQLite file in the <code>sis-data</code> volume: back it up with the container stopped
      (<code>docker compose stop</code>) so the copy is consistent. Settings → Data also exports your plays as
      JSON or CSV.
    </p>
  </DocSection>

</DocPage>

<style>
  /* pasos numerados: el número en una celda mono con el acento, como el resto de cifras de sis */
  .guide-steps {
    padding: 0;
    list-style: none;
    counter-reset: guide-step;
  }
  .guide-steps > li {
    position: relative;
    margin-bottom: 1.75rem;
    padding-left: 2.6rem;
    counter-increment: guide-step;
  }
  .guide-steps > li:last-child {
    margin-bottom: 0;
  }
  .guide-steps > li::before {
    content: counter(guide-step);
    position: absolute;
    top: 0;
    left: 0;
    display: grid;
    place-items: center;
    width: 1.65rem;
    height: 1.65rem;
    border: 1px solid var(--accent-a40);
    border-radius: var(--radius);
    background: var(--accent-a05);
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    color: var(--accent);
  }
  .guide-steps h3 {
    margin: 0 0 0.4rem;
    line-height: 1.65rem;
  }

  /* aviso: lo que en las apps de la store depende de la instancia oficial */
  .guide-note {
    padding: 0.8rem 1rem;
    border-left: 2px solid var(--accent);
    background: var(--accent-a05);
    color: var(--text-muted);
  }
</style>
