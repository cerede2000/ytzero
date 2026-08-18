import type { Context, Hono } from "hono";
import { srtToVtt } from "../downloader";
import {
  dailymotionRelated,
  dailymotionVideoDetail,
  isDailymotionMediaUrl,
  masterPlaylist,
  reSignSegmentUrl,
  resolveDailymotion,
  resolveDailymotionStream,
  subtitlePlaylist,
  rewriteHlsPlaylist,
  searchDailymotion,
  searchDailymotionAll,
  validDailymotionVideoId,
} from "../dailymotion";
import { log } from "../logger";

type ApiEnvironment = { Variables: { userId: number; sessionAdmin?: boolean; profileAdmin?: boolean } };
type Api = Hono<ApiEnvironment>;
type ApiContext = Context<ApiEnvironment>;

/**
 * A second source, behind its own door.
 *
 * Every route here is new and nothing existing calls them, so the experiment
 * can be deleted in one commit if it does not earn its place.
 */
export function registerDailymotionRoutes(api: Api, access: { currentUserId: (context: ApiContext) => number }): void {
  const { currentUserId } = access;

  api.get("/dailymotion/search", async (c) => {
    const query = c.req.query("q")?.trim();
    if (!query) return c.json({ videos: [] });
    try {
      const videos = await searchDailymotion(query, Number(c.req.query("limit") ?? 24));
      return c.json({ videos });
    } catch (error) {
      log.warn("dailymotion.search_failed", { error: error instanceof Error ? error.message : String(error) });
      return c.json({ error: "Dailymotion search failed" }, 502);
    }
  });

  /**
   * What the player is pointed at: one rendition, plus whatever captions exist.
   *
   * Kept separate from the media playlist below so the captions are declared in
   * the manifest, which is the only place iOS's system player looks.
   */
  /** Everything one search finds, on the shelves their own results page uses. */
  api.get("/dailymotion/search/all", async (c) => {
    const query = c.req.query("q")?.trim();
    if (!query) return c.json({ videos: [], channels: [], live: [] });
    try {
      return c.json(await searchDailymotionAll(query));
    } catch (error) {
      log.warn("dailymotion.search_failed", { error: error instanceof Error ? error.message : String(error) });
      return c.json({ error: "Dailymotion search failed" }, 502);
    }
  });

  /** What a player page shows around the picture, and beside it. */
  api.get("/dailymotion/videos/:id", async (c) => {
    const videoId = c.req.param("id");
    if (!validDailymotionVideoId(videoId)) return c.json({ error: "invalid video id" }, 400);
    const [video, related] = await Promise.all([
      dailymotionVideoDetail(videoId).catch(() => null),
      dailymotionRelated(videoId).catch(() => []),
    ]);
    if (!video) return c.json({ error: "video not found" }, 404);
    return c.json({ video, related });
  });

  api.get("/dailymotion/videos/:id/hls.m3u8", async (c) => {
    const videoId = c.req.param("id");
    if (!validDailymotionVideoId(videoId)) return c.json({ error: "invalid video id" }, 400);
    try {
      const { rendition, audioUrl } = await resolveDailymotion(videoId);
      /*
       * No subtitle rendition here on purpose.
       *
       * Declaring one hands the captions to whichever player is running, and
       * all three of them handle it differently — iOS re-reads DEFAULT on every
       * seek, hls.js takes ownership of the element's text tracks. The page
       * fetches the same captions as a plain file and draws them itself, which
       * is what the watch page does and the only arrangement that behaved the
       * same twice.
       */
      const playlist = masterPlaylist(
        `/api/dailymotion/videos/${videoId}/media.m3u8`,
        [],
        rendition,
        audioUrl ? `/api/dailymotion/videos/${videoId}/audio.m3u8` : null,
      );
      return new Response(playlist, {
        headers: { "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-store" },
      });
    } catch (error) {
      log.warn("dailymotion.stream_failed", { videoId, userId: currentUserId(c), error: error instanceof Error ? error.message : String(error) });
      return c.json({ error: error instanceof Error ? error.message : "stream unavailable" }, 502);
    }
  });

  /**
   * The picture, and the sound when it travels separately.
   *
   * One handler for both because the work is identical — fetch their playlist,
   * point every line back at us — and only which address is asked for differs.
   */
  const mediaPlaylist = async (c: ApiContext, track: "video" | "audio") => {
    const videoId = c.req.param("id") ?? "";
    if (!validDailymotionVideoId(videoId)) return c.json({ error: "invalid video id" }, 400);
    try {
      const resolved = await resolveDailymotion(videoId);
      const source = track === "audio" ? resolved.audioUrl : resolved.streamUrl;
      if (!source) return c.json({ error: "no such track" }, 404);
      const response = await fetch(source, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) return c.json({ error: `Dailymotion answered ${response.status}` }, 502);
      const rewritten = rewriteHlsPlaylist(await response.text(), source,
        (absolute) => `/api/dailymotion/videos/${videoId}/segment?u=${encodeURIComponent(absolute)}`);
      return new Response(rewritten, {
        headers: { "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-store" },
      });
    } catch (error) {
      log.warn("dailymotion.stream_failed", { videoId, track, userId: currentUserId(c), error: error instanceof Error ? error.message : String(error) });
      return c.json({ error: error instanceof Error ? error.message : "stream unavailable" }, 502);
    }
  };

  api.get("/dailymotion/videos/:id/media.m3u8", (c) => mediaPlaylist(c, "video"));
  api.get("/dailymotion/videos/:id/audio.m3u8", (c) => mediaPlaylist(c, "audio"));

  /** The rendition a subtitle group points at: one file, stated as a playlist. */
  api.get("/dailymotion/videos/:id/subtitles/:lang/index.m3u8", async (c) => {
    const videoId = c.req.param("id");
    if (!validDailymotionVideoId(videoId)) return c.json({ error: "invalid video id" }, 400);
    const { subtitles, durationSeconds } = await resolveDailymotion(videoId).catch(() => ({ subtitles: [], durationSeconds: null }));
    const lang = c.req.param("lang");
    if (!subtitles.some((track) => track.lang === lang)) return c.json({ error: "unknown subtitle track" }, 404);
    const playlist = subtitlePlaylist(`/api/dailymotion/videos/${videoId}/subtitles/${encodeURIComponent(lang)}`, durationSeconds);
    return new Response(playlist, {
      headers: { "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-store" },
    });
  });

  /**
   * The caption tracks, named for a <track> element.
   *
   * Their own address never reaches the page: it is signed, and a track fetched
   * cross-origin is refused anyway. The page is given ours, per language.
   */
  api.get("/dailymotion/videos/:id/subtitles", async (c) => {
    const videoId = c.req.param("id");
    if (!validDailymotionVideoId(videoId)) return c.json({ error: "invalid video id" }, 400);
    try {
      const { subtitles } = await resolveDailymotion(videoId);
      return c.json({
        subtitles: subtitles.map((track) => ({
          lang: track.lang,
          label: track.label,
          src: `/api/dailymotion/videos/${videoId}/subtitles/${encodeURIComponent(track.lang)}`,
        })),
      });
    } catch (error) {
      log.warn("dailymotion.subtitles_failed", { videoId, error: error instanceof Error ? error.message : String(error) });
      return c.json({ subtitles: [] });
    }
  });

  /**
   * One track, as WebVTT.
   *
   * The language is looked up in what was resolved rather than trusted, so the
   * only addresses this can fetch are ones Dailymotion itself named. SubRip is
   * converted on the way through by the same function the downloader uses for
   * sidecar subtitles — a <track> plays WebVTT and nothing else.
   */
  api.get("/dailymotion/videos/:id/subtitles/:lang", async (c) => {
    const videoId = c.req.param("id");
    if (!validDailymotionVideoId(videoId)) return c.json({ error: "invalid video id" }, 400);
    try {
      const { subtitles } = await resolveDailymotion(videoId);
      const track = subtitles.find((candidate) => candidate.lang === c.req.param("lang"));
      if (!track) return c.json({ error: "unknown subtitle track" }, 404);
      const upstream = await fetch(track.url, { signal: AbortSignal.timeout(15_000) });
      if (!upstream.ok) return c.json({ error: `Dailymotion answered ${upstream.status}` }, 502);
      const body = await upstream.text();
      return new Response(track.srt ? srtToVtt(body) : body, {
        headers: { "Content-Type": "text/vtt; charset=utf-8", "Cache-Control": "public, max-age=3600" },
      });
    } catch (error) {
      log.warn("dailymotion.subtitle_failed", { videoId, error: error instanceof Error ? error.message : String(error) });
      return c.json({ error: "subtitle unavailable" }, 502);
    }
  });

  /**
   * Segments and nested playlists, passed through.
   *
   * Host-locked: the address comes back to us in a query parameter, so without
   * that check this route is an open proxy for anything on the internet. A
   * nested playlist is rewritten in turn, which is what makes depth irrelevant.
   */
  api.get("/dailymotion/videos/:id/segment", async (c) => {
    const videoId = c.req.param("id");
    if (!validDailymotionVideoId(videoId)) return c.json({ error: "invalid video id" }, 400);
    const target = c.req.query("u") ?? "";
    if (!isDailymotionMediaUrl(target)) return c.json({ error: "unsupported media origin" }, 400);
    try {
      // A range asked for here is a range asked for there: the player decides
      // what it wants, and this is a pipe rather than a cache.
      const range = c.req.header("range");
      const ask = (url: string) => fetch(url, {
        headers: range ? { Range: range } : undefined,
        signal: AbortSignal.timeout(20_000),
      });
      let upstream = await ask(target);
      /*
       * A refusal here usually means the signature in the playlist has aged
       * out, not that the segment is gone. Resolving again mints a fresh one,
       * and every segment of this video can be rebuilt from it — so the player
       * never learns that anything happened.
       */
      if (upstream.status === 403 || upstream.status === 410 || upstream.status === 404) {
        const fresh = await resolveDailymotion(videoId, { fresh: true }).then((source) => source.streamUrl).catch(() => null);
        const retry = fresh ? reSignSegmentUrl(target, fresh) : null;
        if (retry) {
          log.info("dailymotion.segment_resigned", { videoId, was: upstream.status });
          upstream = await ask(retry);
        }
      }
      if (!upstream.ok && upstream.status !== 206) return c.json({ error: `Dailymotion answered ${upstream.status}` }, 502);
      const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
      if (contentType.includes("mpegurl") || target.includes(".m3u8")) {
        const rewritten = rewriteHlsPlaylist(await upstream.text(), target,
          (absolute) => `/api/dailymotion/videos/${videoId}/segment?u=${encodeURIComponent(absolute)}`);
        return new Response(rewritten, { headers: { "Content-Type": contentType, "Cache-Control": "no-store" } });
      }
      /*
       * What upstream said about the bytes, said again.
       *
       * The first version answered with a body and two headers of its own,
       * dropping the length and the range support Dailymotion offers. A
       * browser copes; iOS's player is the one that asks for lengths and
       * ranges, and this repository already learnt that lesson once — the
       * audio proxy needed a Content-Length before iOS would touch it. Sound
       * drifting out of step on the phone and nowhere else is exactly the
       * shape of a player left to guess.
       */
      const headers = new Headers({ "Content-Type": contentType, "Cache-Control": "public, max-age=3600", "Accept-Ranges": "bytes" });
      const range_ = upstream.headers.get("content-range");
      if (range_) headers.set("Content-Range", range_);
      /*
       * Read whole rather than piped: a streamed body has no length the runtime
       * will vouch for, so it goes out chunked and the Content-Length is
       * dropped — which is the header iOS wanted in the first place. A segment
       * here is three seconds and a few hundred kilobytes, so holding one is
       * cheaper than the problem it solves.
       */
      const bytes = await upstream.arrayBuffer();
      return new Response(bytes, { status: upstream.status, headers });
    } catch (error) {
      log.warn("dailymotion.segment_failed", { error: error instanceof Error ? error.message : String(error) });
      return c.json({ error: "segment unavailable" }, 502);
    }
  });
}
