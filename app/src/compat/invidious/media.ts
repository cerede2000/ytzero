import { randomBytes } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { getSetting, setSetting } from "../../db";
import { mediaSignature, TOKEN_TTL_SECONDS } from "./mediaToken";

/**
 * Media links an outside player can follow on its own.
 *
 * A client hands the stream URL to the platform's player, not to the code that
 * fetched the document it came in — so whatever proved the request was allowed
 * (a session cookie, the reverse proxy's Basic Auth) is not there any more.
 * Invidious solves this by handing out YouTube's own signed CDN links; we
 * cannot, because ours are resolved with this instance's cookies and answer 403
 * to anyone else.
 *
 * So the link carries its own proof: a video id, an expiry, and a signature
 * over both. It grants exactly one video for a bounded time, it cannot be
 * edited into a link for another, and it says nothing about who asked.
 */
const SECRET_SETTING = "invidious_compat_secret";

let pending: Promise<string> | null = null;

/**
 * The key, minted once and kept.
 *
 * A per-process key would be simpler and would invalidate every link in flight
 * on each restart — a container that updates overnight would strand a playing
 * video. Serialised through one promise because two first requests arriving
 * together would otherwise mint two keys, and the loser's links would already
 * be signed with a secret no longer stored.
 */
export function mediaSecret(): Promise<string> {
  const existing = getSetting(SECRET_SETTING);
  if (existing) return Promise.resolve(existing);
  pending ??= (async () => {
    const again = getSetting(SECRET_SETTING);
    if (again) return again;
    const minted = randomBytes(32).toString("hex");
    await setSetting(SECRET_SETTING, minted);
    return minted;
  })().finally(() => { pending = null; });
  return pending;
}

export async function signedMediaUrl(origin: string, videoId: string, now: number = Date.now()): Promise<string> {
  const expires = Math.floor(now / 1000) + TOKEN_TTL_SECONDS;
  const signature = mediaSignature(await mediaSecret(), "media", videoId, expires);
  return `${origin}/api/v1/media/${encodeURIComponent(videoId)}?expires=${expires}&signature=${signature}`;
}

/**
 * Subtitles, addressed the way Invidious addresses them — relative.
 *
 * Yattee builds the caption request by prefixing this path with `/companion`
 * and resolving it against the instance, which is how current Invidious
 * deployments serve them. An absolute URL here would be concatenated into
 * nonsense, so this one stays a path and the server answers on both prefixes.
 */
export async function signedCaptionPath(videoId: string, language: string, now: number = Date.now()): Promise<string> {
  const expires = Math.floor(now / 1000) + TOKEN_TTL_SECONDS;
  const signature = mediaSignature(await mediaSecret(), `caption:${language}`, videoId, expires);
  return `/api/v1/captions/${encodeURIComponent(videoId)}?lang=${encodeURIComponent(language)}`
    + `&expires=${expires}&signature=${signature}`;
}

/**
 * A downloaded file, served with the byte ranges a player seeks by.
 *
 * The local copy is preferred over resolving anything upstream: it is already
 * the quality that was chosen, it costs no yt-dlp call, and it plays when
 * YouTube would refuse us.
 */
export function localFileResponse(path: string, range: string | undefined): Response | null {
  if (!existsSync(path)) return null;
  const size = statSync(path).size;
  const type = path.endsWith(".webm") ? "video/webm" : "video/mp4";
  const file = Bun.file(path);
  const match = range?.match(/bytes=(\d*)-(\d*)/);
  if (!match) {
    return new Response(file, {
      headers: { "Content-Type": type, "Content-Length": String(size), "Accept-Ranges": "bytes" },
    });
  }
  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isFinite(start) || start >= size) {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  }
  const last = Math.min(Number.isFinite(end) ? end : size - 1, size - 1);
  return new Response(file.slice(start, last + 1), {
    status: 206,
    headers: {
      "Content-Type": type,
      "Content-Length": String(last - start + 1),
      "Content-Range": `bytes ${start}-${last}/${size}`,
      "Accept-Ranges": "bytes",
    },
  });
}
