import { database } from "./database";
import { log } from "./logger";
import { fetchVideoInfo } from "./youtube";
import { YouTubeRefusingError } from "./youtubeRefusalQuiet";
import { persistDirectVideoInfo } from "./videoInfoPersistence";
import { saveRelatedVideos } from "./relatedVideoStore";
import type { RelatedVideo } from "./relatedVideos";
import { videoSelect, type VideoRow } from "./videoRoutesSupport";

/**
 * RSS has no live marker, so an external row is refreshed from its direct
 * player response before the watch page chooses a player or download policy.
 */
export async function refreshExternalWatchVideo(row: VideoRow, userId: number): Promise<VideoRow> {
  if (row.external !== 1) return row;
  try {
    // This downloads the watch page, so it is a second free reading of the
    // panel beside the video — and the one that catches up a video imported
    // before there was anywhere to put it.
    const related: { videos: RelatedVideo[] } = { videos: [] };
    const info = await fetchVideoInfo(row.video_id, { related });
    await persistDirectVideoInfo(info);
    await saveRelatedVideos(row.video_id, related.videos);
    const refreshed = await database.prepare(`${videoSelect(userId)} WHERE v.video_id = ?`).get(row.video_id) as VideoRow;
    if (refreshed.live_status !== row.live_status) {
      log.info("video.live_status_corrected", {
        videoId: row.video_id,
        from: row.live_status,
        to: refreshed.live_status,
        source: "watch_open",
      });
    }
    return refreshed;
  } catch (error) {
    if (error instanceof YouTubeRefusingError) return row;
    log.warn("video.metadata_refresh_failed", {
      videoId: row.video_id,
      source: "watch_open",
      error: error instanceof Error ? error.message : String(error),
    });
    return row;
  }
}
