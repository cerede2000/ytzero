import type { Hono } from "hono";
import {
  isDailymotionMediaUrl,
  masterPlaylist,
  reSignSegmentUrl,
  resolveDailymotion,
  rewriteHlsPlaylist,
  subtitlePlaylist,
  validDailymotionVideoId,
} from "../../dailymotion";
import { srtToVtt } from "../../downloader";
import { log } from "../../logger";
import { dailymotionVideoDetail } from "../../dailymotion";
import { mediaSecret } from "./media";
import { videoFromDailymotion } from "./shapes";
import { mediaSignature, mediaTokenValid, TOKEN_TTL_SECONDS } from "./mediaToken";

/**
 * Dailymotion, played by a client that has never heard of it.
 *
 * The dialect has no notion of a provider, so a Dailymotion video travels as
 * an ordinary video with an id nothing else can spell — the `dm-` prefix — and
 * an HLS manifest where a YouTube video carries a file. That costs nothing:
 * Dailymotion is HLS to begin with, so there is no extraction, no download, no
 * expiring link, and the subtitles are already declared in the manifest, which
 * is the one place a system player looks for them.
 *
 * What has to be rebuilt is reach. The web player's manifest points at routes
 * behind this server's session with relative addresses; a player holds no
 * session, so the whole family is mirrored here with one signature carried
 * from the master playlist down to the last segment.
 */
export const DM_PREFIX = "dm-";

export function dailymotionIdFrom(videoId: string): string | null {
  if (!videoId.startsWith(DM_PREFIX)) return null;
  const id = videoId.slice(DM_PREFIX.length);
  return validDailymotionVideoId(id) ? id : null;
}

export function prefixedDailymotionId(videoId: string): string {
  return DM_PREFIX + videoId;
}

/**
 * One signature for the whole manifest family.
 *
 * A separate token per child would mean minting one for every segment of a
 * playlist we rewrite line by line, and revoking nothing sooner: they all name
 * the same video for the same six hours. So the master playlist is signed and
 * every address it leads to carries that signature onwards.
 */
async function credentials(videoId: string, now: number = Date.now()): Promise<string> {
  const expires = Math.floor(now / 1000) + TOKEN_TTL_SECONDS;
  const signature = mediaSignature(await mediaSecret(), "dailymotion", videoId, expires);
  return `expires=${expires}&signature=${signature}`;
}

export async function signedDailymotionManifest(origin: string, videoId: string): Promise<string> {
  return `${origin}/api/v1/dm/${encodeURIComponent(videoId)}/hls.m3u8?${await credentials(videoId)}`;
}

/**
 * One Dailymotion video, as a client expects to receive a video.
 *
 * `hlsUrl` rather than a file: a client turns it into a stream for recorded
 * video as readily as for live, and it is the format a system player reads
 * natively. It must be absolute — unlike the DASH field beside it, this one is
 * not resolved against the instance.
 */
export async function dailymotionDetail(videoId: string, origin: string) {
  const video = await dailymotionVideoDetail(videoId);
  if (!video) return null;
  const prefixed = prefixedDailymotionId(videoId);
  return {
    ...videoFromDailymotion(video, prefixed),
    descriptionHtml: video.description ?? "",
    description: video.description ?? "",
    authorThumbnails: [] as unknown[],
    subCountText: "",
    allowRatings: true,
    isFamilyFriendly: true,
    isListed: true,
    genre: "",
    keywords: [] as string[],
    hlsUrl: await signedDailymotionManifest(origin, videoId),
    formatStreams: [] as unknown[],
    adaptiveFormats: [] as unknown[],
    captions: [] as unknown[],
    storyboards: [] as unknown[],
    recommendedVideos: [] as unknown[],
    dashUrl: "",
  };
}

