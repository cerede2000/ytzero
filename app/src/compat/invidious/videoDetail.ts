import { getDownload, listSubtitleFiles } from "../../downloader";
import { knownSubtitleTracks, subtitleLanguages, subtitleTracks } from "../../subtitleTracks";
import { log } from "../../logger";
import { signedCaptionPath, signedMediaUrl } from "./media";
import { channelThumbnails, videoFromRow, type VideoRowLike } from "./shapes";

export interface DetailRow extends VideoRowLike {
  channel_thumbnail?: string | null;
  channel_subscriber_count?: string | null;
}

/**
 * How long a video's document may wait on subtitles nobody has resolved yet.
 *
 * The resolution is a yt-dlp run with no timeout of its own, and this request
 * is what the client shows a spinner for. Past the budget the answer goes out
 * without captions and the run finishes into the cache anyway, so the next
 * open of the same video has them.
 */
const CAPTION_BUDGET_MS = 8_000;

/**
 * Which subtitles this video can offer right now, and at what cost.
 *
 * The web player asks for the languages when the menu is opened, so nothing is
 * resolved until somebody wants it. A native client has no such moment: the
 * captions it will ever show are the ones declared in this document. So a
 * video with no file on disk pays one resolution here — bounded, and a failure
 * is logged and dropped, because subtitles nobody could list is not a reason to
 * refuse to play the video.
 */
async function captionLanguages(userId: number, videoId: string): Promise<string[]> {
  const files = await listSubtitleFiles(videoId);
  if (files.length) return files.map((file) => file.lang);
  try {
    await Promise.race([
      subtitleTracks(userId, videoId),
      new Promise((resolve) => setTimeout(resolve, CAPTION_BUDGET_MS)),
    ]);
  } catch (error) {
    log.warn("invidious.captions_unresolved", { videoId, error: error instanceof Error ? error.message : String(error) });
  }
  return subtitleLanguages(knownSubtitleTracks(userId, videoId));
}

/**
 * One video, as a client expects to receive it.
 *
 * The stream it names is this server's own, never YouTube's. A CDN link
 * resolved with this instance's cookies answers 403 to the phone that would
 * follow it, and a client seeing a `googlevideo.com` host starts second-
 * guessing us — Yattee probes such a link with HEAD and rewrites its host to
 * proxy through the instance. Pointing at ourselves from the start is both
 * what works and what keeps the client out of the decision.
 */
export async function videoDetail(userId: number, row: DetailRow, origin: string) {
  const languages = await captionLanguages(userId, row.video_id);
  const downloaded = await getDownload(userId, row.video_id);
  const live = row.live_status === "live";
  return {
    ...videoFromRow(row),
    descriptionHtml: row.description ?? "",
    authorThumbnails: channelThumbnails(row.channel_thumbnail),
    authorVerified: false,
    subCountText: row.channel_subscriber_count ?? "",
    allowRatings: true,
    isFamilyFriendly: true,
    isListed: true,
    genre: "",
    keywords: [] as string[],
    /*
     * One entry, and only for what can actually be played through: a muxed
     * file. Splitting audio from video would mean announcing adaptive formats
     * whose separate URLs we do not resolve, and a live stream needs an HLS
     * manifest this does not mint yet — named here, either would be a promise
     * the next request breaks.
     */
    formatStreams: live ? [] : [{
      url: await signedMediaUrl(origin, row.video_id),
      itag: "18",
      type: downloaded?.path?.endsWith(".webm") ? "video/webm" : "video/mp4",
      container: downloaded?.path?.endsWith(".webm") ? "webm" : "mp4",
      quality: "medium",
    }],
    adaptiveFormats: [] as unknown[],
    captions: await Promise.all(languages.map(async (language) => ({
      label: language,
      languageCode: language,
      url: await signedCaptionPath(row.video_id, language),
    }))),
    storyboards: [] as unknown[],
    recommendedVideos: [] as unknown[],
    dashUrl: "",
  };
}
