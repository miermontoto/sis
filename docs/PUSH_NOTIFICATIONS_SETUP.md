# Push notifications setup

SIS can send push notifications about notable listening events to Android (via
Firebase Cloud Messaging) and to browsers (via VAPID web push).

The whole pipeline is **credential-gated**: with none of the env vars below set,
SIS still detects events and runs every step *except* the final send — the
sender simply no-ops and logs, and never throws. You can therefore deploy first
and drop the credentials in later; nothing breaks in the meantime.

Notifications are also **opt-in per user**: the master switch
(`notificationsEnabled`) defaults to off. A user turns it on from **Settings →
Notifications**, which triggers the OS/browser permission prompt and registers
the device.

---

## 1. Environment variables

All are optional. Presence of a *complete* group enables that transport.

| Variable | Enables | Value | Notes |
| --- | --- | --- | --- |
| `FIREBASE_SERVICE_ACCOUNT` | Android / FCM | Path to the Firebase service-account JSON file | If unset or the file is missing, FCM is disabled |
| `VAPID_PUBLIC_KEY` | Web push | VAPID public key | Also exposed to the browser via `GET /api/push/vapid-public-key` |
| `VAPID_PRIVATE_KEY` | Web push | VAPID private key | Keep secret |
| `VAPID_SUBJECT` | Web push | `mailto:you@example.com` | Contact address required by the web-push spec |

Web push needs **all three** `VAPID_*` vars; if any is missing, web push is
disabled. FCM needs `FIREBASE_SERVICE_ACCOUNT` pointing at a readable JSON file.

Copy the placeholders from `.env.example` into your `.env` and fill them in.

---

## 2. Firebase Console — Android / FCM

1. **Create a Firebase project**
   Go to <https://console.firebase.google.com/> → *Add project*. Give it a name
   (e.g. `sis`). Google Analytics is optional and not required.

2. **Register the Android app**
   In the project, *Add app* → Android. Use the exact package name:

   ```
   info.mier.sis
   ```

   (this matches `applicationId` / `namespace` in
   `packages/web/android/app/build.gradle`). The SHA-1 / debug signing fields are
   optional for FCM data pushes and can be left blank.

3. **Download `google-services.json`**
   Firebase generates a `google-services.json` for the app. Download it and place
   it at:

   ```
   packages/web/android/app/google-services.json
   ```

   A template lives next to it (`google-services.json.template`) — it is a
   placeholder, **not** a working file. The Gradle build only applies the
   `com.google.gms.google-services` plugin when a file literally named
   `google-services.json` exists (see `packages/web/android/app/build.gradle`
   lines ~70-76), so keeping only the `.template` around leaves push **off** until
   you drop in the real file.

4. **Generate a service-account key (backend / FCM sender)**
   Firebase Console → *Project settings* (gear) → **Service accounts** →
   *Generate new private key*. This downloads a JSON credentials file. Store it
   **outside the repo** (it is a secret) and point `FIREBASE_SERVICE_ACCOUNT` at
   its path. The backend loads it with `admin.credential.cert(...)`.

   > `google-services.json` (client, ships in the APK) and the service-account
   > key (server, stays secret) are two different files. You need both for the
   > full Android round-trip.

---

## 3. VAPID keys — web push

Generate a VAPID key pair with the `web-push` CLI (no install needed):

```bash
npx web-push generate-vapid-keys
```

It prints a public and a private key. Set them as:

```
VAPID_PUBLIC_KEY=<public key>
VAPID_PRIVATE_KEY=<private key>
VAPID_SUBJECT=mailto:you@example.com
```

The public key is served to the browser at `GET /api/push/vapid-public-key`;
the client uses it as the `applicationServerKey` when subscribing.

---

## 4. Docker deployment

`docker-compose.yml` already passes the four variables through to the container
(they resolve from the repo-root `.env`). For **FCM** you additionally need the
service-account JSON *inside* the container, since it is a file on disk.

1. Put the service-account JSON somewhere on the host, e.g.
   `./secrets/firebase-service-account.json` (git-ignored — never commit it).

2. Uncomment the mount example in `docker-compose.yml`:

   ```yaml
   volumes:
     - sis-data:/app/data
     - ./secrets/firebase-service-account.json:/app/secrets/firebase-service-account.json:ro
   ```

3. Set the env var to the **container** path (not the host path):

   ```
   FIREBASE_SERVICE_ACCOUNT=/app/secrets/firebase-service-account.json
   ```

4. Rebuild/restart:

   ```bash
   docker compose up --build -d
   ```

Web push needs no mounts — the three `VAPID_*` vars in `.env` are enough.

---

## 5. Android app — sync & rebuild

`google-services.json` and the push plugin are consumed by the native Android
project, so after adding the file (and any web-side changes) sync Capacitor and
rebuild the APK:

```bash
cd packages/web
pnpm build              # build the web SPA
npx cap sync android    # copy web assets + native plugins into android/
# then build the APK from android/ (Android Studio or ./gradlew assembleRelease)
```

If `google-services.json` is present, the Gradle build applies the
`google-services` plugin automatically; if not, it logs a warning and push stays
disabled — the app still builds and runs.

---

## 6. What each notification means

There are exactly four event types. Two sources produce them.

**From the records cache** (fires when a headline record is broken):

- **`record`** — an entity (track, album or artist) newly **enters the top-10**
  of a headline record category. Watched categories: peak week plays, most weeks
  at #1, and longest chart run. Throttled (see below).

**From the weekly chart close** (fires once, shortly after a week rolls over —
week granularity only in phase 1):

- **`chart_closing`** — a recap of the **top-3** of the week's final chart. Sent
  when a week closes.
- **`number_one`** — a **new #1**: the track that finished the closed week at
  rank 1 *and was not #1 the previous week*.
- **`biggest_debut`** — the **highest-ranked brand-new entry** on the closed
  week's chart (a track appearing for the first time).

Chart-close events fire only for the week *immediately* prior to "now". If the
app was down and several weeks were skipped, only that most recent closed week
fires; older weeks are not backfilled. On first boot the current week is just
recorded (nothing fires), so backfills/imports don't trigger a burst.

### Delivery guards

- **Opt-in**: an event sends only if the user has `notificationsEnabled` on
  **and** the matching per-type toggle on (`notifyRecords`, `notifyNumberOne`,
  `notifyChartClosings`, `notifyBiggestDebut`).
- **No deliverable channel**: if the user has no active device token *on a
  configured transport* (no device at all, or FCM/VAPID creds not set for the
  device's platform), nothing is sent and nothing is recorded — so the event can
  still fire once a device is registered **and** credentials exist. This is why
  events aren't "consumed" while you run credential-less.
- **Throttle**: only `record` is capped at `NOTIFICATION_MAX_PER_DAY` (15) per
  user per rolling 24h. The weekly-close events (`number_one`, `chart_closing`,
  `biggest_debut`) bypass the cap so a busy records day can't swallow them.
- **Dedup**: each `(user, type, entity, period)` is sent at most once.

---

## 7. Quick checklist

- [ ] `.env` has `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (web push)
- [ ] `.env` has `FIREBASE_SERVICE_ACCOUNT` + the JSON mounted into the container (Android)
- [ ] `packages/web/android/app/google-services.json` in place (Android)
- [ ] `npx cap sync android` + APK rebuilt (Android)
- [ ] `docker compose up --build -d`
- [ ] In the app: **Settings → Notifications**, toggle on, accept the permission prompt
