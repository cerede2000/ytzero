import { database } from "./database";
import { log } from "./logger";
import {
  fetchVideoInfo,
  fetchVideoOEmbed,
  isDeletedVideoError,
  isPrivateVideoError,
} from "./youtube";
import { isYouTubeRateLimitError } from "./youtubeRateLimit";
import { isYouTubeRefusal } from "./youtubeRefusalQuiet";

const AVAILABILITY_CANDIDATE_SCAN = 100;
const AVAILABILITY_CHECK_LIMIT = 12;

export type VideoAvailabilityCheck = "available" | "deleted" | "private" | "unknown";

export interface VideoAvailabilityAnswer {
  check: VideoAvailabilityCheck;
  /** The uploader's own title, when the oEmbed answer carried one. */
  title: string | null;
}

export async function checkVideoAvailability(
  videoId: string,
  dependencies: {
    oEmbed?: typeof fetchVideoOEmbed;
    videoInfo?: typeof fetchVideoInfo;
  } = {},
): Promise<VideoAvailabilityAnswer> {
  const oEmbed = dependencies.oEmbed ?? fetchVideoOEmbed;
  const videoInfo = dependencies.videoInfo ?? fetchVideoInfo;
  const lightweight = await oEmbed(videoId);
  if (lightweight.availability === "available") return { check: "available", title: lightweight.title };
  if (lightweight.availability === "unknown") return { check: "unknown", title: null };
  try {
    await videoInfo(videoId, { force: true });
    return { check: "available", title: null };
  } catch (error) {
    if (isPrivateVideoError(error)) return { check: "private", title: null };
    if (isDeletedVideoError(error)) return { check: "deleted", title: null };
    throw error;
  }
}

/**
 * What this pass should write down, given the title oEmbed handed back.
 *
 * oEmbed never translates: it answers with what the uploader wrote. The row's
 * `title` may not be that at all — a library kept in French lists a Japanese
 * video under the French title YouTube shows a French reader — so the question
 * "has this upload been renamed?" is asked of `title_original`, and of nothing
 * else. Asked of `title`, the answer is yes for every translated video, every
 * day, and the translation is written over within the hour.
 *
 * A row from before that column existed has nothing to compare against, so the
 * uploader's title is written to both: it is the only title anybody has. That
 * is bookkeeping rather than a rename, and `retitled` says so.
 */
export function titleUpdateFor(
  row: { title: string; title_original?: string | null },
  uploaded: string | null,
): { write: string; retitled: boolean } | null {
  if (!uploaded) return null;
  if ((row.title_original ?? "") === uploaded) return null;
  return { write: uploaded, retitled: row.title !== uploaded };
}

export interface ChannelAvailabilitySyncResult {
  checked: number;
  deleted: number;
  private: number;
  retitled: number;
  failed: number;
  rateLimited: boolean;
  /** Left unasked because the address was being refused. Not the same as failed. */
  skipped: number;
}

export async function syncChannelVideoAvailability(
  channelId: string,
  remotelySeenVideoIds: ReadonlySet<string>,
  options: { force?: boolean } = {},
): Promise<ChannelAvailabilitySyncResult> {
  const dueFilter = options.force
    ? ""
    : "AND (availability_checked_at IS NULL OR availability_checked_at <= datetime('now', '-1 day'))";
  const rows = await database.prepare(`
    SELECT video_id, title, title_original FROM videos
    WHERE channel_id = ? AND is_private = 0 AND is_unavailable = 0
      ${dueFilter}
    ORDER BY COALESCE(published_at, created_at) DESC, video_id DESC
    LIMIT ?
  `).all(channelId, AVAILABILITY_CANDIDATE_SCAN) as { video_id: string; title: string; title_original: string | null }[];
  const candidates = rows
    .filter((row) => !remotelySeenVideoIds.has(row.video_id))
    .slice(0, AVAILABILITY_CHECK_LIMIT);
  const markChecked = database.prepare("UPDATE videos SET availability_checked_at = datetime('now') WHERE video_id = ?");
  const markPrivate = database.prepare(`
    UPDATE videos SET is_private = 1, availability_checked_at = datetime('now'),
      duration = COALESCE(duration, ''), chapters_json = COALESCE(chapters_json, '[]'),
      chapters_fetched_at = datetime('now'), creators_fetched_at = datetime('now')
    WHERE video_id = ?
  `);
  const markDeleted = database.prepare(`
    UPDATE videos SET is_unavailable = 1, is_short = NULL,
      availability_checked_at = datetime('now')
    WHERE video_id = ?
  `);
  const stopPendingDownload = database.prepare(`
    UPDATE downloads SET status = 'deleted', error = NULL, priority = 0,
      finished_at = datetime('now')
    WHERE video_id = ? AND status != 'done'
  `);
  // Both columns at once: see titleUpdateFor for which is being answered.
  const rememberTitle = database.prepare("UPDATE videos SET title = ?, title_original = ? WHERE video_id = ?");
  const result: ChannelAvailabilitySyncResult = {
    checked: 0, deleted: 0, private: 0, retitled: 0, failed: 0, rateLimited: false, skipped: 0,
  };

  for (const row of candidates) {
    try {
      const answer = await checkVideoAvailability(row.video_id);
      result.checked++;
      if (answer.check === "deleted") {
        await markDeleted.run(row.video_id);
        await stopPendingDownload.run(row.video_id);
        result.deleted++;
        log.info("video.marked_unavailable", { videoId: row.video_id, channelId, source: "channel_sync" });
      } else if (answer.check === "private") {
        await markPrivate.run(row.video_id);
        await stopPendingDownload.run(row.video_id);
        result.private++;
        log.info("video.marked_private", { videoId: row.video_id, channelId, source: "channel_sync" });
      } else {
        await markChecked.run(row.video_id);
        const update = titleUpdateFor(row, answer.title);
        if (update) {
          await rememberTitle.run(update.write, update.write, row.video_id);
          if (update.retitled) {
            result.retitled++;
            log.info("video.title_corrected", { videoId: row.video_id, channelId, title: update.write });
          }
        }
      }
    } catch (error) {
      if (isYouTubeRateLimitError(error)) {
        result.rateLimited = true;
        break;
      }
      /*
       * A check that was never made is not a check that failed.
       *
       * Once YouTube is refusing this address, every remaining lookup comes
       * back with the same answer without leaving the building. Marking those
       * videos checked recorded a verification that never happened — so they
       * were not looked at again for as long as a real one would have bought
       * — and warning once per video turned one piece of news into a page of
       * it: twelve lines for a single refusal. The pass stops and says so
       * once, carrying the reason the first one gave.
       */
      if (isYouTubeRefusal(error)) {
        result.skipped = candidates.length - result.checked - result.failed;
        log.warn("channel.availability_sync_refused", {
          channelId,
          skipped: result.skipped,
          error: error instanceof Error ? error.message : String(error),
        });
        break;
      }
      result.failed++;
      await markChecked.run(row.video_id);
      log.warn("video.availability_check_failed", {
        videoId: row.video_id,
        channelId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (candidates.length > 0) log.info("channel.availability_sync_complete", { channelId, ...result });
  return result;
}
