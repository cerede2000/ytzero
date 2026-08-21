import { database } from "./database";
import type { VideoInfo } from "./youtube";
import { DIRECT_VIDEO_INFO_UPSERT_SQL } from "./videoUpserts";

/**
 * Persist metadata obtained directly from the video's player response.
 *
 * `isShort` is passed in rather than worked out here: settling it can cost a
 * request, and this runs on paths that have already paid for one.
 */
export async function persistDirectVideoInfo(info: VideoInfo, isShort: boolean | null = null): Promise<void> {
  await database.prepare(DIRECT_VIDEO_INFO_UPSERT_SQL).run(
    info.videoId,
    info.channelId,
    info.title,
    info.titleOriginal ?? info.title,
    info.description,
    info.thumbnail,
    info.publishedAt,
    info.liveStatus,
    info.viewCount,
    info.duration,
    info.playableInEmbed === null ? null : info.playableInEmbed ? 1 : 0,
    isShort === null ? null : isShort ? 1 : 0,
  );
}