export function registerDailymotionMediaRoutes(app: Hono): void {
  const allowed = async (c: { req: { param: (k: string) => string | undefined; query: (k: string) => string | undefined } }) => {
    const videoId = c.req.param("id") ?? "";
    if (!validDailymotionVideoId(videoId)) return null;
    const holds = mediaTokenValid(
      await mediaSecret(), "dailymotion", videoId, c.req.query("expires"), c.req.query("signature"),
    );
    return holds ? videoId : null;
  };

  const playlist = (body: string) => new Response(body, {
    headers: { "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-store" },
  });

  app.get("/api/v1/dm/:id/hls.m3u8", async (c) => {
    const videoId = await allowed(c);
    if (!videoId) return c.json({ error: "expired or invalid link" }, 403);
    try {
      const { rendition, audioUrl, subtitles } = await resolveDailymotion(videoId);
      const token = `?${await credentials(videoId)}`;
      const here = `/api/v1/dm/${encodeURIComponent(videoId)}`;
      /*
       * The captions are declared as renditions, not sideloaded: the manifest
       * is the only place a system player looks for them, and DEFAULT and
       * AUTOSELECT stay NO so that off means off across a seek.
       */
      return playlist(masterPlaylist(
        `${here}/media.m3u8${token}`,
        subtitles.map((track) => ({
          label: track.label,
          lang: track.lang,
          url: `${here}/subs/${encodeURIComponent(track.lang)}/index.m3u8${token}`,
        })),
        rendition,
        audioUrl ? `${here}/audio.m3u8${token}` : null,
      ));
    } catch (error) {
      log.warn("invidious.dailymotion_manifest_failed", { videoId, error: error instanceof Error ? error.message : String(error) });
      return c.json({ error: "stream unavailable" }, 502);
    }
  });

  const track = (kind: "video" | "audio") => async (c: Parameters<typeof allowed>[0] & { json: typeof Response.json }) => {
    const videoId = await allowed(c);
    if (!videoId) return Response.json({ error: "expired or invalid link" }, { status: 403 });
    try {
      const resolved = await resolveDailymotion(videoId);
      const source = kind === "audio" ? resolved.audioUrl : resolved.streamUrl;
      if (!source) return Response.json({ error: "no such track" }, { status: 404 });
      const response = await fetch(source, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) return Response.json({ error: `Dailymotion answered ${response.status}` }, { status: 502 });
      const token = `&${await credentials(videoId)}`;
      return playlist(rewriteHlsPlaylist(await response.text(), source,
        (absolute) => `/api/v1/dm/${encodeURIComponent(videoId)}/segment?u=${encodeURIComponent(absolute)}${token}`));
    } catch (error) {
      log.warn("invidious.dailymotion_track_failed", { videoId, kind, error: error instanceof Error ? error.message : String(error) });
      return Response.json({ error: "stream unavailable" }, { status: 502 });
    }
  };
  app.get("/api/v1/dm/:id/media.m3u8", (c) => track("video")(c as never) as never);
  app.get("/api/v1/dm/:id/audio.m3u8", (c) => track("audio")(c as never) as never);

  app.get("/api/v1/dm/:id/subs/:lang/index.m3u8", async (c) => {
    const videoId = await allowed(c);
    if (!videoId) return c.json({ error: "expired or invalid link" }, 403);
    const lang = c.req.param("lang");
    const { subtitles, durationSeconds } = await resolveDailymotion(videoId)
      .catch(() => ({ subtitles: [] as { lang: string }[], durationSeconds: null }));
    if (!subtitles.some((subtitle) => subtitle.lang === lang)) return c.json({ error: "unknown subtitle track" }, 404);
    const here = `/api/v1/dm/${encodeURIComponent(videoId)}/subs/${encodeURIComponent(lang)}`;
    return playlist(subtitlePlaylist(`${here}?${await credentials(videoId)}`, durationSeconds));
  });

  app.get("/api/v1/dm/:id/subs/:lang", async (c) => {
    const videoId = await allowed(c);
    if (!videoId) return c.json({ error: "expired or invalid link" }, 403);
    const { subtitles } = await resolveDailymotion(videoId).catch(() => ({ subtitles: [] as { lang: string; url: string }[] }));
    const wanted = subtitles.find((subtitle) => subtitle.lang === c.req.param("lang"));
    if (!wanted) return c.json({ error: "unknown subtitle track" }, 404);
    const response = await fetch(wanted.url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return c.json({ error: `Dailymotion answered ${response.status}` }, 502);
    const text = await response.text();
    return new Response(text.trimStart().startsWith("WEBVTT") ? text : srtToVtt(text), {
      headers: { "Content-Type": "text/vtt; charset=utf-8", "Cache-Control": "no-store" },
    });
  });

  app.get("/api/v1/dm/:id/segment", async (c) => {
    const videoId = await allowed(c);
    if (!videoId) return c.json({ error: "expired or invalid link" }, 403);
    const target = c.req.query("u") ?? "";
    if (!isDailymotionMediaUrl(target)) return c.json({ error: "unsupported media origin" }, 400);
    const range = c.req.header("range");
    const ask = (url: string) => fetch(url, {
      headers: range ? { Range: range } : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    try {
      let upstream = await ask(target);
      /*
       * A refusal here usually means the signature inside the playlist has
       * aged out, not that the segment is gone. Resolving again mints a fresh
       * one, and every segment can be rebuilt from it, so the player never
       * learns that anything happened.
       */
      if (upstream.status === 403 || upstream.status === 410 || upstream.status === 404) {
        const fresh = await resolveDailymotion(videoId, { fresh: true }).then((source) => source.streamUrl).catch(() => null);
        const retry = fresh ? reSignSegmentUrl(target, fresh) : null;
        if (retry) upstream = await ask(retry);
      }
      if (!upstream.ok && upstream.status !== 206) return c.json({ error: `Dailymotion answered ${upstream.status}` }, 502);
      const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
      if (contentType.includes("mpegurl") || target.includes(".m3u8")) {
        const token = `&${await credentials(videoId)}`;
        return playlist(rewriteHlsPlaylist(await upstream.text(), target,
          (absolute) => `/api/v1/dm/${encodeURIComponent(videoId)}/segment?u=${encodeURIComponent(absolute)}${token}`));
      }
      // What upstream said about the bytes, said again: a system player asks
      // for lengths and ranges, and answering with neither is what stops it.
      const headers = new Headers({ "Content-Type": contentType, "Cache-Control": "no-store" });
      for (const name of ["content-length", "content-range", "accept-ranges"]) {
        const value = upstream.headers.get(name);
        if (value) headers.set(name, value);
      }
      return new Response(upstream.body, { status: upstream.status, headers });
    } catch (error) {
      log.warn("invidious.dailymotion_segment_failed", { videoId, error: error instanceof Error ? error.message : String(error) });
      return c.json({ error: "segment unavailable" }, 502);
    }
  });
}
