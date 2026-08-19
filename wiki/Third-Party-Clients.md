YT Zero can answer the API that [Invidious](https://github.com/iv-org/invidious)
defined, so that a client written for Invidious — [Yattee](https://github.com/yattee/yattee)
on iPhone and Apple TV, and others that speak the same dialect — can browse and
play this library instead of a public instance. The client sees your
subscriptions, your channels, your playlists, and your downloads; playback and
downloading both go through your server.

The compatibility layer is **disabled by default**. It is a second front door on
a server that is often exposed, and a door nobody opened should not exist. Read
[Exposure](#exposure) before opening it.

## Setup

1. Set `YTZERO_INVIDIOUS_COMPAT=1` and restart. The log line
   `invidious.compat_enabled` confirms it.
2. Open **Settings → Profiles**, find **Client access token**, and generate one.
   It is shown once; generating another revokes the first.
3. In the client, add an instance of type **Invidious** pointing at your server,
   then sign in with the **profile name** as the username and the **token** as
   the password.

Restricted (child) profiles cannot generate a token: the dialect serves a
library without the limits this server applies to one.

## What the client sees

Signed in, a client reads the feed, subscriptions and playlists of the profile
that owns the token, and can follow and unfollow channels — the same rows the
web interface writes, so both ways of subscribing agree.

Everything else — search, channels, playlists, trending, a video's document —
is served for **one** profile, the one named by `YTZERO_INVIDIOUS_COMPAT_USER`.
Those requests carry no session, because no client of this dialect sends one
outside `/api/v1/auth/*`.

Playback and downloads are served by the instance itself, never by a YouTube
link: a CDN address resolved with this server's cookies answers 403 to the
phone that would follow it. Media links carry their own signature and expire
after six hours.

## Exposure

**These routes answer before the session middleware**, and they have to: no
client of this dialect can satisfy it. With the flag on, anyone who can reach
the server can

- read the library of the configured profile — its videos, channels, and the
  newest uploads of everything it follows;
- run searches, which this server forwards to YouTube;
- open `/api/v1/videos/{id}`, which imports that video into the library **and
  starts a yt-dlp fetch for it**.

The last one is the reason to care: an unknown caller can make the server work.
`YTZERO_INVIDIOUS_MAX_FETCHES` bounds how many of those run at once, and the
cache is capped and evicted, so the cost is bounded — but it is not zero, and
the library is readable either way.

An instance reachable from the internet with this flag on should have
authentication in front of it.

### Basic Auth in front, done correctly

Yattee supports HTTP Basic Auth per instance, and sends it on every API request.
**Its player does not.** The stream URL is handed to the platform player with no
credentials attached, so Basic Auth over the whole server authenticates the
browsing and breaks the playback.

Protect the catalogue and account paths:

```
/api/v1/stats
/api/v1/search        /api/v1/search/suggestions
/api/v1/videos/       /api/v1/comments/
/api/v1/channels/     /api/v1/playlists/
/api/v1/trending      /api/v1/popular
/api/v1/auth/         /login
```

Leave these open — they are followed by a player that holds no credentials, and
each one already carries an HMAC signature naming the video it is for and the
hour it expires:

```
/api/v1/media/        /api/v1/captions/
/companion/           /api/v1/dm/
```

One rule for the first list and nothing for the second is the whole
configuration. In Traefik, that is a second router on the service you already
have, matching only those paths and carrying the middleware — everything it
does not match, including the signed media routes and the web interface, keeps
going through the router you already have:

```yaml
labels:
  - "traefik.http.routers.ytzero-clients.rule=Host(`ytzero.example.com`) && (PathPrefix(`/api/v1/stats`) || PathPrefix(`/api/v1/search`) || PathPrefix(`/api/v1/videos`) || PathPrefix(`/api/v1/comments`) || PathPrefix(`/api/v1/channels`) || PathPrefix(`/api/v1/playlists`) || PathPrefix(`/api/v1/trending`) || PathPrefix(`/api/v1/popular`) || PathPrefix(`/api/v1/auth`) || (Method(`POST`) && Path(`/login`)))"
  - "traefik.http.routers.ytzero-clients.priority=100"
  - "traefik.http.routers.ytzero-clients.service=ytzero"
  - "traefik.http.routers.ytzero-clients.entrypoints=websecure"
  - "traefik.http.routers.ytzero-clients.tls.certresolver=letsencrypt"
  - "traefik.http.routers.ytzero-clients.middlewares=ytzero-clients"
  - "traefik.http.middlewares.ytzero-clients.basicauth.users=yattee:$$apr1$$replace$$me"
```

Mirror the entrypoint, TLS resolver and service name of your existing router.
Generate the credentials with `htpasswd -nB yattee`, and double every `$` in the
result when it goes into a label — a Compose file reads a single one as a
variable. In a Traefik dynamic file, leave them single.

An nginx `location` with `auth_basic`, or the equivalent in any other
authenticating proxy, does the same job.

Check it from outside afterwards. The first must answer `401`, the second `403`
— not `401`, which would mean the player is being challenged too:

```bash
curl -o /dev/null -w '%{http_code}\n' https://ytzero.example.com/api/v1/trending
curl -o /dev/null -w '%{http_code}\n' https://ytzero.example.com/api/v1/media/dQw4w9WgXcQ
```

## Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `YTZERO_INVIDIOUS_COMPAT` | _(unset)_ | Set to `1` to answer the Invidious API. Anything else, including unset, and none of these routes exist. |
| `YTZERO_INVIDIOUS_COMPAT_USER` | first administrator | Profile id whose library the unauthenticated catalogue routes serve. |
| `YTZERO_INVIDIOUS_CACHE_DIR` | `invidious-cache` beside the database directory (`/data/invidious-cache` in Docker) | Where videos fetched for a client are kept. |
| `YTZERO_INVIDIOUS_CACHE_MB` | `4096` | Cap for that directory. Past it, the least recently served file is evicted. |
| `YTZERO_INVIDIOUS_MAX_FETCHES` | `6` | How many videos are fetched at once. Past it a request falls back to the direct path instead of starting another yt-dlp. |

The cache is not the profile's downloads: nobody asked for these files to be
kept, they are evicted freely, and a video the profile has actually downloaded
is served from that copy instead.
