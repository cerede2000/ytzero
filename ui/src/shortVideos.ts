import type { Video } from "./apiTypes";

/**
 * Whether a video is a Short.
 *
 * `is_short` has three states, not two. Telling a Short from an ordinary upload
 * costs a request per video, so it is only ever done while syncing a channel:
 * a video that arrived any other way — opened from search, from a suggestion —
 * keeps `null`, and keeps it for good, because nothing goes back for it.
 *
 * Read as `is_short === 0`, "unknown" therefore reads as "Short", and the video
 * disappears from every list that hides them. That is how a video somebody had
 * just watched half of failed to appear under "Continue watching": not filtered
 * for being a Short, filtered for nobody having checked.
 *
 * Unknown is not a Short. A surface that would rather show nothing than risk a
 * Short — a recommendation, which is about videos nobody has seen yet — can
 * still say so by testing for a confirmed `0`; that is a different question,
 * and it is asked deliberately in the one place it applies.
 */
export function isShort(video: Pick<Video, "is_short">): boolean {
  return video.is_short === 1;
}
