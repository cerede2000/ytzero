import type { Context, Hono } from "hono";
import { existsSync } from "node:fs";
import { getDownload, getVideoResponse, listSubtitleFiles, srtToVtt } from "../../downloader";
import { knownSubtitleTracks, readSubtitleTrack } from "../../subtitleTracks";
import { log } from "../../logger";
import { compatUserId } from "./context";
import { cachedMedia, partialFileResponse, pendingFetch, startFetch } from "./mediaCache";
import { localFileResponse, mediaSecret } from "./media";
import { mediaTokenValid } from "./mediaToken";

/**
 * How long the direct path stays written off for a video that refused it.
 *
 * A native player opens several connections and reopens them as each fails,
 * and every one of them was paying the full retry ladder and a re-resolution
 * before giving up — a minute and a half of asking YouTube about a video it
 * has just refused, on an address already being challenged for robots. Once
 * one connection has learned the answer, the others go straight to the way
 * that works.
 *
 * Short on purpose. This is not a verdict on the video: the refusal is an
 * experiment YouTube runs, and the next press of play is entitled to find out
 * for itself.
 */
const REFUSAL_MEMORY_MS = 30_000;
const refusedAt = new Map<string, number>();

export function noteRefusal(videoId: string, now = Date.now()): void {
  refusedAt.set(videoId, now);
}

export function recentlyRefused(videoId: string, now = Date.now()): boolean {
  const at = refusedAt.get(videoId);
  if (at === undefined) return false;
  if (now - at < REFUSAL_MEMORY_MS) return true;
  refusedAt.delete(videoId);
  return false;
}

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

    // Already fetched once because the direct path was refused for it.
    const kept = cachedMedia(videoId);
    if (kept) {
      const response = localFileResponse(kept, c.req.header("range"));
      if (response) return response;
    }

    /*
     * The direct path first: it costs no disk and starts at once. A player
     * that sent no range still gets a bounded chunk — range-less, the relay
     * reads to the end of the file and buffers it to put a length on it.
     */
    if (!recentlyRefused(videoId)) {
      const streamed = await getVideoResponse(userId, videoId, c.req.header("range") ?? "bytes=0-", c.req.raw.signal);
      if (streamed) return streamed;
      if (c.req.raw.signal.aborted) return new Response(null, { status: 499 });
      noteRefusal(videoId);
    }

    /*
     * Refused. For some videos every format, client, header set and range
     * answers 403 to an address extracted here — YouTube binds the
     * proof-of-origin token to the video — while yt-dlp downloads the same
     * format without trouble. So it fetches, and the file is served as it
     * arrives rather than when it is whole.
     */
    const arriving = pendingFetch(videoId) ?? await startFetch(userId, videoId);
    if (arriving) {
      const served = await partialFileResponse(arriving, c.req.header("range"), c.req.raw.signal);
      if (served) return served;
    }
    /*
     * Nothing came back, and the two reasons for that are not the same event.
     * A native player opens connections it abandons a moment later — probing
     * the file, then reopening at the byte it actually wants — and answering a
     * request nobody is listening to with a 502 logged as a failure buries the
     * real refusals among them.
     */
    if (c.req.raw.signal.aborted) return new Response(null, { status: 499 });
    log.warn("invidious.media_unavailable", { videoId, range: c.req.header("range") ?? null, downloaded: Boolean(download?.path) });
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
