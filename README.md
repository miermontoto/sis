# sis

self-hosted Spotify listening tracker. polls the Spotify API, stores every play in SQLite, and serves a dashboard to explore your listening history.

live at [sis.mier.info](https://sis.mier.info)

![dashboard](screenshots/sis%20screenshot%20(1).png)

## features

- real-time now playing tracking (30s polling)
- full listening history with infinite scroll
- top tracks, artists, and albums with bar charts
- trends over time (daily plays, listening time)
- insights: heatmaps, genre breakdowns, streaks
- Spotify data export import (extended + basic formats)
- JSON/CSV export

<details>
<summary>more screenshots</summary>

![history](screenshots/sis%20screenshot%20(2).png)
![top](screenshots/sis%20screenshot%20(3).png)
![trends](screenshots/sis%20screenshot%20(4).png)
![insights](screenshots/sis%20screenshot%20(5).png)

</details>

## stack

| layer | tech |
|-------|------|
| backend | Hono, better-sqlite3, drizzle-orm |
| frontend | SvelteKit 5 (adapter-static), ECharts |
| runtime | Node.js, tsx |
| deploy | Docker, nginx |

## setup

```bash
cp .env.example .env  # fill in Spotify credentials
pnpm install
pnpm dev              # http://localhost:3000
```

### docker

```bash
docker compose up --build -d
```

## self-hosting

SIS is built to run as your own instance: every instance uses its own Spotify keys, and the Android app connects to whichever instance you point it at.

1. create an app in the [Spotify developer dashboard](https://developer.spotify.com/dashboard) and add `https://<your-host>/auth/callback` as a redirect URI. Spotify only accepts `http` for loopback addresses, so a real instance needs a hostname with TLS (a reverse proxy, Cloudflare Tunnel, Tailscale Funnel…). that same rule is why the app refuses `http://` instances.
2. copy `.env.example` to `.env`, fill in `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` and `SPOTIFY_REDIRECT_URI`, then `docker compose up --build -d`. the database lives in the `sis-data` volume.
3. open the instance and sign in with Spotify. the first login becomes the admin; further users are added from Settings → Account.
4. in the Android app, enter your instance address on the connect screen (Settings → Connections → Instance to change it later).

optional integrations are credential-gated and off until configured: Last.fm (login + scrobble sync), setlist.fm (concert setlists) and push notifications (`docs/PUSH_NOTIFICATIONS_SETUP.md`). from the store app, push notifications and the mier.info login are only available on the official instance: push tokens are bound to the app's Firebase project, and the mier.info OAuth client only exists for `sis.mier.info`.

## license

CC BY-NC-SA 4.0
