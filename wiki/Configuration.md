YT Zero is configured through environment variables. All of them are optional and have sensible defaults.

The application timezone is configured inside **Settings → Appearance → Timezone**
using an IANA name such as `Europe/London`. It controls dates and times across
the UI, scheduling, logs, Insights/Pulse, backups, imports, cleanup boundaries,
and child daily limits. It does not depend on the browser timezone. When `TZ`
is set to a valid IANA name, it becomes the instance timezone and the timezone
picker is read-only until `TZ` is removed and the instance restarted.

## Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3001` | HTTP server port. |
| `TZ` | _(unset)_ | Optional IANA timezone (for example `Europe/Warsaw`). When set, it overrides the saved timezone and prevents changes from the UI. |
| `IDLE_TIMEOUT_SECONDS` | `120` | HTTP idle timeout. Manual channel sync can take longer than Bun's 10-second default when playlist scanning is enabled. |
| `DB_PATH` | `./data/db/ytzero.db` | SQLite database path. |
| `SQLITE_BUSY_TIMEOUT_MS` | `5000` | How long SQLite waits for another process to release a database lock before returning `SQLITE_BUSY` (`0`–`60000`). |
| `SQLITE_OPTIMIZE_INTERVAL_HOURS` | `24` | Interval for bounded planner-statistics maintenance on a long-lived SQLite connection (`1`–`168`). |
| `IMG_CACHE_DIR` | `./data/imgcache` | Thumbnail and image cache directory. |
| `IMG_CACHE_TTL_DAYS` | `5` | How long a cached image is fresh before a refetch is attempted. |
| `AVATAR_DIR` | `./data/avatars` | Uploaded profile avatars. |
| `LOG_PATH` | `./data/logs/ytzero.log` | Active log file. Logs also go to stdout and rotate daily in the timezone selected in Settings, to dated files such as `ytzero-2026-07-26.log`; archives are retained. The in-app viewer reads the active file. |
| `REFRESH_INTERVAL_MINUTES` | `5` | Followed-channel RSS refresh interval. |
| `ADAPTIVE_REFRESH_MIN_MINUTES` | `10` | Minimum automatic interval for one channel feed. This is the hard cooldown that prevents frequent uploaders from being polled continuously. |
| `ADAPTIVE_REFRESH_MAX_MINUTES` | `720` | Maximum automatic interval for one channel feed. This guarantees that infrequent channels remain in the refresh rotation. |
| `ADAPTIVE_REFRESH_UNKNOWN_MINUTES` | `120` | Automatic interval used until a channel has at least three known publication dates. |
| `ADAPTIVE_REFRESH_INACTIVE_MAX_MINUTES` | `4320` | Maximum adaptive interval for channels without recent uploads (up to three days). |
| `FULL_SYNC_INTERVAL_MINUTES` | `15` | Interval between full, rotating channel scans. One subscribed channel is scanned per run, using the same process as the manual channel sync button. |
| `PLAYLIST_SYNC_INTERVAL_MINUTES` | `15` | Interval between followed-playlist refreshes. One playlist is synchronized per run. |
| `POSTS_SYNC_INTERVAL_MINUTES` | `10` | Interval between Community Post scheduler passes. One eligible followed channel is synchronized per run. |
| `POSTS_SYNC_MAX_AGE_MINUTES` | `360` | Per-channel freshness window for the persisted Community Post catalog, including channels whose last successful result was empty. |
| `LIVE_INTERVAL_MINUTES` | `3` | Followed-channel live-status check interval. This does not refetch old video metadata. |
| `AVATAR_REFRESH_INTERVAL_MINUTES` | `60` | Interval for refreshing stale channel avatars. |
| `AVATAR_REFRESH_BATCH_SIZE` | `4` | Maximum channel avatars refreshed in one maintenance pass. |
| `DURATION_INTERVAL_MINUTES` | `3` | Interval for the background job that backfills missing video durations. |
| `DURATION_BATCH_SIZE` | `20` | Videos processed per duration-backfill run. |
| `IMPORT_ENRICH_INTERVAL_MINUTES` | `2` | Interval for the background job that fills in real metadata for videos brought in by a [Takeout import](Importing-from-Google-Takeout). |
| `IMPORT_ENRICH_BATCH_SIZE` | `15` | Videos processed per import-enrichment run. Together with the interval, this sets the pace shown in the import wizard's time estimate. |
| `VIDEO_MAINTENANCE_MAX_AGE_DAYS` | `90` | Maximum video age considered by automatic Shorts and duration backfills. Older videos are resolved only when accessed or manually synchronized. |
| `UI_DIST` | `./public` | Built frontend directory served by the backend. |
| `DOWNLOADS_DIR` | `./data/downloads` | Where the [YT-DLP Integration](YT-DLP-Integration) plugin stores downloaded video files and their `<videoId>.ytz.json` recovery sidecars. Move each sidecar with its media file. |
| `DOWNLOAD_COOKIES_DIR` | `./data/download-cookies` | Private persistent directory for per-profile YouTube cookie files. In a cluster it must be shared with the background worker. |
| `TUBE_ARCHIVIST_CONFIG_DIR` | next to the data directory | Directory containing the machine-local TubeArchivist access token. Share it between replicas that serve or synchronize TubeArchivist content. |
| `YTDLP_PATH` | `yt-dlp` | Path to the yt-dlp binary used by the [YT-DLP Integration](YT-DLP-Integration) plugin. |
| `FFMPEG_PATH` | `ffmpeg` | Path to ffmpeg, used for merged downloads and experimental stream-while-downloading playback. |
| `YTDLP_AUTO_UPDATE` | _(unset; `1` in Docker)_ | Initial default for automatic yt-dlp updates (`1` means daily). An administrator can later choose Never, 1, 3, 7, or 30 days and the stable/nightly channel in the Downloads UI. |
| `APP_URL` | _(derived from request)_ | Public base URL. Used as the OIDC redirect origin and WebAuthn origin when behind a reverse proxy. |
| `WEBAUTHN_RP_ID` | _(request hostname)_ | Override the WebAuthn Relying Party ID (the registrable domain) when the auto-derived hostname is wrong. |
| `YTZERO_AUTH_METHOD` | _(unset)_ | Set to `shared` to force shared-password authentication regardless of the saved method. One-click cloud templates set this automatically. |
| `YTZERO_AUTH_PASSWORD` | _(unset)_ | Shared login password used when `YTZERO_AUTH_METHOD=shared`. It stays environment-owned and is never written to the database, backups, or logs. A missing or empty value leaves forced authentication unconfigured and emits `auth.environment_password_missing`. |
| `YTZERO_INVIDIOUS_COMPAT` | _(unset)_ | Set to `1` to answer the Invidious API for third-party clients such as Yattee. These routes answer before the session middleware — see [Third-Party Clients](Third-Party-Clients#exposure) before opening an instance to the internet with this set. |
| `YTZERO_INVIDIOUS_COMPAT_USER` | _(first administrator)_ | Profile id whose library the unauthenticated catalogue routes serve. |
| `YTZERO_INVIDIOUS_CACHE_MB` | `4096` | Cap for the directory holding videos fetched for a third-party client. |
| `YTZERO_INVIDIOUS_MAX_FETCHES` | `6` | How many videos are fetched at once for third-party clients. |
| `YTZERO_AUTH_DISABLE` | _(unset)_ | Set to `1` to force the **None** auth method regardless of the saved setting. Emergency unlock if an auth method locks you out — see [Authentication](Authentication#recovery-anti-lockout). |
| `YTZERO_BACKGROUND_TASKS` | `1` | Set to `0` on HTTP-only replicas in a PostgreSQL cluster. Such replicas still serve requests and enqueue durable work, but do not start refresh schedulers, the download consumer, automatic yt-dlp updates, or TubeArchivist background synchronization. Exactly one replica should keep the default `1`. |
| `YTZERO_INSTANCE_NAME` | hostname and port | Optional human-readable node name shown in **Settings → Cluster**. Nomad's `NOMAD_ALLOC_NAME` is used automatically when this variable is unset. Give each concurrently running instance a distinct name. |
| `APP_EVENT_POLL_INTERVAL_MS` | `750` | PostgreSQL cross-replica live-event polling interval in milliseconds (`100`–`30000`). Usually there is no reason to change it. |
| `YTZERO_VERSION` | `dev` | Version reported by `/api/health`. Set by the Docker build and by the native installer; there is no reason to set it by hand. |
| `DATABASE_URL` | _(unset)_ | PostgreSQL connection URL. When unset, YT Zero uses SQLite at `DB_PATH`. Migrate from Dangerous settings before enabling this value. |
| `DATABASE_STATE_PATH` | next to the data directory | Machine-local marker used to detect an unexpected engine/location change. It contains fingerprints and migration receipt IDs, never credentials. |
| `RESTORE_SESSION_DIR` | `./data/restore-sessions` | Temporary staging directory for validated portable-restore sessions. |

The path defaults above are relative to the source tree, not to the working
directory: unset, they resolve to a `data/` directory next to `app/`. Docker and
the native installer both set every path explicitly, so this only matters when
you run YT Zero straight from a checkout.

## Method-specific configuration

### Docker and Docker Compose

Set variables in the Compose service's `environment` block, then recreate the
container:

```yaml
environment:
  APP_URL: https://ytzero.example.com
  REFRESH_INTERVAL_MINUTES: 10
```

```bash
docker compose up -d
```

Keep all state under the mounted `/data` path. When changing a path variable in
Docker, point it somewhere below `/data` or add another persistent mount.

### Native Debian/Ubuntu and Proxmox LXC

The installer writes `/etc/ytzero/ytzero.env`. It is retained during updates,
so edit it directly and restart the service:

```bash
sudoedit /etc/ytzero/ytzero.env
systemctl restart ytzero
systemctl status ytzero
```

For a Proxmox-managed container, enter it first with `pct enter <CTID>`, or run
the restart from the host with:

```bash
pct exec <CTID> -- systemctl restart ytzero
```

The installer sets database, cache, download, avatar, log, frontend and yt-dlp
paths explicitly. If you move `YTZERO_DATA` after installation, update the path
variables and the systemd unit's `ReadWritePaths`, then run `systemctl
daemon-reload`. Using the install-time `YTZERO_DATA` knob for a new install is
less error-prone.

### Unraid

Choose **Docker → YT Zero → Edit** and add or change variables in the template.
Applying the change recreates the container without touching the host data path.
Keep `/data` mapped to `/mnt/user/appdata/ytzero` (or another persistent share).
For OIDC or passkeys behind a reverse proxy, add `APP_URL` with the complete
external HTTPS URL.

## Health check

`GET /api/health` needs no authentication and returns `200` with
`{"status":"ok","version":"…","commit":"…","uptime":…,"database":"sqlite|postgres","background_tasks":true|false}`,
or `503` if the database cannot be reached. The Docker image has a `HEALTHCHECK`
wired to it; use it for reverse-proxy readiness probes, Unraid, or uptime
monitoring. In a cluster, `database` and `background_tasks` also confirm that an
allocation received the intended role.

## Docker Compose

The bundled Compose file sets:

```yaml
DB_PATH=/data/db/ytzero.db
IMG_CACHE_DIR=/data/imgcache
DOWNLOADS_DIR=/data/downloads
YTDLP_AUTO_UPDATE=1
IDLE_TIMEOUT_SECONDS=120
REFRESH_INTERVAL_MINUTES=5
```

The image bundles **yt-dlp** and **ffmpeg** for the [YT-DLP Integration](YT-DLP-Integration) plugin; downloaded videos land in the mounted `./data/downloads`.

and mounts:

```text
./data:/data
```

### Moving from SQLite to PostgreSQL

1. Create an empty PostgreSQL database. Do not point YT Zero at it yet.
2. Open **Settings → Dangerous → Database**, paste the PostgreSQL URL, and run the migration. YT Zero pauses new mutations, copies a consistent SQLite snapshot in batches, recreates constraints, and verifies row counts plus primary-key checksums. The source SQLite file is not modified.
3. Set `DATABASE_URL` to the same URL and restart YT Zero.
4. Return to **Settings → Dangerous → Database**. The app verifies the migration receipt stored in PostgreSQL before it lets you confirm the new active database.

The connection URL is accepted only for the migration request and is not saved in application state or logs. Keep it in your secret-management mechanism. The target must be empty; a partial or existing schema is rejected.

For Docker Compose, the optional override can be used with the main file:

```bash
docker compose -f docker-compose.yml -f docker-compose.postgres.yml up -d
```

Back up PostgreSQL with the tools supplied by your PostgreSQL operator (for example `pg_dump` plus tested restore procedures). Portable YT Zero backups remain engine-independent, but they intentionally exclude secrets, downloads, caches, and database implementation metadata.

On a brand-new installation you may set `DATABASE_URL` from the first start. YT Zero initializes an empty PostgreSQL database from its pristine schema. If the local SQLite file already contains channels, videos, history, or per-video state, automatic initialization is refused and the explicit Settings migration above is required.

### Clustered PostgreSQL deployment

YT Zero supports several application processes against one PostgreSQL database.
SQLite remains strictly single-instance: never run several processes against a
shared SQLite file.

#### Supported topology

Use the same YT Zero image and `DATABASE_URL` in two deployment groups:

| Group | Count | `YTZERO_BACKGROUND_TASKS` | Responsibility |
| --- | ---: | --- | --- |
| Background worker | exactly `1` | `1` (default) | HTTP plus schedulers, download processing, yt-dlp maintenance, and TubeArchivist background sync |
| HTTP replicas | `1` or more | `0` | Serve the UI/API, publish live events, and enqueue durable work without consuming it |

The worker is still an HTTP-capable process, but normally only the HTTP group is
registered in the public load-balancer pool. This keeps traffic scaling separate
from singleton background work.

#### Initial deployment

1. Create PostgreSQL and migrate an existing SQLite installation while only one
   YT Zero process is running. A new empty installation may start directly with
   `DATABASE_URL`.
2. Start the singleton worker and let it finish database migrations.
3. Start or scale the HTTP group.
4. Check `/api/health` on both groups and then open **Settings → Cluster** from
   the primary profile.

Example environment:

```text
# singleton worker
DATABASE_URL=postgresql://ytzero:secret@postgres/ytzero
YTZERO_BACKGROUND_TASKS=1
YTZERO_INSTANCE_NAME=ytzero-worker-1

# each HTTP replica
DATABASE_URL=postgresql://ytzero:secret@postgres/ytzero
YTZERO_BACKGROUND_TASKS=0
YTZERO_INSTANCE_NAME=ytzero-http-1
```

Give every concurrently running process a useful, distinct
`YTZERO_INSTANCE_NAME`. When it is unset, YT Zero uses `NOMAD_ALLOC_NAME` when
available, otherwise the process hostname and port.

`YTZERO_BACKGROUND_TASKS` nominates the worker; it does **not** perform leader
election. Configure the worker group with a desired count of one and a
stop-before-start update strategy. Use `Recreate` in Kubernetes, or the
equivalent non-overlapping deployment behavior in Nomad. Atomic download claims
protect individual queue items, but two background-capable processes would
still duplicate periodic scheduler work.

#### Health and cluster dashboard

The unauthenticated health endpoint should report:

Worker:

```json
{"status":"ok","database":"postgres","background_tasks":true}
```

HTTP replica:

```json
{"status":"ok","database":"postgres","background_tasks":false}
```

The real response also includes `version`, `commit`, and process `uptime`. A
`503` means the process cannot query PostgreSQL and must not receive traffic.

With PostgreSQL active, the primary profile gets **Cluster** as the last item in
Settings. Its API is administrator-only. The dashboard refreshes every five
seconds and shows each process's name, host, role, build, uptime, last contact,
and a small allowlist of non-secret runtime settings. It warns about:

- no online worker;
- more than one online worker;
- different builds running at the same time.

Every process writes a PostgreSQL heartbeat every five seconds. It becomes
offline after 15 seconds without a heartbeat, remains visible in the dashboard
for one hour, and its registry row is cleaned up after 24 hours. The dashboard
never returns database URLs, authentication configuration, tokens, cookies, or
filesystem contents.

#### Behavior during failures

HTTP replicas continue serving traffic and can enqueue downloads while the
worker is unavailable. Downloads and scheduled refreshes wait in PostgreSQL
until the worker returns. A claimed download can be recovered 30 seconds after
its previous worker heartbeat disappears and can resume from partial files when
all workers use the same `DOWNLOADS_DIR`.

Queue claims are atomic. Cancellation and priority changes made through another
replica reach the worker through PostgreSQL; an active worker verifies ownership
about every two seconds. Application events use a short-lived PostgreSQL relay,
so ordinary SSE updates cross replica boundaries. OIDC/WebAuthn flows, Child
Lock sessions, child playback heartbeats, PIN-failure counters, download
progress, and other cluster runtime state are shared through PostgreSQL.
Settings and plugin caches converge within about two seconds.

The cluster remains available while an HTTP process is replaced, provided the
load balancer removes failed health checks. Replacing the worker pauses only
background work; it does not prevent healthy HTTP replicas from serving the
application.

#### Shared and local storage

PostgreSQL only shares database state. Mount the same read-write filesystem on
all replicas for every feature whose files must follow a request:

| Path | When it must be shared |
| --- | --- |
| `DOWNLOADS_DIR` | Downloads or local playback are enabled. |
| `DOWNLOAD_COOKIES_DIR` | Cookies can be uploaded through an HTTP replica and consumed by the worker. |
| `AVATAR_DIR` | Uploaded profile avatars are used. |
| `RESTORE_SESSION_DIR` | A multi-step portable restore may cross replicas. |
| `TUBE_ARCHIVIST_CONFIG_DIR` | TubeArchivist is configured or proxied by more than one replica. |

`IMG_CACHE_DIR` may remain replica-local because it is rebuildable. Logs are
also replica-local; set a distinct `LOG_PATH` per allocation because several
processes must not rotate the same file. `/api/logs` and `/api/logs/stream` show
the instance that served the request. Keep `DB_PATH` replica-local even when
`DATABASE_URL` selects PostgreSQL: YT Zero still uses the local SQLite file as
its migration source and compatibility bootstrap. `DATABASE_STATE_PATH` is a
machine-local safety marker and should likewise be distinct per allocation,
not used as the cluster coordinator. Mount shared directories individually
instead of sharing the entire `/data` tree between replicas.

#### Load-balancer affinity and maintenance

Ordinary pages, authentication callbacks, downloads, notifications, and the
general `/api/events` stream do not need sticky sessions. Live process state
still exists for Watch Together rooms and active local audio/HLS/direct streams;
configure affinity for `/api/social/watch-parties/*` and for a viewer's media
requests. Keep the long-running manual channel-sync request at
`/api/channels/sync` on one replica until that sync finishes. A shared filesystem
cannot transfer a running ffmpeg/yt-dlp process or an open Watch Together room.

Rolling application starts are serialized around schema migration with a
PostgreSQL advisory lock. Nevertheless, deploy one version at a time and avoid
leaving mixed builds online. Before a portable restore or an in-app
SQLite-to-PostgreSQL migration, scale the whole deployment down to one process;
their maintenance lease cannot pause mutations already executing on another
replica.

Before considering the deployment ready, verify:

- all processes use the same PostgreSQL database and application build;
- exactly one healthy process reports `background_tasks: true`;
- every HTTP replica reports `background_tasks: false`;
- required file-backed features use the shared paths listed above;
- `DB_PATH`, `DATABASE_STATE_PATH`, and `LOG_PATH` are distinct per allocation;
- the load balancer removes `/api/health` responses with status `503`;
- the Cluster dashboard has no topology or mixed-version warning.

## Background refresh

Durations and Shorts metadata are filled lazily for videos from the last 90 days (configurable with `VIDEO_MAINTENANCE_MAX_AGE_DAYS`). Older videos are not revisited by automatic maintenance; their metadata can still be resolved when accessed or manually synchronized.

Channel RSS refresh is adaptive. YT Zero estimates each channel's upload cadence from the median gap between its latest publication dates, prioritises feeds that are overdue relative to that cadence, and reserves two places in every ten-channel batch for oldest-first rotation. Repeated failures receive exponential backoff, and an HTTP 429 stops the rest of the current batch. The three `ADAPTIVE_REFRESH_*` variables set the per-channel bounds without increasing the ten-request batch budget. A manual refresh bypasses the automatic cooldown.

Channel RSS refreshes only the latest feed entries. Live-status checks operate per followed channel and do not refetch old video metadata.

For details on what is fetched and stored, see [How It Works](How-It-Works).
