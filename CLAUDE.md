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
pnpm check                  # lint (oxlint) + typecheck both packages (api: tsc; web: svelte-check)
pnpm lint                   # oxlint only
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
- `LOG_LEVEL` — `debug|info|warn|error|silent`, default `info`. Read once at startup; an invalid value falls back to `info` rather than muting the process.

Push notifications (optional — credential-gated; if unset the pipeline detects events but the sender no-ops + logs, never throws — see `docs/PUSH_NOTIFICATIONS_SETUP.md`):
- `FIREBASE_SERVICE_ACCOUNT` — path to the Firebase service-account JSON (enables Android/FCM)
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` — web push (VAPID) keys + `mailto:` subject (enables browser push)

Last.fm integration (optional — credential-gated, no-ops if unset; enables Last.fm SSO + scrobble sync):
- `LASTFM_API_KEY`, `LASTFM_API_SECRET` — from https://www.last.fm/api/account/create
- `LASTFM_REDIRECT_URI` — optional; defaults to `<SPOTIFY_REDIRECT_URI origin>/auth/lastfm/callback`

id.mier.info SSO (optional — credential-gated, no-ops if unset; enables "Sign in with mier.info" via OIDC authorization code + PKCE; identity-only, no data sync):
- `MIERID_CLIENT_ID`, `MIERID_CLIENT_SECRET` — OAuth client registered at id.mier.info
- `MIERID_REDIRECT_URI` — optional; defaults to `<SPOTIFY_REDIRECT_URI origin>/auth/mierid/callback`

## Key patterns

### API data flow
- `services/polling.ts` — setInterval-based polling (currently-playing 30s, recently-played 5m, artist metadata 24h)
- `services/ingestion.ts` — `upsertTrack()` upserts album/artists/track from Spotify data; `enrichArtistMetadata()` batch-fetches full artist details (images, genres) via `/v1/artists?ids=`
- `services/spotify-client.ts` — `spotifyFetch<T>()` handles auth headers, 401 token refresh, and 429 rate-limit retry
- `services/token-manager.ts` — stores tokens in DB, auto-refreshes before expiry
- `services/logger.ts` — `createLogger(scope)` for all API logging; no raw `console.*` in `packages/api` (the linter would let one through, so keep it by convention). Output is `[scope] message`, and `log.child(userId)` gives `[scope:12]` for per-user cycles. Chatty per-cycle lines belong at `debug`.

### Multi-source identity
Entity PKs stay in the spotify_id space (real IDs + `import:`/`local:` synthetics). `tracks.isrc/mbid`, `artists.mbid`, `albums.mbid` are resolution *evidence*, never keys (NULL = unqueried, `''` = queried without result). Resolution ladder in `history-import.ts`: isrc → mbid → name+primary artist (position 0 only) → mint synthetic; events accrete missing ids onto entities they resolve to. `ingestion/identity.ts` harvests ISRCs (Spotify `/tracks`, capped/cycle), MBIDs+ISRCs for synthetics (MusicBrainz, capped/cycle) and merges synthetics into real tracks sharing an id (`mergeTracksByIdentity`, via `reassignTrackRefs`). `listening_history.source` records play provenance (`spotify`|`lastfm`|`import`; NULL = pre-column rows).

### Stats endpoints (`routes/stats.ts`)
All top-* endpoints accept `?range=` (from `TIME_RANGES` in constants.ts), `?limit=`, and `?sort=time|plays`. The `sort` param controls SQL ORDER BY (sum of duration vs count). All return both `playCount` and `totalMs`.

`TIME_RANGES` uses sentinel values: `0` = all time (no filter), `-1` = thisYear (Jan 1 UTC of current year).

### Chart peaks (streaming)
`/stats/charts/peaks` (batch JSON) and `/stats/charts/peaks/stream` (NDJSON, one line per entity) return the same stats. Both drive `services/chart-peaks.ts`: the per-period `ROW_NUMBER()` scan is split into one-calendar-year `played_at` windows (work-preserving, since the ranking is partitioned by period, and index-friendly via `(user_id, played_at)`), walked newest → oldest, closing each entity once the scan passes its own first play. Year cut points are `Jan 1 + weekStart shift`, which never splits a period label. The batch endpoint stays as the client's fallback (shipped APKs, proxies that eat chunked responses).

Writing any streaming route: `dbRead` runs **synchronously on the main thread in dev** (worker pool only in prod), so the handler must `await setImmediate` between chunks or nothing flushes until it returns. Set `X-Accel-Buffering: no` so nginx doesn't buffer it in production.

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

## Scrobble ingestion (ListenBrainz-compatible)

`GET /1/validate-token` + `POST /1/submit-listens` (`single`|`import`|`playing_now`), mounted at the site root *outside* the session gate — auth is a per-user token (`listen_tokens`, managed via `/api/listen-token` and Settings → Connections → Scrobblers). Clients (Pano Scrobbler, Web Scrobbler, Navidrome…) point their custom ListenBrainz server URL at the site origin. Listens map to `ListenEvent` → `importListenEvents()` (`history-import.ts`), which runs the identity ladder — a `spotify_id` URL in `additional_info` resolves directly; isrc/mbid/duration from clients accrete onto entities. `playing_now` writes `polling_state` only for users without Spotify tokens (same rule as Last.fm). Plays are tagged `source='listenbrainz'`; scrobble-vs-polling twins are cleaned by the boot + daily dedup pair.

## History import

`POST /api/import` — multipart/form-data with `.json` files from Spotify data export.
- Auto-detects Extended (`ts` key) vs Basic (`endTime` key) format
- Skips entries < 30s and null track names (podcasts)
- Deduplicates via UNIQUE on `played_at`

## Code style

- Comments in Spanish, technical terms in English
- No magic numbers — constants in `packages/api/src/constants.ts`
- Run `pnpm check` before committing: Vite only transpiles types, so nothing else catches type errors in `packages/web`. The web gate is `--threshold warning` and the tree is at 0/0 — a11y and unused-CSS warnings block too. Where a mouse-only handler is a deliberate enhancement over already-accessible content, suppress with `<!-- svelte-ignore <code>, <code> -->` (comma-separated) plus a comment saying why.
- `pnpm check` runs oxlint first (`.oxlintrc.json`, tree at 0 findings). Only `correctness` is on plus a few hand-picked rules; the `perf`/`suspicious` categories are off on purpose (they flag the deliberate sequential `await`s in Spotify pagination). Two rules are disabled for `.svelte` only, because the Svelte compiler defeats them: `no-unassigned-vars` (`bind:this` targets are assigned by the compiler) and `no-unused-expressions` (a bare `store.value;` inside `$effect` is how a dependency is registered — deleting it silently breaks reactivity).
- Svelte 5 runes ($state, $derived, $effect)
- ECharts tree-shaken imports via echarts/core

## Git & deploy workflow

- Auto-commit is authorized in this repo (overrides the global "don't commit unless prompted" rule). Commit committable changes **before the turn ends**, grouped logically, with descriptive conventional-commit messages (`type(scope): summary` — feat/fix/chore, matching git history).
- Deploy is automatic: a `Stop` hook in `.claude/settings.local.json` (gitignored) runs `docker compose up --build -d` after the turn, but **only when `packages/**` changed** since the last deploy (marker: `.git/sis-last-deploy`). Committing packages changes is enough — don't deploy manually. A shell hook can't write descriptive commit messages, so the commit is done in-turn (by the agent), the deploy by the hook.
- Each deploy recreates the single container → a brief (~seconds) 502 while it restarts. Expected.
- No changelog: the app ships no release notes. The version tag in the sidebar footer is plain text; don't reintroduce a changelog file, route or modal.

## Notes

- Spotify deprecated audio_features endpoint (Nov 2024) — no audio features data available
- Artist images require separate `/v1/artists` API call (not included in track/recently-played responses); handled by `enrichArtistMetadata()` on startup + 24h interval
- better-sqlite3 requires node-gyp on Node 24 (no prebuilt binaries)
