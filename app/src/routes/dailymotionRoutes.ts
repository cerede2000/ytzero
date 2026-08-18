import type { Context, Hono } from "hono";
import {
  isDailymotionMediaUrl,
  resolveDailymotionStream,
  rewriteHlsPlaylist,
  searchDailymotion,
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

  api.get("/dailymotion/videos/:id/hls.m3u8", async (c) => {
    const videoId = c.req.param("id");
    if (!validDailymotionVideoId(videoId)) return c.json({ error: "invalid video id" }, 400);
    try {
      const source = await resolveDailymotionStream(videoId);
      const response = await fetch(source, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) return c.json({ error: `Dailymotion answered ${response.status}` }, 502);
      const rewritten = rewriteHlsPlaylist(await response.text(), source,
        (absolute) => `/api/dailymotion/segment?u=${encodeURIComponent(absolute)}`);
      return new Response(rewritten, {
        headers: { "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-store" },
      });
    } catch (error) {
      log.warn("dailymotion.stream_failed", { videoId, userId: currentUserId(c), error: error instanceof Error ? error.message : String(error) });
      return c.json({ error: error instanceof Error ? error.message : "stream unavailable" }, 502);
    }
  });

  /**
   * Segments and nested playlists, passed through.
   *
   * Host-locked: the address comes back to us in a query parameter, so without
   * that check this route is an open proxy for anything on the internet. A
   * nested playlist is rewritten in turn, which is what makes depth irrelevant.
   */
  api.get("/dailymotion/segment", async (c) => {
    const target = c.req.query("u") ?? "";
    if (!isDailymotionMediaUrl(target)) return c.json({ error: "unsupported media origin" }, 400);
    try {
      const upstream = await fetch(target, { signal: AbortSignal.timeout(20_000) });
      if (!upstream.ok) return c.json({ error: `Dailymotion answered ${upstream.status}` }, 502);
      const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
      if (contentType.includes("mpegurl") || target.includes(".m3u8")) {
        const rewritten = rewriteHlsPlaylist(await upstream.text(), target,
          (absolute) => `/api/dailymotion/segment?u=${encodeURIComponent(absolute)}`);
        return new Response(rewritten, { headers: { "Content-Type": contentType, "Cache-Control": "no-store" } });
      }
      return new Response(upstream.body, {
        headers: { "Content-Type": contentType, "Cache-Control": "public, max-age=3600" },
      });
    } catch (error) {
      log.warn("dailymotion.segment_failed", { error: error instanceof Error ? error.message : String(error) });
      return c.json({ error: "segment unavailable" }, 502);
    }
  });
}
