import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, utimesSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DB_PATH } from "../../db";
import { YTDLP, downloadCookiesConfigured, downloadCookiesFile } from "../../downloadConfig";
import { log } from "../../logger";
import { potArgsFor } from "../../ytdlpPotProvider";

/**
 * The way back when the address itself is refused.
 *
 * Normally the file's address is resolved and range-proxied, which costs
 * nothing and starts at once. Measured on a live instance, that fails for some
 * videos completely: every format, every client, every combination of headers
 * and ranges answers 403 to a URL yt-dlp printed — while yt-dlp downloads the
 * same format at twenty-five megabytes a second, saying in its debug output
 * that YouTube is running an experiment binding the proof-of-origin token to
 * the video. An address extracted by one process and fetched by another is
 * then dead on arrival.
 *
 * So this is the fallback, not the rule: when the direct path is refused, the
 * file is fetched the one way that works and served from disk as it arrives.
 * What it costs is space, which is why it is capped and evicted
 * least-recently-served first, and why it lives apart from the profile's own
 * downloads: nobody asked for these to be kept.
 */
const CACHE_DIR = process.env.YTZERO_INVIDIOUS_CACHE_DIR
  ?? resolve(dirname(DB_PATH), "../invidious-cache");
const CACHE_LIMIT_BYTES = Math.max(1, Number(process.env.YTZERO_INVIDIOUS_CACHE_MB) || 4096) * 1024 * 1024;
/** Long enough for a long video on a slow line; short enough to end. */
const FETCH_TIMEOUT_MS = 10 * 60_000;
/*
 * One muxed file the player reads as-is. Merging separate video and audio
 * would buy resolution and cost an ffmpeg pass in front of somebody waiting,
 * so the first version keeps what starts fastest.
 */
const FORMAT = "18/22/best[ext=mp4][acodec!=none][vcodec!=none]/best[acodec!=none][vcodec!=none]";

/** A name that cannot escape the directory it is written into. */
export function cacheableVideoId(videoId: string): boolean {
  return /^[A-Za-z0-9_-]{5,24}$/.test(videoId);
}

function pathFor(videoId: string): string {
  return join(CACHE_DIR, `${videoId}.mp4`);
}

/** The kept copy, if there is one — and it is marked as used just now. */
export function cachedMedia(videoId: string): string | null {
  if (!cacheableVideoId(videoId)) return null;
  const path = pathFor(videoId);
  if (!existsSync(path)) return null;
  try {
    const now = new Date();
    utimesSync(path, now, now);
  } catch {
    // Only affects eviction order.
  }
  return path;
}

/**
 * Oldest out first, until the cap is respected.
 *
 * Eviction reads the times the files were last served, not written, so a video
 * somebody keeps coming back to outlives one watched once.
 */
export function pruneCache(limit = CACHE_LIMIT_BYTES, keep?: string): void {
  if (!existsSync(CACHE_DIR)) return;
  const files = readdirSync(CACHE_DIR)
    .filter((name) => name.endsWith(".mp4"))
    .map((name) => {
      const path = join(CACHE_DIR, name);
      try {
        const stats = statSync(path);
        return { path, size: stats.size, used: stats.atimeMs || stats.mtimeMs };
      } catch {
        return null;
      }
    })
    .filter((entry): entry is { path: string; size: number; used: number } => entry !== null);

  let total = files.reduce((sum, file) => sum + file.size, 0);
  if (total <= limit) return;
  for (const file of files.sort((a, b) => a.used - b.used)) {
    if (total <= limit) break;
    if (file.path === keep) continue;
    try {
      rmSync(file.path, { force: true });
      total -= file.size;
      log.info("invidious.cache_evicted", { file: file.path.split("/").pop(), freed: file.size });
    } catch {
      // A file being served right now: leave it, the next pass will take it.
    }
  }
}

