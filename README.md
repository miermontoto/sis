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

## license

CC BY-NC-SA 4.0
