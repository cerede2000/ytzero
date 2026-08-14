# Audio mode

Audio mode replaces the watch-page video player with a compact audio-only
player. It is intended for music, podcasts, long-form videos, and livestreams
that should continue playing while the browser is in the background. On iOS
Safari and other supported mobile browsers, it can continue from the lock
screen and exposes system controls through the Media Session API.

## Using audio mode

Open a video and use the audio/video control near the player controls. To start
a playlist in audio mode, open the arrow menu beside **Play all** or **Continue
watching** and choose the audio-only option; the main part of each button
starts it in video mode. The current playback position is handed to the audio
player when switching from a regular video and handed back when returning to
video. Audio mode participates in the normal progress, completion, playlist,
and continuous-playback flow.

The choice is stored in browser `localStorage`, namespaced by the active
profile. It remains enabled while navigating between videos, including the rest
of a playlist started in audio mode, but only in that browser and for that
profile. It is not a server setting, does not follow the profile to another
device, and is not included in backups.

## Requirements and supported content

For videos without a local copy, the YT Zero server must have a working
[yt-dlp](https://github.com/yt-dlp/yt-dlp) installation and Deno 2.3 or newer
available on `PATH`. Deno runs yt-dlp's JavaScript challenge solver for videos
that YouTube does not expose without that step. The official Docker image and
native installer bundle both. A completed download is played directly from the
local file instead, so it does not require yt-dlp or access to YouTube.

Audio mode is available for:

- regular public videos with a compatible AAC audio stream;
- active public livestreams with a compatible HLS audio stream.

It is not available for upcoming, private, members-only, or unavailable videos,
child profiles, or Watch Together sessions. An ended livestream can use the
regular-video path after YouTube publishes a compatible audio format.

### Proof-of-origin tokens

An address YouTube does not recognise is increasingly answered with "Sign in to
confirm you're not a bot", and the clients that accept cookies are handed media
URLs bound to a proof-of-origin token. Cookies alone do not settle this: they
get the extraction through, and the URL that comes back is then refused with a
403 to whoever fetches it — which reads in the log as a resolution that
succeeded followed by `audio.upstream_failed`.

The image carries the `bgutil` provider and its yt-dlp plugin, and runs it
under the Deno that is already there, so the token is computed locally and no
companion service is needed. Two variables adjust it:

- `POT_PROVIDER_HOME` — where the provider lives, `off` to ignore it;
- `POT_PROVIDER_URL` — the address of a companion provider service, if one is
  preferred to the bundled script.

A source that is refused even after its URL has been resolved again is left
alone for thirty seconds (`audio.source_quiet`). Retrying a refusal changes
nothing, and a player asking every couple of seconds is how an address stays
refused.

## How streaming works

For a completed download, the audio element reads the existing range-capable
`/stream` response directly. It does not request an audio manifest, resolve a
new source, or contact YouTube.

For regular videos without a completed download, yt-dlp resolves an AAC stream
in an MP4 container. When the source publishes an MP4 segment index (`sidx`),
YT Zero exposes its existing fragments as a same-origin HLS VOD playlist. This
lets a seek request the fragment at the target time directly, including in
recordings many hours long. The index and fragments are read through the same
bounded, validated byte-range proxy; there is no transcoding and signed upstream
URLs are never exposed to the browser. Sources without a usable index fall back
to the regular byte-range audio stream.

Safari consumes the VOD playlist through its native HLS support. Other
supported browsers use the same lazily loaded `hls.js` path as live audio. VOD
keeps up to about four minutes ahead of the playhead, while live audio retains
its short buffer so it stays close to the broadcast edge.

For active livestreams, yt-dlp resolves an HLS audio rendition. YT Zero rewrites
the rolling playlist and proxies its manifests and segments through opaque,
same-origin URLs. Redirects between allowed YouTube media hosts are followed
with every hop revalidated against the media-host allowlist.

Resolved sources, parsed VOD indexes, and live sessions are isolated by profile
because yt-dlp may use profile-specific YouTube cookies. They are kept only as
short-lived runtime cache entries and are invalidated when their upstream source
expires, fails, or is explicitly retried.

## Controls and browser behavior

The audio player provides play/pause, seeking for regular videos, elapsed and
remaining time, volume and mute controls, playback speed where applicable, and
live-state presentation for broadcasts. Media Session metadata includes the
video title, channel, and thumbnail.

Background and lock-screen playback ultimately depend on browser and operating
system policy. iOS may still stop playback under memory pressure, after a
network change, or when a live playlist is temporarily unavailable.

When iOS blocks the initial autoplay after navigation, the first touch anywhere
on the watch page retries the audio start. This one-time fallback stops as soon
as the element has started, so a listener's deliberate pause is never undone by
a later touch.

## Errors and retrying

If no compatible source can be resolved, the player displays **Try again**.
Each retry invalidates the previous source instead of reusing a failed cache
entry and asks yt-dlp to resolve it again. After three unsuccessful attempts,
the control is disabled and the player suggests trying again later.

The backend also refreshes the video's current live status after a failed
resolution. This repairs rows imported through channel RSS without a live
marker and automatically changes between progressive and livestream audio when
YouTube reports a different current state.

Useful server log events include:

- `audio.source_attempt_failed` and `audio.source_resolution_failed`;
- `audio.upstream_failed` and `audio.upstream_redirect`;
- `audio.vod_index_ready` and `audio.vod_index_unavailable`;
- `audio.live_status_probe_failed`;
- `video.live_status_corrected`;
- `downloads.ytdlp_js_runtime_missing` when Deno cannot be executed;
- `audio.source_quiet` while a refused source is being left alone.

These diagnostics contain video/profile identifiers and safe failure reasons,
but do not log signed media URLs or cookie contents.