/** A fetch under way: where it is being written, how big it will be, and when it ends. */
export interface PendingFetch {
  path: string;
  /**
   * Bytes the finished file will have, when yt-dlp tells us — and a promise
   * rather than a number because it is not known when the fetch is registered.
   *
   * Registering has to happen before anything is awaited: two connections
   * arriving together both looked, both found nothing under way, and both
   * downloaded the same video.
   */
  total: Promise<number | null>;
  done: Promise<string | null>;
}

const fetching = new Map<string, PendingFetch>();

/** The fetch under way for this video, if there is one. */
export function pendingFetch(videoId: string): PendingFetch | null {
  for (const [key, entry] of fetching) {
    if (key.endsWith(`:${videoId}`)) return entry;
  }
  return null;
}

/**
 * The first line of a stream, without waiting for the rest of it.
 *
 * Reading the whole of yt-dlp's output means waiting for yt-dlp to finish,
 * which is the one thing this must not do: the size is printed before the
 * download starts, and it is what lets the first range be answered while the
 * rest is still arriving. The stream keeps draining afterwards so the process
 * is never blocked writing into a full pipe.
 */
function firstLine(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Promise((resolve) => {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let settled = false;
    const settle = (value: string) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    void (async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (value) buffer += decoder.decode(value, { stream: true });
        const newline = buffer.indexOf("\n");
        if (newline >= 0) settle(buffer.slice(0, newline));
        if (done) return settle(buffer);
      }
    })().catch(() => settle(""));
  });
}

/**
 * Start fetching, and say straight away where it lands and how big it will be.
 *
 * The size comes out of the same run that does the downloading: `--print` with
 * `--no-simulate` prints the field and fetches the file. A player told nothing
 * about the length will not start, and one told `bytes 0-99/*` cannot seek.
 */
