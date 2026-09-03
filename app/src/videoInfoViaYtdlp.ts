import { downloadCookiesConfigured, ytdlpCommand, ytdlpStatus } from "./downloader";
import { callerWasRefused, cookieAttemptMemory } from "./cookieAttemptOrder";
import { videoInfoRefusalQuiet } from "./youtubeRefusalQuiet";
import { currentCookieHealth } from "./youtubeCookieHealth";
import { log } from "./logger";
import type { AudioSource } from "./audioSourceResolver";
import { parseYtdlpHttpHeaders, type YtdlpHttpHeaders } from "./ytdlpHttpHeaders";
import { safeGoogleVideoUrl } from "./audioUpstreamUrl";
import type { VideoInfo } from "./youtube";
import { audioLanguageFor, audioSelectorFor } from "./audioTrackLanguage";
import { potArgsFor } from "./ytdlpPotProvider";

/**
 * Read a video's details through yt-dlp when YouTube will not answer directly.
 *
 * Opening a video that is not in the library imports it first, and that import
 * reads the player response the same way the rest of the app does: over plain
 * HTTPS, with no cookies and no proof-of-origin token. When the address is
 * being refused, every one of those attempts fails and the video simply cannot
 * be opened — while yt-dlp, in the same container, resolves its audio without
 * trouble, because it has both.
 *
 * So the same question is asked again through the tool that can get an answer.
 * This is a fallback, not a replacement: it costs a process and several
 * seconds, which is only worth paying once the direct read has failed.
 */

const INFO_TIMEOUT_MS = 45_000;

/** The last thing said, capped: yt-dlp puts the reason on the final line. */
function lastLine(text: string): string {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return (lines[lines.length - 1] ?? "").slice(0, 300);
}

/** Exactly what the import needs, as one JSON line whatever the text holds. */
const INFO_FIELDS = "%(.{id,title,channel_id,channel,uploader,description,thumbnail,"
  + "view_count,duration,upload_date,timestamp,release_timestamp,live_status,is_live,was_live})j";

/** Printed once per requested format, in this order. */
const PRINTED_FIELDS = [INFO_FIELDS, "urls", "%(http_headers)j", "%(acodec)s", "%(vcodec)s", "%(ext)s"];

const PROGRESSIVE_SELECTOR = "22/18/best[ext=mp4][acodec!=none][vcodec!=none]";

/** yt-dlp's own vocabulary for what a video is doing. */
function liveStatusFrom(json: Record<string, unknown>): VideoInfo["liveStatus"] {
  const status = typeof json.live_status === "string" ? json.live_status : "";
  if (status === "is_live") return "live";
  if (status === "is_upcoming") return "upcoming";
  if (status === "was_live" || status === "post_live") return "was_live";
  if (json.is_live === true) return "live";
  if (json.was_live === true) return "was_live";
  return "none";
}

