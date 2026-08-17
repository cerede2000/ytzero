/**
 * What to show when a thumbnail URL stops resolving.
 *
 * Two ways an image that was fine at import time stops being one. A replacement
 * can render nothing — DeArrow answers 204 while it has no frame yet. And the
 * uploader's own image can simply go: YouTube's designed thumbnails are served
 * under a numbered, signed name, and changing the thumbnail rotates it.
 *
 *     hq720_custom_3.jpg?sqp=…&rs=…   →  404, signature or no signature
 *     hqdefault.jpg                   →  200
 *
 * The plain name is derived from the video id and never rotates, so it is the
 * last thing worth trying before drawing a hole. Measured on a followed
 * channel: 2 rows in 100 carried a custom name, one of which had already gone.
 */
/*
 * Thumbnails come from more than one host. A row imported from the page scrape
 * carries `i.ytimg.com`; one imported from a feed carries `i2`, `i4`, or
 * `img.youtube.com`. Matching only the first left three quarters of a library
 * with no fallback at all.
 */
const YOUTUBE_THUMBNAIL = /^https?:\/\/(?:i\d*\.ytimg\.com|img\.youtube\.com)\/vi\/([\w-]+)\//i;

/** The never-rotating name for the same video, or null if that is this URL. */
export function plainYouTubeThumbnail(url: string): string | null {
  const videoId = YOUTUBE_THUMBNAIL.exec(url)?.[1];
  if (!videoId) return null;
  const plain = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  return url.split("?")[0] === plain ? null : plain;
}

/**
 * Everything worth showing, best first.
 *
 * Order is what was asked for, then what it falls back to, then the name that
 * cannot rotate — derived from the last of those, since a DeArrow frame carries
 * no video id of its own but the image it stands in for does.
 */
/**
 * The candidate owed a second chance.
 *
 * DeArrow renders a frame the first time somebody asks for it, and answers 204
 * until it has one — so the first page view of a video nobody has ever opened
 * gets nothing, falls back to the uploader's image, and keeps it for the rest
 * of the session. Measured on the channel reported: of 22 videos, 3 answered
 * 204; one of them had answered 204 earlier the same evening and answered 200
 * by the time it was asked again. The answer changes, so asking once is not
 * enough — and the 204 carries no cache headers, so asking again really asks.
 *
 * Once per candidate, though. A video DeArrow cannot render answers 204 for
 * ever, and a card that keeps retrying is a card that keeps asking for it.
 */
export function pendingRetry(failed: readonly string[], retried: readonly string[]): string | null {
  return failed.find((url) => !retried.includes(url)) ?? null;
}

/**
 * What stays on screen while a different image is being loaded out of sight.
 *
 * Setting a new `src` empties the element until the replacement decodes, and a
 * card is given a second URL a moment after its first: DeArrow's answer arrives
 * after the page has settled. Rendering what is already painted until the next
 * one is ready is what turns a blink into a swap. The exception is the first
 * paint, where holding back would show nothing at all.
 */
export function shownThumbnail(painted: string | null, wanted: string): string {
  return painted && painted !== wanted ? painted : wanted;
}

export function thumbnailCandidates(src: string, fallbackSrc?: string): string[] {
  const candidates: string[] = [];
  for (const url of [src, fallbackSrc]) {
    if (url && !candidates.includes(url)) candidates.push(url);
  }
  const plain = plainYouTubeThumbnail(candidates[candidates.length - 1] ?? src);
  if (plain && !candidates.includes(plain)) candidates.push(plain);
  return candidates;
}
