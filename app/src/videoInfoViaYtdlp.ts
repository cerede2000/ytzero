import { downloadCookiesConfigured, ytdlpCommand, ytdlpStatus } from "./downloader";
import { callerWasRefused, cookieAttemptMemory } from "./cookieAttemptOrder";
import { log } from "./logger";
import type { AudioSource } from "./audioSourceResolver";
import { audioSourceHeaders } from "./audioSourceResolver";
import { safeGoogleVideoUrl } from "./audioUpstreamUrl";
import type { VideoInfo } from "./youtube";
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

/** Exactly what the import needs, as one JSON line whatever the text holds. */
const INFO_FIELDS = "%(.{id,title,channel_id,channel,uploader,description,thumbnail,"
  + "view_count,duration,upload_date,timestamp,release_timestamp,live_status,is_live,was_live})j";

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
  };
}

/** googlevideo URLs carry an `expire` unix-second param; keep just under it. */
function sourceExpiry(url: string): number {
  const match = url.match(/[?&]expire=(\d+)/);
  const expiresAt = match ? Number(match[1]) * 1000 : 0;
  return expiresAt ? Math.max(Date.now(), expiresAt - 300_000) : Date.now() + 3 * 3_600_000;
}

/**
 * The audio track that came with the description.
 *
 * The import asks for one format and prints it alongside the fields it needs,
 * so the track the player is about to want is already resolved — URL, and the
 * headers that URL expects. Resolving it again, seconds later, is the same
 * work twice.
 */
export function audioSourceFromPrinted(printed: {
  url?: string;
  headers?: string;
  acodec?: string;
  vcodec?: string;
}): AudioSource | null {
  const acodec = printed.acodec ?? "";
  const vcodec = printed.vcodec ?? "";
  // Audio only, and the AAC-in-MP4 the audio path is built around: anything
  // else would play as silence, or not at all.
  if (!acodec.startsWith("mp4a")) return null;
  if (vcodec && vcodec !== "none" && vcodec !== "NA") return null;
  const url = printed.url ? safeGoogleVideoUrl(printed.url) : null;
  if (!url) return null;
  return {
    url,
    mime: "audio/mp4",
    expiresAt: sourceExpiry(url),
    headers: audioSourceHeaders(printed.headers),
  };
}

async function runAttempt(
  userId: number,
  videoId: string,
  useCookies: boolean,
  spawn: typeof Bun.spawn,
  /** Filled in when YouTube turned the caller away rather than the request. */
  refusedRef: { refused: boolean } = { refused: false },
  audioRef: { source: AudioSource | null } = { source: null },
): Promise<VideoInfo | null> {
  const args = [
    `https://www.youtube.com/watch?v=${videoId}`,
    "--ignore-config", "--no-playlist", "--no-warnings",
    // One format rather than all of them: every format URL costs a signature
    // to decipher, and we want exactly one — the one the player will ask for.
    "-f", "bestaudio[acodec^=mp4a]/bestaudio[ext=m4a]/140/bestaudio/best",
    "--print", INFO_FIELDS,
    "--print", "urls",
    "--print", "%(http_headers)j",
    "--print", "%(acodec)s",
    "--print", "%(vcodec)s",
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
      return null;
    }
    const [fields, url, headers, acodec, vcodec] = stdout.split(/\r?\n/);
    const info = videoInfoFromYtdlpJson(videoId, JSON.parse(fields ?? "{}") as Record<string, unknown>);
    if (info) audioRef.source = audioSourceFromPrinted({ url, headers, acodec, vcodec });
    return info;
  } catch {
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
): Promise<VideoInfo | null> {
  if (!(await ytdlpStatus())) return null;
  const startedAt = Date.now();
  const order = cookieAttemptMemory.order(userId, downloadCookiesConfigured(userId));
  for (const useCookies of order) {
    const refusal = { refused: false };
    const info = await runAttempt(userId, videoId, useCookies, spawn, refusal, audioRef);
    cookieAttemptMemory.record({
      userId, useCookies, resolved: Boolean(info), refused: refusal.refused,
    });
    if (info) {
      log.info("video.info_via_ytdlp", {
        videoId, usedCookies: useCookies, ms: Date.now() - startedAt, audio: Boolean(audioRef.source),
      });
      return info;
    }
  }
  log.warn("video.info_via_ytdlp_failed", { videoId, ms: Date.now() - startedAt });
  return null;
}
