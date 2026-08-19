import type { Context, Hono } from "hono";
import { existsSync } from "node:fs";
import { getDownload, listSubtitleFiles, srtToVtt } from "../../downloader";
import { notePlayback } from "../../playbackActivity";
import { knownSubtitleTracks, readSubtitleTrack } from "../../subtitleTracks";
import { log } from "../../logger";
import { compatUserId } from "./context";
import { cachedMedia, growingFileResponse, mimeFor, offeredHeight, offeredKind, partialFileResponse, pendingFetch, startFetch } from "./mediaCache";
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
    const height = offeredHeight(c.req.query("height"));
    const kind = offeredKind(c.req.query("kind"));
    if (!await tokenHolds(c, `media:${kind}:${height}`, videoId)) return c.json({ error: "expired or invalid link" }, 403);
    const userId = await compatUserId();

    const askedAt = Date.now();
    // Somebody is watching: the background passes stand aside until they stop.
    notePlayback();
    /*
     * Every path says how long it took and which copy answered — the ones that
     * cost nothing included. Served from a kept file, this route used to log
     * nothing at all, so a quiet log meant either the fastest path or no
     * request, and reading it required knowing which silences were good ones.
     */
    const answered = (by: string, response: Response) => {
      log.info("invidious.media_answered", { videoId, kind, height, by, ms: Date.now() - askedAt });
      return response;
    };

    /*
     * A kept copy answers immediately, at the quality that was chosen, without
     * asking YouTube for anything — but only for the muxed file it is. A client
     * asking for a separate track wants that track, not a file with both.
     */
    const download = kind === "muxed" ? await getDownload(userId, videoId) : null;
    if (download?.status === "done" && download.path) {
      const response = localFileResponse(download.path, c.req.header("range"));
      if (response) return answered("downloaded", response);
    }

    // Fetched for an earlier play, or by the warm when the video was opened.
    const kept = cachedMedia(videoId, kind, height);
    if (kept) {
      const response = localFileResponse(kept, c.req.header("range"), mimeFor(kind, kept));
      if (response) return answered("cached", response);
    }

    const range = c.req.header("range");

    /*
     * One source for the whole of a video, and it is this server's own file.
     *
     * There used to be a second: the address YouTube would have served, raced
     * against the fetch so that a working one answered first. It served the
     * profile's progressive stream — one stream, whatever the link asked for —
     * so a client playing the 1080p track got a few megabytes of the muxed
     * file before the fetch took over, and a client playing the separate audio
     * track got video. Two files under one address. It plays for a while and
     * stops in the middle, nothing is logged at either end, and the second
     * attempt is perfect because by then the file is cached and every byte
     * comes from it.
     *
     * A shortcut that has to be right about which file it is serving, and is
     * not, is not a shortcut. The fetch answers in about a second, and it
     * answers with the track that was asked for.
     */
    const arriving = pendingFetch(videoId, kind, height) ?? startFetch(userId, videoId, kind, height);
    if (arriving) {
      /*
       * No range at all means the whole file, and that is a downloader.
       *
       * A player asks in ranges and comes back for more, so it is served as
       * the file arrives. A downloader issues one plain GET and expects one
       * complete body — answered with a partial one it saves a truncated file
       * or calls the download failed, which is what a client reported.
       */
      if (!range) return answered("streamed-file", await growingFileResponse(arriving, kind));
      const served = await partialFileResponse(arriving, range, c.req.raw.signal, kind);
      if (served) return answered("fetch", served);
    }
    /*
     * Nothing came back, and the two reasons for that are not the same event.
     * A native player opens connections it abandons a moment later — probing
     * the file, then reopening at the byte it actually wants — and answering a
     * request nobody is listening to with a 502 logged as a failure buries the
     * real refusals among them.
     */
    if (c.req.raw.signal.aborted) return new Response(null, { status: 499 });
    log.warn("invidious.media_unavailable", { videoId, kind, height, range: range ?? null, downloaded: Boolean(download?.path) });
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
