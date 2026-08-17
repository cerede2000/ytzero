import { classifyIsShort } from "./youtube";

/**
 * Settle whether a video is a Short, asking YouTube only when it has to.
 *
 * Shortness is otherwise only ever established while syncing a channel, so a
 * video that arrived any other way — opened from search, from a suggestion —
 * stays unknown for good, and every list that hides Shorts had to decide what
 * to do about a video nobody had looked at. Both answers were wrong: treating
 * it as a Short hid videos somebody was in the middle of watching, and
 * treating it as an upload lets a genuine Short through.
 *
 * There is no need to guess. The question can be settled at the one moment the
 * video is being fetched anyway, and mostly without asking anything at all.
 */

/**
 * The longest a Short has ever been allowed to run.
 *
 * YouTube raised the limit from sixty seconds to three minutes; nothing longer
 * is a Short, whatever else it might be. One second of slack because the
 * duration shown is rounded.
 */
export const SHORT_MAX_SECONDS = 3 * 60 + 1;

/** "26:50" and "1:29:08" — the form a video's duration arrives in. */
export function durationSeconds(value: string | null | undefined): number | null {
  if (!value) return null;
  const parts = value.split(":").map(Number);
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !Number.isFinite(part) || part < 0)) return null;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

/**
 * `true` a Short, `false` an ordinary upload, `null` still genuinely unknown.
 *
 * The duration answers most of it for nothing: a video running longer than a
 * Short is allowed to run cannot be one, and that is nearly everything anybody
 * watches. Only a video short enough to be in doubt costs a request.
 */
export async function settleIsShort(
  videoId: string,
  title: string,
  duration: string | null | undefined,
  classify: (videoId: string, title: string) => Promise<boolean | null> = classifyIsShort,
): Promise<boolean | null> {
  if (/#shorts?\b/i.test(title)) return true;
  const seconds = durationSeconds(duration);
  if (seconds !== null && seconds > SHORT_MAX_SECONDS) return false;
  // A live or upcoming stream has no duration yet and is not a Short either,
  // but that is the caller's business — here, unknown length means ask.
  return classify(videoId, title);
}
