# SIS — Self-hosted Spotify Stats Tracker

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
- `SPOTIFY_CLIENT_ID` — from Spotify Developer Dashboard
- `SPOTIFY_CLIENT_SECRET` — from Spotify Developer Dashboard
- `SPOTIFY_REDIRECT_URI` — default: `http://localhost:3000/auth/callback`
- `DATABASE_PATH` — default: `./data/sis.db` (relative to repo root)
- `PORT` — default: `3000`

## OAuth flow

1. Visit `/auth/login` → redirects to Spotify
2. Spotify redirects to `/auth/callback` → stores tokens → starts polling
3. Token manager auto-refreshes before expiry

## Deployment

Production: `fa:~/dev/sis` → Docker container on port 3004 → nginx reverse proxy → `https://sis.mier.info`
- Nginx config: `fa:/home/mier/hosts/nginx-proxy/nginx/sites-enabled/sis.mier.info.conf`
- SSL: Let's Encrypt via certbot (auto-renewed by `/home/mier/hosts/nginx-proxy/renew-ssl.sh`)
- Data: Docker volume `sis-data` mounted at `/app/data`
- Callback URL in production: `https://sis.mier.info/auth/callback`

## History import

`POST /api/import` — multipart/form-data with `.json` files from Spotify data export.
- Auto-detects Extended (`ts` key) vs Basic (`endTime` key) format
- Skips entries < 30s (skipped tracks) and null track names (podcasts)
- Deduplicates via UNIQUE on `played_at`
- Service: `packages/api/src/services/history-import.ts`

## Code style

- Comments in Spanish, technical terms in English
- No magic numbers — constants in `packages/api/src/constants.ts`
- Svelte 5 runes ($state, $derived, $effect)
- ECharts tree-shaken imports via echarts/core
