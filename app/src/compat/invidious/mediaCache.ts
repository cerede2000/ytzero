import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, utimesSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DB_PATH } from "../../db";
import { YTDLP, downloadCookiesConfigured, downloadCookiesFile } from "../../downloadConfig";
import { log } from "../../logger";
import { potArgsFor } from "../../ytdlpPotProvider";

/**
 * Letting yt-dlp fetch the bytes, because nothing else can.
 *
 * The obvious design was to resolve the file's address and range-proxy it, the
 * way the web player's direct streaming does. Measured on a live instance, that
 * is now impossible: every format, every client, every combination of headers
 * and ranges answers 403 to a URL that yt-dlp printed — while yt-dlp itself
 * downloads the same format at twenty-five megabytes a second. YouTube is
 * running an experiment binding the proof-of-origin token to the video, and an
 * address extracted by one process and fetched by another is dead on arrival.
 *
 * So the file is fetched the only way that works, kept, and served from disk
 * with the byte ranges a player seeks by. What it costs is space, which is why
 * it is capped and evicted oldest-first, and why it lives apart from the
 * profile's own downloads: nobody asked for these to be kept.
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

const fetching = new Map<string, Promise<string | null>>();

/**
 * The file on disk, fetching it first if this is the first time it is wanted.
 *
 * One fetch per video however many are waiting: a native player opens several
 * connections at once, and each of them arrives here for the same file.
 */
export function ensureCached(userId: number, videoId: string): Promise<string | null> {
  if (!cacheableVideoId(videoId)) return Promise.resolve(null);
  const existing = cachedMedia(videoId);
  if (existing) return Promise.resolve(existing);
  const key = `${userId}:${videoId}`;
  const running = fetching.get(key);
  if (running) return running;
  const started = fetch(userId, videoId).finally(() => fetching.delete(key));
  fetching.set(key, started);
  return started;
}

async function fetch(userId: number, videoId: string): Promise<string | null> {
  mkdirSync(CACHE_DIR, { recursive: true });
  const target = pathFor(videoId);
  // Written under another name and moved into place, so a partial file is
  // never mistaken for one that can be served.
  const partial = join(CACHE_DIR, `${videoId}.partial`);
  const args = [
    `https://www.youtube.com/watch?v=${videoId}`,
    "--no-playlist", "--no-warnings", "--no-part",
    "-f", FORMAT,
    "-o", partial,
    ...potArgsFor(true),
  ];
  if (downloadCookiesConfigured(userId)) args.push("--cookies", downloadCookiesFile(userId));

  const startedAt = Date.now();
  const process = Bun.spawn([YTDLP, ...args], { stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => process.kill(), FETCH_TIMEOUT_MS);
  try {
    const [said, exitCode] = await Promise.all([
      new Response(process.stderr as ReadableStream<Uint8Array>).text(),
      process.exited,
    ]);
    if (exitCode !== 0 || !existsSync(partial)) {
      log.warn("invidious.cache_fetch_failed", {
        videoId, exitCode,
        said: said.split(/\r?\n/).filter(Boolean).slice(-2).map((line) => line.replace(/https?:\/\/\S+/gi, "<url>").slice(0, 300)),
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
  }
}
