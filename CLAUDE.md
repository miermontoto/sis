# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Architecture

Single-process monorepo: Hono serves API + SvelteKit SPA + background polling → SQLite.

```
Browser <──> Hono :3000
               ├── /api/*      → stats, auth, export, import
               ├── /auth/*     → OAuth login/callback
               ├── /*          → SvelteKit static SPA
               └── [internal]  → PollingService → SQLite (data/sis.db)
```

## Project structure

- `packages/api/` — Hono backend + polling + DB (TypeScript, tsx)
- `packages/web/` — SvelteKit 5 SPA with ECharts (adapter-static)
- `data/` — SQLite database (gitignored)
- Root scripts: `pnpm dev`, `pnpm build`, `pnpm start`

## Key commands

```bash
pnpm dev                    # start API with hot reload (tsx watch)
pnpm build                  # build web → copy to api/static → build api
pnpm db:generate            # generate drizzle migrations after schema changes
docker compose up --build   # full containerized deployment
```

## Database

SQLite with WAL mode via better-sqlite3 + drizzle-orm. Schema in `packages/api/src/db/schema.ts`.
Tables: artists, albums, tracks, track_artists, listening_history, auth_tokens, polling_state.

## Environment variables

Required in `.env` at repo root:
- `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` — from Spotify Developer Dashboard
- `SPOTIFY_REDIRECT_URI` — default: `http://localhost:3000/auth/callback`
- `DATABASE_PATH` — default: `./data/sis.db` (relative to repo root)
- `PORT` — default: `3000`

## Key patterns

### API data flow
- `services/polling.ts` — setInterval-based polling (currently-playing 30s, recently-played 5m, artist metadata 24h)
- `services/ingestion.ts` — `upsertTrack()` upserts album/artists/track from Spotify data; `enrichArtistMetadata()` batch-fetches full artist details (images, genres) via `/v1/artists?ids=`
- `services/spotify-client.ts` — `spotifyFetch<T>()` handles auth headers, 401 token refresh, and 429 rate-limit retry
- `services/token-manager.ts` — stores tokens in DB, auto-refreshes before expiry

### Stats endpoints (`routes/stats.ts`)
All top-* endpoints accept `?range=` (from `TIME_RANGES` in constants.ts), `?limit=`, and `?sort=time|plays`. The `sort` param controls SQL ORDER BY (sum of duration vs count). All return both `playCount` and `totalMs`.

`TIME_RANGES` uses sentinel values: `0` = all time (no filter), `-1` = thisYear (Jan 1 UTC of current year).

### Frontend state
- `packages/web/src/lib/api.ts` — typed API client, all types for API responses, ranking metric preference via localStorage (`sis:rankingMetric`)
- Pages read localStorage preferences on mount (no global store)
- `TimeRangeSelector.svelte` — shared range picker used across Top, Trends, Insights pages

## Deployment

Production: `fa:~/dev/sis` → Docker container on port 3004 → nginx reverse proxy → `https://sis.mier.info`
- Data: Docker volume `sis-data` mounted at `/app/data`
- Callback URL in production: `https://sis.mier.info/auth/callback`
- Docker WORKDIR is `/app/packages/api` so Hono's serveStatic finds `./static`
- Deploy: `ssh fa "cd ~/dev/sis && docker compose up --build -d"`

## History import

`POST /api/import` — multipart/form-data with `.json` files from Spotify data export.
- Auto-detects Extended (`ts` key) vs Basic (`endTime` key) format
- Skips entries < 30s and null track names (podcasts)
- Deduplicates via UNIQUE on `played_at`

## Code style

- Comments in Spanish, technical terms in English
- No magic numbers — constants in `packages/api/src/constants.ts`
- Svelte 5 runes ($state, $derived, $effect)
- ECharts tree-shaken imports via echarts/core

## Notes

- Spotify deprecated audio_features endpoint (Nov 2024) — no audio features data available
- Artist images require separate `/v1/artists` API call (not included in track/recently-played responses); handled by `enrichArtistMetadata()` on startup + 24h interval
- better-sqlite3 requires node-gyp on Node 24 (no prebuilt binaries)
