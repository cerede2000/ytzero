import type { Context, Hono } from "hono";
import { existsSync } from "node:fs";
import { getDownload, getVideoResponse, listSubtitleFiles, srtToVtt } from "../../downloader";
import { knownSubtitleTracks, readSubtitleTrack } from "../../subtitleTracks";
import { log } from "../../logger";
import { compatUserId } from "./context";
import { localFileResponse, mediaSecret } from "./media";
import { mediaTokenValid } from "./mediaToken";

async function tokenHolds(c: Context, resource: string, videoId: string): Promise<boolean> {
  return mediaTokenValid(
    await mediaSecret(),
    resource,
    videoId,
    c.req.query("expires"),
    c.req.query("signature"),
  );
}

/**
 * The bytes themselves.
 *
 * Both routes here are reached by a media player rather than by the client
 * that asked for the document naming them, so neither can rely on a session:
 * the link's own signature is the whole of the authorisation, and it says only
 * which video, which kind of resource, and until when.
 */
export function registerMediaRoutes(app: Hono): void {
  app.get("/api/v1/media/:id", async (c) => {
    const videoId = c.req.param("id");
    if (!await tokenHolds(c, "media", videoId)) return c.json({ error: "expired or invalid link" }, 403);
    const userId = await compatUserId();

    // A kept copy answers immediately, at the quality that was chosen, without
    // asking YouTube for anything.
    const download = await getDownload(userId, videoId);
    if (download?.status === "done" && download.path) {
      const response = localFileResponse(download.path, c.req.header("range"));
      if (response) return response;
    }

    const streamed = await getVideoResponse(userId, videoId, c.req.header("range") ?? null, c.req.raw.signal);
    if (streamed) return streamed;
    log.warn("invidious.media_unavailable", { videoId });
    return c.json({ error: "video unavailable" }, 502);
  });

  const captions = async (c: Context) => {
    const videoId = c.req.param("id") ?? "";
    const language = c.req.query("lang") ?? "";
    if (!videoId) return c.json({ error: "not found" }, 404);
    if (!await tokenHolds(c, `caption:${language}`, videoId)) return c.json({ error: "expired or invalid link" }, 403);
    const userId = await compatUserId();

    const file = (await listSubtitleFiles(videoId)).find((subtitle) => subtitle.lang === language);
    if (file && existsSync(file.path)) {
      const text = await Bun.file(file.path).text();
      return vtt(file.ext === "srt" ? srtToVtt(text) : text);
    }
    /*
     * A video with several audio tracks has one caption track per track, all
     * in the asked-for language, so they are tried in turn until one answers.
     */
    for (const track of knownSubtitleTracks(userId, videoId).filter((t) => t.lang === language)) {
      const streamed = await readSubtitleTrack(track, c.req.raw.signal);
      if (streamed) return vtt(streamed);
      if (c.req.raw.signal.aborted) break;
    }
    return c.json({ error: "not found" }, 404);
  };

  app.get("/api/v1/captions/:id", captions);
  /*
   * Yattee builds its caption request by prefixing the path with `/companion`,
   * matching how current Invidious deployments split that service out. We are
   * one process, so the same handler answers on both paths.
   */
  app.get("/companion/api/v1/captions/:id", captions);
}

function vtt(text: string): Response {
  return new Response(text, {
    headers: { "Content-Type": "text/vtt; charset=utf-8", "Cache-Control": "no-store" },
  });
}