export function startFetch(userId: number, videoId: string): PendingFetch | null {
  if (!cacheableVideoId(videoId)) return null;
  const key = `${userId}:${videoId}`;
  const running = fetching.get(key);
  if (running) return running;

  mkdirSync(CACHE_DIR, { recursive: true });
  const target = pathFor(videoId);
  // Written under another name and moved into place, so a partial file is
  // never mistaken for one that can be served in full.
  const partial = join(CACHE_DIR, `${videoId}.partial`);
  rmSync(partial, { force: true });
  const args = [
    `https://www.youtube.com/watch?v=${videoId}`,
    "--no-playlist", "--no-warnings", "--no-part", "--no-simulate",
    /*
     * The same instance, minutes apart: seven and a half megabytes in
     * two-thirds of a second, and seven and a half megabytes in twenty
     * seconds. Same size, same code, thirty times the speed — which is not
     * contention or a slow line but YouTube throttling a connection once it
     * has been open a few seconds.
     *
     * Pieces small enough to finish before the throttle takes hold. Ten
     * megabytes was one piece for most of these files, which is to say no
     * pieces at all.
     */
    "--http-chunk-size", "1M",
    "--print", "%(filesize,filesize_approx)s",
    "-f", FORMAT,
    "-o", partial,
    ...potArgsFor(true),
  ];
  if (downloadCookiesConfigured(userId)) args.push("--cookies", downloadCookiesFile(userId));

  const startedAt = Date.now();
  const child = Bun.spawn([YTDLP, ...args], { stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => child.kill(), FETCH_TIMEOUT_MS);
  const announced = firstLine(child.stdout as ReadableStream<Uint8Array>);

  const done = (async () => {
    try {
      const [said, exitCode] = await Promise.all([
        new Response(child.stderr as ReadableStream<Uint8Array>).text(),
        child.exited,
      ]);
      if (exitCode !== 0 || !existsSync(partial)) {
        log.warn("invidious.cache_fetch_failed", {
          videoId, exitCode,
          said: said.split(/\r?\n/).filter(Boolean).slice(-2)
            .map((line) => line.replace(/https?:\/\/\S+/gi, "<url>").slice(0, 300)),
        });
        rmSync(partial, { force: true });
        return null;
      }
      renameSync(partial, target);
      const size = statSync(target).size;
      log.info("invidious.cache_fetched", { videoId, bytes: size, ms: Date.now() - startedAt });
      pruneCache(CACHE_LIMIT_BYTES, target);
      return target;
    } finally {
      clearTimeout(timer);
      fetching.delete(key);
    }
  })();

  // Never hold on a size that is not coming: without one the first range waits
  // for the whole file, which is slower but still plays.
  const total = Promise.race([announced, Bun.sleep(20_000).then(() => "")]).then((printed) => {
    const size = Number(printed.trim());
    const announcedBytes = Number.isFinite(size) && size > 0 ? size : null;
    log.info("invidious.cache_fetch_started", { videoId, announcedBytes });
    return announcedBytes;
  });

  const entry: PendingFetch = { path: partial, total, done };
  fetching.set(key, entry);
  return entry;
}

/** The finished file, waiting for a fetch under way if there is one. */
export async function ensureCached(userId: number, videoId: string): Promise<string | null> {
  const existing = cachedMedia(videoId);
  if (existing) return existing;
  const started = startFetch(userId, videoId);
  return started ? started.done : null;
}

/** Max bytes answered at once, so a length can be set without holding a film in memory. */
const CHUNK_BYTES = 8 * 1024 * 1024;
/**
 * Enough of a first answer to be worth sending, rather than all that was asked.
 *
 * A player opens with `bytes=0-`, meaning the whole file — and a file smaller
 * than the chunk cap made that literal: the first range waited for the last
 * byte of the download, which is the whole point of serving early thrown away.
 * A range answer is allowed to be shorter than the range requested, so it is:
 * as soon as there is a quarter of a megabyte to send, it goes.
 */
const FIRST_BYTES = 256 * 1024;

/** What a player asked for, from what has arrived so far. */
export function wantedRange(range: string | undefined, total: number): { start: number; end: number } | null {
  const match = range?.match(/bytes=(\d*)-(\d*)/);
  const start = match?.[1] ? Number(match[1]) : 0;
  if (!Number.isFinite(start) || start >= total) return null;
  const askedEnd = match?.[2] ? Number(match[2]) : Number.POSITIVE_INFINITY;
  const end = Math.min(askedEnd, start + CHUNK_BYTES - 1, total - 1);
  return { start, end: Math.max(start, end) };
}

/**
 * Serve out of a file that is still being written.
 *
 * Waiting for the whole file before the first frame is the difference between
 * a video that starts now and one that starts in a minute, and a player asks
 * for the front of the file first — which arrives first. So a range is
 * answered as soon as the bytes it names are on disk.
 */
export async function partialFileResponse(
  entry: PendingFetch,
  range: string | undefined,
  signal?: AbortSignal,
): Promise<Response | null> {
  const total = await entry.total;
  // Without a length there is nothing to answer a range against; the caller
  // falls back to waiting for the whole file.
  if (total === null) return null;
  const wanted = wantedRange(range, total);
  if (!wanted) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${total}` } });

  let path = entry.path;
  let finished = false;
  for (;;) {
    if (signal?.aborted) return null;
    let size = 0;
    try {
      size = statSync(path).size;
    } catch {
      size = 0;
    }
    // Everything asked for, or enough of it to be worth answering with.
    if (size > wanted.end || size - wanted.start >= FIRST_BYTES) break;
    const settled = await Promise.race([entry.done, Bun.sleep(120).then(() => undefined)]);
    if (settled !== undefined) {
      if (settled === null) return null;
      path = settled;
      finished = true;
      break;
    }
  }
  if (finished && !existsSync(path)) return null;
  const available = statSync(path).size;
  const end = Math.min(wanted.end, available - 1);
  if (end < wanted.start) return null;
  log.info("invidious.cache_served", { bytes: end - wanted.start + 1, from: wanted.start, of: total, complete: finished });
  return new Response(Bun.file(path).slice(wanted.start, end + 1), {
    status: 206,
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(end - wanted.start + 1),
      "Content-Range": `bytes ${wanted.start}-${end}/${total}`,
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
    },
  });
}