/** The same `M:SS` shape the player response produces, hours included as minutes. */
function durationFrom(json: Record<string, unknown>): string | null {
  const seconds = Math.floor(Number(json.duration));
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function publishedAtFrom(json: Record<string, unknown>): string | null {
  const timestamp = Number(json.release_timestamp ?? json.timestamp);
  if (Number.isFinite(timestamp) && timestamp > 0) return new Date(timestamp * 1000).toISOString();
  const uploadDate = typeof json.upload_date === "string" ? json.upload_date : "";
  const parts = uploadDate.match(/^(\d{4})(\d{2})(\d{2})$/);
  return parts ? `${parts[1]}-${parts[2]}-${parts[3]}T00:00:00.000Z` : null;
}

function thumbnailFrom(json: Record<string, unknown>): string {
  if (typeof json.thumbnail === "string" && json.thumbnail) return json.thumbnail;
  const thumbnails = Array.isArray(json.thumbnails) ? json.thumbnails : [];
  const last = thumbnails.at(-1) as { url?: unknown } | undefined;
  return typeof last?.url === "string" ? last.url : "";
}

/** Map one `--dump-single-json` payload onto the shape the rest of the app uses. */
export function videoInfoFromYtdlpJson(videoId: string, json: Record<string, unknown>): VideoInfo | null {
  const channelId = typeof json.channel_id === "string" ? json.channel_id : "";
  const title = typeof json.title === "string" ? json.title : "";
  // Without a channel there is nothing to attach the video to, and without a
  // title there is nothing to show: an answer missing either is not an answer.
  if (!channelId || !title) return null;
  const views = Number(json.view_count);
  return {
    videoId,
    title,
    channelId,
    channelTitle: typeof json.channel === "string" && json.channel
      ? json.channel
      : typeof json.uploader === "string" ? json.uploader : "",
    description: typeof json.description === "string" ? json.description : "",
    thumbnail: thumbnailFrom(json),
    viewCount: Number.isFinite(views) && views >= 0 ? views : null,
    publishedAt: publishedAtFrom(json),
    duration: durationFrom(json),
    liveStatus: liveStatusFrom(json),
    // yt-dlp answers about the video, not about the embed. Unknown stays
    // unknown rather than being read as a refusal.
    playableInEmbed: null,
  };
}

/** A muxed progressive file, which is what the direct video player streams. */
export interface ProgressiveVideoSource {
  url: string;
  expiresAt: number;
  issuedAt: number;
  /**
   * The headers this URL expects, for the same reason the audio track carries
   * them: a file signed for a client that was signed in answers 403 to a
   * caller that does not look like it.
   */
  httpHeaders: YtdlpHttpHeaders;
}

/** googlevideo URLs carry an `expire` unix-second param; keep just under it. */
function sourceExpiry(url: string): number {
  const match = url.match(/[?&]expire=(\d+)/);
  const expiresAt = match ? Number(match[1]) * 1000 : 0;
  return expiresAt ? Math.max(Date.now(), expiresAt - 300_000) : Date.now() + 3 * 3_600_000;
}

export interface PrintedFormat {
  url?: string;
  headers?: string;
  acodec?: string;
  vcodec?: string;
  ext?: string;
}

const absent = (codec: string) => !codec || codec === "none" || codec === "NA";

/**
 * The audio track that came with the description.
 *
 * The import asks for the formats it prints alongside the fields it needs, so
 * the track the player is about to want is already resolved — URL, and the
 * headers that URL expects. Resolving it again, seconds later, is the same
 * work twice.
 */
export function audioSourceFromPrinted(printed: PrintedFormat): AudioSource | null {
  // Audio only, and the AAC-in-MP4 the audio path is built around: anything
  // else would play as silence, or not at all.
  if (!(printed.acodec ?? "").startsWith("mp4a")) return null;
  if (!absent(printed.vcodec ?? "")) return null;
  const url = printed.url ? safeGoogleVideoUrl(printed.url) : null;
  if (!url) return null;
  const httpHeaders = parseYtdlpHttpHeaders(printed.headers ?? "");
  if (!httpHeaders) return null;
  return { url, mime: "audio/mp4", expiresAt: sourceExpiry(url), issuedAt: Date.now(), httpHeaders };
}

/**
 * The progressive file that came with it, for the same reason.
 *
 * The direct video player streams one muxed file, and the import is already
 * asking YouTube about this video with the credentials it takes to get an
 * answer. Printing that format too costs one more signature to decipher —
 * measured at no difference worth reporting — and saves the player a second
 * extraction of four to five seconds a few moments later.
 */
export function progressiveVideoFromPrinted(printed: PrintedFormat): ProgressiveVideoSource | null {
  // Muxed: a file with only one of the two is what the HLS path assembles, not
  // something a <video> element can play on its own.
  if (absent(printed.acodec ?? "") || absent(printed.vcodec ?? "")) return null;
  const url = printed.url ? safeGoogleVideoUrl(printed.url) : null;
  if (!url) return null;
  const httpHeaders = parseYtdlpHttpHeaders(printed.headers ?? "");
  if (!httpHeaders) return null;
  return { url, expiresAt: sourceExpiry(url), issuedAt: Date.now(), httpHeaders };
}

/**
 * Split what yt-dlp printed back into one entry per format.
 *
 * Asking for two formats repeats the whole `--print` block for each, and a
 * selector that matches nothing is quietly skipped rather than failing the
 * call — so the blocks are counted, not assumed, and each one says for itself
 * which track it is.
 */
export function printedFormats(stdout: string, fieldsPerFormat: number): PrintedFormat[] {
  const lines = stdout.split(/\r?\n/);
  const formats: PrintedFormat[] = [];
  for (let start = 0; start + fieldsPerFormat <= lines.length; start += fieldsPerFormat) {
    const [, url, headers, acodec, vcodec, ext] = lines.slice(start, start + fieldsPerFormat);
    formats.push({ url, headers, acodec, vcodec, ext });
  }
  return formats;
}

async function runAttempt(
  userId: number,
  videoId: string,
  useCookies: boolean,
  spawn: typeof Bun.spawn,
  /** Filled in when YouTube turned the caller away rather than the request. */
  refusedRef: { refused: boolean } = { refused: false },
  audioRef: { source: AudioSource | null } = { source: null },
  videoRef: { source: ProgressiveVideoSource | null } = { source: null },
  /** How this attempt ended, for the line that reports the failure. */
  why: { reason: string; said: string } = { reason: "", said: "" },
): Promise<VideoInfo | null> {
  const args = [
    `https://www.youtube.com/watch?v=${videoId}`,
    "--ignore-config", "--no-playlist", "--no-warnings",
    // Two formats rather than all of them: every format URL costs a signature
    // to decipher, and these are the two a page actually plays — the audio
    // track and the progressive file. A video offering neither prints one
    // block, or none, and the import carries on regardless.
    "-f", `${audioSelectorFor(audioLanguageFor(userId))},${PROGRESSIVE_SELECTOR}`,
    ...PRINTED_FIELDS.flatMap((field) => ["--print", field]),
    ...potArgsFor(useCookies),
  ];
  let process: ReturnType<typeof Bun.spawn>;
  try {
    process = spawn(ytdlpCommand(userId, args, useCookies), { stdout: "pipe", stderr: "pipe" });
  } catch {
    return null;
  }
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; try { process.kill(); } catch {} }, INFO_TIMEOUT_MS);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(process.stdout as ReadableStream<Uint8Array>).text(),
      new Response(process.stderr as ReadableStream<Uint8Array>).text(),
      process.exited,
    ]);
    if (timedOut || exitCode !== 0) {
      // What this attempt learned is worth passing on: the audio resolver is
      // about to ask the same question, and can skip the same doomed attempt.
      refusedRef.refused = callerWasRefused(stderr);
      /*
       * And what it was told, which used to be thrown away.
       *
       * Three different endings returned the same silent null — a refusal, an
       * answer that could not be read, and a thrown error — so the line
       * reporting the failure could not say which had happened. A day went
       * into reproducing the command by hand, where it succeeded every way it
       * was tried, because nothing here said what was different.
       */
      why.reason = timedOut ? "timeout" : refusedRef.refused ? "refused" : "exit";
      why.said = lastLine(stderr);
      return null;
    }
    const info = videoInfoFromYtdlpJson(videoId, JSON.parse(stdout.split(/\r?\n/)[0] ?? "{}") as Record<string, unknown>);
    if (!info) {
      // yt-dlp answered, and the answer was not one this could read: a shape
      // that changed, or a field it no longer prints.
      why.reason = "unreadable";
      why.said = lastLine(stdout.split(/\r?\n/)[0] ?? "");
      return null;
    }
    for (const printed of printedFormats(stdout, PRINTED_FIELDS.length)) {
      audioRef.source ??= audioSourceFromPrinted(printed);
      videoRef.source ??= progressiveVideoFromPrinted(printed);
    }
    return info;
  } catch (error) {
    // The JSON parse above included: a first line that is not JSON threw here
    // and left no trace at all.
    why.reason = "crashed";
    why.said = error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ask yt-dlp for a video's details, honouring the same credential order the
 * media resolvers learned: on a refused address, cookies first.
 */
export async function fetchVideoInfoViaYtdlp(
  userId: number,
  videoId: string,
  spawn: typeof Bun.spawn = Bun.spawn,
  /** Receives the audio track found alongside, so nobody resolves it twice. */
  audioRef: { source: AudioSource | null } = { source: null },
  /** And the progressive file, for the same reason. */
  videoRef: { source: ProgressiveVideoSource | null } = { source: null },
): Promise<VideoInfo | null> {
  if (!(await ytdlpStatus())) return null;
  const startedAt = Date.now();
  const order = cookieAttemptMemory.order(userId, downloadCookiesConfigured(userId), videoInfoRefusalQuiet.quiet());
  const endings: { cookies: boolean; reason: string; said: string }[] = [];
  for (const useCookies of order) {
    const refusal = { refused: false };
    const why = { reason: "", said: "" };
    const info = await runAttempt(userId, videoId, useCookies, spawn, refusal, audioRef, videoRef, why);
    if (!info) endings.push({ cookies: useCookies, reason: why.reason || "unknown", said: why.said });
    cookieAttemptMemory.record({
      userId, useCookies, resolved: Boolean(info), refused: refusal.refused,
    });
    if (info) {
      log.info("video.info_via_ytdlp", {
        videoId, usedCookies: useCookies, ms: Date.now() - startedAt,
        audio: Boolean(audioRef.source), video: Boolean(videoRef.source),
      });
      return info;
    }
  }
  // Which profile asked, and whether it had anything to ask with. A failure
  // here is the last thing standing between somebody and the video, and the
  // usual cause is a profile whose cookie jar is missing or no longer good —
  // which is invisible unless the line says so.
  log.warn("video.info_via_ytdlp_failed", {
    videoId,
    userId,
    cookiesConfigured: downloadCookiesConfigured(userId),
    attempted: order,
    // What each attempt was actually told. Without this the line said only
    // that something had failed, which is the one thing already obvious.
    endings,
    ms: Date.now() - startedAt,
  });
  /*
   * Ask whether the jar is still known, now that something has just failed
   * holding it.
   *
   * This is the strongest evidence there is that it has expired, and until
   * now it went nowhere: the answer was only ever refreshed by somebody
   * opening the page that displays it, so an instance could spend a night
   * failing every ten minutes while still reporting the jar as good. The
   * question carries its own ten-minute memory, so a run of failures asks it
   * once.
   */
  if (downloadCookiesConfigured(userId)) void currentCookieHealth(userId).catch(() => {});
  return null;
}
