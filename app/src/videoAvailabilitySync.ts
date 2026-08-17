import { database } from "./database";
import { log } from "./logger";
import {
  fetchVideoInfo,
  fetchVideoOEmbed,
  isDeletedVideoError,
  isPrivateVideoError,
} from "./youtube";
import { isYouTubeRateLimitError } from "./youtubeRateLimit";

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

export interface ChannelAvailabilitySyncResult {
  checked: number;
  deleted: number;
  private: number;
  retitled: number;
  failed: number;
  rateLimited: boolean;
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
    SELECT video_id FROM videos
    WHERE channel_id = ? AND is_private = 0 AND is_unavailable = 0
      ${dueFilter}
    ORDER BY COALESCE(published_at, created_at) DESC, video_id DESC
    LIMIT ?
  `).all(channelId, AVAILABILITY_CANDIDATE_SCAN) as { video_id: string }[];
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
  /**
   * The title this pass has already been told, written down.
   *
   * These are exactly the videos the channel scrape can no longer reach — the
   * candidates are the rows YouTube did not list this time round — so whatever
   * their title was when they were imported is what they keep for ever. Rows
   * imported while every request went out in English kept an auto-translated
   * title: "Rebuilding Your Wealth at 44: His Plan" for a French video on a
   * French instance, 22 of them on one followed channel.
   *
   * oEmbed does not translate, and this pass already asks it. So the answer is
   * kept rather than thrown away, and a retitled upload is picked up with it.
   */
  const rewriteTitle = database.prepare("UPDATE videos SET title = ? WHERE video_id = ? AND title != ?");
  const result: ChannelAvailabilitySyncResult = {
    checked: 0, deleted: 0, private: 0, retitled: 0, failed: 0, rateLimited: false,
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
        if (answer.title) {
          const rewritten = await rewriteTitle.run(answer.title, row.video_id, answer.title);
          if (Number((rewritten as { changes?: number } | undefined)?.changes ?? 0) > 0) {
            result.retitled++;
            log.info("video.title_corrected", { videoId: row.video_id, channelId, title: answer.title });
          }
        }
      }
    } catch (error) {
      if (isYouTubeRateLimitError(error)) {
        result.rateLimited = true;
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
