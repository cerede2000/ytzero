import type { Context, Hono } from "hono";
import { existsSync } from "node:fs";
import { getDownload, getVideoResponse, listSubtitleFiles, srtToVtt } from "../../downloader";
import { videoInfoRefusalQuiet } from "../../youtubeRefusalQuiet";
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

/**
 * One connection finds out whether the direct path works; the rest are told.
 *
 * A native player opens several at once, and each was starting its own
 * extraction and its own retry ladder against the same address — twenty
 * seconds of 403 in parallel before any of them had a verdict to share. Now
 * the first one asks and the others wait for the answer: if it serves, they
 * ask too and find the source already resolved; if it is refused, they go
 * straight to the way that works.
 *
 * An abandoned request settles nothing. A player that hung up says nothing
 * about whether YouTube would have answered.
 */
const directVerdicts = new Map<string, Promise<boolean>>();

/**
 * How long the direct path runs alone before the other way starts beside it.
 *
 * Long enough that an address which works answers first and costs nothing;
 * short enough that a refused one is not what the viewer waits for. And none
 * at all while YouTube is refusing this address outright: the extraction the
 * grace is waiting for has already been reported as failing, so waiting for it
 * again is four seconds spent on an answer we have.
 */
const DIRECT_GRACE_MS = 2_500;

function directGrace(): number {
  return videoInfoRefusalQuiet.quiet() ? 0 : DIRECT_GRACE_MS;
}

export async function directResponse(
  userId: number,
  videoId: string,
  range: string,
  signal: AbortSignal,
  ask: (userId: number, videoId: string, range: string, signal: AbortSignal) => Promise<Response | null> =
    (id, video, wanted, aborts) => getVideoResponse(id, video, wanted, aborts),
): Promise<Response | null> {
  const waiting = directVerdicts.get(videoId);
  if (waiting) {
    return await waiting ? ask(userId, videoId, range, signal) : null;
  }
  let settle: (worked: boolean) => void = () => {};
  directVerdicts.set(videoId, new Promise<boolean>((resolve) => { settle = resolve; }));
  try {
    const response = await ask(userId, videoId, range, signal);
    settle(Boolean(response) || signal.aborted);
    return response;
  } catch (error) {
    settle(signal.aborted);
    throw error;
  } finally {
    directVerdicts.delete(videoId);
  }
}

/**
 * Whichever way answers first, and nothing kept from the one that lost.
 *
 * When a fetch is already under way it is because the direct path was still
 * undecided seconds ago, so there is no sense in waiting out its verdict
 * before starting to serve: the file that is arriving may well be ahead of it.
 * A late answer from the loser is drained rather than dropped, so the
 * connection behind it is not left open.
 */
export async function firstServed(candidates: Promise<Response | null>[]): Promise<Response | null> {
  return new Promise((resolve) => {
    let outstanding = candidates.length;
    let settled = false;
    for (const candidate of candidates) {
      candidate.then((response) => {
        if (settled) return void response?.body?.cancel().catch(() => {});
        if (response) {
          settled = true;
          return resolve(response);
        }
        if (--outstanding === 0) resolve(null);
      }, () => {
        if (!settled && --outstanding === 0) resolve(null);
      });
    }
  });
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
    const askedAt = Date.now();
    const kept = cachedMedia(videoId);
    if (kept) {
      const response = localFileResponse(kept, c.req.header("range"));
      if (response) return response;
    }

    /*
     * The direct path first: it costs no disk and starts at once. A player
     * that sent no range still gets a bounded chunk — range-less, the relay
     * reads to the end of the file and buffers it to put a length on it.
     *
     * If a fetch is already under way, the two race. Waiting out the direct
     * verdict costs seventeen seconds of extractions and retry ladders, and
     * the file arriving beside it is often ready long before that.
     */
    const range = c.req.header("range");
    if (!recentlyRefused(videoId)) {
      /*
       * Both ways run, and the first to produce bytes wins.
       *
       * The fallback starts itself after a grace rather than joining one that
       * happens to be under way already: a request arriving in the seconds
       * before the fetch was registered found nothing to race against and
       * waited out the direct verdict instead — an extraction, a ladder, a
       * second extraction, a second ladder — with the file it needed already
       * arriving beside it.
       */
      const direct = directResponse(userId, videoId, range ?? "bytes=0-", c.req.raw.signal);
      const fallback = Bun.sleep(directGrace()).then(() => {
        const entry = pendingFetch(videoId) ?? startFetch(userId, videoId);
        return entry ? partialFileResponse(entry, range, c.req.raw.signal) : null;
      });
      const streamed = await firstServed([direct, fallback]);
      if (streamed) {
        log.info("invidious.media_answered", { videoId, by: "direct-or-fetch", ms: Date.now() - askedAt });
        return streamed;
      }
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
    const fetching = pendingFetch(videoId) ?? startFetch(userId, videoId);
    if (fetching) {
      const served = await partialFileResponse(fetching, range, c.req.raw.signal);
      if (served) {
        log.info("invidious.media_answered", { videoId, by: "fetch", ms: Date.now() - askedAt });
        return served;
      }
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
