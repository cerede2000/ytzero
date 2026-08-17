import { createHash } from "node:crypto";

const BRANDING_API = "https://sponsor.ajay.app/api/branding";
const THUMBNAIL_API = "https://dearrow-thumb.ajay.app/api/v1/getThumbnail";
const CACHE_TTL_MS = 15 * 60_000;

interface DeArrowCandidate {
  original: boolean;
  votes: number;
  locked: boolean;
}

interface DeArrowTitle extends DeArrowCandidate {
  title: string;
}

interface DeArrowThumbnail extends DeArrowCandidate {
  timestamp: number | null;
}

export interface DeArrowApiBranding {
  titles?: DeArrowTitle[];
  thumbnails?: DeArrowThumbnail[];
  /**
   * A fraction of the way through the video, returned for every video whether
   * or not anybody has submitted a thumbnail for it.
   *
   * It is how DeArrow answers the far commoner case: nobody has chosen a frame,
   * and showing the uploader's is showing the thing the reader asked not to
   * see. Measured on a channel of 213 videos, not one had a community
   * thumbnail and every one had this.
   */
  randomTime?: number;
  videoDuration?: number | null;
}

export interface DeArrowBranding {
  title: string | null;
  thumbnail: string | null;
}

const prefixCache = new Map<string, { expiresAt: number; value: Promise<Record<string, DeArrowApiBranding>> }>();

export function deArrowHashPrefix(videoId: string): string {
  return createHash("sha256").update(videoId).digest("hex").slice(0, 4);
}

/**
 * The frame to show when the community has chosen none.
 *
 * `randomTime` is a fraction of the way through, so it needs the duration to
 * become a time. Without one there is nothing to ask the thumbnail service for,
 * and the uploader's own image is the honest answer.
 */
export function deArrowFallbackTimestamp(branding: DeArrowApiBranding | undefined): number | null {
  const fraction = Number(branding?.randomTime);
  const duration = Number(branding?.videoDuration);
  if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) return null;
  if (!Number.isFinite(duration) || duration <= 0) return null;
  return fraction * duration;
}

function trusted<T extends DeArrowCandidate>(candidate: T | undefined): candidate is T {
  return Boolean(candidate && (candidate.locked || candidate.votes >= 0));
}

export function selectDeArrowBranding(videoId: string, branding: DeArrowApiBranding | undefined): DeArrowBranding {
  const titleCandidate = branding?.titles?.[0];
  const thumbnailCandidate = branding?.thumbnails?.[0];
  const title = trusted(titleCandidate) && !titleCandidate.original
    ? titleCandidate.title.replaceAll(">", "").trim() || null
    : null;
  const chosen = trusted(thumbnailCandidate) && !thumbnailCandidate.original && Number.isFinite(thumbnailCandidate.timestamp)
    ? Number(thumbnailCandidate.timestamp)
    : null;
  // Nobody has chosen a frame for most videos, and stopping there left the
  // setting doing nothing at all on whole channels: the uploader's thumbnail
  // stayed, which is the one the reader turned this on to avoid. DeArrow
  // answers that with a point in the video, and its own extension shows the
  // frame there — so this does too.
  const timestamp = chosen ?? deArrowFallbackTimestamp(branding);
  const thumbnail = timestamp != null && timestamp >= 0
    ? `${THUMBNAIL_API}?videoID=${encodeURIComponent(videoId)}&time=${encodeURIComponent(String(timestamp))}`
    : null;
  return { title, thumbnail };
}

async function brandingForPrefix(prefix: string): Promise<Record<string, DeArrowApiBranding>> {
  const now = Date.now();
  const cached = prefixCache.get(prefix);
  if (cached && cached.expiresAt > now) return cached.value;

  const value = fetch(`${BRANDING_API}/${prefix}`, {
    headers: { "X-Client-Name": "YTZero" },
    signal: AbortSignal.timeout(8_000),
  }).then(async (response) => {
    if (response.status === 404) return {};
    if (!response.ok) throw new Error(`DeArrow API returned ${response.status}`);
    return await response.json() as Record<string, DeArrowApiBranding>;
  }).catch(() => ({}));
  prefixCache.set(prefix, { expiresAt: now + CACHE_TTL_MS, value });
  return value;
}

export async function getDeArrowBranding(videoId: string): Promise<DeArrowBranding> {
  const response = await brandingForPrefix(deArrowHashPrefix(videoId));
  return selectDeArrowBranding(videoId, response[videoId]);
}
