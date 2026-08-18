import { YTDLP } from "./downloadConfig";
import { log } from "./logger";

/**
 * Dailymotion, kept at arm's length.
 *
 * A deliberate island: nothing here writes to `videos`, nothing here is asked
 * for by the feed, and no YouTube path knows it exists. The point is to find
 * out whether the pipeline this application is built on — resolve with yt-dlp,
 * serve the stream ourselves, let the client choose picture or sound — holds
 * for a second source, before deciding what an identifier means or what a sync
 * would look like.
 */
const SEARCH_API = "https://api.dailymotion.com/videos";
const SEARCH_FIELDS = "id,title,duration,thumbnail_360_url,owner.screenname,created_time,views_total,status,private,allow_embed";
/** Signed and short-lived: worth reusing across a page's segment requests, not worth keeping. */
const STREAM_TTL_MS = 60_000;
/** Dailymotion's own id grammar: an x and base-36, nothing that could be a path. */
const VIDEO_ID = /^x[a-z0-9]{5,9}$/i;
const MEDIA_HOSTS = ["dmcdn.net", "dailymotion.com"];

export interface DailymotionVideo {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnail: string;
  durationSeconds: number | null;
  publishedAt: string | null;
  views: number | null;
}

export function validDailymotionVideoId(value: string): boolean {
  return VIDEO_ID.test(value);
}

/** Only the hosts Dailymotion serves media from, so the proxy cannot be aimed elsewhere. */
export function isDailymotionMediaUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return MEDIA_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
  } catch {
    return false;
  }
}

/**
 * Whether this result is one we could actually play.
 *
 * The search index keeps entries YouTube's equivalent would have dropped: asked
 * for "film complet", one result in fifteen answered 404 on its own endpoint —
 * "This video does not exist or has been deleted" — and yt-dlp said `Not found`
 * for it. Offering those is offering a card that cannot be pressed, which is
 * how this was reported.
 *
 * The dead one differed from its fourteen neighbours in a single field:
 * `allow_embed` was false where every live result had it true. That is also
 * exactly the right question to ask — not "does this exist" but "may we play
 * it" — so it is the one asked, alongside the two obvious ones.
 */
function playable(raw: Record<string, unknown>): boolean {
  if (raw.allow_embed === false) return false;
  if (raw.private === true) return false;
  return raw.status === undefined || raw.status === "published";
}

function toVideo(raw: Record<string, unknown>): DailymotionVideo | null {
  const videoId = typeof raw.id === "string" ? raw.id : "";
  if (!validDailymotionVideoId(videoId) || !playable(raw)) return null;
  const seconds = Number(raw.duration);
  const created = Number(raw.created_time);
  const views = Number(raw.views_total);
  return {
    videoId,
    title: typeof raw.title === "string" ? raw.title : videoId,
    channelTitle: typeof raw["owner.screenname"] === "string" ? raw["owner.screenname"] : "",
    thumbnail: typeof raw.thumbnail_360_url === "string" ? raw.thumbnail_360_url : "",
    durationSeconds: Number.isFinite(seconds) && seconds > 0 ? seconds : null,
    publishedAt: Number.isFinite(created) ? new Date(created * 1000).toISOString() : null,
    views: Number.isFinite(views) ? views : null,
  };
}

export async function searchDailymotion(query: string, limit = 24, fetchImpl: typeof fetch = fetch): Promise<DailymotionVideo[]> {
  const url = `${SEARCH_API}?search=${encodeURIComponent(query)}&limit=${Math.min(50, Math.max(1, limit))}`
    + `&fields=${encodeURIComponent(SEARCH_FIELDS)}&sort=relevance`;
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Dailymotion search failed (${response.status})`);
  const payload = await response.json() as { list?: Record<string, unknown>[] };
  return (payload.list ?? []).map(toVideo).filter((video): video is DailymotionVideo => video !== null);
}

const streamCache = new Map<string, { expiresAt: number; url: Promise<string> }>();

/**
 * The playable address, from yt-dlp.
 *
 * `-g` prints it and nothing else, which is the whole of what this needs: the
 * answer is an HLS playlist on Dailymotion's CDN, signed and short-lived. It is
 * cached for a minute so the segments of one playback share a single lookup —
 * a page that resolved once per segment would spend a subprocess per three
 * seconds of video.
 */
export function resolveDailymotionStream(videoId: string): Promise<string> {
  const cached = streamCache.get(videoId);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.url;
  const url = (async () => {
    const proc = Bun.spawn([YTDLP, "-g", "--no-warnings", `https://www.dailymotion.com/video/${videoId}`], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    if (await proc.exited !== 0) throw new Error(err.trim().split("\n").pop() || "yt-dlp could not resolve the video");
    const first = out.split("\n").map((line) => line.trim()).find(Boolean);
    if (!first || !isDailymotionMediaUrl(first)) throw new Error("yt-dlp returned no usable address");
    log.info("dailymotion.resolved", { videoId });
    return first;
  })();
  streamCache.set(videoId, { expiresAt: now + STREAM_TTL_MS, url });
  url.catch(() => streamCache.delete(videoId));
  return url;
}

/**
 * The same playlist, pointing at us instead of at Dailymotion.
 *
 * Its segment lines are relative, and the CDN sends no CORS header — so a
 * player fetching them from this origin is refused, and one fetching them
 * directly leaks a signed URL into the page. Both are answered by rewriting
 * every URI to an absolute address behind our own proxy. Attribute URIs are
 * rewritten too: no Dailymotion playlist seen here carries a key, and one that
 * did would otherwise fail silently.
 */
export function rewriteHlsPlaylist(playlist: string, playlistUrl: string, proxy: (absolute: string) => string): string {
  const absolute = (reference: string) => {
    try { return new URL(reference, playlistUrl).toString(); } catch { return reference; }
  };
  return playlist.split("\n").map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (!trimmed.startsWith("#")) return proxy(absolute(trimmed));
    return line.replace(/URI="([^"]+)"/g, (_match, reference: string) => `URI="${proxy(absolute(reference))}"`);
  }).join("\n");
}
