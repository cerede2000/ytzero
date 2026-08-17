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
export function thumbnailCandidates(src: string, fallbackSrc?: string): string[] {
  const candidates: string[] = [];
  for (const url of [src, fallbackSrc]) {
    if (url && !candidates.includes(url)) candidates.push(url);
  }
  const plain = plainYouTubeThumbnail(candidates[candidates.length - 1] ?? src);
  if (plain && !candidates.includes(plain)) candidates.push(plain);
  return candidates;
}
