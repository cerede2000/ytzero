import { database } from "./database";
import { log } from "./logger";
import { isDeletedVideoError, isPrivateVideoError } from "./youtubeVideoAvailability";

/**
 * Write down what a failed playback already found out.
 *
 * A video removed by its uploader is discovered twice over: the availability
 * sync asks YouTube about it on a cycle, and a reader opens it and is told
 * plainly that it is gone. Only the first was ever written down — so a video
 * somebody had just been refused stayed in their feed, looking perfectly
 * ordinary, until the sync's turn came round.
 *
 * That turn can be a while. Each video is re-asked at most once a day and only
 * a dozen per channel per pass, so a video deleted just after its last check is
 * offered for another day at least. The reader has already paid for the answer
 * by being turned away; this is only a matter of keeping it.
 *
 * Refusals are not this. "Sign in to confirm you're not a bot" is about the
 * address, says nothing about the video, and marking on it would empty a
 * library over one bad afternoon — which is why the two predicates below are
 * narrow and neither of them matches a refusal.
 */
export async function recordVideoGone(videoId: string, error: unknown): Promise<boolean> {
  const isPrivate = isPrivateVideoError(error);
  if (!isPrivate && !isDeletedVideoError(error)) return false;
  const column = isPrivate ? "is_private" : "is_unavailable";
  // Only ever from 0 to 1: a row already marked needs nothing, and the write is
  // skipped rather than repeated on every retry behind a stuck player.
  const result = await database.prepare(
    `UPDATE videos SET ${column} = 1, availability_checked_at = datetime('now')
     WHERE video_id = ? AND ${column} = 0`
  ).run(videoId);
  const changed = Number((result as { changes?: number } | undefined)?.changes ?? 0) > 0;
  if (changed) {
    log.info("video.gone_on_playback", { videoId, reason: isPrivate ? "private" : "deleted" });
  }
  return changed;
}
