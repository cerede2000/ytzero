YT Zero can answer the API that [Invidious](https://github.com/iv-org/invidious)
defined, so that a client written for Invidious — [Yattee](https://github.com/yattee/yattee)
on iPhone and Apple TV, and others that speak the same dialect — can browse and
play this library instead of a public instance. The client sees your
subscriptions, your channels, your playlists, and your downloads; playback and
downloading both go through your server.

The compatibility layer is **disabled by default**. It is a second front door on
a server that is often exposed, and a door nobody opened should not exist.

## Setup

1. Set `YTZERO_INVIDIOUS_COMPAT=1` and `YTZERO_INVIDIOUS_COMPAT_AUTH=basic`, then
   restart. The log line `invidious.compat_enabled` reports both.
2. Each person opens **Settings → Client access** and generates a token. It is
   shown once; generating another revokes the first. The entry is there for
   every profile, which is the point: the credentials are the profile's own,
   not something an administrator hands out.
3. In the client, add an instance of type **Invidious** pointing at your server.
   Fill its HTTP Basic Auth fields with the **profile name** as the username and
   the **token** as the password. Signing in to an account on the same instance
   takes exactly the same pair.

Restricted (child) profiles cannot generate a token: the dialect serves a
library without the limits this server applies to one.

## Several profiles

`YTZERO_INVIDIOUS_COMPAT_AUTH=basic` is what makes a household work, and it is
worth understanding why the alternative cannot.

A client of this dialect sends its session — the cookie it gets from signing in
— to `/api/v1/auth/*` and to nothing else. On every other route there is nobody
to recognise, which is why those are otherwise served for one named profile
(`YTZERO_INVIDIOUS_COMPAT_USER`) whoever asks. Two people pointing their phones
at such an instance get their own feed, subscriptions and playlists, and the
same search results, the same channel pages, and the same home screen — one
person's, for both.

HTTP Basic credentials are different: a client bakes them into every request it
makes. So the server checks them itself, against the profile name and the token
minted for it, and every route knows whose library it is answering. Each person
sees their own.

Media links stay out of this and must: the platform player that follows them
carries no credentials at all. They prove themselves with a signature naming
the video and the hour it expires.

## What the client sees

The feed, subscriptions and playlists of the profile that owns the credentials,
and following or unfollowing writes the same rows the web interface does, so
both ways of subscribing agree.

What a client calls trending or popular is not a place: it is the newest videos
from the channels that profile follows. Searches go out to YouTube, and to any
other provider this instance searches.

Playback and downloads are served by the instance itself, never by a YouTube
link: a CDN address resolved with this server's cookies answers 403 to the phone
that would follow it. Media links expire after six hours.

## Exposure

Without `YTZERO_INVIDIOUS_COMPAT_AUTH=basic`, **these routes answer before the
session middleware** and ask for nothing. Anyone who can reach the server can

- read the library of the configured profile — its videos, channels, and the
  newest uploads of everything it follows;
- run searches, which this server forwards to YouTube;
- open `/api/v1/videos/{id}`, which imports that video into the library **and
  starts a yt-dlp fetch for it**.

The last one is the reason to care: an unknown caller can make the server work.
`YTZERO_INVIDIOUS_MAX_FETCHES` bounds how many of those run at once and the
cache is capped and evicted, so the cost is bounded — but it is not zero, and
the library is readable either way.

Asking clients for credentials is the answer, and the one that also makes the
library each person's own. An instance left open should at least not be
reachable from the internet.

### Basic Auth in a reverse proxy instead

If the credentials must be checked in front of the server rather than by it —
one shared pair for the household, say — the split matters. Yattee sends Basic
Auth on every API request. **Its player does not**: the stream URL is handed to
the platform player with nothing attached, so Basic Auth over the whole server
authenticates the browsing and breaks the playback.

Protect the catalogue and account paths:

```
/api/v1/stats
/api/v1/search        /api/v1/search/suggestions
/api/v1/videos/       /api/v1/comments/
/api/v1/channels/     /api/v1/playlists/
/api/v1/trending      /api/v1/popular
/api/v1/auth/         /login
```

Leave these open — each already carries its own signature:

```
/api/v1/media/        /api/v1/captions/
/companion/           /api/v1/dm/
```

In Traefik that is a second router on the service you already have, matching
only those paths and carrying the middleware; everything it does not match
keeps going through the router you already have:

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
variable. In a Traefik dynamic file, leave them single. An nginx `location` with
`auth_basic` does the same job.

A proxy checking one shared pair does not tell the server who is behind it, so
the catalogue stays the configured profile's for everyone. The two can be
combined: the proxy decides who may knock, the server decides whose library
answers — but then the credentials each person types must be the proxy's, and
`YTZERO_INVIDIOUS_COMPAT_AUTH=basic` will not see the profile behind them.

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
| `YTZERO_INVIDIOUS_COMPAT_AUTH` | `open` | Set to `basic` to require HTTP Basic credentials — a profile name and its token — on the catalogue routes, and to answer each of them for that profile. |
| `YTZERO_INVIDIOUS_COMPAT_USER` | first administrator | Profile whose library the catalogue routes serve while `..._AUTH` is `open`. |
| `YTZERO_INVIDIOUS_CACHE_DIR` | `invidious-cache` beside the database directory (`/data/invidious-cache` in Docker) | Where videos fetched for a client are kept. |
| `YTZERO_INVIDIOUS_CACHE_MB` | `4096` | Cap for that directory. Past it, the least recently served file is evicted. |
| `YTZERO_INVIDIOUS_MAX_FETCHES` | `6` | How many videos are fetched at once. Past it a request falls back to the direct path instead of starting another yt-dlp. |

The cache is not the profile's downloads: nobody asked for these files to be
kept, they are evicted freely, and a video the profile has actually downloaded
is served from that copy instead.
